import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeMutation } from '@/lib/query-auth';

const RULE_SELECT = {
  id: true,
  flightId: true,
  flightLabel: true,
  targetPrice: true,
  dropAbs: true,
  dropPct: true,
  baselinePrice: true,
  currency: true,
  enabled: true,
  lastNotifiedPrice: true,
  lastNotifiedAt: true,
  createdAt: true,
} as const;

/** GET — list a tracker's alert rules. Gated like a mutation so a target price
 * the owner set isn't world-readable on a hosted instance. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = await prisma.query.findUnique({
    where: { id },
    select: { id: true, deleteToken: true, userId: true },
  });
  if (!query) return apiError('Tracker not found', 404);

  const auth = await authorizeMutation(query, req.nextUrl.searchParams.get('deleteToken'));
  if (!auth.ok) return apiError(auth.error ?? 'Forbidden', auth.status ?? 403);

  const rules = await prisma.alertRule.findMany({
    where: { queryId: id },
    orderBy: { createdAt: 'asc' },
    select: RULE_SELECT,
  });
  return apiSuccess({ rules });
}

/** POST — create an alert rule. `flightId` null = whole tracker; set = one flight.
 * At least one of targetPrice / dropAbs / dropPct is required. dropPct accepts a
 * percent (10) or a fraction (0.1). Drop rules capture the current scope price as
 * their baseline at creation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const query = await prisma.query.findUnique({
    where: { id },
    select: { id: true, deleteToken: true, userId: true, currency: true },
  });
  if (!query) return apiError('Tracker not found', 404);

  const auth = await authorizeMutation(query, body.deleteToken);
  if (!auth.ok) return apiError(auth.error ?? 'Forbidden', auth.status ?? 403);

  const flightId = strOrNull(body.flightId);
  const flightLabel = strOrNull(body.flightLabel);
  const targetPrice = numOrNull(body.targetPrice);
  const dropAbs = numOrNull(body.dropAbs);
  const dropPct = normalizePct(numOrNull(body.dropPct));

  if (targetPrice == null && dropAbs == null && dropPct == null) {
    return apiError('Set at least one of: target price, drop by amount, or drop by percent', 400);
  }
  for (const [k, v] of Object.entries({ targetPrice, dropAbs, dropPct })) {
    if (v != null && (!Number.isFinite(v) || v <= 0)) return apiError(`${k} must be a positive number`, 400);
  }
  if (dropPct != null && dropPct >= 1) return apiError('Drop percent must be below 100', 400);

  // Baseline for drop rules = the latest known price for this scope at creation.
  const baselinePrice =
    dropAbs != null || dropPct != null ? await currentScopePrice(id, flightId, query.currency) : null;

  const rule = await prisma.alertRule.create({
    data: {
      queryId: id,
      flightId,
      flightLabel,
      targetPrice,
      dropAbs,
      dropPct,
      baselinePrice,
      currency: query.currency,
    },
    select: RULE_SELECT,
  });
  return apiSuccess({ rule }, 201);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  return typeof v === 'number' ? v : Number(v); // may be NaN; caller validates finiteness
}

/** Accept a percent (10 → 0.10) or an already-fractional value (0.10). */
function normalizePct(v: number | null): number | null {
  if (v == null) return null;
  return v > 1 ? v / 100 : v;
}

async function currentScopePrice(
  queryId: string,
  flightId: string | null,
  currency: string | null,
): Promise<number | null> {
  const snap = await prisma.priceSnapshot.findFirst({
    where: {
      queryId,
      status: 'available',
      ...(flightId ? { flightId } : {}),
      ...(currency ? { currency } : {}),
    },
    orderBy: [{ scrapedAt: 'desc' }, { price: 'asc' }],
    select: { price: true },
  });
  return snap?.price ?? null;
}
