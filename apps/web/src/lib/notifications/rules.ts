import { prisma } from '@/lib/prisma';
import type { ChannelMessage } from './channels/types';
import { dispatchNotifications } from './notify';
import { formatPrice } from './format';

// Tolerance for float comparisons so IEEE-754 drift can't push a borderline
// trigger just over/under a threshold.
const EPS = 0.005;

/** resolveBaseUrl, inlined to avoid a circular import with run.ts (which imports
 * this module). Same precedence: admin publicBaseUrl → APP_URL → null on a
 * self-hosted box (so links omit rather than point at flight-finder.org). */
function baseUrlFrom(publicBaseUrl?: string | null): string | null {
  const configured = publicBaseUrl || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.SELF_HOSTED === 'true') return null;
  return 'https://flight-finder.org';
}

/**
 * Evaluate per-tracker and per-flight alert rules for the queries scraped this
 * cycle and push a notification when a rule's condition is newly met.
 *
 * Conditions are OR-combined: a rule fires when the current price is at/below
 * its target, OR has dropped by ≥ dropAbs, OR by ≥ dropPct — drops measured from
 * the baseline captured when the rule was created. A drop rule re-arms lower
 * after firing (baseline := the price we just alerted at) so each further drop
 * of the configured size alerts again, while a steady price never re-spams.
 *
 * Per-query isolation: one query's failure is logged and skipped, never thrown,
 * so a cron/manual scrape is never broken by notification work.
 */
