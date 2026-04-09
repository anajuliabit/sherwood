/**
 * Twitter Sentiment Provider — fetches token-specific sentiment data from Twitter API v2.
 * Uses OAuth 1.0a for user-context authentication (higher rate limits than app-only).
 * Rate limit: 10 requests/min, 100 tweets/request (Recent Search free tier).
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface TwitterSentimentData {
  mentionVolume: number;           // Total tweets in last hour vs 24h hourly average
  sentimentScore: number;          // Simple keyword-based sentiment (-1 to +1)
  engagementWeightedSentiment: number; // Sentiment weighted by engagement
  volumeSpike: number;             // Ratio of last-hour volume to 24h hourly average
  tweetCount: number;              // Total tweets analyzed
}

interface TwitterTweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
  author_id: string;
}

interface TwitterApiResponse {
  data: TwitterTweet[];
  meta: {
    result_count: number;
    next_token?: string;
  };
}

const TWITTER_BASE = 'https://api.twitter.com/2';

// Map CoinGecko token IDs to Twitter search queries
const TOKEN_TO_SEARCH: Record<string, string> = {
  bitcoin: '$BTC OR #bitcoin',
  ethereum: '$ETH OR #ethereum',
  solana: '$SOL OR #solana',
  arbitrum: '$ARB OR #arbitrum',
  uniswap: '$UNI OR #uniswap',
  aave: '$AAVE OR #aave',
  chainlink: '$LINK OR #chainlink',
  cardano: '$ADA OR #cardano',
  polkadot: '$DOT OR #polkadot',
  avalanche: '$AVAX OR #avalanche',
  near: '$NEAR OR #near',
  cosmos: '$ATOM OR #cosmos',
  sui: '$SUI OR #sui',
  aptos: '$APT OR #aptos',
  maker: '$MKR OR #maker',
  optimism: '$OP OR #optimism',
  polygon: '$MATIC OR #polygon',
  dogecoin: '$DOGE OR #dogecoin',
  litecoin: '$LTC OR #litecoin',
  filecoin: '$FIL OR #filecoin',
  render: '$RENDER OR #render',
  injective: '$INJ OR #injective',
  jupiter: '$JUP OR #jupiter',
  pendle: '$PENDLE OR #pendle',
  pepe: '$PEPE OR #pepe',
};

// Sentiment keywords
const BULLISH_WORDS = [
  'bullish', 'moon', 'pump', 'buy', 'long', 'breakout', 'ath', 'send it', 'lfg', 'wagmi', 'undervalued',
  'hodl', 'diamond hands', 'to the moon', 'rocket', 'bull run', 'green', 'gainz', 'surge', 'rally'
];

const BEARISH_WORDS = [
  'bearish', 'dump', 'sell', 'short', 'crash', 'dead', 'rekt', 'ngmi', 'overvalued', 'scam',
  'paper hands', 'bear market', 'red', 'dip', 'correction', 'bubble', 'rugpull', 'bloodbath'
];

export class TwitterSentimentProvider {
  private cacheDir: string;
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.cacheDir = join(homedir(), '.sherwood', 'agent', 'cache');
  }

  /** Get Twitter sentiment data for a token. Returns null if no data or API failure. */
  async getSentiment(tokenId: string): Promise<TwitterSentimentData | null> {
    const query = TOKEN_TO_SEARCH[tokenId];
    if (!query) {
      // For unknown tokens, try to use the token symbol if available
      return null;
    }

    // Check cache first
    const cached = await this.readCache(tokenId);
    if (cached) return cached;

    try {
      // Fetch recent tweets (last 24 hours for volume analysis)
      const tweets = await this.fetchTweets(query, new Date(Date.now() - 24 * 60 * 60 * 1000));
      if (!tweets || tweets.length === 0) return null;

      // Calculate metrics
      const data = this.analyzeTweets(tweets);

      // Cache results
      await this.writeCache(tokenId, data);

      return data;
    } catch (err) {
      console.error(`Twitter API error for ${tokenId}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Fetch tweets using Twitter API v2 Recent Search with OAuth 1.0a. */
  private async fetchTweets(query: string, startTime: Date): Promise<TwitterTweet[] | null> {
    const apiKey = process.env.TWITTER_API_KEY;
    const apiSecret = process.env.TWITTER_API_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
      throw new Error('Twitter API credentials not found in environment variables');
    }

    const url = new URL(`${TWITTER_BASE}/tweets/search/recent`);
    url.searchParams.set('query', query);
    url.searchParams.set('start_time', startTime.toISOString());
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');

    // Generate OAuth 1.0a signature
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: apiKey,
      oauth_token: accessToken,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: randomBytes(16).toString('hex'),
      oauth_version: '1.0',
    };

    // Create signature base string
    const params = { ...oauthParams, ...Object.fromEntries(url.searchParams) };
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    const signatureBaseString = `GET&${encodeURIComponent(url.origin + url.pathname)}&${encodeURIComponent(sortedParams)}`;

    // Create signing key
    const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessTokenSecret)}`;

    // Generate signature
    const signature = createHmac('sha1', signingKey).update(signatureBaseString).digest('base64');

    // Create Authorization header
    const authHeader = 'OAuth ' + Object.entries({ ...oauthParams, oauth_signature: signature })
      .map(([key, value]) => `${encodeURIComponent(key)}="${encodeURIComponent(value)}"`)
      .join(', ');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'Sherwood-Agent/1.0'
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited
        return null;
      }
      throw new Error(`Twitter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as TwitterApiResponse;
    return data.data || [];
  }

  /** Analyze tweets to calculate sentiment metrics. */
  private analyzeTweets(tweets: TwitterTweet[]): TwitterSentimentData {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Separate recent (last hour) vs all tweets
    const recentTweets = tweets.filter(t => new Date(t.created_at).getTime() > oneHourAgo);
    const allTweets = tweets;

    // Calculate mention volume (recent vs average)
    const recentVolume = recentTweets.length;
    const avgHourlyVolume = allTweets.length / 24; // 24 hours of data
    const volumeSpike = avgHourlyVolume > 0 ? recentVolume / avgHourlyVolume : 1;

    // Analyze sentiment for all tweets
    let bullishCount = 0;
    let bearishCount = 0;
    let totalEngagement = 0;
    let engagementWeightedBullish = 0;
    let engagementWeightedBearish = 0;

    for (const tweet of allTweets) {
      const text = tweet.text.toLowerCase();
      const engagement = tweet.public_metrics.like_count +
                       tweet.public_metrics.retweet_count +
                       tweet.public_metrics.reply_count;

      let tweetBullish = 0;
      let tweetBearish = 0;

      // Count sentiment words
      for (const word of BULLISH_WORDS) {
        if (text.includes(word)) tweetBullish++;
      }
      for (const word of BEARISH_WORDS) {
        if (text.includes(word)) tweetBearish++;
      }

      if (tweetBullish > tweetBearish) {
        bullishCount++;
        engagementWeightedBullish += engagement;
      } else if (tweetBearish > tweetBullish) {
        bearishCount++;
        engagementWeightedBearish += engagement;
      }

      totalEngagement += engagement;
    }

    // Calculate sentiment scores
    const totalAnalyzed = bullishCount + bearishCount;
    const sentimentScore = totalAnalyzed > 0
      ? Math.max(-1, Math.min(1, (bullishCount - bearishCount) / totalAnalyzed))
      : 0;

    const engagementWeightedSentiment = totalEngagement > 0
      ? Math.max(-1, Math.min(1, (engagementWeightedBullish - engagementWeightedBearish) / totalEngagement))
      : sentimentScore;

    return {
      mentionVolume: recentVolume,
      sentimentScore,
      engagementWeightedSentiment,
      volumeSpike,
      tweetCount: allTweets.length,
    };
  }

  /** Read cached sentiment data. */
  private async readCache(tokenId: string): Promise<TwitterSentimentData | null> {
    try {
      const cacheFile = join(this.cacheDir, `twitter-${tokenId}.json`);
      const raw = await readFile(cacheFile, 'utf-8');
      const cached = JSON.parse(raw) as { ts: number; data: TwitterSentimentData };

      if (Date.now() - cached.ts < this.cacheTTL) {
        return cached.data;
      }
    } catch {
      // No cache or invalid cache
    }
    return null;
  }

  /** Write sentiment data to cache. */
  private async writeCache(tokenId: string, data: TwitterSentimentData): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      const cacheFile = join(this.cacheDir, `twitter-${tokenId}.json`);
      await writeFile(cacheFile, JSON.stringify({ ts: Date.now(), data }), 'utf-8');
    } catch {
      // Cache write failure is non-fatal
    }
  }

  /** Get sentiment data with fallback to token symbol for unknown tokens. */
  async getSentimentWithSymbol(tokenId: string, tokenSymbol?: string): Promise<TwitterSentimentData | null> {
    // Try with known token mapping first
    let result = await this.getSentiment(tokenId);

    // If no result and we have a symbol, try searching with symbol
    if (!result && tokenSymbol) {
      const symbolQuery = `$${tokenSymbol.toUpperCase()} OR #${tokenSymbol.toLowerCase()}`;
      try {
        const tweets = await this.fetchTweets(symbolQuery, new Date(Date.now() - 24 * 60 * 60 * 1000));
        if (tweets && tweets.length > 0) {
          result = this.analyzeTweets(tweets);
          await this.writeCache(tokenId, result);
        }
      } catch {
        // Symbol-based search failed
      }
    }

    return result;
  }
}