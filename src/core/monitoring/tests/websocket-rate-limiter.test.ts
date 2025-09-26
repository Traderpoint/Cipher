import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebSocketRateLimiter,
  createConnectionRateLimiter,
  createMessageRateLimiter,
  createFailureRateLimiter
} from '../websocket-rate-limiter.js';

describe('WebSocketRateLimiter', () => {
  let rateLimiter: WebSocketRateLimiter;

  beforeEach(() => {
    rateLimiter = new WebSocketRateLimiter({
      windowMs: 60000, // 1 minute
      maxRequests: 5,
      keyGenerator: (connectionId, clientIP) => `${connectionId}:${clientIP || 'unknown'}`
    });
  });

  afterEach(() => {
    rateLimiter.shutdown();
  });

  describe('Basic Rate Limiting', () => {
    it('should allow requests under the limit', () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      for (let i = 0; i < 5; i++) {
        const result = rateLimiter.checkLimit(connectionId, clientIP, false);
        expect(result.isBlocked).toBe(false);
        expect(result.totalHits).toBe(i + 1);
      }
    });

    it('should block requests over the limit', () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.checkLimit(connectionId, clientIP, false);
      }

      // Next request should be blocked
      const result = rateLimiter.checkLimit(connectionId, clientIP, false);
      expect(result.isBlocked).toBe(true);
      expect(result.totalHits).toBe(6);
    });

    it('should reset after window expires', async () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Create rate limiter with short window for testing
      const shortWindowLimiter = new WebSocketRateLimiter({
        windowMs: 100, // 100ms
        maxRequests: 2
      });

      // Use up the limit
      shortWindowLimiter.checkLimit(connectionId, clientIP, false);
      shortWindowLimiter.checkLimit(connectionId, clientIP, false);

      // Should be blocked
      let result = shortWindowLimiter.checkLimit(connectionId, clientIP, false);
      expect(result.isBlocked).toBe(true);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be allowed again
      result = shortWindowLimiter.checkLimit(connectionId, clientIP, false);
      expect(result.isBlocked).toBe(false);
      expect(result.totalHits).toBe(1);

      shortWindowLimiter.shutdown();
    });
  });

  describe('Failed Request Handling', () => {
    it('should count failed requests separately', () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Make 3 successful and 2 failed requests
      rateLimiter.checkLimit(connectionId, clientIP, false); // success
      rateLimiter.checkLimit(connectionId, clientIP, true);  // failed
      rateLimiter.checkLimit(connectionId, clientIP, false); // success
      rateLimiter.checkLimit(connectionId, clientIP, true);  // failed
      const result = rateLimiter.checkLimit(connectionId, clientIP, false); // success

      expect(result.totalHits).toBe(5);
      expect(result.totalSuccessfulRequests).toBe(3);
      expect(result.totalFailedRequests).toBe(2);
    });

    it('should respect skipSuccessful option', () => {
      const skipSuccessfulLimiter = new WebSocketRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
        skipSuccessful: true
      });

      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Make successful requests (should not count)
      skipSuccessfulLimiter.checkLimit(connectionId, clientIP, false);
      skipSuccessfulLimiter.checkLimit(connectionId, clientIP, false);

      // Make failed requests (should count)
      skipSuccessfulLimiter.checkLimit(connectionId, clientIP, true);
      skipSuccessfulLimiter.checkLimit(connectionId, clientIP, true);
      skipSuccessfulLimiter.checkLimit(connectionId, clientIP, true);

      // Should not be blocked yet (only failed requests count)
      let result = skipSuccessfulLimiter.checkLimit(connectionId, clientIP, true);
      expect(result.isBlocked).toBe(true);
      expect(result.totalHits).toBe(4);
      expect(result.totalFailedRequests).toBe(4);
      expect(result.totalSuccessfulRequests).toBe(0);

      skipSuccessfulLimiter.shutdown();
    });

    it('should respect skipFailedRequests option', () => {
      const skipFailedLimiter = new WebSocketRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        skipFailedRequests: true
      });

      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Make failed requests (should not count)
      skipFailedLimiter.checkLimit(connectionId, clientIP, true);
      skipFailedLimiter.checkLimit(connectionId, clientIP, true);

      // Make successful requests (should count)
      skipFailedLimiter.checkLimit(connectionId, clientIP, false);
      skipFailedLimiter.checkLimit(connectionId, clientIP, false);

      // Should be blocked now
      const result = skipFailedLimiter.checkLimit(connectionId, clientIP, false);
      expect(result.isBlocked).toBe(true);
      expect(result.totalHits).toBe(3);
      expect(result.totalSuccessfulRequests).toBe(3);
      expect(result.totalFailedRequests).toBe(0);

      skipFailedLimiter.shutdown();
    });
  });

  describe('Key Generation', () => {
    it('should use custom key generator', () => {
      const customKeyLimiter = new WebSocketRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        keyGenerator: (connectionId, clientIP) => `custom-${clientIP}`
      });

      // Different connections from same IP should share limit
      customKeyLimiter.checkLimit('conn1', '127.0.0.1', false);
      customKeyLimiter.checkLimit('conn2', '127.0.0.1', false);

      // Should be blocked for any connection from this IP
      const result = customKeyLimiter.checkLimit('conn3', '127.0.0.1', false);
      expect(result.isBlocked).toBe(true);

      customKeyLimiter.shutdown();
    });
  });

  describe('Statistics and Status', () => {
    it('should provide accurate statistics', () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Make some requests
      rateLimiter.checkLimit(connectionId, clientIP, false);
      rateLimiter.checkLimit(connectionId, clientIP, true);
      rateLimiter.checkLimit(connectionId, clientIP, false);

      const stats = rateLimiter.getStats();
      expect(stats.totalKeys).toBe(1);
      expect(stats.activeKeys).toBe(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalSuccessfulRequests).toBe(2);
      expect(stats.totalFailedRequests).toBe(1);
    });

    it('should provide status for all active entries', () => {
      rateLimiter.checkLimit('conn1', '127.0.0.1', false);
      rateLimiter.checkLimit('conn2', '192.168.1.1', false);

      const allStatus = rateLimiter.getAllStatus();
      expect(allStatus).toHaveLength(2);

      const status1 = allStatus.find(s => s.key.includes('127.0.0.1'));
      const status2 = allStatus.find(s => s.key.includes('192.168.1.1'));

      expect(status1).toBeDefined();
      expect(status2).toBeDefined();
      expect(status1!.info.totalHits).toBe(1);
      expect(status2!.info.totalHits).toBe(1);
    });

    it('should get status without incrementing counters', () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Get initial status
      const initialStatus = rateLimiter.getStatus(connectionId, clientIP);
      expect(initialStatus.totalHits).toBe(0);

      // Get status again - should still be 0
      const secondStatus = rateLimiter.getStatus(connectionId, clientIP);
      expect(secondStatus.totalHits).toBe(0);

      // Actually make a request
      rateLimiter.checkLimit(connectionId, clientIP, false);

      // Now status should show 1
      const afterStatus = rateLimiter.getStatus(connectionId, clientIP);
      expect(afterStatus.totalHits).toBe(1);
    });
  });

  describe('Reset and Cleanup', () => {
    it('should reset limits for specific key', () => {
      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Use up the limit
      for (let i = 0; i < 6; i++) {
        rateLimiter.checkLimit(connectionId, clientIP, false);
      }

      // Should be blocked
      let result = rateLimiter.checkLimit(connectionId, clientIP, false);
      expect(result.isBlocked).toBe(true);

      // Reset the limit
      rateLimiter.resetLimit(connectionId, clientIP);

      // Should be allowed again
      result = rateLimiter.checkLimit(connectionId, clientIP, false);
      expect(result.isBlocked).toBe(false);
      expect(result.totalHits).toBe(1);
    });
  });

  describe('Callback Functions', () => {
    it('should call onLimitReached callback', () => {
      const onLimitReached = vi.fn();
      const callbackLimiter = new WebSocketRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
        onLimitReached
      });

      const connectionId = 'test-connection';
      const clientIP = '127.0.0.1';

      // Use up the limit
      callbackLimiter.checkLimit(connectionId, clientIP, false);
      callbackLimiter.checkLimit(connectionId, clientIP, false);

      expect(onLimitReached).not.toHaveBeenCalled();

      // Exceed the limit
      callbackLimiter.checkLimit(connectionId, clientIP, false);

      expect(onLimitReached).toHaveBeenCalledOnce();
      expect(onLimitReached).toHaveBeenCalledWith(
        expect.stringContaining(connectionId),
        expect.any(Number)
      );

      callbackLimiter.shutdown();
    });
  });
});

