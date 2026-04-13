/**
 * Lightweight per-IP rate limiter for API routes.
 *
 * Per-instance only — fine for low-traffic deployments. For multi-instance
 * production deployments, swap the in-memory Map for a Redis-backed store.
 *
 * Usage:
 *   const limit = makeRateLimit({ windowMs: 60_000, max: 60 });
 *   if (!limit(req)) return new NextResponse(..., { status: 429 });
 */

interface Bucket {
  count: number;
  resetAt: number;
}

interface Options {
  windowMs: number;
  max: number;
}

/** Resolve a stable client identifier from a Request. Falls back to a
 *  literal "unknown" so we still rate-limit pathological no-IP cases
 *  (single shared bucket is acceptable behaviour for that edge). */
function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function makeRateLimit({ windowMs, max }: Options) {
  const buckets = new Map<string, Bucket>();
  return function checkRateLimit(req: Request): boolean {
    const ip = clientIp(req);
    const now = Date.now();
    const entry = buckets.get(ip);
    if (!entry || entry.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}
