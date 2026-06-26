/**
 * Whether a flight matches a tracker's search criteria. Single source of truth
 * shared by the criteria-change purge (api/queries/[id] PATCH). Mirrors the
 * filters the extraction prompt + code apply, so "what's stored" and "what
 * matches" stay consistent. Lenient on unknown values (null departure/duration
 * are kept) — same as the extraction filters.
 */
export interface SearchCriteria {
  timePreference: string;
  maxStops: number | null;
  maxPrice: number | null;
  maxDurationHours: number | null;
  preferredAirlines: string[];
}

export interface FlightLike {
  departureTime: string | null;
  stops: number;
  price: number;
  airline: string;
  duration: string | null;
}

function departureMinutes(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function inTimeWindow(departureTime: string | null, pref: string): boolean {
  const m = departureMinutes(departureTime);
  if (m === null) return true; // unknown time → keep
  switch (pref) {
    case 'morning':
      return m < 12 * 60;
    case 'afternoon':
      return m >= 12 * 60 && m <= 18 * 60;
    case 'evening':
      return m > 18 * 60;
    case 'redeye':
      return m >= 22 * 60;
    default:
      return true; // 'any'
  }
}

function durationMinutes(d: string | null): number | null {
  if (!d) return null;
  const h = d.match(/(\d+)\s*h/i);
  const m = d.match(/(\d+)\s*m/i);
  if (!h && !m) return null;
  return (h ? parseInt(h[1]!, 10) * 60 : 0) + (m ? parseInt(m[1]!, 10) : 0);
}

export function flightMatchesCriteria(f: FlightLike, c: SearchCriteria): boolean {
  if (!inTimeWindow(f.departureTime, c.timePreference)) return false;
  if (c.maxStops != null && f.stops > c.maxStops) return false;
  if (c.maxPrice != null && f.price > c.maxPrice) return false;
  if (c.maxDurationHours != null) {
    const dm = durationMinutes(f.duration);
    if (dm != null && dm > c.maxDurationHours * 60) return false;
  }
  if (c.preferredAirlines.length > 0) {
    const al = f.airline.toLowerCase();
    const ok = c.preferredAirlines.some((a) => {
      const lower = a.toLowerCase();
      return al.includes(lower) || lower.includes(al);
    });
    if (!ok) return false;
  }
  return true;
}
