/**
 * Backup Monitoring Integration
 *
 * Integrates the backup system with the existing monitoring infrastructure.
 * Provides metrics collection, alerting, and dashboard integration.
 */

import { EventEmitter } from 'events';
import {
  BackupManager,
  BackupScheduler,
  BackupJob,
  BackupMetadata,
  BackupStatistics,
  BackupStorageType,
} from './types.js';
import { Logger } from '../logger/logger.js';
import { MetricsCollector } from '../monitoring/metrics-collector.js';
import { ErrorTracker } from '../monitoring/error-tracker.js';
import { AlertManager } from '../monitoring/alert-manager.js';

/**
 * Backup monitoring configuration
 */
interface BackupMonitoringConfig {
  /** Enable metrics collection */
  enableMetrics: boolean;
  /** Enable error tracking */
  enableErrorTracking: boolean;
  /** Enable alerting */
  enableAlerting: boolean;
  /** Metrics collection interval (seconds) */
  metricsInterval: number;
  /** Alert thresholds */
  alertThresholds: {
    /** Maximum allowed backup failure rate (percentage) */
    maxFailureRate: number;
    /** Maximum allowed backup duration (minutes) */
    maxBackupDuration: number;
    /** Minimum required disk space (GB) */
    minDiskSpace: number;
    /** Maximum time since last successful backup (hours) */
    maxTimeSinceLastBackup: number;
  };
  /** Dashboard configuration */
  dashboard: {
    /** Enable backup dashboard widgets */
    enabled: boolean;
    /** Dashboard update interval (seconds) */
    updateInterval: number;
    /** Number of recent backups to display */
    recentBackupsCount: number;
  };
}

/**
 * Backup metrics interface
 */
interface BackupMetrics {
  // Counters
  backupsStarted: number;
  backupsCompleted: number;
  backupsFailed: number;
  backupsCancelled: number;
  backupsRestored: number;
  backupsDeleted: number;
  backupsVerified: number;
  scheduledBackupsExecuted: number;
  cleanupOperationsExecuted: number;

  // Gauges
  activeBackupJobs: number;
  queuedBackupJobs: number;
  totalBackupSize: number;
  availableDiskSpace: number;
  oldestBackupAge: number;
  newestBackupAge: number;

  // Histograms
  backupDuration: number[];
  backupSizes: number[];
  restoreDuration: number[];
  verificationDuration: number[];

  // By storage type
  storageTypeMetrics: Record<BackupStorageType, {
    backupsCount: number;
    totalSize: number;
    averageDuration: number;
    failureRate: number;
    lastBackupTime?: Date;
  }>;
}

/**
 * Backup Monitoring Integration Implementation
 */
