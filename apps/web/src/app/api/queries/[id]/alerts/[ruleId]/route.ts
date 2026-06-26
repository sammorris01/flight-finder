import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { authorizeMutation } from '@/lib/query-auth';
import type { AuthResult } from '@/lib/query-auth';

async function authForQuery(id: string, token: string | null | undefined): Promise<AuthResult> {
  const query = await prisma.query.findUnique({
    where: { id },
    select: { deleteToken: true, userId: true },
  });
  if (!query) return { ok: false, status: 404, error: 'Tracker not found' };
  return authorizeMutation(query, token);
}

/** PATCH — toggle `enabled` or edit thresholds on a rule. Editing a threshold
 * clears the dedup marker so the new value can fire immediately. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  const { id, ruleId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const auth = await authForQuery(id, body.deleteToken);
  if (!auth.ok) return apiError(auth.error ?? 'Forbidden', auth.status ?? 403);

  const existing = await prisma.alertRule.findFirst({
    where: { id: ruleId, queryId: id },
    select: { id: true },
  });
  if (!existing) return apiError('Alert not found', 404);

  const data: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  let editedThreshold = false;
  if ('targetPrice' in body) {
    data.targetPrice = posOrNull(body.targetPrice);
    editedThreshold = true;
  }
  if ('dropAbs' in body) {
    data.dropAbs = posOrNull(body.dropAbs);
    editedThreshold = true;
  }
  if ('dropPct' in body) {
    const p = posOrNull(body.dropPct);
    data.dropPct = p == null ? null : p > 1 ? p / 100 : p;
    editedThreshold = true;
  }
  if (editedThreshold) data.lastNotifiedPrice = null;

  if (Object.keys(data).length === 0) return apiError('Nothing to update', 400);

  const rule = await prisma.alertRule.update({
    where: { id: ruleId },
    data,
    select: {
      id: true,
      enabled: true,
      targetPrice: true,
      dropAbs: true,
      dropPct: true,
      flightId: true,
      flightLabel: true,
    },
  });
  return apiSuccess({ rule });
}

/** DELETE — remove a rule. Accepts the delete token via query string or body. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  const { id, ruleId } = await params;
  const token =
    req.nextUrl.searchParams.get('deleteToken') ??
    (await req.json().catch(() => null))?.deleteToken;

  const auth = await authForQuery(id, token);
  if (!auth.ok) return apiError(auth.error ?? 'Forbidden', auth.status ?? 403);

  const existing = await prisma.alertRule.findFirst({
    where: { id: ruleId, queryId: id },
    select: { id: true },
  });
  if (!existing) return apiError('Alert not found', 404);

  await prisma.alertRule.delete({ where: { id: ruleId } });
  return apiSuccess({ deleted: true });
}

function posOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
