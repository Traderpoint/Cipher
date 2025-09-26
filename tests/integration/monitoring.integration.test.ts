import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createAPIServer } from '@app/api/server';
import { metricsCollector } from '@core/monitoring';

describe('Monitoring Integration Tests', () => {
  let app: any;
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    app = createAPIServer();
    request = supertest(app);

    // Initialize metrics collector
    metricsCollector.startCollection(1000); // 1s for tests
  });

  afterAll(async () => {
    metricsCollector.stopCollection();
  });

  describe('Health Check Endpoint', () => {
    it('should return health status', async () => {
      const response = await request
        .get('/api/monitoring/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toMatch(/healthy|warning|critical/);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
    });

    it('should return service status details', async () => {
      const response = await request
        .get('/api/monitoring/health')
        .expect(200);

      expect(response.body.services).toHaveProperty('api');
      expect(response.body.services).toHaveProperty('websocket');
      expect(response.body.services).toHaveProperty('memory');
      expect(response.body.services).toHaveProperty('llm');
    });
  });

  describe('Metrics Endpoints', () => {
    it('should return complete metrics', async () => {
      const response = await request
        .get('/api/monitoring/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('system');
      expect(response.body).toHaveProperty('llm');
      expect(response.body).toHaveProperty('memory');
      expect(response.body).toHaveProperty('websocket');
      expect(response.body).toHaveProperty('api');
      expect(response.body).toHaveProperty('sessions');
    });

    it('should return system metrics', async () => {
      const response = await request
        .get('/api/monitoring/metrics/system')
        .expect(200);

      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('memory');
      expect(response.body.memory).toHaveProperty('used');
      expect(response.body.memory).toHaveProperty('total');
      expect(response.body.memory).toHaveProperty('percentage');
    });

    it('should return dashboard data', async () => {
      const response = await request
        .get('/api/monitoring/dashboard')
        .expect(200);

      expect(response.body).toHaveProperty('health');
      expect(response.body).toHaveProperty('performance');
      expect(response.body).toHaveProperty('charts');
      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('System Status', () => {
    it('should return system status overview', async () => {
      const response = await request
        .get('/api/monitoring/status')
        .expect(200);

      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toBeInstanceOf(Array);
    });
  });

  describe('Metrics Collection', () => {
    it('should track API requests', async () => {
      // Make some API calls to generate metrics
      await request.get('/api/monitoring/health');
      await request.get('/api/monitoring/metrics');

      const response = await request
        .get('/api/monitoring/metrics/api')
        .expect(200);

      expect(response.body.totalRequests).toBeGreaterThan(0);
      expect(response.body).toHaveProperty('requestsByEndpoint');
    });

    it('should track system metrics over time', async () => {
      // Wait a bit for metrics collection
      await new Promise(resolve => setTimeout(resolve, 1100));

      const response = await request
        .get('/api/monitoring/metrics/system')
        .expect(200);

      expect(response.body.uptime).toBeGreaterThan(0);
      expect(response.body.memory.percentage).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid metric type', async () => {
      await request
        .get('/api/monitoring/metrics/invalid')
        .expect(400);
    });

    it('should handle server errors gracefully', async () => {
      // Test endpoint that might fail
      const response = await request
        .get('/api/monitoring/metrics');

      // Should not crash the server
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('Performance Tests', () => {
    it('should respond to health check quickly', async () => {
      const startTime = Date.now();

      await request
        .get('/api/monitoring/health')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // Should respond within 1s
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(5).fill(null).map(() =>
        request.get('/api/monitoring/health').expect(200)
      );

      const responses = await Promise.all(requests);
      expect(responses).toHaveLength(5);
      responses.forEach(response => {
        expect(response.body.status).toMatch(/healthy|warning|critical/);
      });
    });
  });
});