/**
 * Custom Metrics Manager for Extensible Monitoring
 *
 * Provides a flexible system for defining, collecting, and managing custom metrics
 * beyond the built-in system metrics. Supports various metric types, aggregations,
 * and custom collection strategies.
 */

import { EventEmitter } from 'events';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger/index.js';
import { metricsCollector } from './metrics-collector.js';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'timer';
export type AggregationType = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'rate' | 'percentile';

export interface CustomMetricDefinition {
  id: string;
  name: string;
  description?: string;
  type: MetricType;
  unit?: string;
  tags: Record<string, string>;

  // Collection configuration
  collection: {
    method: 'push' | 'pull' | 'calculated';
    interval?: number; // milliseconds for pull/calculated
    source?: string; // function name or endpoint for pull
    calculation?: string; // expression for calculated metrics
  };

  // Aggregation settings
  aggregation: {
    enabled: boolean;
    functions: AggregationType[];
    windowSize: number; // milliseconds
    retentionPeriod: number; // milliseconds
  };

  // Alerting integration
  alerting: {
    enabled: boolean;
    thresholds?: Array<{
      condition: string;
      value: number;
      severity: 'info' | 'warning' | 'critical';
    }>;
  };

  // Metadata
  created: Date;
  updated: Date;
  enabled: boolean;
  owner: string;
  category: string;
}

export interface MetricValue {
  metricId: string;
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface HistogramBucket {
  upperBound: number;
  count: number;
}

export interface MetricData {
  definition: CustomMetricDefinition;
  currentValue?: number;
  history: MetricValue[];
  aggregatedData: {
    [key in AggregationType]?: number;
  };

  // Type-specific data
  histogram?: {
    buckets: HistogramBucket[];
    totalCount: number;
    sum: number;
  };

  summary?: {
    quantiles: Array<{ quantile: number; value: number }>;
    count: number;
    sum: number;
  };
}

export interface MetricCollector {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;

  // Collection function
  collect(): Promise<MetricValue[]> | MetricValue[];

  // Configuration
  config: Record<string, any>;
  interval?: number;
  tags?: Record<string, string>;
}

export interface MetricQuery {
  metricIds?: string[];
  categories?: string[];
  tags?: Record<string, string>;
  timeRange?: {
    start: Date;
    end: Date;
  };
  aggregation?: {
    function: AggregationType;
    groupBy?: string[];
    interval?: number;
  };
  limit?: number;
  offset?: number;
}

export interface MetricExport {
  format: 'json' | 'csv' | 'prometheus' | 'influxdb';
  metrics: string[];
  timeRange: {
    start: Date;
    end: Date;
  };
  options: Record<string, any>;
}

export class CustomMetricsManager extends EventEmitter {
  private static instance: CustomMetricsManager;
  private definitions: Map<string, CustomMetricDefinition> = new Map();
  private data: Map<string, MetricData> = new Map();
  private collectors: Map<string, MetricCollector> = new Map();
  private collectionIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Configuration
  private config = {
    maxMetrics: 1000,
    maxHistorySize: 10000,
    defaultRetentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
    persistenceInterval: 300000, // 5 minutes
    cleanupInterval: 3600000 // 1 hour
  };

  // Storage paths
  private configPath: string;
  private dataPath: string;

  // Intervals
  private persistenceInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.configPath = process.env.CIPHER_CUSTOM_METRICS_CONFIG_PATH || './monitoring-data/custom-metrics';
    this.dataPath = process.env.CIPHER_CUSTOM_METRICS_DATA_PATH || './monitoring-data/custom-metrics/data';
    this.initializeBuiltInCollectors();
    this.startIntervals();
  }

  static getInstance(): CustomMetricsManager {
    if (!CustomMetricsManager.instance) {
      CustomMetricsManager.instance = new CustomMetricsManager();
    }
    return CustomMetricsManager.instance;
  }

  /**
   * Define a new custom metric
   */
  defineMetric(definition: Omit<CustomMetricDefinition, 'created' | 'updated'>): void {
    if (this.definitions.size >= this.config.maxMetrics) {
      throw new Error(`Maximum number of metrics (${this.config.maxMetrics}) reached`);
    }

    if (this.definitions.has(definition.id)) {
      throw new Error(`Metric with ID '${definition.id}' already exists`);
    }

    const fullDefinition: CustomMetricDefinition = {
      ...definition,
      created: new Date(),
      updated: new Date()
    };

    this.validateMetricDefinition(fullDefinition);

    this.definitions.set(definition.id, fullDefinition);

    // Initialize metric data
    this.data.set(definition.id, {
      definition: fullDefinition,
      history: [],
      aggregatedData: {}
    });

    // Set up collection if needed
    if (fullDefinition.collection.method === 'pull' || fullDefinition.collection.method === 'calculated') {
      this.setupMetricCollection(fullDefinition);
    }

    logger.info('Custom metric defined', {
      metricId: definition.id,
      name: definition.name,
      type: definition.type,
      category: definition.category
    });

    this.emit('metricDefined', fullDefinition);
  }

