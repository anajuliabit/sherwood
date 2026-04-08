/**
 * CoinGecko free API provider with rate-limiting (1.5s between calls).
 */

import type { Provider, ProviderInfo } from "../../types.js";

const BASE_URL = "https://api.coingecko.com/api/v3";

// Shared mutex queue across all instances to prevent 429s.
// Each request chains onto this promise so only one runs at a time with a 3s gap.
let requestQueue: Promise<void> = Promise.resolve();
let sharedLastCallTime = 0;
const MIN_INTERVAL = 5000; // 5s between calls — free tier needs this

export class CoinGeckoProvider implements Provider {
  info(): ProviderInfo {
    return {
      name: "CoinGecko",
      type: "research",
      capabilities: ["price", "market-data", "ohlc", "coin-details", "trending"],
      supportedChains: [],
    };
  }

  /**
   * Serialised request method — every CoinGecko call goes through here.
   * Uses a shared promise chain (mutex) so concurrent calls are queued,
   * each waiting 3s after the previous one completes.
   */
  private fetchJson(url: string): Promise<any> {
    const job = requestQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - sharedLastCallTime;
      if (elapsed < MIN_INTERVAL) {
        await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL - elapsed));
      }
      sharedLastCallTime = Date.now();
      const res = await fetch(url);
      if (res.status === 429) {
        // Rate limited — wait 30s and retry once
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        sharedLastCallTime = Date.now();
        const retry = await fetch(url);
        if (!retry.ok) throw new Error(`CoinGecko error: ${retry.status} ${retry.statusText} — ${url}`);
        return retry.json();
      }
      if (!res.ok) throw new Error(`CoinGecko error: ${res.status} ${res.statusText} — ${url}`);
      return res.json();
    });
    // Chain the next request after this one settles (success or failure)
    requestQueue = job.then(() => {}, () => {});
    return job;
  }

  /**
   * Get simple prices for multiple tokens.
   * Returns price, 24h vol, 24h change, and market cap per token.
   */
  async getPrice(
    ids: string[],
    vsCurrencies: string[] = ["usd"],
  ): Promise<Record<string, any>> {
    const params = new URLSearchParams({
      ids: ids.join(","),
      vs_currencies: vsCurrencies.join(","),
      include_24hr_vol: "true",
      include_24hr_change: "true",
      include_market_cap: "true",
    });
    return this.fetchJson(`${BASE_URL}/simple/price?${params}`);
  }

  /**
   * Get market chart data (prices, market_caps, total_volumes) over time.
   * Note: only fetches for a single id at a time.
   */
  async getMarketData(
    id: string,
    days: number = 30,
  ): Promise<{ prices: number[][]; market_caps: number[][]; total_volumes: number[][] }> {
    const params = new URLSearchParams({
      vs_currency: "usd",
      days: String(days),
    });
    return this.fetchJson(`${BASE_URL}/coins/${encodeURIComponent(id)}/market_chart?${params}`);
  }

  /**
   * Get OHLC candle data.
   * days: 1/7/14/30/90/180/365/max
   * Returns array of [timestamp, open, high, low, close].
   */
  async getOHLC(
    id: string,
    days: number = 30,
  ): Promise<number[][]> {
    const params = new URLSearchParams({
      vs_currency: "usd",
      days: String(days),
    });
    return this.fetchJson(`${BASE_URL}/coins/${encodeURIComponent(id)}/ohlc?${params}`);
  }

  /** Get detailed coin information. */
  async getCoinDetails(id: string): Promise<any> {
    const params = new URLSearchParams({
      localization: "false",
      tickers: "false",
      community_data: "true",
      developer_data: "true",
    });
    return this.fetchJson(`${BASE_URL}/coins/${encodeURIComponent(id)}?${params}`);
  }

  /** Get trending coins. */
  async getTrending(): Promise<any> {
    return this.fetchJson(`${BASE_URL}/search/trending`);
  }
}