export class BackupMonitoringIntegration extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: BackupMonitoringConfig;
  private readonly metricsCollector?: MetricsCollector;
  private readonly errorTracker?: ErrorTracker;
  private readonly alertManager?: AlertManager;

  private backupManager?: BackupManager;
  private backupScheduler?: BackupScheduler;
  private metricsInterval?: NodeJS.Timeout;
  private isInitialized = false;

  private metrics: BackupMetrics = {
    backupsStarted: 0,
    backupsCompleted: 0,
    backupsFailed: 0,
    backupsCancelled: 0,
    backupsRestored: 0,
    backupsDeleted: 0,
    backupsVerified: 0,
    scheduledBackupsExecuted: 0,
    cleanupOperationsExecuted: 0,
    activeBackupJobs: 0,
    queuedBackupJobs: 0,
    totalBackupSize: 0,
    availableDiskSpace: 0,
    oldestBackupAge: 0,
    newestBackupAge: 0,
    backupDuration: [],
    backupSizes: [],
    restoreDuration: [],
    verificationDuration: [],
    storageTypeMetrics: {},
  };

  constructor(
    config: Partial<BackupMonitoringConfig> = {},
    logger?: Logger,
    metricsCollector?: MetricsCollector,
    errorTracker?: ErrorTracker,
    alertManager?: AlertManager
  ) {
    super();

    this.logger = logger || new Logger('BackupMonitoring');
    this.metricsCollector = metricsCollector;
    this.errorTracker = errorTracker;
    this.alertManager = alertManager;

    // Default configuration
    this.config = {
      enableMetrics: true,
      enableErrorTracking: true,
      enableAlerting: true,
      metricsInterval: 60, // 1 minute
      alertThresholds: {
        maxFailureRate: 20, // 20%
        maxBackupDuration: 120, // 2 hours
        minDiskSpace: 10, // 10 GB
        maxTimeSinceLastBackup: 25, // 25 hours (daily + 1 hour grace)
      },
      dashboard: {
        enabled: true,
        updateInterval: 30, // 30 seconds
        recentBackupsCount: 10,
      },
      ...config,
    };
  }

  /**
   * Initialize monitoring integration
   */
  async initialize(
    backupManager: BackupManager,
    backupScheduler: BackupScheduler
  ): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.backupManager = backupManager;
    this.backupScheduler = backupScheduler;

    // Set up event listeners
    this.setupEventListeners();

    // Start metrics collection
    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }

    this.isInitialized = true;
    this.logger.info('Backup monitoring integration initialized');
  }

  /**
   * Get current backup metrics
   */
  getMetrics(): BackupMetrics {
    return { ...this.metrics };
  }

  /**
   * Get backup system health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    issues: string[];
    metrics: BackupMetrics;
  }> {
    const issues: string[] = [];

    try {
      // Update metrics
      await this.collectMetrics();

      // Check failure rate
      const totalBackups = this.metrics.backupsStarted;
      const failedBackups = this.metrics.backupsFailed;
      const failureRate = totalBackups > 0 ? (failedBackups / totalBackups) * 100 : 0;

      if (failureRate > this.config.alertThresholds.maxFailureRate) {
        issues.push(`High backup failure rate: ${failureRate.toFixed(1)}%`);
      }

      // Check disk space
      if (this.metrics.availableDiskSpace < this.config.alertThresholds.minDiskSpace) {
        issues.push(`Low disk space: ${this.metrics.availableDiskSpace.toFixed(1)} GB available`);
      }

      // Check time since last backup
      const hoursSinceLastBackup = this.metrics.newestBackupAge / (1000 * 60 * 60);
      if (hoursSinceLastBackup > this.config.alertThresholds.maxTimeSinceLastBackup) {
        issues.push(`Last backup was ${hoursSinceLastBackup.toFixed(1)} hours ago`);
      }

      // Check for long-running backups
      const longRunningBackups = this.metrics.backupDuration.filter(
        duration => duration > this.config.alertThresholds.maxBackupDuration * 60 * 1000
      );

      if (longRunningBackups.length > 0) {
        issues.push(`${longRunningBackups.length} backup(s) exceeded maximum duration`);
      }

      const healthy = issues.length === 0;

      return {
        healthy,
        issues,
        metrics: this.metrics,
      };

    } catch (error) {
      this.logger.error('Failed to get backup health status:', error);

      return {
        healthy: false,
        issues: [`Health check failed: ${error.message}`],
        metrics: this.metrics,
      };
    }
  }

  /**
   * Create backup dashboard data
   */
  async getDashboardData(): Promise<Record<string, any>> {
    if (!this.config.dashboard.enabled) {
      return {};
    }

    try {
      const statistics = this.backupManager
        ? await this.backupManager.getStatistics()
        : null;

      const schedulerStats = this.backupScheduler
        ? this.backupScheduler.getStatistics()
        : null;

      const recentJobs = this.backupManager
        ? await this.backupManager.listJobs({
            limit: this.config.dashboard.recentBackupsCount,
            sortBy: 'startTime',
            sortOrder: 'desc',
          })
        : [];

      const healthStatus = await this.getHealthStatus();

      return {
        overview: {
          totalBackups: statistics?.totalBackups || 0,
          successfulBackups: statistics?.successfulBackups || 0,
          failedBackups: statistics?.failedBackups || 0,
          successRate: statistics?.successRate || 0,
          totalSize: this.formatBytes(statistics?.totalSize || 0),
          lastBackupTime: statistics?.lastBackupTime,
          nextScheduledBackup: statistics?.nextScheduledBackup,
        },
        scheduler: {
          totalJobs: schedulerStats?.totalJobs || 0,
          enabledJobs: schedulerStats?.enabledJobs || 0,
          disabledJobs: schedulerStats?.disabledJobs || 0,
          totalRuns: schedulerStats?.totalRuns || 0,
          successRate: schedulerStats?.successRate || 0,
          nextExecution: schedulerStats?.nextExecution,
        },
        recentBackups: recentJobs.map(job => ({
          id: job.id,
          storageType: job.storageType,
          status: job.status,
          startTime: job.startTime,
          duration: job.metadata.endTime
            ? job.metadata.endTime.getTime() - job.startTime.getTime()
            : null,
          size: job.metadata.size,
          compression: job.metadata.compression,
        })),
        storageTypes: Object.entries(this.metrics.storageTypeMetrics).map(([type, metrics]) => ({
          type,
          backupsCount: metrics.backupsCount,
          totalSize: this.formatBytes(metrics.totalSize),
          averageDuration: this.formatDuration(metrics.averageDuration),
          failureRate: metrics.failureRate.toFixed(1) + '%',
          lastBackupTime: metrics.lastBackupTime,
        })),
        health: {
          status: healthStatus.healthy ? 'healthy' : 'unhealthy',
          issues: healthStatus.issues,
        },
        charts: {
          backupTrend: await this.getBackupTrendData(),
          sizeDistribution: await this.getSizeDistributionData(),
          durationTrend: await this.getDurationTrendData(),
          failureAnalysis: await this.getFailureAnalysisData(),
        },
      };

    } catch (error) {
      this.logger.error('Failed to create dashboard data:', error);
      return { error: error.message };
    }
  }

  /**
   * Shutdown monitoring integration
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }

    this.removeAllListeners();
    this.logger.info('Backup monitoring integration shutdown complete');
  }

  // Private helper methods

  /**
   * Set up event listeners for backup manager and scheduler
   */
  private setupEventListeners(): void {
    if (this.backupManager) {
      this.backupManager.on('job:started', this.handleBackupStarted.bind(this));
      this.backupManager.on('job:completed', this.handleBackupCompleted.bind(this));
      this.backupManager.on('job:failed', this.handleBackupFailed.bind(this));
      this.backupManager.on('job:cancelled', this.handleBackupCancelled.bind(this));
    }

    if (this.backupScheduler) {
      this.backupScheduler.on('job:completed', this.handleScheduledJobCompleted.bind(this));
      this.backupScheduler.on('job:failed', this.handleScheduledJobFailed.bind(this));
      this.backupScheduler.on('cleanup:completed', this.handleCleanupCompleted.bind(this));
    }
  }

  /**
   * Start periodic metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(
      () => this.collectMetrics(),
      this.config.metricsInterval * 1000
    );

    // Collect initial metrics
    this.collectMetrics();
  }

  /**
   * Collect current metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      if (!this.backupManager || !this.backupScheduler) {
        return;
      }

      // Get backup statistics
      const statistics = await this.backupManager.getStatistics();
      const schedulerStats = this.backupScheduler.getStatistics();

      // Update basic metrics
      this.metrics.backupsCompleted = statistics.successfulBackups;
      this.metrics.backupsFailed = statistics.failedBackups;
      this.metrics.totalBackupSize = statistics.totalSize;

      // Update storage type metrics
      for (const [storageType, stats] of Object.entries(statistics.storageTypeStats)) {
        this.metrics.storageTypeMetrics[storageType as BackupStorageType] = {
          backupsCount: stats.count,
          totalSize: stats.size,
          averageDuration: 0, // Would need to track this separately
          failureRate: 0, // Would need to track this separately
          lastBackupTime: stats.lastBackup,
        };
      }

      // Get current job status
      const activeJobs = await this.backupManager.listJobs({
        status: 'in-progress',
      });
      this.metrics.activeBackupJobs = activeJobs.length;

      // Update scheduler metrics
      this.metrics.scheduledBackupsExecuted = schedulerStats.totalRuns;

      // Calculate backup ages
      if (statistics.lastBackupTime) {
        this.metrics.newestBackupAge = Date.now() - statistics.lastBackupTime.getTime();
      }

      // Get disk space (platform-specific implementation would be needed)
      this.metrics.availableDiskSpace = await this.getAvailableDiskSpace();

      // Update monitoring system
      if (this.metricsCollector) {
        this.updateMonitoringMetrics();
      }

    } catch (error) {
      this.logger.error('Failed to collect backup metrics:', error);
    }
  }

  /**
   * Update monitoring system with current metrics
   */
  private updateMonitoringMetrics(): void {
    if (!this.metricsCollector) {
      return;
    }

    // Record gauges
    this.metricsCollector.recordGauge('backup_active_jobs', this.metrics.activeBackupJobs);
    this.metricsCollector.recordGauge('backup_total_size_bytes', this.metrics.totalBackupSize);
    this.metricsCollector.recordGauge('backup_available_disk_space_gb', this.metrics.availableDiskSpace);
    this.metricsCollector.recordGauge('backup_newest_age_ms', this.metrics.newestBackupAge);

    // Record storage type metrics
    for (const [storageType, metrics] of Object.entries(this.metrics.storageTypeMetrics)) {
      const labels = { storage_type: storageType };
      this.metricsCollector.recordGauge('backup_storage_count', metrics.backupsCount, labels);
      this.metricsCollector.recordGauge('backup_storage_size_bytes', metrics.totalSize, labels);
      this.metricsCollector.recordGauge('backup_storage_failure_rate', metrics.failureRate, labels);
    }
  }

  /**
   * Handle backup started event
   */
  private handleBackupStarted(job: BackupJob): void {
    this.metrics.backupsStarted++;

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_started_total', {
        storage_type: job.storageType,
        backup_type: job.config.backupType,
      });
    }

    this.logger.info(`Backup started: ${job.id} (${job.storageType})`);
  }

  /**
   * Handle backup completed event
   */
  private handleBackupCompleted(job: BackupJob): void {
    this.metrics.backupsCompleted++;

    const duration = job.metadata.endTime!.getTime() - job.startTime.getTime();
    this.metrics.backupDuration.push(duration);

    if (job.metadata.size) {
      this.metrics.backupSizes.push(job.metadata.size);
    }

    // Update storage type metrics
    if (!this.metrics.storageTypeMetrics[job.storageType]) {
      this.metrics.storageTypeMetrics[job.storageType] = {
        backupsCount: 0,
        totalSize: 0,
        averageDuration: 0,
        failureRate: 0,
      };
    }

    const storageMetrics = this.metrics.storageTypeMetrics[job.storageType];
    storageMetrics.backupsCount++;
    storageMetrics.totalSize += job.metadata.size || 0;
    storageMetrics.lastBackupTime = job.metadata.endTime;

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_completed_total', {
        storage_type: job.storageType,
        backup_type: job.config.backupType,
      });

      this.metricsCollector.recordHistogram('backup_duration_ms', duration, {
        storage_type: job.storageType,
      });

      if (job.metadata.size) {
        this.metricsCollector.recordHistogram('backup_size_bytes', job.metadata.size, {
          storage_type: job.storageType,
        });
      }
    }

    this.logger.info(`Backup completed: ${job.id} (${this.formatDuration(duration)})`);
  }

  /**
   * Handle backup failed event
   */
  private handleBackupFailed(job: BackupJob): void {
    this.metrics.backupsFailed++;

    // Update storage type failure rate
    if (this.metrics.storageTypeMetrics[job.storageType]) {
      const metrics = this.metrics.storageTypeMetrics[job.storageType];
      metrics.failureRate = (this.metrics.backupsFailed / this.metrics.backupsStarted) * 100;
    }

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_failed_total', {
        storage_type: job.storageType,
        error_type: job.error?.code || 'unknown',
      });
    }

    if (this.errorTracker && job.error) {
      this.errorTracker.trackError(job.error, {
        context: 'backup',
        storageType: job.storageType,
        jobId: job.id,
      });
    }

    // Check if alert should be triggered
    this.checkFailureRateAlert();

    this.logger.error(`Backup failed: ${job.id} - ${job.error?.message}`);
  }

  /**
   * Handle backup cancelled event
   */
  private handleBackupCancelled(job: BackupJob): void {
    this.metrics.backupsCancelled++;

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_cancelled_total', {
        storage_type: job.storageType,
      });
    }

    this.logger.info(`Backup cancelled: ${job.id}`);
  }

  /**
   * Handle scheduled job completed event
   */
  private handleScheduledJobCompleted(result: any): void {
    this.metrics.scheduledBackupsExecuted++;

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_scheduled_completed_total', {
        storage_type: result.storageType,
      });
    }
  }

  /**
   * Handle scheduled job failed event
   */
  private handleScheduledJobFailed(result: any): void {
    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_scheduled_failed_total', {
        storage_type: result.storageType,
      });
    }

    if (this.errorTracker && result.error) {
      this.errorTracker.trackError(result.error, {
        context: 'scheduled_backup',
        storageType: result.storageType,
        jobId: result.jobId,
      });
    }
  }

  /**
   * Handle cleanup completed event
   */
  private handleCleanupCompleted(result: any): void {
    this.metrics.cleanupOperationsExecuted++;

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_cleanup_completed_total');
      this.metricsCollector.recordGauge('backup_cleanup_deleted_count', result.deletedCount);
    }
  }

  /**
   * Check failure rate and trigger alert if necessary
   */
  private checkFailureRateAlert(): void {
    const failureRate = this.metrics.backupsStarted > 0
      ? (this.metrics.backupsFailed / this.metrics.backupsStarted) * 100
      : 0;

    if (failureRate > this.config.alertThresholds.maxFailureRate && this.alertManager) {
      this.alertManager.triggerAlert({
        id: 'backup_high_failure_rate',
        severity: 'high',
        title: 'High Backup Failure Rate',
        message: `Backup failure rate is ${failureRate.toFixed(1)}% (threshold: ${this.config.alertThresholds.maxFailureRate}%)`,
        data: {
          failureRate,
          threshold: this.config.alertThresholds.maxFailureRate,
          totalBackups: this.metrics.backupsStarted,
          failedBackups: this.metrics.backupsFailed,
        },
      });
    }
  }

  /**
   * Get available disk space (simplified implementation)
   */
  private async getAvailableDiskSpace(): Promise<number> {
    try {
      // This is a simplified implementation
      // In a real system, you'd use platform-specific APIs
      const { execSync } = await import('child_process');

      if (process.platform === 'win32') {
        // Windows implementation would go here
        return 100; // Placeholder
      } else {
        // Unix-like systems
        const output = execSync('df -BG . | tail -1').toString();
        const parts = output.trim().split(/\s+/);
        const available = parseInt(parts[3].replace('G', ''), 10);
        return available;
      }
    } catch {
      return 0;
    }
  }

  /**
   * Get backup trend data for charts
   */
  private async getBackupTrendData(): Promise<any[]> {
    // This would typically query historical data
    // For now, return sample data
    return [];
  }

  /**
   * Get size distribution data for charts
   */
  private async getSizeDistributionData(): Promise<any[]> {
    return Object.entries(this.metrics.storageTypeMetrics).map(([type, metrics]) => ({
      name: type,
      value: metrics.totalSize,
    }));
  }

  /**
   * Get duration trend data for charts
   */
  private async getDurationTrendData(): Promise<any[]> {
    return [];
  }

  /**
   * Get failure analysis data for charts
   */
  private async getFailureAnalysisData(): Promise<any[]> {
    return Object.entries(this.metrics.storageTypeMetrics).map(([type, metrics]) => ({
      name: type,
      failures: metrics.failureRate,
      successes: 100 - metrics.failureRate,
    }));
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Format duration to human readable string
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}