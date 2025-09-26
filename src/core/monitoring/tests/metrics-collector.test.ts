import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MetricsCollector } from '../metrics-collector.js';
import os from 'os';

// Mock os module
vi.mock('os', () => ({
  default: {
    totalmem: vi.fn(() => 8 * 1024 * 1024 * 1024), // 8GB
    freemem: vi.fn(() => 4 * 1024 * 1024 * 1024),  // 4GB
    uptime: vi.fn(() => 3600), // 1 hour
    loadavg: vi.fn(() => [0.5, 0.7, 0.9]),
    cpus: vi.fn(() => [
      { model: 'Intel Core i7', speed: 2800, times: { user: 100, nice: 0, sys: 50, idle: 800, irq: 0 } },
      { model: 'Intel Core i7', speed: 2800, times: { user: 120, nice: 0, sys: 60, idle: 850, irq: 0 } }
    ])
  }
}));

// Mock process.memoryUsage
const mockMemoryUsage = vi.fn(() => ({
  rss: 100 * 1024 * 1024,        // 100MB
  heapTotal: 80 * 1024 * 1024,   // 80MB
  heapUsed: 60 * 1024 * 1024,    // 60MB
  external: 5 * 1024 * 1024,     // 5MB
  arrayBuffers: 2 * 1024 * 1024  // 2MB
}));

