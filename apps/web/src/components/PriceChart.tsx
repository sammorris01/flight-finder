'use client';

import { useMemo, useRef, useState, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { currencySymbol } from '@/lib/currency';
import { safeHttpUrl } from '@/lib/safe-url';
import { useTrackerView } from '@/lib/useTrackerView';
import styles from './PriceChart.module.css';

// react-plotly.js's bundled types don't export PlotParams or the legend-click
// events, so type just the props we actually pass (the events are supported at
// runtime). `data`/`layout`/`config` stay loose — Plotly validates them anyway.
type PlotlyGraphDiv = { data?: Array<{ meta?: string; visible?: boolean | string }> };
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false }) as unknown as ComponentType<{
  data: unknown[];
  layout?: unknown;
  config?: unknown;
  style?: Record<string, string | number>;
  onClick?: (data: { points: Array<{ customdata?: unknown }> }) => void;
  onInitialized?: (figure: unknown, graphDiv: PlotlyGraphDiv) => void;
  onRestyle?: () => void;
}>;

interface Snapshot {
  id: string;
  travelDate: string;
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string | null;
  stops: number;
  duration: string | null;
  flightId: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  seatsLeft: number | null;
  status: string;
  airlineDirectPrice: number | null;
  vpnCountry: string | null;
  scrapedAt: string;
}

type ChartView = 'all' | 'local' | 'comparison' | string; // string = specific country code

// Distinct colors cycled per flight (departure), so each tracked flight is its
// own clearly-separable line rather than every airline collapsing to one color.
const FLIGHT_COLORS = [
  '#80a8a5', '#c1272d', '#d4a574', '#8b5cf6', '#ec4899', '#14b8a6',
  '#3b82f6', '#f97316', '#22c55e', '#eab308', '#a855f7', '#06b6d4',
];

const COUNTRY_COLORS = ['#80a8a5', '#c1272d', '#d4a574', '#8b5cf6', '#ec4899', '#14b8a6', '#3b82f6', '#f97316'];