describe('Pre-configured Rate Limiters', () => {
  it('should create connection rate limiter with correct config', () => {
    const limiter = createConnectionRateLimiter();
    expect(limiter).toBeInstanceOf(WebSocketRateLimiter);

    // Test it works with IP-based limiting
    const stats1 = limiter.getStats();
    limiter.checkLimit('conn1', '127.0.0.1', false);
    const stats2 = limiter.getStats();

    expect(stats2.totalRequests).toBe(stats1.totalRequests + 1);
    limiter.shutdown();
  });

  it('should create message rate limiter with correct config', () => {
    const limiter = createMessageRateLimiter();
    expect(limiter).toBeInstanceOf(WebSocketRateLimiter);

    // Test it works with connection-based limiting
    const stats1 = limiter.getStats();
    limiter.checkLimit('conn1', '127.0.0.1', false);
    const stats2 = limiter.getStats();

    expect(stats2.totalRequests).toBe(stats1.totalRequests + 1);
    limiter.shutdown();
  });

  it('should create failure rate limiter with correct config', () => {
    const limiter = createFailureRateLimiter();
    expect(limiter).toBeInstanceOf(WebSocketRateLimiter);

    // Test it only counts failures
    limiter.checkLimit('conn1', '127.0.0.1', false); // success - should not count
    const stats1 = limiter.getStats();
    expect(stats1.totalRequests).toBe(0);

    limiter.checkLimit('conn1', '127.0.0.1', true); // failure - should count
    const stats2 = limiter.getStats();
    expect(stats2.totalRequests).toBe(1);
    expect(stats2.totalFailedRequests).toBe(1);

    limiter.shutdown();
  });
});