/**
 * Server-side price quoting API route.
 *
 * Caches prices for 30s so all visitors share one set of RPC calls.
 * POST body: { chainId, tokens: [{ token, decimals, feeTier? }], asset, assetDecimals }
 * Returns: { prices: Record<string, { price: number }> }
 */

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { quoteAllTokenPrices } from "@/lib/price-quote";
import type { Address } from "viem";

interface CacheEntry {
  prices: Record<string, { price: number }>;
  timestamp: number;
}

// In-memory cache keyed by "chainId:asset:tokensSorted"
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 30_000; // 30s
const MAX_TOKENS_PER_REQUEST = 25;

// Lightweight in-memory rate limit (per-instance). Production deployments
// behind multiple instances should swap this for an external store (Redis).
const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function buildCacheKey(chainId: number, asset: string, tokens: string[]): string {
  return `${chainId}:${asset}:${[...tokens].sort().join(",")}`;
}

export async function POST(req: Request) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Rate limit exceeded — try again in a minute." },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { chainId, tokens, asset, assetDecimals } = body as {
      chainId: number;
      tokens: { token: string; decimals: number; feeTier?: number }[];
      asset: string;
      assetDecimals: number;
    };

    if (!chainId || !tokens?.length || !asset) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    if (tokens.length > MAX_TOKENS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many tokens. Max ${MAX_TOKENS_PER_REQUEST} per request.` },
        { status: 400 },
      );
    }

    if (!isAddress(asset)) {
      return NextResponse.json({ error: "Invalid asset address" }, { status: 400 });
    }
    for (const t of tokens) {
      if (!isAddress(t.token)) {
        return NextResponse.json(
          { error: `Invalid token address: ${t.token}` },
          { status: 400 },
        );
      }
      if (typeof t.decimals !== "number" || t.decimals < 0 || t.decimals > 36) {
        return NextResponse.json(
          { error: `Invalid decimals for ${t.token}` },
          { status: 400 },
        );
      }
    }

    const cacheKey = buildCacheKey(chainId, asset, tokens.map((t) => t.token));
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.prices);
    }

    const priceMap = await quoteAllTokenPrices(
      chainId,
      tokens.map((t) => ({
        token: t.token as Address,
        decimals: t.decimals,
        feeTier: t.feeTier,
      })),
      asset as Address,
      assetDecimals,
    );

    const prices: Record<string, { price: number }> = {};
    for (const [addr, tp] of priceMap.entries()) {
      prices[addr] = { price: tp.price };
    }

    cache.set(cacheKey, { prices, timestamp: Date.now() });

    return NextResponse.json(prices);
  } catch {
    return NextResponse.json({ error: "Quote failed" }, { status: 500 });
  }
}
