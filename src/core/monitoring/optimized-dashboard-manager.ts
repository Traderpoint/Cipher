/**
 * Optimized Dashboard Manager for Large Scale Monitoring Data
 *
 * Enhanced version of the dashboard manager with optimizations for handling
 * large volumes of monitoring data including data compression, efficient
 * storage, intelligent caching, and streaming capabilities.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { logger } from '../logger/index.js';
import { metricsCollector } from './metrics-collector.js';
import { alertManager } from './alert-manager.js';
import { errorTracker } from './error-tracker.js';
import type { DashboardConfig, HistoricalData } from './dashboard-manager.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface OptimizedDashboardConfig {
  // Data compression settings
  compression: {
    enabled: boolean;
    algorithm: 'gzip' | 'lz4' | 'brotli';
    level: number;
    threshold: number; // Minimum size to compress
  };

  // Storage optimization
  storage: {
    maxMemoryItems: number;
    diskCacheSize: number; // MB
    partitionByTime: boolean;
    retentionPeriod: number; // days
    enableSharding: boolean;
  };

  // Performance settings
  performance: {
    batchSize: number;
    flushInterval: number; // ms
    enableAsyncWrites: boolean;
    maxConcurrentReads: number;
    enableStreaming: boolean;
  };

  // Aggregation settings
  aggregation: {
    enableDownsampling: boolean;
    downsampleIntervals: number[]; // minutes
    aggregationFunctions: ('avg' | 'min' | 'max' | 'sum' | 'count')[];
    retainRawData: boolean;
  };
}

export interface DataPartition {
  id: string;
  startTime: Date;
  endTime: Date;
  filePath: string;
  compressed: boolean;
  itemCount: number;
  fileSize: number;
}

export interface AggregatedMetrics {
  timestamp: Date;
  interval: number; // minutes
  metrics: {
    [key: string]: {
      avg?: number;
      min?: number;
      max?: number;
      sum?: number;
      count?: number;
    };
  };
}

export class OptimizedDashboardManager {
  private static instance: OptimizedDashboardManager;
  private config: OptimizedDashboardConfig;
  private configPath: string;
  private dataPath: string;
  private partitionsPath: string;
  private memoryCache: Map<string, HistoricalData> = new Map();
  private writeQueue: HistoricalData[] = [];
  private partitions: Map<string, DataPartition> = new Map();
  private dataCollectionInterval: NodeJS.Timeout | null = null;
  private flushInterval: NodeJS.Timeout | null = null;
  private maintenanceInterval: NodeJS.Timeout | null = null;

  private constructor(config: OptimizedDashboardConfig) {
    this.config = config;
    this.configPath = process.env.CIPHER_MONITORING_CONFIG_PATH || './monitoring-data/configs';
    this.dataPath = process.env.CIPHER_MONITORING_DATA_PATH || './monitoring-data/historical';
    this.partitionsPath = join(this.dataPath, 'partitions');
    this.ensureDirectories();
    this.initializeFlushInterval();
    this.initializeMaintenanceInterval();
  }

  static getInstance(config?: OptimizedDashboardConfig): OptimizedDashboardManager {
    if (!OptimizedDashboardManager.instance && config) {
      OptimizedDashboardManager.instance = new OptimizedDashboardManager(config);
    }
    return OptimizedDashboardManager.instance;
  }

  /**
   * Start optimized data collection with batching and compression
   */
  startDataCollection(intervalMs: number = 60000): void {
    if (this.dataCollectionInterval) {
      this.stopDataCollection();
    }

    this.dataCollectionInterval = setInterval(() => {
      this.collectHistoricalDataOptimized();
    }, intervalMs);

    logger.info('Optimized dashboard data collection started', {
      intervalMs,
      batchSize: this.config.performance.batchSize,
      compressionEnabled: this.config.compression.enabled
    });
  }

  /**
   * Stop data collection and flush remaining data
   */
  async stopDataCollection(): Promise<void> {
    if (this.dataCollectionInterval) {
      clearInterval(this.dataCollectionInterval);
      this.dataCollectionInterval = null;
    }

    // Flush any remaining data
    await this.flushWriteQueue();

    logger.info('Optimized dashboard data collection stopped');
  }

  /**
   * Get historical data with intelligent caching and streaming
   */
  async getHistoricalDataOptimized(
    hours: number = 24,
    options: {
      useAggregated?: boolean;
      aggregationInterval?: number;
      enableStreaming?: boolean;
      maxItems?: number;
    } = {}
  ): Promise<HistoricalData[] | NodeJS.ReadableStream> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const useAggregated = options.useAggregated && this.config.aggregation.enableDownsampling;

    if (options.enableStreaming && this.config.performance.enableStreaming) {
      return this.createDataStream(cutoff, useAggregated, options.aggregationInterval);
    }

    // First, check memory cache
    const memoryData = Array.from(this.memoryCache.values())
      .filter(data => data.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (memoryData.length > 0 && !useAggregated) {
      const limited = options.maxItems ? memoryData.slice(0, options.maxItems) : memoryData;
      logger.debug('Served historical data from memory cache', {
        hours,
        itemCount: limited.length
      });
      return limited;
    }

    // Load from disk partitions
    const relevantPartitions = Array.from(this.partitions.values())
      .filter(partition =>
        partition.endTime >= cutoff || partition.startTime >= cutoff
      )
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    const allData: HistoricalData[] = [];

    for (const partition of relevantPartitions) {
      try {
        const partitionData = await this.loadPartitionData(partition);
        const filteredData = partitionData.filter(data => data.timestamp >= cutoff);
        allData.push(...filteredData);

        if (options.maxItems && allData.length >= options.maxItems) {
          break;
        }
      } catch (error) {
        logger.error('Failed to load partition data', {
          partitionId: partition.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const sortedData = allData
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, options.maxItems || allData.length);

    if (useAggregated) {
      return this.aggregateData(sortedData, options.aggregationInterval || 60);
    }

    logger.info('Served historical data from disk partitions', {
      hours,
      partitionsLoaded: relevantPartitions.length,
      itemCount: sortedData.length
    });

    return sortedData;
  }

  /**
   * Export optimized historical data with compression and streaming
   */
  async exportHistoricalDataOptimized(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' | 'parquet' = 'json',
    options: {
      useCompression?: boolean;
      useStreaming?: boolean;
      batchSize?: number;
    } = {}
  ): Promise<string | NodeJS.ReadableStream> {
    const useStreaming = options.useStreaming && this.config.performance.enableStreaming;
    const batchSize = options.batchSize || this.config.performance.batchSize;

    if (useStreaming) {
      return this.createExportStream(startDate, endDate, format, options);
    }

    const relevantPartitions = Array.from(this.partitions.values())
      .filter(partition =>
        (partition.startTime >= startDate && partition.startTime <= endDate) ||
        (partition.endTime >= startDate && partition.endTime <= endDate) ||
        (partition.startTime <= startDate && partition.endTime >= endDate)
      );

    const allData: HistoricalData[] = [];

    // Process partitions in batches to control memory usage
    for (let i = 0; i < relevantPartitions.length; i += batchSize) {
      const batch = relevantPartitions.slice(i, i + batchSize);

      const batchPromises = batch.map(async (partition) => {
        try {
          const partitionData = await this.loadPartitionData(partition);
          return partitionData.filter(
            data => data.timestamp >= startDate && data.timestamp <= endDate
          );
        } catch (error) {
          logger.error('Failed to load partition for export', {
            partitionId: partition.id,
            error: error instanceof Error ? error.message : String(error)
          });
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(data => allData.push(...data));

      // Prevent memory overload
      if (allData.length > 100000) {
        logger.warn('Large export detected, consider using streaming', {
          currentItems: allData.length,
          remainingPartitions: relevantPartitions.length - i - batchSize
        });
      }
    }

    const sortedData = allData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    let exportData: string;
    if (format === 'csv') {
      exportData = this.convertToOptimizedCSV(sortedData);
    } else if (format === 'parquet') {
      exportData = await this.convertToParquet(sortedData);
    } else {
      exportData = JSON.stringify({
        exportedAt: new Date(),
        dateRange: { start: startDate, end: endDate },
        dataPoints: sortedData.length,
        compressed: options.useCompression,
        data: sortedData
      }, null, 2);
    }

    if (options.useCompression && this.config.compression.enabled) {
      const compressed = await gzipAsync(Buffer.from(exportData));
      exportData = compressed.toString('base64');
    }

    logger.info('Historical data exported with optimizations', {
      format,
      dataPoints: sortedData.length,
      compressed: options.useCompression,
      partitionsProcessed: relevantPartitions.length,
      outputSize: exportData.length
    });

    return exportData;
  }

  /**
   * Get optimized dashboard statistics with caching
   */
  getDashboardStatsOptimized(): {
    memory: {
      cacheSize: number;
      cacheHitRate: number;
      totalMemoryUsage: number;
    };
    storage: {
      totalPartitions: number;
      totalDataPoints: number;
      diskUsage: number;
      compressionRatio: number;
    };
    performance: {
      avgReadTime: number;
      avgWriteTime: number;
      queuedWrites: number;
      throughput: number;
    };
  } {
    const stats = {
      memory: {
        cacheSize: this.memoryCache.size,
        cacheHitRate: 0, // TODO: Track cache hits
        totalMemoryUsage: this.calculateMemoryUsage()
      },
      storage: {
        totalPartitions: this.partitions.size,
        totalDataPoints: Array.from(this.partitions.values())
          .reduce((sum, partition) => sum + partition.itemCount, 0),
        diskUsage: Array.from(this.partitions.values())
          .reduce((sum, partition) => sum + partition.fileSize, 0),
        compressionRatio: this.calculateCompressionRatio()
      },
      performance: {
        avgReadTime: 0, // TODO: Track read performance
        avgWriteTime: 0, // TODO: Track write performance
        queuedWrites: this.writeQueue.length,
        throughput: this.calculateThroughput()
      }
    };

    return stats;
  }

  /**
   * Optimize storage by cleaning up old data and compacting partitions
   */
  async optimizeStorage(): Promise<void> {
    logger.info('Starting storage optimization');

    try {
      // Clean up old partitions
      await this.cleanupOldPartitions();

      // Compact small partitions
      await this.compactPartitions();

      // Update partition index
      await this.updatePartitionIndex();

      // Clean memory cache
      this.cleanupMemoryCache();

      logger.info('Storage optimization completed');

    } catch (error) {
      logger.error('Storage optimization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Shutdown with proper cleanup
   */
  async shutdown(): Promise<void> {
    await this.stopDataCollection();

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }

    // Final flush
    await this.flushWriteQueue();

    logger.info('Optimized dashboard manager shutdown completed');
  }

  // Private helper methods

  private async collectHistoricalDataOptimized(): Promise<void> {
    try {
      const metrics = metricsCollector.getMetrics();
      const activeAlerts = alertManager.getActiveAlerts();
      const recentErrors = errorTracker.getRecentErrors(10);

      const dataPoint: HistoricalData = {
        timestamp: new Date(),
        metrics,
        alerts: activeAlerts,
        errors: recentErrors
      };

      // Add to memory cache
      const cacheKey = dataPoint.timestamp.toISOString();
      this.memoryCache.set(cacheKey, dataPoint);

      // Add to write queue for persistent storage
      this.writeQueue.push(dataPoint);

      // Maintain memory cache size
      if (this.memoryCache.size > this.config.storage.maxMemoryItems) {
        const oldestKey = Array.from(this.memoryCache.keys())[0];
        this.memoryCache.delete(oldestKey);
      }

      // Flush if queue is full
      if (this.writeQueue.length >= this.config.performance.batchSize) {
        await this.flushWriteQueue();
      }

    } catch (error) {
      logger.error('Error collecting optimized historical data', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async flushWriteQueue(): Promise<void> {
    if (this.writeQueue.length === 0) return;

    try {
      const dataToWrite = [...this.writeQueue];
      this.writeQueue = [];

      // Create time-based partition
      const partitionId = this.generatePartitionId(dataToWrite[0].timestamp);
      const partitionPath = join(this.partitionsPath, `${partitionId}.json`);

      let dataBuffer = Buffer.from(JSON.stringify(dataToWrite));

      // Apply compression if enabled
      if (this.config.compression.enabled &&
          dataBuffer.length > this.config.compression.threshold) {
        dataBuffer = await gzipAsync(dataBuffer);
      }

      await writeFile(partitionPath, dataBuffer);

      // Update partition registry
      const partition: DataPartition = {
        id: partitionId,
        startTime: dataToWrite[0].timestamp,
        endTime: dataToWrite[dataToWrite.length - 1].timestamp,
        filePath: partitionPath,
        compressed: this.config.compression.enabled,
        itemCount: dataToWrite.length,
        fileSize: dataBuffer.length
      };

      this.partitions.set(partitionId, partition);

      logger.debug('Flushed write queue to partition', {
        partitionId,
        itemCount: dataToWrite.length,
        compressed: partition.compressed,
        fileSize: partition.fileSize
      });

    } catch (error) {
      logger.error('Failed to flush write queue', {
        queueSize: this.writeQueue.length,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async loadPartitionData(partition: DataPartition): Promise<HistoricalData[]> {
    try {
      let dataBuffer = await readFile(partition.filePath);

      if (partition.compressed) {
        dataBuffer = await gunzipAsync(dataBuffer);
      }

      const data = JSON.parse(dataBuffer.toString()) as HistoricalData[];

      // Convert date strings back to Date objects
      return data.map(item => ({
        ...item,
        timestamp: new Date(item.timestamp)
      }));

    } catch (error) {
      logger.error('Failed to load partition data', {
        partitionId: partition.id,
        filePath: partition.filePath,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private createDataStream(
    cutoff: Date,
    useAggregated: boolean,
    aggregationInterval?: number
  ): NodeJS.ReadableStream {
    // TODO: Implement streaming data reader
    throw new Error('Streaming not yet implemented');
  }

  private createExportStream(
    startDate: Date,
    endDate: Date,
    format: string,
    options: any
  ): NodeJS.ReadableStream {
    // TODO: Implement streaming export
    throw new Error('Streaming export not yet implemented');
  }

  private aggregateData(data: HistoricalData[], intervalMinutes: number): HistoricalData[] {
    // TODO: Implement data aggregation
    return data;
  }

  private convertToOptimizedCSV(data: HistoricalData[]): string {
    // Enhanced CSV conversion with better performance
    if (data.length === 0) return '';

    const headers = [
      'timestamp',
      'memory_percentage',
      'cpu_percentage',
      'api_total_requests',
      'websocket_active_connections',
      'llm_total_requests',
      'active_alerts_count',
      'total_errors'
    ];

    const csvLines = [headers.join(',')];

    for (const point of data) {
      const row = [
        point.timestamp.toISOString(),
        point.metrics.system?.memory?.percentage || 0,
        point.metrics.system?.cpu?.percentage || 0,
        point.metrics.api?.totalRequests || 0,
        point.metrics.websocket?.activeConnections || 0,
        Object.values(point.metrics.llm || {}).reduce((sum: number, llm: any) => sum + (llm.totalRequests || 0), 0),
        point.alerts?.length || 0,
        point.errors?.length || 0
      ];
      csvLines.push(row.join(','));
    }

    return csvLines.join('\n');
  }

  private async convertToParquet(data: HistoricalData[]): Promise<string> {
    // TODO: Implement Parquet conversion
    throw new Error('Parquet format not yet implemented');
  }

  private generatePartitionId(timestamp: Date): string {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    const hour = String(timestamp.getHours()).padStart(2, '0');

    return `${year}-${month}-${day}-${hour}`;
  }

  private calculateMemoryUsage(): number {
    // Rough calculation of memory usage
    const avgItemSize = 2048; // bytes per item
    return this.memoryCache.size * avgItemSize;
  }

  private calculateCompressionRatio(): number {
    const compressedPartitions = Array.from(this.partitions.values())
      .filter(p => p.compressed);

    if (compressedPartitions.length === 0) return 1;

    // Estimate original size vs compressed size
    const estimatedOriginalSize = compressedPartitions.reduce(
      (sum, p) => sum + (p.itemCount * 2048), 0
    );
    const compressedSize = compressedPartitions.reduce(
      (sum, p) => sum + p.fileSize, 0
    );

    return estimatedOriginalSize / compressedSize;
  }

  private calculateThroughput(): number {
    // TODO: Implement throughput calculation
    return 0;
  }

  private async cleanupOldPartitions(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.storage.retentionPeriod);

    const oldPartitions = Array.from(this.partitions.values())
      .filter(partition => partition.endTime < cutoff);

    for (const partition of oldPartitions) {
      try {
        if (existsSync(partition.filePath)) {
          await import('fs/promises').then(fs => fs.unlink(partition.filePath));
        }
        this.partitions.delete(partition.id);

        logger.debug('Cleaned up old partition', { partitionId: partition.id });
      } catch (error) {
        logger.error('Failed to cleanup partition', {
          partitionId: partition.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async compactPartitions(): Promise<void> {
    // TODO: Implement partition compaction
    logger.debug('Partition compaction not yet implemented');
  }

  private async updatePartitionIndex(): Promise<void> {
    const indexPath = join(this.partitionsPath, 'index.json');
    const index = {
      updatedAt: new Date(),
      partitions: Array.from(this.partitions.values())
    };

    await writeFile(indexPath, JSON.stringify(index, null, 2));
    logger.debug('Updated partition index');
  }

  private cleanupMemoryCache(): void {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 1); // Keep only last hour in memory

    for (const [key, data] of this.memoryCache.entries()) {
      if (data.timestamp < cutoff) {
        this.memoryCache.delete(key);
      }
    }

    logger.debug('Cleaned up memory cache', { remainingItems: this.memoryCache.size });
  }

  private initializeFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      if (this.writeQueue.length > 0) {
        this.flushWriteQueue().catch(error => {
          logger.error('Flush interval error', { error: error.message });
        });
      }
    }, this.config.performance.flushInterval);
  }

  private initializeMaintenanceInterval(): void {
    this.maintenanceInterval = setInterval(() => {
      this.optimizeStorage().catch(error => {
        logger.error('Maintenance interval error', { error: error.message });
      });
    }, 3600000); // Every hour
  }

  private async ensureDirectories(): Promise<void> {
    try {
      if (!existsSync(this.configPath)) {
        await mkdir(this.configPath, { recursive: true });
      }
      if (!existsSync(this.dataPath)) {
        await mkdir(this.dataPath, { recursive: true });
      }
      if (!existsSync(this.partitionsPath)) {
        await mkdir(this.partitionsPath, { recursive: true });
      }
    } catch (error) {
      logger.error('Error creating optimized dashboard directories', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Default configuration for production use
export const defaultOptimizedConfig: OptimizedDashboardConfig = {
  compression: {
    enabled: true,
    algorithm: 'gzip',
    level: 6,
    threshold: 1024 // 1KB
  },
  storage: {
    maxMemoryItems: 1000,
    diskCacheSize: 500, // 500MB
    partitionByTime: true,
    retentionPeriod: 90, // days
    enableSharding: false
  },
  performance: {
    batchSize: 100,
    flushInterval: 30000, // 30 seconds
    enableAsyncWrites: true,
    maxConcurrentReads: 5,
    enableStreaming: true
  },
  aggregation: {
    enableDownsampling: true,
    downsampleIntervals: [5, 15, 60, 240, 1440], // 5min, 15min, 1h, 4h, 1day
    aggregationFunctions: ['avg', 'min', 'max'],
    retainRawData: true
  }
};