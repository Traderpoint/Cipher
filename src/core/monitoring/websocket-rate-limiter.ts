import { logger } from '../logger/index.js';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  skipSuccessful?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  keyGenerator?: (connectionId: string, clientIP?: string) => string;
  onLimitReached?: (key: string, retryAfter: number) => void;
}

export interface RateLimitInfo {
  totalHits: number;
  totalFailedRequests: number;
  totalSuccessfulRequests: number;
  resetTime: Date;
  retryAfter: number;
  isBlocked: boolean;
}

interface RateLimitStore {
  totalHits: number;
  totalFailedRequests: number;
  totalSuccessfulRequests: number;
  resetTime: number;
}

export class WebSocketRateLimiter {
  private store = new Map<string, RateLimitStore>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private config: RateLimitConfig) {
    // Start cleanup process every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000);
  }

  /**
   * Check if request should be rate limited
   */
  checkLimit(connectionId: string, clientIP?: string, isFailedRequest = false): RateLimitInfo {
    const key = this.config.keyGenerator
      ? this.config.keyGenerator(connectionId, clientIP)
      : `${connectionId}:${clientIP || 'unknown'}`;

    const now = Date.now();
    let record = this.store.get(key);

    // Create new record if doesn't exist or window has expired
    if (!record || now >= record.resetTime) {
      record = {
        totalHits: 0,
        totalFailedRequests: 0,
        totalSuccessfulRequests: 0,
        resetTime: now + this.config.windowMs
      };
    }

    // Increment counters
    const shouldCount = this.shouldCountRequest(isFailedRequest);
    if (shouldCount) {
      record.totalHits++;
      if (isFailedRequest) {
        record.totalFailedRequests++;
      } else {
        record.totalSuccessfulRequests++;
      }
    }

    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    const isBlocked = record.totalHits > this.config.maxRequests;

    // Store updated record
    this.store.set(key, record);

    // Log rate limit violations
    if (isBlocked) {
      logger.warn('WebSocket rate limit exceeded', {
        key,
        connectionId,
        totalHits: record.totalHits,
        maxRequests: this.config.maxRequests,
        windowMs: this.config.windowMs,
        retryAfter
      });

      this.config.onLimitReached?.(key, retryAfter);
    }

    return {
      totalHits: record.totalHits,
      totalFailedRequests: record.totalFailedRequests,
      totalSuccessfulRequests: record.totalSuccessfulRequests,
      resetTime: new Date(record.resetTime),
      retryAfter,
      isBlocked
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  resetLimit(connectionId: string, clientIP?: string): void {
    const key = this.config.keyGenerator
      ? this.config.keyGenerator(connectionId, clientIP)
      : `${connectionId}:${clientIP || 'unknown'}`;

    this.store.delete(key);
    logger.debug('Rate limit reset', { key, connectionId });
  }

  /**
   * Get current rate limit status without incrementing counters
   */
  getStatus(connectionId: string, clientIP?: string): RateLimitInfo {
    const key = this.config.keyGenerator
      ? this.config.keyGenerator(connectionId, clientIP)
      : `${connectionId}:${clientIP || 'unknown'}`;

    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now >= record.resetTime) {
      return {
        totalHits: 0,
        totalFailedRequests: 0,
        totalSuccessfulRequests: 0,
        resetTime: new Date(now + this.config.windowMs),
        retryAfter: Math.ceil(this.config.windowMs / 1000),
        isBlocked: false
      };
    }

    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    return {
      totalHits: record.totalHits,
      totalFailedRequests: record.totalFailedRequests,
      totalSuccessfulRequests: record.totalSuccessfulRequests,
      resetTime: new Date(record.resetTime),
      retryAfter,
      isBlocked: record.totalHits > this.config.maxRequests
    };
  }

  /**
   * Get all active rate limit entries
   */
  getAllStatus(): Array<{ key: string; info: RateLimitInfo }> {
    const now = Date.now();
    const results: Array<{ key: string; info: RateLimitInfo }> = [];

    for (const [key, record] of this.store.entries()) {
      if (now < record.resetTime) { // Only include active entries
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        results.push({
          key,
          info: {
            totalHits: record.totalHits,
            totalFailedRequests: record.totalFailedRequests,
            totalSuccessfulRequests: record.totalSuccessfulRequests,
            resetTime: new Date(record.resetTime),
            retryAfter,
            isBlocked: record.totalHits > this.config.maxRequests
          }
        });
      }
    }

    return results;
  }

  /**
   * Get rate limiting statistics
   */
  getStats(): {
    totalKeys: number;
    activeKeys: number;
    blockedKeys: number;
    totalRequests: number;
    totalFailedRequests: number;
    totalSuccessfulRequests: number;
  } {
    const now = Date.now();
    let activeKeys = 0;
    let blockedKeys = 0;
    let totalRequests = 0;
    let totalFailedRequests = 0;
    let totalSuccessfulRequests = 0;

    for (const record of this.store.values()) {
      if (now < record.resetTime) {
        activeKeys++;
        totalRequests += record.totalHits;
        totalFailedRequests += record.totalFailedRequests;
        totalSuccessfulRequests += record.totalSuccessfulRequests;

        if (record.totalHits > this.config.maxRequests) {
          blockedKeys++;
        }
      }
    }

    return {
      totalKeys: this.store.size,
      activeKeys,
      blockedKeys,
      totalRequests,
      totalFailedRequests,
      totalSuccessfulRequests
    };
  }

  /**
   * Determine if request should be counted based on config
   */
  private shouldCountRequest(isFailedRequest: boolean): boolean {
    if (isFailedRequest && this.config.skipFailedRequests) {
      return false;
    }
    if (!isFailedRequest && this.config.skipSuccessful) {
      return false;
    }
    return true;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, record] of this.store.entries()) {
      if (now >= record.resetTime) {
        this.store.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug('Rate limiter cleanup completed', {
        removedEntries: removedCount,
        remainingEntries: this.store.size
      });
    }
  }

  /**
   * Shutdown the rate limiter
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
    logger.info('WebSocket rate limiter shutdown');
  }
}

// Pre-configured rate limiters for different use cases
export const createConnectionRateLimiter = (): WebSocketRateLimiter => {
  return new WebSocketRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5, // 5 connections per minute per IP
    keyGenerator: (connectionId, clientIP) => `conn:${clientIP}`,
    onLimitReached: (key, retryAfter) => {
      logger.warn('Connection rate limit exceeded', { key, retryAfter });
    }
  });
};

export const createMessageRateLimiter = (): WebSocketRateLimiter => {
  return new WebSocketRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 messages per minute per connection
    keyGenerator: (connectionId) => `msg:${connectionId}`,
    onLimitReached: (key, retryAfter) => {
      logger.warn('Message rate limit exceeded', { key, retryAfter });
    }
  });
};

export const createFailureRateLimiter = (): WebSocketRateLimiter => {
  return new WebSocketRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 10, // 10 failures per 5 minutes
    skipSuccessful: true, // Only count failed requests
    keyGenerator: (connectionId, clientIP) => `fail:${clientIP}`,
    onLimitReached: (key, retryAfter) => {
      logger.error('Failure rate limit exceeded - possible attack', { key, retryAfter });
    }
  });
};