  /**
   * Update an existing metric definition
   */
  updateMetric(metricId: string, updates: Partial<CustomMetricDefinition>): void {
    const existing = this.definitions.get(metricId);
    if (!existing) {
      throw new Error(`Metric '${metricId}' not found`);
    }

    const updated: CustomMetricDefinition = {
      ...existing,
      ...updates,
      updated: new Date()
    };

    this.validateMetricDefinition(updated);

    this.definitions.set(metricId, updated);

    // Update data structure
    const metricData = this.data.get(metricId);
    if (metricData) {
      metricData.definition = updated;
    }

    // Restart collection if needed
    if (existing.collection.interval !== updated.collection.interval ||
        existing.collection.method !== updated.collection.method) {
      this.stopMetricCollection(metricId);
      this.setupMetricCollection(updated);
    }

    logger.info('Custom metric updated', { metricId, changes: Object.keys(updates) });
    this.emit('metricUpdated', updated);
  }

  /**
   * Remove a custom metric
   */
  removeMetric(metricId: string): boolean {
    const definition = this.definitions.get(metricId);
    if (!definition) return false;

    // Stop collection
    this.stopMetricCollection(metricId);

    // Remove from storage
    this.definitions.delete(metricId);
    this.data.delete(metricId);

    logger.info('Custom metric removed', { metricId, name: definition.name });
    this.emit('metricRemoved', metricId);

    return true;
  }

  /**
   * Record a metric value (for push-based metrics)
   */
  recordValue(metricId: string, value: number, tags?: Record<string, string>): void {
    const metricData = this.data.get(metricId);
    if (!metricData) {
      throw new Error(`Metric '${metricId}' not found`);
    }

    const definition = metricData.definition;
    if (definition.collection.method !== 'push') {
      throw new Error(`Metric '${metricId}' is not configured for push collection`);
    }

    const metricValue: MetricValue = {
      metricId,
      value,
      timestamp: new Date(),
      tags: { ...definition.tags, ...tags }
    };

    // Add to history
    metricData.history.push(metricValue);

    // Maintain history size
    if (metricData.history.length > this.config.maxHistorySize) {
      metricData.history = metricData.history.slice(-this.config.maxHistorySize);
    }

    // Update current value based on metric type
    this.updateCurrentValue(metricData, value);

    // Update aggregated data
    this.updateAggregatedData(metricData);

    // Handle type-specific updates
    this.updateTypeSpecificData(metricData, value);

    logger.debug('Metric value recorded', { metricId, value, type: definition.type });

    this.emit('valueRecorded', metricValue);
  }

  /**
   * Increment a counter metric
   */
  incrementCounter(metricId: string, delta: number = 1, tags?: Record<string, string>): void {
    const metricData = this.data.get(metricId);
    if (!metricData || metricData.definition.type !== 'counter') {
      throw new Error(`Counter metric '${metricId}' not found`);
    }

    const currentValue = metricData.currentValue || 0;
    this.recordValue(metricId, currentValue + delta, tags);
  }

  /**
   * Set a gauge value
   */
  setGauge(metricId: string, value: number, tags?: Record<string, string>): void {
    const metricData = this.data.get(metricId);
    if (!metricData || metricData.definition.type !== 'gauge') {
      throw new Error(`Gauge metric '${metricId}' not found`);
    }

    this.recordValue(metricId, value, tags);
  }

  /**
   * Record a histogram observation
   */
  observeHistogram(metricId: string, value: number, tags?: Record<string, string>): void {
    const metricData = this.data.get(metricId);
    if (!metricData || metricData.definition.type !== 'histogram') {
      throw new Error(`Histogram metric '${metricId}' not found`);
    }

    // Initialize histogram if needed
    if (!metricData.histogram) {
      metricData.histogram = {
        buckets: this.createHistogramBuckets(),
        totalCount: 0,
        sum: 0
      };
    }

    // Update histogram buckets
    for (const bucket of metricData.histogram.buckets) {
      if (value <= bucket.upperBound) {
        bucket.count++;
      }
    }

    metricData.histogram.totalCount++;
    metricData.histogram.sum += value;

    // Record the observation
    this.recordValue(metricId, value, tags);
  }

