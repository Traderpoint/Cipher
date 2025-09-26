"use client"

import { useState, useCallback, useRef, useEffect } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  stale?: boolean;
}

interface CacheConfig {
  defaultTTL?: number; // Default TTL in milliseconds
  maxSize?: number; // Maximum cache entries
  staleWhileRevalidate?: boolean; // Return stale data while fetching new
}

export const useCacheManager = <T = any>(config: CacheConfig = {}) => {
  const {
    defaultTTL = 5 * 60 * 1000, // 5 minutes
    maxSize = 100,
    staleWhileRevalidate = true
  } = config;

  const cacheRef = useRef<Map<string, CacheEntry<T>>>(new Map());
  const [, forceUpdate] = useState({});

  // Force re-render for cache updates
  const triggerUpdate = useCallback(() => {
    forceUpdate({});
  }, []);

  // Clean expired entries
  const cleanExpired = useCallback(() => {
    const now = Date.now();
    const cache = cacheRef.current;

    for (const [key, entry] of cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        cache.delete(key);
      }
    }

    // Limit cache size (LRU-like behavior)
    if (cache.size > maxSize) {
      const entries = Array.from(cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toDelete = entries.slice(0, cache.size - maxSize);
      toDelete.forEach(([key]) => cache.delete(key));
    }
  }, [maxSize]);

  // Set cache entry
  const set = useCallback((key: string, data: T, ttl = defaultTTL) => {
    cleanExpired();

    cacheRef.current.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      stale: false
    });

    triggerUpdate();
  }, [defaultTTL, cleanExpired, triggerUpdate]);

  // Get cache entry
  const get = useCallback((key: string): { data: T; isStale: boolean } | null => {
    const entry = cacheRef.current.get(key);
    if (!entry) return null;

    const now = Date.now();
    const isExpired = now > entry.timestamp + entry.ttl;

    if (isExpired && !staleWhileRevalidate) {
      cacheRef.current.delete(key);
      return null;
    }

    if (isExpired && staleWhileRevalidate) {
      // Mark as stale but return data
      entry.stale = true;
      return { data: entry.data, isStale: true };
    }

    return { data: entry.data, isStale: false };
  }, [staleWhileRevalidate]);

  // Check if key exists and is valid
  const has = useCallback((key: string): boolean => {
    const entry = cacheRef.current.get(key);
    if (!entry) return false;

    const now = Date.now();
    const isExpired = now > entry.timestamp + entry.ttl;

    if (isExpired && !staleWhileRevalidate) {
      cacheRef.current.delete(key);
      return false;
    }

    return true;
  }, [staleWhileRevalidate]);

  // Delete specific entry
  const del = useCallback((key: string) => {
    const deleted = cacheRef.current.delete(key);
    if (deleted) triggerUpdate();
    return deleted;
  }, [triggerUpdate]);

  // Clear all cache
  const clear = useCallback(() => {
    cacheRef.current.clear();
    triggerUpdate();
  }, [triggerUpdate]);

  // Get cache stats
  const getStats = useCallback(() => {
    const cache = cacheRef.current;
    const now = Date.now();
    let validEntries = 0;
    let staleEntries = 0;
    let expiredEntries = 0;

    for (const entry of cache.values()) {
      const isExpired = now > entry.timestamp + entry.ttl;
      if (isExpired) {
        expiredEntries++;
      } else if (entry.stale) {
        staleEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      total: cache.size,
      valid: validEntries,
      stale: staleEntries,
      expired: expiredEntries,
      maxSize
    };
  }, [maxSize]);

  // Auto cleanup every minute
  useEffect(() => {
    const interval = setInterval(cleanExpired, 60000);
    return () => clearInterval(interval);
  }, [cleanExpired]);

  return {
    set,
    get,
    has,
    delete: del,
    clear,
    getStats
  };
};

// Hook for cached fetch operations
export const useCachedFetch = <T = any>(
  url: string,
  options: RequestInit = {},
  cacheConfig: CacheConfig = {}
) => {
  const cache = useCacheManager<T>(cacheConfig);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (force = false): Promise<T | null> => {
    const cacheKey = `${url}-${JSON.stringify(options)}`;

    // Check cache first
    if (!force) {
      const cached = cache.get(cacheKey);
      if (cached && !cached.isStale) {
        return cached.data;
      }

      // Return stale data immediately, fetch in background
      if (cached?.isStale) {
        fetchData(true); // Background refresh
        return cached.data;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      cache.set(cacheKey, data);
      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Fetch failed');
      setError(error);

      // Return stale data if available on error
      const cached = cache.get(cacheKey);
      if (cached) {
        console.warn('Fetch failed, returning stale data:', error.message);
        return cached.data;
      }

      throw error;
    } finally {
      setLoading(false);
    }
  }, [url, options, cache]);

  const invalidate = useCallback(() => {
    const cacheKey = `${url}-${JSON.stringify(options)}`;
    cache.delete(cacheKey);
  }, [url, options, cache]);

  return {
    fetchData,
    invalidate,
    loading,
    error,
    cacheStats: cache.getStats()
  };
};