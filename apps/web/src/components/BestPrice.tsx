'use client';

import { currencySymbol } from '@/lib/currency';
import { safeHttpUrl } from '@/lib/safe-url';
import { useTrackerView } from '@/lib/useTrackerView';
import styles from './BestPrice.module.css';

interface Snapshot {
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string | null;
  stops: number;
  flightId: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  duration: string | null;
  vpnCountry: string | null;
  scrapedAt: string;
  status?: string;
}

/** Flight identity, matching the chart legend / Results list keys (flightId). */
function keyOf(s: Snapshot): string {
  return s.flightId ?? `${s.airline}|${s.departureTime ?? ''}|${s.arrivalTime ?? ''}`;
}

export function BestPrice({ snapshots, trackerId }: { snapshots: Snapshot[]; trackerId?: string }) {
  const { isHidden } = useTrackerView(trackerId);
  if (snapshots.length === 0) return null;

  // Cheapest fare in the LATEST scrape — i.e. what's bookable right now — not the
  // all-time low across history, which would show a price that's no longer
  // available (a stale "best price"). Sold-out rows carry a stale price and the
  // booking link is dead, so exclude them; also exclude flights the user hid.
  const latestScrapedAt = snapshots.reduce(
    (mx, s) => (s.scrapedAt > mx ? s.scrapedAt : mx),
    snapshots[0]!.scrapedAt,
  );
  const bookable = snapshots.filter(
    (s) => s.scrapedAt === latestScrapedAt && s.status !== 'sold_out' && !isHidden(keyOf(s)),
  );
  if (bookable.length === 0) return null;

  const best = bookable.reduce((min, s) => (s.price < min.price ? s : min), bookable[0]!);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>Best price found</span>
      </div>
      <div className={styles.content}>
        <span className={styles.price}>
          {currencySymbol(best.currency)}{best.price.toLocaleString('en-US', { minimumFractionDigits: 0 })}
        </span>
        <div className={styles.details}>
          <span className={styles.airline}>{best.airline}</span>
          <span className={styles.meta}>
            {best.stops === 0 ? 'Nonstop' : `${best.stops} stop${best.stops > 1 ? 's' : ''}`}
            {best.duration && ` · ${best.duration}`}
            {(best.departureTime || best.arrivalTime) && ` · ${best.departureTime ?? '?'} - ${best.arrivalTime ?? '?'}`}
          </span>
        </div>
        {safeHttpUrl(best.bookingUrl) && (
          <a
            href={safeHttpUrl(best.bookingUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.bookButton}
          >
            Book on {best.airline}
          </a>
        )}
      </div>
    </div>
  );
}