export async function evaluateAndNotifyRules(queryIds: string[], cycleStartedAt: Date): Promise<void> {
  const ids = [...new Set(queryIds)];
  if (ids.length === 0) return;

  const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
  const baseUrl = baseUrlFrom(config?.publicBaseUrl);

  for (const queryId of ids) {
    try {
      const query = await prisma.query.findUnique({
        where: { id: queryId },
        select: { id: true, origin: true, destination: true, currency: true, userId: true },
      });
      if (!query) continue;

      const rules = await prisma.alertRule.findMany({
        where: { queryId, enabled: true },
        select: {
          id: true, flightId: true, flightLabel: true, targetPrice: true,
          dropAbs: true, dropPct: true, baselinePrice: true, currency: true, lastNotifiedPrice: true,
        },
      });
      if (rules.length === 0) continue;

      // This cycle's available fares for the query (one row per flight option).
      const snaps = await prisma.priceSnapshot.findMany({
        where: { queryId, status: 'available', scrapedAt: { gte: cycleStartedAt } },
        select: {
          price: true, currency: true, airline: true, bookingUrl: true,
          travelDate: true, flightId: true, departureTime: true,
        },
      });
      if (snaps.length === 0) continue;

      for (const rule of rules) {
        // Flight rules look only at their flightId; tracker rules at every fare.
        const scoped = rule.flightId ? snaps.filter((s) => s.flightId === rule.flightId) : snaps;
        if (scoped.length === 0) continue;

        // Compare within a single currency (prefer the rule/query currency).
        const wantCur = rule.currency ?? query.currency ?? null;
        const inCur = wantCur ? scoped.filter((s) => s.currency === wantCur) : scoped;
        const pool = inCur.length > 0 ? inCur : scoped;
        const cheapest = pool.reduce((a, b) => (b.price < a.price ? b : a));
        const cur = cheapest.currency ?? wantCur;
        const price = cheapest.price;

        const reasons: string[] = [];
        let dropFired = false;
        if (rule.targetPrice != null && price <= rule.targetPrice + EPS) {
          reasons.push(`hit your target of ${formatPrice(rule.targetPrice, cur)}`);
        }
        if (rule.baselinePrice != null) {
          const drop = Math.round((rule.baselinePrice - price) * 100) / 100;
          if (rule.dropAbs != null && drop >= rule.dropAbs - EPS) {
            reasons.push(`dropped ${formatPrice(drop, cur)} from ${formatPrice(rule.baselinePrice, cur)}`);
            dropFired = true;
          }
          if (rule.dropPct != null && rule.dropPct > 0 && drop / rule.baselinePrice >= rule.dropPct - 1e-9) {
            const pct = (Math.round((drop / rule.baselinePrice) * 1000) / 10).toFixed(1);
            reasons.push(`dropped ${pct}% from ${formatPrice(rule.baselinePrice, cur)}`);
            dropFired = true;
          }
        }

        if (reasons.length === 0) {
          // Re-arm once the price climbs back out of the trigger zone, so a fresh
          // dip later alerts again instead of being suppressed forever.
          if (rule.lastNotifiedPrice != null) {
            const aboveTarget = rule.targetPrice == null || price > rule.targetPrice + EPS;
            const aboveBaseline = rule.baselinePrice == null || price >= rule.baselinePrice - EPS;
            if (aboveTarget && aboveBaseline) {
              await prisma.alertRule.update({ where: { id: rule.id }, data: { lastNotifiedPrice: null } });
            }
          }
          continue;
        }

        // Dedup: only (re)alert when this is lower than the last price we alerted
        // for this rule (or we never have). Stops hourly spam at a steady price.
        if (rule.lastNotifiedPrice != null && price >= rule.lastNotifiedPrice - EPS) continue;

        const scopeLabel = rule.flightId ? (rule.flightLabel ?? cheapest.airline) : 'cheapest fare';
        const message = formatRuleMessage({
          route: { origin: query.origin, destination: query.destination },
          scopeLabel,
          price,
          currency: cur,
          reasons,
          airline: cheapest.airline,
          departureTime: cheapest.departureTime,
          bookingUrl: cheapest.bookingUrl,
          baseUrl,
        });
        const outcomes = await dispatchNotifications(query.userId, message);

        // Advance dedup state only once a channel actually delivered, so a
        // transient all-channel failure doesn't consume the alert.
        if (outcomes.some((o) => o.ok)) {
          await prisma.alertRule.update({
            where: { id: rule.id },
            data: {
              lastNotifiedPrice: price,
              lastNotifiedAt: new Date(),
              // Re-arm a drop rule from the price we just alerted at.
              ...(dropFired ? { baselinePrice: price } : {}),
            },
          });
        }
        const sent = outcomes.filter((o) => o.ok).length;
        console.log(
          `[notify] rule=${rule.id} query=${queryId} fired @${price} (${reasons.join('; ')}) ` +
            `sent=${sent}/${outcomes.length}`,
        );
      }
    } catch (err) {
      console.error(`[notify] rules query=${queryId} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Query IDs (among the given set) that have at least one enabled alert rule.
 * The legacy new-low path uses this to skip queries the rule engine owns, so a
 * tracker with custom rules doesn't also fire the generic new-low alert.
 */
export async function queriesWithEnabledRules(queryIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(queryIds)];
  if (ids.length === 0) return new Set();
  const rows = await prisma.alertRule.findMany({
    where: { queryId: { in: ids }, enabled: true },
    select: { queryId: true },
    distinct: ['queryId'],
  });
  return new Set(rows.map((r) => r.queryId));
}

function formatRuleMessage(p: {
  route: { origin: string; destination: string };
  scopeLabel: string;
  price: number;
  currency: string | null;
  reasons: string[];
  airline: string;
  departureTime: string | null;
  bookingUrl: string | null;
  baseUrl: string | null;
}): ChannelMessage {
  const lane = `${p.route.origin}→${p.route.destination}`;
  const flight = p.departureTime ? `${p.airline} ${p.departureTime}` : p.airline;
  const scope = p.scopeLabel === 'cheapest fare' ? 'price alert' : p.scopeLabel;
  const title = `${lane} ${formatPrice(p.price, p.currency)} — ${scope}`;
  const body = `${flight}: ${p.reasons.join(' and ')}.`;
  const url = p.bookingUrl || p.baseUrl || '';
  return {
    title,
    body,
    url,
    data: { lane, price: p.price, currency: p.currency, scope: p.scopeLabel },
  };
}
