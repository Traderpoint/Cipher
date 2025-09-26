import { writeFile } from 'fs/promises';
import { logger } from '../logger/index.js';
import { metricsCollector } from './metrics-collector.js';
import { dashboardManager } from './dashboard-manager.js';

export interface ExportOptions {
  format: 'json' | 'csv' | 'xlsx';
  dateRange?: {
    startDate: Date;
    endDate: Date;
  };
  includeMetrics?: string[]; // Specific metrics to include
  compression?: boolean;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  data?: string;
  error?: string;
  metadata: {
    exportedAt: Date;
    format: string;
    recordCount: number;
    fileSize?: number;
  };
}

export class MetricsExporter {
  private static instance: MetricsExporter;

  private constructor() {}

  static getInstance(): MetricsExporter {
    if (!MetricsExporter.instance) {
      MetricsExporter.instance = new MetricsExporter();
    }
    return MetricsExporter.instance;
  }

  /**
   * Export current metrics snapshot
   */
  async exportCurrentMetrics(options: ExportOptions): Promise<ExportResult> {
    try {
      const metrics = metricsCollector.getMetrics();
      const timestamp = new Date();

      let data: string;
      let recordCount = 1;

      switch (options.format) {
        case 'json':
          data = this.formatAsJSON(metrics, timestamp);
          break;
        case 'csv':
          data = this.formatAsCSV([{ ...metrics, exportedAt: timestamp }]);
          break;
        case 'xlsx':
          throw new Error('XLSX format not yet implemented');
        default:
          throw new Error(`Unsupported format: ${options.format}`);
      }

      const result: ExportResult = {
        success: true,
        data,
        metadata: {
          exportedAt: timestamp,
          format: options.format,
          recordCount,
          fileSize: Buffer.byteLength(data, 'utf8')
        }
      };

      logger.info('Current metrics exported successfully', {
        format: options.format,
        fileSize: result.metadata.fileSize,
        recordCount
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to export current metrics', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          exportedAt: new Date(),
          format: options.format,
          recordCount: 0
        }
      };
    }
  }

