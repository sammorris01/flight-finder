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
  const { isHidden, passes } = useTrackerView(trackerId);

  // Sold-out snapshots carry the last seen price (run-scrape.ts marks the row
  // sold_out but copies the prior price). The listing is no longer bookable, so
  // excluding them keeps a vanished cheap fare from outranking real ones. Also
  // exclude flights the user has hidden or filtered out, so "best price" reflects
  // exactly the flights currently in view.
  const bookable = snapshots.filter(
    (s) => s.status !== 'sold_out' && passes(s) && !isHidden(keyOf(s)),
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