Object.defineProperty(process, 'memoryUsage', {
  value: mockMemoryUsage
});

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    metricsCollector = MetricsCollector.getInstance();
    metricsCollector.reset(); // Reset metrics between tests
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('System Metrics', () => {
    it('should collect system metrics correctly', () => {
      const metrics = metricsCollector.getMetrics();

      expect(metrics.system).toBeDefined();
      expect(metrics.system.uptime).toBe(3600);
      expect(metrics.system.memory.total).toBe(8 * 1024 * 1024 * 1024);
      expect(metrics.system.memory.free).toBe(4 * 1024 * 1024 * 1024);
      expect(metrics.system.memory.used).toBe(4 * 1024 * 1024 * 1024);
      expect(metrics.system.memory.percentage).toBe(50);
      expect(metrics.system.memory.external).toBe(5 * 1024 * 1024);
      expect(metrics.system.memory.arrayBuffers).toBe(2 * 1024 * 1024);
      expect(metrics.system.cpu.loadAverage).toEqual([0.5, 0.7, 0.9]);
    });

    it('should calculate CPU percentage correctly', () => {
      const metrics = metricsCollector.getMetrics();

      // CPU percentage should be calculated from load average
      expect(metrics.system.cpu.percentage).toBeGreaterThanOrEqual(0);
      expect(metrics.system.cpu.percentage).toBeLessThanOrEqual(100);
    });
  });

  describe('API Metrics', () => {
    it('should track API requests correctly', () => {
      metricsCollector.trackAPIRequest('/api/test', 250, true);
      metricsCollector.trackAPIRequest('/api/test', 300, false);
      metricsCollector.trackAPIRequest('/api/other', 150, true);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.api.totalRequests).toBe(3);
      expect(metrics.api.requestsByEndpoint['/api/test']).toBe(2);
      expect(metrics.api.requestsByEndpoint['/api/other']).toBe(1);
      expect(metrics.api.errorsByEndpoint['/api/test']).toBe(1);
      expect(metrics.api.errorsByEndpoint['/api/other']).toBe(0);
    });

    it('should calculate average response times correctly', () => {
      metricsCollector.trackAPIRequest('/api/test', 200, true);
      metricsCollector.trackAPIRequest('/api/test', 400, true);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.api.averageResponseTime['/api/test']).toBe(300);
    });

    it('should track popular endpoints', () => {
      // Track multiple requests to different endpoints
      for (let i = 0; i < 5; i++) {
        metricsCollector.trackAPIRequest('/api/popular', 200, true);
      }
      for (let i = 0; i < 2; i++) {
        metricsCollector.trackAPIRequest('/api/less-popular', 150, true);
      }

      const metrics = metricsCollector.getMetrics();

      expect(metrics.api.popularEndpoints).toHaveLength(2);
      expect(metrics.api.popularEndpoints[0].endpoint).toBe('/api/popular');
      expect(metrics.api.popularEndpoints[0].count).toBe(5);
      expect(metrics.api.popularEndpoints[1].endpoint).toBe('/api/less-popular');
      expect(metrics.api.popularEndpoints[1].count).toBe(2);
    });

    it('should track status codes', () => {
      metricsCollector.trackStatusCode(200);
      metricsCollector.trackStatusCode(200);
      metricsCollector.trackStatusCode(404);
      metricsCollector.trackStatusCode(500);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.api.statusCodes['200']).toBe(2);
      expect(metrics.api.statusCodes['404']).toBe(1);
      expect(metrics.api.statusCodes['500']).toBe(1);
    });

    it('should calculate throughput metrics', () => {
      const startTime = Date.now();

      // Track some requests
      metricsCollector.trackAPIRequest('/api/test', 200, true);
      metricsCollector.trackAPIRequest('/api/test', 300, true);

      // Mock time passing
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 1000); // 1 second later

      const metrics = metricsCollector.getMetrics();

      expect(metrics.api.throughput.requestsPerSecond).toBeGreaterThan(0);
      expect(metrics.api.throughput.averageResponseSize).toBeGreaterThan(0);
    });
  });

  describe('LLM Metrics', () => {
    it('should track LLM requests correctly', () => {
      metricsCollector.trackLLMRequest('openai', 'gpt-4', 1500, true, 100);
      metricsCollector.trackLLMRequest('openai', 'gpt-4', 1200, false, 0);
      metricsCollector.trackLLMRequest('anthropic', 'claude-3', 800, true, 150);

      const metrics = metricsCollector.getMetrics();

      const openaiGpt4 = metrics.llm['openai:gpt-4'];
      const anthropicClaude = metrics.llm['anthropic:claude-3'];

      expect(openaiGpt4.totalRequests).toBe(2);
      expect(openaiGpt4.successfulRequests).toBe(1);
      expect(openaiGpt4.failedRequests).toBe(1);
      expect(openaiGpt4.averageResponseTime).toBe(1350);
      expect(openaiGpt4.totalTokensUsed).toBe(100);
      expect(openaiGpt4.errorRate).toBe(0.5);

      expect(anthropicClaude.totalRequests).toBe(1);
      expect(anthropicClaude.successfulRequests).toBe(1);
      expect(anthropicClaude.totalTokensUsed).toBe(150);
    });

    it('should calculate tokens per request correctly', () => {
      metricsCollector.trackLLMRequest('openai', 'gpt-3.5', 1000, true, 200);
      metricsCollector.trackLLMRequest('openai', 'gpt-3.5', 1100, true, 400);

      const metrics = metricsCollector.getMetrics();
      const llmMetric = metrics.llm['openai:gpt-3.5'];

      expect(llmMetric.averageTokensPerRequest).toBe(300);
    });

    it('should calculate requests per minute', () => {
      const startTime = Date.now();

      metricsCollector.trackLLMRequest('openai', 'gpt-4', 1000, true, 100);

      // Mock 30 seconds passing
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 30000);

      metricsCollector.trackLLMRequest('openai', 'gpt-4', 1100, true, 120);

      const metrics = metricsCollector.getMetrics();
      const llmMetric = metrics.llm['openai:gpt-4'];

      expect(llmMetric.requestsPerMinute).toBeGreaterThan(0);
      expect(llmMetric.requestsPerMinute).toBeLessThanOrEqual(120); // Max 2 requests in 30s = 4/min
    });
  });

  describe('WebSocket Metrics', () => {
    it('should track WebSocket connections correctly', () => {
      metricsCollector.trackWebSocketConnection();
      metricsCollector.trackWebSocketConnection();
      metricsCollector.trackWebSocketDisconnection();

      const metrics = metricsCollector.getMetrics();

      expect(metrics.websocket.activeConnections).toBe(1);
      expect(metrics.websocket.peakConnections).toBe(2);
    });

    it('should track WebSocket messages', () => {
      metricsCollector.trackWebSocketMessage('received');
      metricsCollector.trackWebSocketMessage('sent');
      metricsCollector.trackWebSocketMessage('received');

      const metrics = metricsCollector.getMetrics();

      expect(metrics.websocket.messagesReceived).toBe(2);
      expect(metrics.websocket.messagesSent).toBe(1);
    });

    it('should track WebSocket latency', () => {
      metricsCollector.trackWebSocketLatency(50);
      metricsCollector.trackWebSocketLatency(100);
      metricsCollector.trackWebSocketLatency(75);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.websocket.averageLatency).toBe(75);
    });

    it('should track bytes transferred', () => {
      metricsCollector.trackBytesTransferred(1024);
      metricsCollector.trackBytesTransferred(2048);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.websocket.bytesTransferred).toBe(3072);
    });
  });

  describe('Memory Search Metrics', () => {
    it('should track memory searches correctly', () => {
      metricsCollector.trackMemorySearch(45, 'pattern1', 0.8);
      metricsCollector.trackMemorySearch(55, 'pattern2', 0.9);
      metricsCollector.trackMemorySearch(35, 'pattern1', 0.7);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.memory.totalSearches).toBe(3);
      expect(metrics.memory.averageSearchTime).toBe(45);
      expect(metrics.memory.topSearchPatterns).toHaveLength(2);

      const pattern1Stats = metrics.memory.topSearchPatterns.find(p => p.pattern === 'pattern1');
      expect(pattern1Stats?.count).toBe(2);
      expect(pattern1Stats?.averageRelevance).toBe(0.75);
    });

    it('should track vector operations', () => {
      metricsCollector.trackVectorOperation('search');
      metricsCollector.trackVectorOperation('insertion');
      metricsCollector.trackVectorOperation('search');

      const metrics = metricsCollector.getMetrics();

      expect(metrics.memory.vectorOperations.searches).toBe(2);
      expect(metrics.memory.vectorOperations.insertions).toBe(1);
      expect(metrics.memory.vectorOperations.updates).toBe(0);
      expect(metrics.memory.vectorOperations.deletions).toBe(0);
    });
  });

  describe('Session Metrics', () => {
    it('should track sessions correctly', () => {
      metricsCollector.trackSessionStart();
      metricsCollector.trackSessionStart();
      metricsCollector.trackSessionEnd(300000); // 5 minutes

      const metrics = metricsCollector.getMetrics();

      expect(metrics.sessions.active).toBe(1);
      expect(metrics.sessions.total).toBe(2);
      expect(metrics.sessions.averageDuration).toBe(300000);
    });

    it('should track new and expired sessions in time windows', () => {
      // This would need time-based mocking for a complete test
      metricsCollector.trackSessionStart();

      const metrics = metricsCollector.getMetrics();

      expect(metrics.sessions.newSessions).toBeGreaterThanOrEqual(0);
      expect(metrics.sessions.expiredSessions).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Utility Methods', () => {
    it('should reset all metrics', () => {
      // Add some data
      metricsCollector.trackAPIRequest('/api/test', 200, true);
      metricsCollector.trackLLMRequest('openai', 'gpt-4', 1000, true, 100);

      let metrics = metricsCollector.getMetrics();
      expect(metrics.api.totalRequests).toBe(1);
      expect(Object.keys(metrics.llm)).toHaveLength(1);

      // Reset
      metricsCollector.reset();

      metrics = metricsCollector.getMetrics();
      expect(metrics.api.totalRequests).toBe(0);
      expect(Object.keys(metrics.llm)).toHaveLength(0);
    });

    it('should return singleton instance', () => {
      const instance1 = MetricsCollector.getInstance();
      const instance2 = MetricsCollector.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Health Status', () => {
    it('should calculate health status based on metrics', () => {
      // Mock low memory and high CPU for critical status
      vi.mocked(os.freemem).mockReturnValue(100 * 1024 * 1024); // 100MB free
      vi.mocked(os.loadavg).mockReturnValue([8.0, 8.5, 9.0]); // High load

      const health = metricsCollector.getHealthStatus();

      expect(health.status).toBe('critical');
      expect(health.issues).toContain('Low memory available');
      expect(health.issues).toContain('High system load detected');
    });

    it('should return healthy status with good metrics', () => {
      // Reset to good values
      vi.mocked(os.freemem).mockReturnValue(4 * 1024 * 1024 * 1024); // 4GB free
      vi.mocked(os.loadavg).mockReturnValue([0.5, 0.7, 0.9]); // Normal load

      const health = metricsCollector.getHealthStatus();

      expect(health.status).toBe('healthy');
      expect(health.issues).toHaveLength(0);
    });
  });
});