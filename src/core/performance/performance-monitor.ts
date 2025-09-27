/**
 * Advanced Performance Monitoring System
 *
 * Provides comprehensive performance tracking for:
 * - Database queries
 * - API endpoints
 * - Cache operations
 * - Memory usage
 * - Connection pools
 */

import { logger } from '../logger/index.js';
import { metricsCollector } from '../monitoring/metrics-collector.js';

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}

export interface PerformanceStats {
  totalRequests: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  p99Duration: number;
  errorRate: number;
  throughput: number; // requests per second
}

export interface QueryPerformanceStats extends PerformanceStats {
  slowQueries: number;
  connectionPoolUtilization: number;
}

export class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetrics[]> = new Map();
  private slowQueryThreshold = 1000; // 1 second
  private metricsRetentionPeriod = 300000; // 5 minutes
  private memoryWarningThreshold = 0.8; // 80% of heap

  constructor() {
    // Clean up old metrics every minute
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 60000);

    // Monitor memory usage every 30 seconds
    setInterval(() => {
      this.monitorMemoryUsage();
    }, 30000);

    // Report performance stats every 2 minutes
    setInterval(() => {
      this.reportPerformanceStats();
    }, 120000);
  }

  /**
   * Start monitoring an operation
   */
  startOperation(operation: string, metadata?: Record<string, unknown>): PerformanceTracker {
    return new PerformanceTracker(operation, metadata, this);
  }

  /**
   * Record completed operation
   */
  recordOperation(metric: PerformanceMetrics): void {
    const operationMetrics = this.metrics.get(metric.operation) || [];
    operationMetrics.push(metric);
    this.metrics.set(metric.operation, operationMetrics);

    // Check for slow operations
    if (metric.duration > this.slowQueryThreshold) {
      logger.warn('Slow operation detected', {
        operation: metric.operation,
        duration: metric.duration,
        metadata: metric.metadata
      });
    }

    // Send to metrics collector
    metricsCollector.recordOperationPerformance(metric.operation, metric.duration, metric.metadata);
  }

  /**
   * Get performance statistics for an operation
   */
  getStats(operation: string): PerformanceStats | null {
    const operationMetrics = this.metrics.get(operation);
    if (!operationMetrics || operationMetrics.length === 0) {
      return null;
    }

    const durations = operationMetrics.map(m => m.duration).sort((a, b) => a - b);
    const errors = operationMetrics.filter(m => !m.success);
    const now = Date.now();
    const recentMetrics = operationMetrics.filter(m => now - m.timestamp < 60000); // Last minute

    return {
      totalRequests: operationMetrics.length,
      avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p95Duration: durations[Math.floor(durations.length * 0.95)],
      p99Duration: durations[Math.floor(durations.length * 0.99)],
      errorRate: errors.length / operationMetrics.length,
      throughput: recentMetrics.length // requests per minute
    };
  }

  /**
   * Get all operation statistics
   */
  getAllStats(): Record<string, PerformanceStats> {
    const stats: Record<string, PerformanceStats> = {};

    for (const operation of this.metrics.keys()) {
      const operationStats = this.getStats(operation);
      if (operationStats) {
        stats[operation] = operationStats;
      }
    }

    return stats;
  }

  /**
   * Monitor database query performance
   */
  async monitorQuery<T>(
    queryName: string,
    queryFn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const tracker = this.startOperation(`db:${queryName}`, metadata);

    try {
      const result = await queryFn();
      tracker.success();
      return result;
    } catch (error) {
      tracker.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Monitor API endpoint performance
   */
  async monitorEndpoint<T>(
    endpoint: string,
    endpointFn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const tracker = this.startOperation(`api:${endpoint}`, metadata);

    try {
      const result = await endpointFn();
      tracker.success();
      return result;
    } catch (error) {
      tracker.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Monitor cache operations
   */
  async monitorCache<T>(
    operation: string,
    cacheFn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const tracker = this.startOperation(`cache:${operation}`, metadata);

    try {
      const result = await cacheFn();
      tracker.success();
      return result;
    } catch (error) {
      tracker.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Get slow queries (database operations over threshold)
   */
  getSlowQueries(limit = 10): PerformanceMetrics[] {
    const allMetrics: PerformanceMetrics[] = [];

    for (const [operation, metrics] of this.metrics.entries()) {
      if (operation.startsWith('db:')) {
        allMetrics.push(...metrics);
      }
    }

    return allMetrics
      .filter(m => m.duration > this.slowQueryThreshold)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    totalOperations: number;
    avgResponseTime: number;
    errorRate: number;
    slowOperations: number;
    memoryUsage: NodeJS.MemoryUsage;
  } {
    let totalOperations = 0;
    let totalDuration = 0;
    let totalErrors = 0;
    let slowOperations = 0;

    for (const metrics of this.metrics.values()) {
      totalOperations += metrics.length;
      totalDuration += metrics.reduce((sum, m) => sum + m.duration, 0);
      totalErrors += metrics.filter(m => !m.success).length;
      slowOperations += metrics.filter(m => m.duration > this.slowQueryThreshold).length;
    }

    return {
      totalOperations,
      avgResponseTime: totalOperations > 0 ? totalDuration / totalOperations : 0,
      errorRate: totalOperations > 0 ? totalErrors / totalOperations : 0,
      slowOperations,
      memoryUsage: process.memoryUsage()
    };
  }

  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.metricsRetentionPeriod;
    let cleaned = 0;

    for (const [operation, metrics] of this.metrics.entries()) {
      const filteredMetrics = metrics.filter(m => m.timestamp > cutoff);

      if (filteredMetrics.length !== metrics.length) {
        cleaned += metrics.length - filteredMetrics.length;
        this.metrics.set(operation, filteredMetrics);
      }

      // Remove empty entries
      if (filteredMetrics.length === 0) {
        this.metrics.delete(operation);
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up old performance metrics', { cleanedCount: cleaned });
    }
  }

  private monitorMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const utilization = heapUsedMB / heapTotalMB;

    metricsCollector.recordMemoryUsage(memUsage);

    if (utilization > this.memoryWarningThreshold) {
      logger.warn('High memory usage detected', {
        heapUsedMB: Math.round(heapUsedMB),
        heapTotalMB: Math.round(heapTotalMB),
        utilization: Math.round(utilization * 100)
      });
    }
  }

  private reportPerformanceStats(): void {
    const summary = this.getSummary();
    const allStats = this.getAllStats();

    logger.info('Performance summary', summary);

    // Report top 5 slowest operations
    const slowestOps = Object.entries(allStats)
      .sort(([,a], [,b]) => b.avgDuration - a.avgDuration)
      .slice(0, 5);

    if (slowestOps.length > 0) {
      logger.info('Slowest operations', { operations: slowestOps });
    }
  }
}

export class PerformanceTracker {
  private startTime: number;
  private operation: string;
  private metadata?: Record<string, unknown>;
  private monitor: PerformanceMonitor;

  constructor(
    operation: string,
    metadata: Record<string, unknown> | undefined,
    monitor: PerformanceMonitor
  ) {
    this.startTime = Date.now();
    this.operation = operation;
    this.metadata = metadata;
    this.monitor = monitor;
  }

  /**
   * Mark operation as successful
   */
  success(): void {
    this.complete(true);
  }

  /**
   * Mark operation as failed
   */
  error(errorMessage: string): void {
    this.complete(false, errorMessage);
  }

  private complete(success: boolean, errorMessage?: string): void {
    const duration = Date.now() - this.startTime;

    this.monitor.recordOperation({
      operation: this.operation,
      duration,
      timestamp: this.startTime,
      metadata: this.metadata,
      success,
      errorMessage
    });
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Convenience functions
export const monitor = {
  query: <T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>) =>
    performanceMonitor.monitorQuery(name, fn, metadata),
  endpoint: <T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>) =>
    performanceMonitor.monitorEndpoint(name, fn, metadata),
  cache: <T>(operation: string, fn: () => Promise<T>, metadata?: Record<string, unknown>) =>
    performanceMonitor.monitorCache(operation, fn, metadata),
  operation: (name: string, metadata?: Record<string, unknown>) =>
    performanceMonitor.startOperation(name, metadata)
};