function countryFlag(code: string): string {
  return String.fromCodePoint(...code.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Parse a "6:40 AM" / "1:55 PM" departure label into minutes-from-midnight so
 * flights sort in schedule order. Missing/unparseable times sort last. */
function departureMinutes(t: string | null | undefined): number {
  if (!t) return Number.MAX_SAFE_INTEGER;
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  let h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

/** A UTC ISO scrape timestamp → naive local "YYYY-MM-DD HH:MM:SS" so Plotly's
 * x-axis shows the viewer's own wall-clock time. Plotly.js does not localize
 * timezones, so without this it renders the raw UTC time (off by the local
 * offset, e.g. ~1h on BST). Flight departure/arrival times are left untouched —
 * those are airport-local by aviation convention. */
function toLocalAxis(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function buildDetailTraces(snapshots: Snapshot[], sym: string, hasVpnData: boolean) {
  // Chart only identifiable individual flights: one line per departure (flightId),
  // grouped under its airline in the legend. Snapshots with no flight identity
  // (early scrapes where the departure couldn't be read) are dropped from the
  // detail view rather than collapsed into a confusing bare-airline line.
  const available = snapshots.filter((s) => s.status !== 'sold_out' && s.flightId);

  const byGroup = new Map<string, Snapshot[]>();
  for (const s of available) {
    const fid = s.flightId!; // guaranteed by the filter above
    const key = hasVpnData && s.vpnCountry ? `${fid} (${s.vpnCountry})` : fid;
    const existing = byGroup.get(key) ?? [];
    existing.push(s);
    byGroup.set(key, existing);
  }

  // Sort points chronologically (clean left→right line), then order the series by
  // airline and, within an airline, by departure time so each carrier's flights
  // read top-to-bottom in schedule order.
  const groups = Array.from(byGroup.values())
    .map((points) => [...points].sort((a, b) => a.scrapedAt.localeCompare(b.scrapedAt)))
    .sort((a, b) => {
      const byAirline = (a[0]?.airline ?? '').localeCompare(b[0]?.airline ?? '');
      if (byAirline !== 0) return byAirline;
      return departureMinutes(a[0]?.departureTime) - departureMinutes(b[0]?.departureTime);
    });

  let idx = 0;
  const result = groups.map((points) => {
    const first = points[0];
    const airline = first?.airline ?? 'Flight';
    const time = first?.departureTime ?? 'time n/a';
    const vpn = hasVpnData && first?.vpnCountry ? ` (${first.vpnCountry})` : '';
    const color = FLIGHT_COLORS[idx++ % FLIGHT_COLORS.length]!;
    return {
      x: points.map((p) => toLocalAxis(p.scrapedAt)),
      y: points.map((p) => p.price),
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      // Grouped under an airline heading, so the entry only needs the departure time.
      name: `${time}${vpn}`,
      legendgroup: airline,
      legendgrouptitle: { text: airline },
      // Stable id (flightId) shared with the Price History list for visibility sync.
      meta: first?.flightId ?? `${airline}-${time}`,
      line: { color, width: 2 },
      marker: { color, size: 6 },
      customdata: points.map((p) => [p.bookingUrl]),
      text: points.map((p) => {
        const lines = [
          `<b>${airline} · ${p.departureTime ?? time}</b>`,
          `<b>${sym}${p.price.toFixed(2)}</b> ${p.currency}`,
          new Date(p.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        ];
        if (p.departureTime || p.arrivalTime) {
          lines.push(`${p.departureTime ?? '?'} - ${p.arrivalTime ?? '?'}`);
        }
        if (p.duration) lines.push(p.duration);
        if (p.seatsLeft) lines.push(`${p.seatsLeft} seats left`);
        if (p.vpnCountry) lines.push(`${countryFlag(p.vpnCountry)} Scraped from ${p.vpnCountry}`);
        return lines.join('<br>');
      }),
      hovertemplate: '%{text}<extra></extra>',
    };
  });

  return result;
}

/** Comparison view: one line per country showing the cheapest price at each scrape time */
function buildComparisonTraces(snapshots: Snapshot[], sym: string) {
  const available = snapshots.filter((s) => s.status !== 'sold_out');

  // Group by country label
  const byCountry = new Map<string, Snapshot[]>();
  for (const s of available) {
    const label = s.vpnCountry ?? 'Local';
    const existing = byCountry.get(label) ?? [];
    existing.push(s);
    byCountry.set(label, existing);
  }

  let idx = 0;
  return Array.from(byCountry.entries()).map(([label, points]) => {
    // Group by scrapedAt timestamp (rounded to minute) and pick cheapest
    const byTime = new Map<string, Snapshot>();
    for (const p of points) {
      const timeKey = p.scrapedAt.slice(0, 16); // YYYY-MM-DDTHH:MM
      const existing = byTime.get(timeKey);
      if (!existing || p.price < existing.price) {
        byTime.set(timeKey, p);
      }
    }

    const cheapest = Array.from(byTime.values()).sort(
      (a, b) => new Date(a.scrapedAt).getTime() - new Date(b.scrapedAt).getTime()
    );

    const color = COUNTRY_COLORS[idx % COUNTRY_COLORS.length]!;
    const flag = label !== 'Local' ? countryFlag(label) + ' ' : '';
    idx++;

    return {
      x: cheapest.map((p) => toLocalAxis(p.scrapedAt)),
      y: cheapest.map((p) => p.price),
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: `${flag}${label}`,
      line: { color, width: 3 },
      marker: { color, size: 8 },
      customdata: cheapest.map((p) => [p.bookingUrl]),
      text: cheapest.map((p) => {
        const lines = [
          `<b>${sym}${p.price.toFixed(2)}</b> cheapest from ${flag}${label}`,
          `${p.airline}`,
          new Date(p.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        ];
        return lines.join('<br>');
      }),
      hovertemplate: '%{text}<extra>%{fullData.name}</extra>',
    };
  });
}

export function PriceChart({
  snapshots,
  currency = 'USD',
  trackerId,
}: {
  snapshots: Snapshot[];
  currency?: string;
  trackerId?: string;
}) {
  const sym = currencySymbol(currency);

  // Detect VPN data and available countries
  const vpnCountries = useMemo(() => {
    const countries = new Set<string>();
    for (const s of snapshots) {
      if (s.vpnCountry) countries.add(s.vpnCountry);
    }
    return Array.from(countries).sort();
  }, [snapshots]);

  const hasVpnData = vpnCountries.length > 0;
  const [view, setView] = useState<ChartView>('all');

  // Per-tracker hidden-flight state, shared with the Price History list (keyed by
  // flightId) so the chart legend and the list toggle together and persist.
  const { hidden: hiddenKeys, setHidden: saveHidden, passes } = useTrackerView(trackerId);

  // The live Plotly graph div, captured once, so onRestyle can read the actual
  // per-trace visibility after any legend interaction.
  const graphRef = useRef<PlotlyGraphDiv | null>(null);

  // Filter snapshots based on selected view
  const filteredSnapshots = useMemo(() => {
    if (view === 'all') return snapshots;
    if (view === 'local') return snapshots.filter((s) => !s.vpnCountry);
    if (view === 'comparison') return snapshots; // comparison uses all data but builds different traces
    // Specific country code
    return snapshots.filter((s) => s.vpnCountry === view);
  }, [snapshots, view]);

  // Apply the active departure/arrival/stops filters: a flight that fails drops
  // off the chart entirely (consistent with the Results list and Best Price).
  const viewSnapshots = useMemo(() => filteredSnapshots.filter((s) => passes(s)), [filteredSnapshots, passes]);

  const traces = useMemo(() => {
    if (view === 'comparison') {
      return buildComparisonTraces(viewSnapshots, sym);
    }
    return buildDetailTraces(viewSnapshots, sym, hasVpnData && view === 'all');
  }, [viewSnapshots, sym, view, hasVpnData]);

  // Apply remembered visibility: a hidden flight renders as `legendonly`.
  const displayTraces = useMemo(
    () =>
      traces.map((t) => {
        const key = (t as { meta?: string }).meta;
        if (!key) return t;
        return { ...t, visible: hiddenKeys.has(key) ? ('legendonly' as const) : (true as const) };
      }),
    [traces, hiddenKeys],
  );

  if (snapshots.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No price data yet</p>
        <p className={styles.emptyHint}>
          Prices will appear after the first scrape runs. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {hasVpnData && (
        <div className={styles.viewFilter}>
          <select
            className={styles.viewSelect}
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="all">All countries</option>
            <option value="comparison">Country comparison (cheapest)</option>
            <option value="local">Local only</option>
            {vpnCountries.map((code) => (
              <option key={code} value={code}>
                {countryFlag(code)} {code} only
              </option>
            ))}
          </select>
        </div>
      )}
      <Plot
        data={displayTraces}
        layout={{
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { family: 'IBM Plex Mono, monospace', color: '#8b9ec2', size: 11 },
          margin: { t: 20, r: 20, b: 50, l: 60 },
          xaxis: {
            gridcolor: '#243049',
            tickformat: '%b %d %H:%M',
            title: { text: '' },
          },
          yaxis: {
            gridcolor: '#243049',
            tickprefix: sym,
            title: { text: '' },
          },
          legend: {
            orientation: 'h',
            y: -0.15,
            font: { size: 11 },
            // Clicking a flight toggles just that flight; clicking the airline
            // heading toggles the whole group.
            groupclick: 'toggleitem',
          },
          // Opaque hover box. The unified label otherwise inherits the
          // transparent paper_bgcolor, so the x axis date ticks bled through
          // it into unreadable text-on-text when hovering a low point (#97).
          // A solid surface cleanly occludes whatever sits behind the box.
          hoverlabel: {
            bgcolor: '#0e3640',
            bordercolor: '#80a8a5',
            font: { family: 'IBM Plex Mono, monospace', color: '#ecdfc0', size: 11 },
            align: 'left',
          },
          hovermode: 'x unified',
          autosize: true,
        }}
        config={{
          responsive: true,
          displayModeBar: false,
        }}
        style={{ width: '100%', height: '400px' }}
        onClick={(data) => {
          const point = data.points[0];
          if (point?.customdata) {
            const url = safeHttpUrl((point.customdata as string[])[0]);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          }
        }}
        onInitialized={(_figure, graphDiv) => {
          graphRef.current = graphDiv;
        }}
        onRestyle={() => {
          // After any legend interaction — single flight, airline heading (group),
          // or double-click — read the chart's actual per-trace visibility and
          // mirror it into the shared state, so the Price History list and
          // persistence track every kind of toggle. 'legendonly' = hidden via legend.
          const data = graphRef.current?.data;
          if (!data) return;
          // Start from the existing hidden set so flights NOT currently plotted
          // (filtered out) keep their state; only update the plotted ones.
          const next = new Set(hiddenKeys);
          for (const t of data) {
            if (!t.meta) continue;
            if (t.visible === 'legendonly') next.add(t.meta);
            else next.delete(t.meta);
          }
          const changed = next.size !== hiddenKeys.size || [...next].some((k) => !hiddenKeys.has(k));
          if (changed) saveHidden(next);
        }}
      />
    </div>
  );
}