  /**
   * Start a timer and return a function to stop it
   */
  startTimer(metricId: string, tags?: Record<string, string>): () => void {
    const startTime = Date.now();

    return () => {
      const duration = Date.now() - startTime;

      const metricData = this.data.get(metricId);
      if (!metricData || metricData.definition.type !== 'timer') {
        throw new Error(`Timer metric '${metricId}' not found`);
      }

      this.recordValue(metricId, duration, tags);
    };
  }

  /**
   * Query metrics with filtering and aggregation
   */
  queryMetrics(query: MetricQuery): Array<{
    metricId: string;
    name: string;
    values: MetricValue[];
    aggregated?: Record<string, number>;
  }> {
    const results: Array<{
      metricId: string;
      name: string;
      values: MetricValue[];
      aggregated?: Record<string, number>;
    }> = [];

    for (const [metricId, metricData] of this.data.entries()) {
      const definition = metricData.definition;

      // Apply filters
      if (query.metricIds && !query.metricIds.includes(metricId)) continue;
      if (query.categories && !query.categories.includes(definition.category)) continue;

      // Tag filtering
      if (query.tags) {
        const matches = Object.entries(query.tags).every(([key, value]) =>
          definition.tags[key] === value
        );
        if (!matches) continue;
      }

      // Time range filtering
      let filteredValues = metricData.history;
      if (query.timeRange) {
        filteredValues = metricData.history.filter(value =>
          value.timestamp >= query.timeRange!.start &&
          value.timestamp <= query.timeRange!.end
        );
      }

      // Apply limit and offset
      if (query.offset) {
        filteredValues = filteredValues.slice(query.offset);
      }
      if (query.limit) {
        filteredValues = filteredValues.slice(0, query.limit);
      }

      const result = {
        metricId,
        name: definition.name,
        values: filteredValues
      };

      // Apply aggregation if requested
      if (query.aggregation && filteredValues.length > 0) {
        result.aggregated = this.calculateAggregation(
          filteredValues,
          query.aggregation.function,
          query.aggregation.groupBy
        );
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Export metrics in various formats
   */
  async exportMetrics(exportConfig: MetricExport): Promise<string> {
    const query: MetricQuery = {
      metricIds: exportConfig.metrics,
      timeRange: exportConfig.timeRange
    };

    const queryResults = this.queryMetrics(query);

    switch (exportConfig.format) {
      case 'json':
        return JSON.stringify({
          exportedAt: new Date(),
          timeRange: exportConfig.timeRange,
          metrics: queryResults
        }, null, 2);

      case 'csv':
        return this.exportToCSV(queryResults);

      case 'prometheus':
        return this.exportToPrometheus(queryResults);

      case 'influxdb':
        return this.exportToInfluxDB(queryResults);

      default:
        throw new Error(`Unsupported export format: ${exportConfig.format}`);
    }
  }

  /**
   * Register a custom metric collector
   */
  registerCollector(collector: MetricCollector): void {
    if (this.collectors.has(collector.id)) {
      throw new Error(`Collector '${collector.id}' already registered`);
    }

    this.collectors.set(collector.id, collector);

    // Start collection if enabled
    if (collector.enabled && collector.interval) {
      const interval = setInterval(async () => {
        try {
          const values = await collector.collect();
          for (const value of Array.isArray(values) ? values : [values]) {
            if (this.data.has(value.metricId)) {
              this.recordValue(value.metricId, value.value, value.tags);
            }
          }
        } catch (error) {
          logger.error('Error in custom collector', {
            collectorId: collector.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }, collector.interval);

      this.collectionIntervals.set(collector.id, interval);
    }

    logger.info('Custom metric collector registered', {
      collectorId: collector.id,
      name: collector.name,
      enabled: collector.enabled
    });
  }

  /**
   * Get metric statistics and health
   */
  getMetricsStats(): {
    totalMetrics: number;
    metricsByType: Record<MetricType, number>;
    metricsByCategory: Record<string, number>;
    activeCollectors: number;
    memoryUsage: number;
    oldestDataPoint?: Date;
    newestDataPoint?: Date;
  } {
    const metricsByType: Record<MetricType, number> = {
      counter: 0,
      gauge: 0,
      histogram: 0,
      summary: 0,
      timer: 0
    };

    const metricsByCategory: Record<string, number> = {};
    let oldestDataPoint: Date | undefined;
    let newestDataPoint: Date | undefined;

    for (const metricData of this.data.values()) {
      const definition = metricData.definition;

      metricsByType[definition.type]++;
      metricsByCategory[definition.category] = (metricsByCategory[definition.category] || 0) + 1;

      // Find oldest and newest data points
      if (metricData.history.length > 0) {
        const oldest = metricData.history[0].timestamp;
        const newest = metricData.history[metricData.history.length - 1].timestamp;

        if (!oldestDataPoint || oldest < oldestDataPoint) {
          oldestDataPoint = oldest;
        }
        if (!newestDataPoint || newest > newestDataPoint) {
          newestDataPoint = newest;
        }
      }
    }

    // Estimate memory usage (rough calculation)
    const memoryUsage = Array.from(this.data.values())
      .reduce((sum, metricData) => sum + metricData.history.length * 100, 0); // ~100 bytes per data point

    return {
      totalMetrics: this.definitions.size,
      metricsByType,
      metricsByCategory,
      activeCollectors: Array.from(this.collectors.values()).filter(c => c.enabled).length,
      memoryUsage,
      oldestDataPoint,
      newestDataPoint
    };
  }

  /**
   * Clean up old metric data
   */
  async cleanupOldData(): Promise<void> {
    const now = Date.now();
    let cleanedCount = 0;

    for (const metricData of this.data.values()) {
      const retentionPeriod = metricData.definition.aggregation.retentionPeriod ||
                             this.config.defaultRetentionPeriod;

      const cutoffTime = now - retentionPeriod;
      const originalLength = metricData.history.length;

      metricData.history = metricData.history.filter(
        value => value.timestamp.getTime() > cutoffTime
      );

      cleanedCount += originalLength - metricData.history.length;
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old metric data', { itemsRemoved: cleanedCount });
    }
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    // Stop all intervals
    for (const interval of this.collectionIntervals.values()) {
      clearInterval(interval);
    }

    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Final persistence
    await this.persistData();

    logger.info('Custom metrics manager shutdown completed');
  }

  // Private helper methods

  private validateMetricDefinition(definition: CustomMetricDefinition): void {
    if (!definition.id || !definition.name || !definition.type) {
      throw new Error('Invalid metric definition: missing required fields');
    }

    const validTypes: MetricType[] = ['counter', 'gauge', 'histogram', 'summary', 'timer'];
    if (!validTypes.includes(definition.type)) {
      throw new Error(`Invalid metric type: ${definition.type}`);
    }

    if (definition.collection.method === 'pull' && !definition.collection.source) {
      throw new Error('Pull-based metrics require a source');
    }

    if (definition.collection.method === 'calculated' && !definition.collection.calculation) {
      throw new Error('Calculated metrics require a calculation expression');
    }
  }

  private setupMetricCollection(definition: CustomMetricDefinition): void {
    if (!definition.collection.interval) return;

    const interval = setInterval(async () => {
      try {
        let value: number;

        if (definition.collection.method === 'pull') {
          value = await this.pullMetricValue(definition);
        } else if (definition.collection.method === 'calculated') {
          value = await this.calculateMetricValue(definition);
        } else {
          return;
        }

        this.recordValue(definition.id, value);

      } catch (error) {
        logger.error('Error collecting metric', {
          metricId: definition.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, definition.collection.interval);

    this.collectionIntervals.set(definition.id, interval);
  }

  private stopMetricCollection(metricId: string): void {
    const interval = this.collectionIntervals.get(metricId);
    if (interval) {
      clearInterval(interval);
      this.collectionIntervals.delete(metricId);
    }
  }

  private async pullMetricValue(definition: CustomMetricDefinition): Promise<number> {
    // Implementation would depend on the source type
    // For now, return a placeholder
    return Math.random() * 100;
  }

  private async calculateMetricValue(definition: CustomMetricDefinition): Promise<number> {
    // Implementation would evaluate the calculation expression
    // For now, return a placeholder
    return Math.random() * 100;
  }

  private updateCurrentValue(metricData: MetricData, value: number): void {
    const type = metricData.definition.type;

    switch (type) {
      case 'counter':
        metricData.currentValue = value;
        break;
      case 'gauge':
        metricData.currentValue = value;
        break;
      case 'timer':
      case 'histogram':
      case 'summary':
        // For these types, current value might be the latest observation
        metricData.currentValue = value;
        break;
    }
  }

  private updateAggregatedData(metricData: MetricData): void {
    if (!metricData.definition.aggregation.enabled) return;

    const functions = metricData.definition.aggregation.functions;
    const values = metricData.history.map(v => v.value);

    for (const func of functions) {
      metricData.aggregatedData[func] = this.calculateSingleAggregation(values, func);
    }
  }

  private updateTypeSpecificData(metricData: MetricData, value: number): void {
    // Implementation for histogram and summary specific updates
    // Already handled in observeHistogram method
  }

  private createHistogramBuckets(): HistogramBucket[] {
    // Default buckets - could be configurable
    const bounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, Infinity];
    return bounds.map(upperBound => ({ upperBound, count: 0 }));
  }

  private calculateSingleAggregation(values: number[], func: AggregationType): number {
    if (values.length === 0) return 0;

    switch (func) {
      case 'sum':
        return values.reduce((sum, v) => sum + v, 0);
      case 'avg':
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'count':
        return values.length;
      case 'rate':
        // Calculate rate over time window
        return values.length / (this.config.defaultRetentionPeriod / 1000);
      case 'percentile':
        // Default to 95th percentile
        return this.calculatePercentile(values, 0.95);
      default:
        return 0;
    }
  }

  private calculateAggregation(
    values: MetricValue[],
    func: AggregationType,
    groupBy?: string[]
  ): Record<string, number> {
    const numericValues = values.map(v => v.value);

    if (!groupBy || groupBy.length === 0) {
      return { [func]: this.calculateSingleAggregation(numericValues, func) };
    }

    // Group by specified fields
    const groups: Record<string, number[]> = {};

    for (const value of values) {
      const groupKey = groupBy.map(field =>
        value.tags?.[field] || value.labels?.[field] || 'unknown'
      ).join('|');

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(value.value);
    }

    const result: Record<string, number> = {};
    for (const [groupKey, groupValues] of Object.entries(groups)) {
      result[groupKey] = this.calculateSingleAggregation(groupValues, func);
    }

    return result;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index] || 0;
  }

  private exportToCSV(queryResults: any[]): string {
    const lines = ['timestamp,metricId,metricName,value,tags'];

    for (const result of queryResults) {
      for (const value of result.values) {
        const tags = value.tags ? JSON.stringify(value.tags) : '';
        lines.push(`${value.timestamp.toISOString()},${result.metricId},${result.name},${value.value},"${tags}"`);
      }
    }

    return lines.join('\n');
  }

  private exportToPrometheus(queryResults: any[]): string {
    const lines: string[] = [];

    for (const result of queryResults) {
      const metricName = result.name.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`# HELP ${metricName} Custom metric: ${result.name}`);
      lines.push(`# TYPE ${metricName} gauge`);

      for (const value of result.values) {
        const tags = value.tags ?
          Object.entries(value.tags).map(([k, v]) => `${k}="${v}"`).join(',') : '';
        const tagString = tags ? `{${tags}}` : '';
        lines.push(`${metricName}${tagString} ${value.value} ${value.timestamp.getTime()}`);
      }
    }

    return lines.join('\n');
  }

  private exportToInfluxDB(queryResults: any[]): string {
    const lines: string[] = [];

    for (const result of queryResults) {
      for (const value of result.values) {
        const tags = value.tags ?
          Object.entries(value.tags).map(([k, v]) => `${k}=${v}`).join(',') : '';
        const tagString = tags ? `,${tags}` : '';
        const timestamp = value.timestamp.getTime() * 1000000; // nanoseconds
        lines.push(`${result.name}${tagString} value=${value.value} ${timestamp}`);
      }
    }

    return lines.join('\n');
  }

  private initializeBuiltInCollectors(): void {
    // Add some built-in collectors for common system metrics
    this.registerCollector({
      id: 'nodejs_metrics',
      name: 'Node.js Runtime Metrics',
      enabled: true,
      interval: 10000, // 10 seconds
      config: {},
      collect: () => {
        const memUsage = process.memoryUsage();
        return [
          {
            metricId: 'nodejs_heap_used',
            value: memUsage.heapUsed,
            timestamp: new Date(),
            tags: { source: 'nodejs' }
          },
          {
            metricId: 'nodejs_heap_total',
            value: memUsage.heapTotal,
            timestamp: new Date(),
            tags: { source: 'nodejs' }
          }
        ];
      }
    });
  }

  private startIntervals(): void {
    // Persistence interval
    this.persistenceInterval = setInterval(() => {
      this.persistData().catch(error => {
        logger.error('Error persisting custom metrics data', { error: error.message });
      });
    }, this.config.persistenceInterval);

    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData().catch(error => {
        logger.error('Error cleaning up custom metrics data', { error: error.message });
      });
    }, this.config.cleanupInterval);
  }

  private async persistData(): Promise<void> {
    // Implementation would save definitions and data to disk
    logger.debug('Custom metrics data persisted');
  }
}

export const customMetricsManager = CustomMetricsManager.getInstance();