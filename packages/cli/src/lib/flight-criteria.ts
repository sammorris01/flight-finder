// CLI shim for `@/lib/flight-criteria`. The shared scraper (extract-prices.ts)
// imports it to enforce a tracker's search criteria deterministically. Under the
// CLI's tsconfig (`@/*` -> ./src/*) that bare import would not resolve, so
// re-export the real implementation here. tsup's `@` -> apps/web/src alias
// inlines the same module at build time, and the dev loader resolves this
// relative path to it. Same shim role as ./secret-crypto.ts and ./prisma.ts.
export { flightMatchesCriteria } from '../../../../apps/web/src/lib/flight-criteria.js';
export type { SearchCriteria, FlightLike } from '../../../../apps/web/src/lib/flight-criteria.js';
