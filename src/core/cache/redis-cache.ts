/**
 * Advanced Redis Cache System
 *
 * Provides intelligent caching with:
 * - TTL management
 * - Cache invalidation patterns
 * - Compression support
 * - Performance monitoring
 */

import { Redis } from 'ioredis';
import { logger } from '../logger/index.js';
import { metricsCollector } from '../monitoring/metrics-collector.js';
import { env } from '../env.js';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  compress?: boolean;
  pattern?: string; // For invalidation
  version?: string; // For cache versioning
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  avgResponseTime: number;
}

export class RedisCache {
  private redis: Redis;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    totalRequests: 0,
    avgResponseTime: 0
  };
  private defaultTTL = 3600; // 1 hour
  private keyPrefix = 'cipher:cache:';

  constructor() {
    this.redis = new Redis({
      host: (env as any).REDIS_HOST || 'localhost',
      port: (env as any).REDIS_PORT || 6379,
      password: (env as any).REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      logger.error('Redis cache error', { error: error.message });
    });

    this.redis.on('connect', () => {
      logger.info('Redis cache connected');
    });

    // Report stats every minute
    setInterval(() => {
      this.reportStats();
    }, 60000);
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();
    const fullKey = this.keyPrefix + key;

    try {
      const value = await this.redis.get(fullKey);
      const responseTime = Date.now() - startTime;

      this.updateStats(value !== null, responseTime);

      if (value === null) {
        logger.debug('Cache miss', { key });
        return null;
      }

      logger.debug('Cache hit', { key });

      // Try to parse JSON, return as-is if it fails
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch (error) {
      logger.error('Cache get error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const fullKey = this.keyPrefix + key;
    const ttl = options.ttl || this.defaultTTL;

    try {
      let serializedValue: string;

      if (typeof value === 'string') {
        serializedValue = value;
      } else {
        serializedValue = JSON.stringify(value);
      }

      // Add versioning if specified
      if (options.version) {
        const versionedValue = {
          version: options.version,
          data: serializedValue,
          timestamp: Date.now()
        };
        serializedValue = JSON.stringify(versionedValue);
      }

      await this.redis.setex(fullKey, ttl, serializedValue);

      // Add to pattern index for invalidation
      if (options.pattern) {
        await this.redis.sadd(`${this.keyPrefix}patterns:${options.pattern}`, fullKey);
        await this.redis.expire(`${this.keyPrefix}patterns:${options.pattern}`, ttl);
      }

      logger.debug('Cache set', { key, ttl });
    } catch (error) {
      logger.error('Cache set error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Delete specific key
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.keyPrefix + key;

    try {
      await this.redis.del(fullKey);
      logger.debug('Cache delete', { key });
    } catch (error) {
      logger.error('Cache delete error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Invalidate by pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    const patternKey = `${this.keyPrefix}patterns:${pattern}`;

    try {
      const keys = await this.redis.smembers(patternKey);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        await this.redis.del(patternKey);
        logger.info('Cache pattern invalidated', { pattern, keysCount: keys.length });
      }
    } catch (error) {
      logger.error('Cache pattern invalidation error', {
        pattern,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get or set with function
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key);

    if (cached !== null) {
      return cached;
    }

    const value = await fn();
    await this.set(key, value, options);
    return value;
  }

  /**
   * Cache with automatic refresh
   */
  async cacheWithRefresh<T>(
    key: string,
    fn: () => Promise<T>,
    options: CacheOptions & { refreshInterval?: number } = {}
  ): Promise<T> {
    const refreshInterval = options.refreshInterval || 300; // 5 minutes
    const refreshKey = `${key}:refresh`;

    // Check if we need to refresh
    const lastRefresh = await this.redis.get(this.keyPrefix + refreshKey);
    const now = Date.now();

    if (!lastRefresh || (now - parseInt(lastRefresh)) > refreshInterval * 1000) {
      // Background refresh
      this.backgroundRefresh(key, fn, options).catch(error => {
        logger.error('Background cache refresh failed', {
          key,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      // Set refresh timestamp
      await this.redis.setex(this.keyPrefix + refreshKey, refreshInterval, now.toString());
    }

    return this.getOrSet(key, fn, options);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info('Cache cleared', { keysCount: keys.length });
      }
    } catch (error) {
      logger.error('Cache clear error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async backgroundRefresh<T>(
    key: string,
    fn: () => Promise<T>,
    options: CacheOptions
  ): Promise<void> {
    try {
      const value = await fn();
      await this.set(key, value, options);
    } catch (error) {
      logger.error('Background refresh error', {
        key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private updateStats(hit: boolean, responseTime: number): void {
    this.stats.totalRequests++;

    if (hit) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }

    this.stats.hitRate = this.stats.hits / this.stats.totalRequests;

    // Update average response time using exponential moving average
    const alpha = 0.1;
    this.stats.avgResponseTime = this.stats.avgResponseTime === 0
      ? responseTime
      : (alpha * responseTime) + ((1 - alpha) * this.stats.avgResponseTime);
  }

  private reportStats(): void {
    metricsCollector.recordCacheStats(this.stats);
    logger.debug('Cache stats', this.stats);
  }

  async disconnect(): Promise<void> {
    await this.redis.disconnect();
  }
}

// Singleton instance
export const redisCache = new RedisCache();

// Convenience functions
export const cache = {
  get: <T>(key: string) => redisCache.get<T>(key),
  set: <T>(key: string, value: T, options?: CacheOptions) => redisCache.set(key, value, options),
  delete: (key: string) => redisCache.delete(key),
  invalidatePattern: (pattern: string) => redisCache.invalidatePattern(pattern),
  getOrSet: <T>(key: string, fn: () => Promise<T>, options?: CacheOptions) =>
    redisCache.getOrSet(key, fn, options),
  cacheWithRefresh: <T>(key: string, fn: () => Promise<T>, options?: CacheOptions & { refreshInterval?: number }) =>
    redisCache.cacheWithRefresh(key, fn, options),
  clear: () => redisCache.clear(),
  stats: () => redisCache.getStats()
};