  /**
   * Export historical metrics data
   */
  async exportHistoricalMetrics(options: ExportOptions): Promise<ExportResult> {
    try {
      const { dateRange } = options;

      if (!dateRange) {
        throw new Error('Date range is required for historical export');
      }

      const historicalData = await dashboardManager.exportHistoricalData(
        dateRange.startDate,
        dateRange.endDate,
        options.format === 'csv' ? 'csv' : 'json'
      );

      const recordCount = options.format === 'json'
        ? JSON.parse(historicalData).dataPoints || 0
        : historicalData.split('\n').length - 1; // Subtract header

      const result: ExportResult = {
        success: true,
        data: historicalData,
        metadata: {
          exportedAt: new Date(),
          format: options.format,
          recordCount,
          fileSize: Buffer.byteLength(historicalData, 'utf8')
        }
      };

      logger.info('Historical metrics exported successfully', {
        format: options.format,
        dateRange,
        fileSize: result.metadata.fileSize,
        recordCount
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to export historical metrics', {
        error: errorMessage,
        options
      });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          exportedAt: new Date(),
          format: options.format,
          recordCount: 0
        }
      };
    }
  }

  /**
   * Export metrics to file
   */
  async exportToFile(filePath: string, options: ExportOptions): Promise<ExportResult> {
    try {
      const exportResult = options.dateRange
        ? await this.exportHistoricalMetrics(options)
        : await this.exportCurrentMetrics(options);

      if (!exportResult.success || !exportResult.data) {
        return exportResult;
      }

      await writeFile(filePath, exportResult.data, 'utf8');

      const { data: _, ...resultWithoutData } = exportResult;
      const result: ExportResult = {
        ...resultWithoutData,
        filePath
      };

      logger.info('Metrics exported to file successfully', {
        filePath,
        format: options.format,
        fileSize: result.metadata.fileSize
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to export metrics to file', {
        error: errorMessage,
        filePath,
        options
      });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          exportedAt: new Date(),
          format: options.format,
          recordCount: 0
        }
      };
    }
  }

  /**
   * Get export templates for different formats
   */
  getExportTemplate(format: 'json' | 'csv'): string {
    switch (format) {
      case 'json':
        return JSON.stringify({
          exportedAt: new Date().toISOString(),
          format: 'json',
          description: 'Cipher Monitoring Metrics Export',
          metrics: {
            system: {
              uptime: 0,
              memory: { used: 0, free: 0, total: 0, percentage: 0 },
              cpu: { percentage: 0, loadAverage: [0, 0, 0] }
            },
            api: {
              totalRequests: 0,
              requestsByEndpoint: {},
              averageResponseTime: {},
              errorsByEndpoint: {},
              statusCodes: {},
              throughput: { requestsPerSecond: 0, averageResponseSize: 0 }
            },
            llm: {},
            websocket: {
              activeConnections: 0,
              messagesReceived: 0,
              messagesSent: 0,
              connectionErrors: 0,
              averageLatency: 0,
              peakConnections: 0,
              bytesTransferred: 0
            },
            memory: {
              totalKnowledge: 0,
              totalReflections: 0,
              vectorStorageSize: 0,
              averageSearchTime: 0,
              totalSearches: 0,
              memoryEfficiencyScore: 0,
              topSearchPatterns: [],
              vectorOperations: { searches: 0, insertions: 0, updates: 0, deletions: 0 }
            },
            sessions: {
              active: 0,
              total: 0,
              averageDuration: 0,
              newSessions: 0,
              expiredSessions: 0
            }
          }
        }, null, 2);

      case 'csv':
        return [
          'timestamp',
          'system_uptime',
          'memory_used',
          'memory_percentage',
          'cpu_percentage',
          'api_total_requests',
          'websocket_active_connections',
          'llm_total_requests',
          'sessions_active',
          'memory_total_knowledge'
        ].join(',');

      default:
        throw new Error(`Unsupported template format: ${format}`);
    }
  }

  /**
   * Format metrics as JSON
   */
  private formatAsJSON(metrics: any, timestamp: Date): string {
    const exportData = {
      exportedAt: timestamp.toISOString(),
      format: 'json',
      description: 'Cipher Monitoring Metrics Export',
      metrics
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Format metrics as CSV
   */
  private formatAsCSV(dataPoints: Array<{ timestamp: Date; [key: string]: any }>): string {
    if (dataPoints.length === 0) return '';

    // Define CSV headers
    const headers = [
      'timestamp',
      'system_uptime',
      'memory_used',
      'memory_free',
      'memory_total',
      'memory_percentage',
      'cpu_percentage',
      'cpu_load_1m',
      'cpu_load_5m',
      'cpu_load_15m',
      'api_total_requests',
      'api_requests_per_second',
      'websocket_active_connections',
      'websocket_messages_received',
      'websocket_messages_sent',
      'websocket_average_latency',
      'sessions_active',
      'sessions_total',
      'memory_total_knowledge',
      'memory_total_searches',
      'memory_average_search_time'
    ];

    // Convert data points to CSV rows
    const rows = dataPoints.map(point => {
      const { timestamp, system, api, websocket, sessions, memory } = point;

      return [
        timestamp.toISOString(),
        system?.uptime || 0,
        system?.memory?.used || 0,
        system?.memory?.free || 0,
        system?.memory?.total || 0,
        system?.memory?.percentage || 0,
        system?.cpu?.percentage || 0,
        system?.cpu?.loadAverage?.[0] || 0,
        system?.cpu?.loadAverage?.[1] || 0,
        system?.cpu?.loadAverage?.[2] || 0,
        api?.totalRequests || 0,
        api?.throughput?.requestsPerSecond || 0,
        websocket?.activeConnections || 0,
        websocket?.messagesReceived || 0,
        websocket?.messagesSent || 0,
        websocket?.averageLatency || 0,
        sessions?.active || 0,
        sessions?.total || 0,
        memory?.totalKnowledge || 0,
        memory?.totalSearches || 0,
        memory?.averageSearchTime || 0
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}

export const metricsExporter = MetricsExporter.getInstance();