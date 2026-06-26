import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeMutation } from '@/lib/query-auth';
import { isAggregatorSource } from '@/lib/scraper/navigate';

const ALLOWED_INTERVALS = [1, 3, 6, 12, 24];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const token = body?.deleteToken;

  const query = await prisma.query.findUnique({
    where: { id },
    select: { deleteToken: true, groupId: true, userId: true },
  });

  if (!query) return apiError('Tracker not found', 404);

  const auth = await authorizeMutation(query, token);
  if (!auth.ok) return apiError(auth.error ?? 'Forbidden', auth.status ?? 403);

  // Group-cascading fields: applied to every sibling in the group via updateMany.
  // The search criteria (time/stops/price/airlines/cabin/duration) are part of
  // the shared search, so they cascade across the group too.
  const cascadeData: {
    scrapeInterval?: number | null;
    active?: boolean;
    timePreference?: string;
    cabinClass?: string;
    maxStops?: number | null;
    maxPrice?: number | null;
    maxDurationHours?: number | null;
    preferredAirlines?: string[];
  } = {};
  // Per-row fields: applied only to the single id. preferredAggregators is
  // intentionally NOT cascaded — different siblings in a flex group can sit on
  // different aggregators (e.g. one experimental, one default).
  const singleRowData: { preferredAggregators?: string[]; label?: string | null } = {};

  if (body && Object.prototype.hasOwnProperty.call(body, 'scrapeInterval')) {
    let interval: number | null;
    if (body.scrapeInterval === null) {
      interval = null;
    } else {
      interval = Number(body.scrapeInterval);
      if (!ALLOWED_INTERVALS.includes(interval)) {
        return apiError(`scrapeInterval must be null or one of: ${ALLOWED_INTERVALS.join(', ')}`, 400);
      }
    }
    cascadeData.scrapeInterval = interval;
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'active')) {
    if (typeof body.active !== 'boolean') {
      return apiError('active must be a boolean', 400);
    }
    cascadeData.active = body.active;
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'label')) {
    if (body.label === null) {
      singleRowData.label = null;
    } else if (typeof body.label === 'string') {
      const trimmed = body.label.trim();
      if (trimmed.length > 60) {
        return apiError('label must be 60 characters or fewer', 400);
      }
      singleRowData.label = trimmed || null;
    } else {
      return apiError('label must be a string or null', 400);
    }
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'preferredAggregators')) {
    if (!Array.isArray(body.preferredAggregators)) {
      return apiError('preferredAggregators must be an array of strings', 422);
    }
    for (const a of body.preferredAggregators) {
      if (!isAggregatorSource(a)) {
        return apiError(`preferredAggregators contains invalid value: ${JSON.stringify(a)}`, 422);
      }
    }
    singleRowData.preferredAggregators = body.preferredAggregators;
  }

  const TIME_PREFS = ['any', 'morning', 'afternoon', 'evening', 'redeye'];
  if (body && Object.prototype.hasOwnProperty.call(body, 'timePreference')) {
    if (typeof body.timePreference !== 'string' || !TIME_PREFS.includes(body.timePreference)) {
      return apiError(`timePreference must be one of: ${TIME_PREFS.join(', ')}`, 400);
    }
    cascadeData.timePreference = body.timePreference;
  }

  const CABINS = ['economy', 'premium-economy', 'business', 'first'];
  if (body && Object.prototype.hasOwnProperty.call(body, 'cabinClass')) {
    if (typeof body.cabinClass !== 'string' || !CABINS.includes(body.cabinClass)) {
      return apiError(`cabinClass must be one of: ${CABINS.join(', ')}`, 400);
    }
    cascadeData.cabinClass = body.cabinClass;
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'maxStops')) {
    if (body.maxStops === null) {
      cascadeData.maxStops = null;
    } else {
      const n = Number(body.maxStops);
      if (!Number.isInteger(n) || n < 0 || n > 3) return apiError('maxStops must be null or 0–3', 400);
      cascadeData.maxStops = n;
    }
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'maxPrice')) {
    if (body.maxPrice === null) {
      cascadeData.maxPrice = null;
    } else {
      const n = Number(body.maxPrice);
      if (!Number.isFinite(n) || n <= 0) return apiError('maxPrice must be null or a positive number', 400);
      cascadeData.maxPrice = n;
    }
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'maxDurationHours')) {
    if (body.maxDurationHours === null) {
      cascadeData.maxDurationHours = null;
    } else {
      const n = Number(body.maxDurationHours);
      if (!Number.isFinite(n) || n <= 0) return apiError('maxDurationHours must be null or a positive number', 400);
      cascadeData.maxDurationHours = n;
    }
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'preferredAirlines')) {
    if (!Array.isArray(body.preferredAirlines) || body.preferredAirlines.some((a: unknown) => typeof a !== 'string')) {
      return apiError('preferredAirlines must be an array of strings', 422);
    }
    cascadeData.preferredAirlines = body.preferredAirlines.map((a: string) => a.trim()).filter(Boolean);
  }

  if (Object.keys(cascadeData).length === 0 && Object.keys(singleRowData).length === 0) {
    return apiError('No updatable fields supplied', 400);
  }

  const idsToUpdate = [id];
  if (query.groupId && Object.keys(cascadeData).length > 0) {
    const siblings = await prisma.query.findMany({
      where: { groupId: query.groupId, id: { not: id } },
      select: { id: true },
    });
    idsToUpdate.push(...siblings.map((s) => s.id));
  }

  if (Object.keys(cascadeData).length > 0) {
    await prisma.query.updateMany({
      where: { id: { in: idsToUpdate } },
      data: cascadeData,
    });
  }

  if (Object.keys(singleRowData).length > 0) {
    await prisma.query.update({
      where: { id },
      data: singleRowData,
    });
  }

  return apiSuccess({ ...cascadeData, ...singleRowData, updated: idsToUpdate.length });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const token = body?.deleteToken;
  const groupDelete = body?.groupDelete === true;

  const query = await prisma.query.findUnique({
    where: { id },
    select: { deleteToken: true, groupId: true, userId: true },
  });

  if (!query) {
    return apiError('Tracker not found', 404);
  }

  const auth = await authorizeMutation(query, token);
  if (!auth.ok) return apiError(auth.error ?? 'Forbidden', auth.status ?? 403);

  if (groupDelete && query.groupId) {
    const result = await prisma.query.deleteMany({ where: { groupId: query.groupId } });
    return apiSuccess({ deleted: true, groupDeleted: true, count: result.count });
  }

  await prisma.query.delete({ where: { id } });

  return apiSuccess({ deleted: true, groupDeleted: false });
}
