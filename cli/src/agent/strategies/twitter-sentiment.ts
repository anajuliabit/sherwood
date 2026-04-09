/**
 * Twitter Sentiment Strategy
 * Uses Twitter API data to generate trading signals based on mention volume,
 * sentiment analysis, and engagement patterns.
 */

import type { Signal } from '../scoring.js';
import type { Strategy, StrategyContext } from './types.js';
import { clamp } from '../utils.js';

export class TwitterSentimentStrategy implements Strategy {
  name = 'twitterSentiment';
  description = 'Analyzes Twitter sentiment and mention volume for trading signals';
  requiredData = ['twitterData'];

  async analyze(ctx: StrategyContext): Promise<Signal> {
    const twitterData = ctx.twitterData;

    if (!twitterData) {
      return {
        name: this.name,
        value: 0.0,
        confidence: 0.0,
        source: 'Twitter Sentiment',
        details: 'No Twitter sentiment data available — requires Twitter API credentials',
      };
    }

    const {
      mentionVolume,
      sentimentScore,
      engagementWeightedSentiment,
      volumeSpike,
      tweetCount,
    } = twitterData;

    let value = 0;
    const details: string[] = [];
    let confidence = this.calculateConfidence(tweetCount, volumeSpike);

    // 1. Volume spike detection (weight 40%)
    const volumeSignal = this.analyzeVolumeSpike(volumeSpike, sentimentScore);
    value += volumeSignal.value * 0.4;
    if (volumeSignal.details) details.push(volumeSignal.details);

    // 2. Engagement-weighted sentiment (weight 40%)
    const sentimentSignal = this.analyzeSentiment(engagementWeightedSentiment);
    value += sentimentSignal.value * 0.4;
    details.push(sentimentSignal.details);

    // 3. Contrarian overlay (weight 20%)
    const contrarianSignal = this.analyzeContrarian(sentimentScore, volumeSpike);
    value += contrarianSignal.value * 0.2;
    if (contrarianSignal.details) details.push(contrarianSignal.details);

    // Add volume and tweet count context
    details.push(`${tweetCount} tweets analyzed, ${volumeSpike.toFixed(2)}x volume spike`);

    return {
      name: this.name,
      value: clamp(value),
      confidence,
      source: 'Twitter Sentiment',
      details: details.join('; '),
    };
  }

  /** Analyze volume spike patterns. */
  private analyzeVolumeSpike(volumeSpike: number, sentimentScore: number): { value: number; details?: string } {
    if (volumeSpike > 5) {
      // Extreme attention
      const signal = sentimentScore > 0 ? 0.5 : -0.5;
      return {
        value: signal,
        details: `Extreme attention (${volumeSpike.toFixed(1)}x volume): ${signal > 0 ? 'bullish momentum' : 'bearish momentum'}`,
      };
    } else if (volumeSpike > 3) {
      // High attention
      const signal = sentimentScore > 0 ? 0.3 : -0.3;
      return {
        value: signal,
        details: `High attention (${volumeSpike.toFixed(1)}x volume): ${signal > 0 ? 'positive buzz' : 'negative buzz'}`,
      };
    } else if (volumeSpike > 1.5) {
      // Moderate attention
      const signal = sentimentScore > 0 ? 0.1 : -0.1;
      return {
        value: signal,
        details: `Moderate buzz (${volumeSpike.toFixed(1)}x volume)`,
      };
    }

    return { value: 0 }; // No significant volume spike
  }

  /** Analyze engagement-weighted sentiment. */
  private analyzeSentiment(engagementWeightedSentiment: number): { value: number; details: string } {
    const sentimentValue = engagementWeightedSentiment * 0.4; // Scale to max ±0.4

    let description: string;
    if (Math.abs(engagementWeightedSentiment) < 0.1) {
      description = 'neutral sentiment';
    } else if (engagementWeightedSentiment > 0.7) {
      description = 'very bullish sentiment';
    } else if (engagementWeightedSentiment > 0.3) {
      description = 'bullish sentiment';
    } else if (engagementWeightedSentiment < -0.7) {
      description = 'very bearish sentiment';
    } else if (engagementWeightedSentiment < -0.3) {
      description = 'bearish sentiment';
    } else {
      description = engagementWeightedSentiment > 0 ? 'mildly bullish' : 'mildly bearish';
    }

    return {
      value: sentimentValue,
      details: `Engagement-weighted ${description} (${(engagementWeightedSentiment > 0 ? '+' : '')}${engagementWeightedSentiment.toFixed(2)})`,
    };
  }

  /** Apply contrarian analysis for extreme sentiment + high volume. */
  private analyzeContrarian(sentimentScore: number, volumeSpike: number): { value: number; details?: string } {
    if (volumeSpike > 3) {
      if (sentimentScore > 0.7) {
        // Extreme bullishness + high volume = potential local top
        return {
          value: -0.2,
          details: 'Contrarian warning: extreme bullishness may indicate local top',
        };
      } else if (sentimentScore < -0.7) {
        // Extreme bearishness + high volume = potential capitulation
        return {
          value: 0.2,
          details: 'Contrarian opportunity: extreme bearishness may indicate capitulation',
        };
      }
    }

    return { value: 0 }; // No contrarian signal
  }

  /** Calculate confidence based on tweet count and volume spike. */
  private calculateConfidence(tweetCount: number, volumeSpike: number): number {
    let confidence = 0.3; // Base confidence

    if (tweetCount >= 100 && volumeSpike > 2) {
      confidence = 0.8;
    } else if (tweetCount >= 50) {
      confidence = 0.7;
    } else if (tweetCount >= 20) {
      confidence = 0.5;
    }

    return confidence;
  }
}