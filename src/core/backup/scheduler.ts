/**
 * Backup Scheduler
 *
 * Manages automated backup scheduling using cron expressions.
 * Provides flexible scheduling, job management, and error handling.
 */

import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import {
  BackupConfig,
  BackupSchedule,
  BackupStorageType,
  StorageBackupConfig,
  IBackupManager,
} from './types.js';
import { Logger } from '../logger/logger.js';
import { MetricsCollector } from '../monitoring/metrics-collector.js';

/**
 * Scheduled job information
 */
interface ScheduledJob {
  id: string;
  name: string;
  cronJob: CronJob;
  storageType: BackupStorageType;
  schedule: BackupSchedule;
  lastRun?: Date;
  nextRun?: Date;
  enabled: boolean;
  runCount: number;
  errorCount: number;
  lastError?: Error;
}

/**
 * Schedule execution result
 */
interface ScheduleResult {
  jobId: string;
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  error?: Error;
}

/**
 * Backup Scheduler Implementation
 */
export class BackupScheduler extends EventEmitter {
  private readonly logger: Logger;
  private readonly metricsCollector?: MetricsCollector;
  private backupManager?: IBackupManager;
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private isInitialized = false;
  private isShuttingDown = false;

  constructor(logger?: Logger, metricsCollector?: MetricsCollector) {
    super();
    this.logger = logger || new Logger('BackupScheduler');
    this.metricsCollector = metricsCollector;
  }

  /**
   * Initialize the scheduler
   */
  async initialize(backupManager: IBackupManager): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.backupManager = backupManager;
    this.isInitialized = true;

    this.logger.info('Backup scheduler initialized');

    // Emit metrics
    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_scheduler_initialized');
    }
  }

  /**
   * Schedule backups based on configuration
   */
  async scheduleFromConfig(config: BackupConfig): Promise<void> {
    if (!this.isInitialized || !this.backupManager) {
      throw new Error('Scheduler not initialized');
    }

    if (!config.enabled) {
      this.logger.info('Backup scheduling disabled in configuration');
      return;
    }

    // Clear existing schedules
    await this.clearAllSchedules();

    // Schedule each enabled storage type
    for (const storageConfig of config.storageConfigs) {
      if (storageConfig.enabled) {
        await this.scheduleStorage(
          storageConfig.type,
          storageConfig,
          config.defaultSchedule
        );
      }
    }

    // Schedule cleanup job
    await this.scheduleCleanup(config);

    this.logger.info(`Scheduled backups for ${this.scheduledJobs.size} jobs`);
  }

  /**
   * Schedule backup for specific storage type
   */
  async scheduleStorage(
    storageType: BackupStorageType,
    storageConfig: StorageBackupConfig,
    defaultSchedule: BackupSchedule,
    customSchedule?: Partial<BackupSchedule>
  ): Promise<string> {
    if (!this.isInitialized || !this.backupManager) {
      throw new Error('Scheduler not initialized');
    }

    const schedule = { ...defaultSchedule, ...customSchedule };
    const jobId = `backup-${storageType}-${Date.now()}`;
    const jobName = `Backup ${storageType}`;

    try {
      // Create cron job
      const cronJob = new CronJob(
        schedule.cron,
        async () => {
          await this.executeScheduledBackup(jobId, storageType, storageConfig);
        },
        null, // onComplete
        false, // start
        schedule.timezone,
        null, // context
        false, // runOnInit
        undefined, // utcOffset
        false // unrefTimeout
      );

      // Create scheduled job info
      const scheduledJob: ScheduledJob = {
        id: jobId,
        name: jobName,
        cronJob,
        storageType,
        schedule,
        enabled: schedule.enabled,
        runCount: 0,
        errorCount: 0,
        nextRun: cronJob.nextDate()?.toDate(),
      };

      this.scheduledJobs.set(jobId, scheduledJob);

      // Start the job if enabled
      if (schedule.enabled) {
        cronJob.start();
        this.logger.info(`Scheduled backup for ${storageType}: ${schedule.cron} (${schedule.timezone})`);
      }

      // Emit metrics
      if (this.metricsCollector) {
        this.metricsCollector.incrementCounter('backup_schedule_added', {
          storage_type: storageType
        });
      }

      return jobId;

    } catch (error) {
      this.logger.error(`Failed to schedule backup for ${storageType}:`, error);
      throw error;
    }
  }

  /**
   * Schedule cleanup job
   */
  async scheduleCleanup(config: BackupConfig): Promise<string> {
    if (!config.retentionPolicy.autoCleanup) {
      return '';
    }

    const jobId = 'cleanup-' + Date.now();
    const schedule: BackupSchedule = {
      cron: '0 3 * * *', // Daily at 3 AM
      timezone: config.defaultSchedule.timezone,
      enabled: true,
      timeout: 30, // 30 minutes
      retries: 1,
    };

    const cronJob = new CronJob(
      schedule.cron,
      async () => {
        await this.executeScheduledCleanup(jobId);
      },
      null,
      false,
      schedule.timezone
    );

    const scheduledJob: ScheduledJob = {
      id: jobId,
      name: 'Backup Cleanup',
      cronJob,
      storageType: 'file-system', // Placeholder
      schedule,
      enabled: true,
      runCount: 0,
      errorCount: 0,
      nextRun: cronJob.nextDate()?.toDate(),
    };

    this.scheduledJobs.set(jobId, scheduledJob);
    cronJob.start();

    this.logger.info(`Scheduled backup cleanup: ${schedule.cron} (${schedule.timezone})`);
    return jobId;
  }

  /**
   * Add custom schedule
   */
  async addSchedule(
    name: string,
    storageType: BackupStorageType,
    schedule: BackupSchedule,
    storageConfig?: Partial<StorageBackupConfig>
  ): Promise<string> {
    if (!this.isInitialized || !this.backupManager) {
      throw new Error('Scheduler not initialized');
    }

    const jobId = `custom-${storageType}-${Date.now()}`;

    const cronJob = new CronJob(
      schedule.cron,
      async () => {
        await this.executeScheduledBackup(jobId, storageType, storageConfig);
      },
      null,
      false,
      schedule.timezone
    );

    const scheduledJob: ScheduledJob = {
      id: jobId,
      name,
      cronJob,
      storageType,
      schedule,
      enabled: schedule.enabled,
      runCount: 0,
      errorCount: 0,
      nextRun: cronJob.nextDate()?.toDate(),
    };

    this.scheduledJobs.set(jobId, scheduledJob);

    if (schedule.enabled) {
      cronJob.start();
      this.logger.info(`Added custom schedule "${name}" for ${storageType}: ${schedule.cron}`);
    }

    return jobId;
  }

  /**
   * Remove schedule
   */
  async removeSchedule(jobId: string): Promise<boolean> {
    const job = this.scheduledJobs.get(jobId);
    if (!job) {
      return false;
    }

    job.cronJob.stop();
    this.scheduledJobs.delete(jobId);

    this.logger.info(`Removed schedule: ${job.name} (${jobId})`);

    // Emit metrics
    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_schedule_removed', {
        storage_type: job.storageType
      });
    }

    return true;
  }

  /**
   * Enable/disable schedule
   */
  async toggleSchedule(jobId: string, enabled: boolean): Promise<boolean> {
    const job = this.scheduledJobs.get(jobId);
    if (!job) {
      return false;
    }

    job.enabled = enabled;

    if (enabled) {
      job.cronJob.start();
      job.nextRun = job.cronJob.nextDate()?.toDate();
      this.logger.info(`Enabled schedule: ${job.name} (${jobId})`);
    } else {
      job.cronJob.stop();
      job.nextRun = undefined;
      this.logger.info(`Disabled schedule: ${job.name} (${jobId})`);
    }

    return true;
  }

  /**
   * Update schedule
   */
  async updateSchedule(jobId: string, updates: Partial<BackupSchedule>): Promise<boolean> {
    const job = this.scheduledJobs.get(jobId);
    if (!job) {
      return false;
    }

    // Stop existing job
    job.cronJob.stop();

    // Update schedule
    job.schedule = { ...job.schedule, ...updates };

    // Create new cron job with updated schedule
    const newCronJob = new CronJob(
      job.schedule.cron,
      async () => {
        await this.executeScheduledBackup(jobId, job.storageType);
      },
      null,
      false,
      job.schedule.timezone
    );

    job.cronJob = newCronJob;

    // Start if enabled
    if (job.enabled && job.schedule.enabled) {
      newCronJob.start();
      job.nextRun = newCronJob.nextDate()?.toDate();
    }

    this.logger.info(`Updated schedule: ${job.name} (${jobId})`);
    return true;
  }

  /**
   * Get all scheduled jobs
   */
  getScheduledJobs(): ScheduledJob[] {
    return Array.from(this.scheduledJobs.values()).map(job => ({
      ...job,
      cronJob: undefined as any, // Don't expose CronJob instance
    }));
  }

  /**
   * Get specific scheduled job
   */
  getScheduledJob(jobId: string): ScheduledJob | null {
    const job = this.scheduledJobs.get(jobId);
    if (!job) {
      return null;
    }

    return {
      ...job,
      cronJob: undefined as any, // Don't expose CronJob instance
    };
  }

  /**
   * Get next execution times for all jobs
   */
  getNextExecutions(): Record<string, Date | null> {
    const executions: Record<string, Date | null> = {};

    for (const [jobId, job] of this.scheduledJobs) {
      executions[jobId] = job.enabled ? job.cronJob.nextDate()?.toDate() || null : null;
    }

    return executions;
  }

  /**
   * Run scheduled job immediately
   */
  async runJobNow(jobId: string): Promise<ScheduleResult> {
    const job = this.scheduledJobs.get(jobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }

    this.logger.info(`Running scheduled job immediately: ${job.name} (${jobId})`);

    const startTime = new Date();

    try {
      if (job.name === 'Backup Cleanup') {
        await this.executeScheduledCleanup(jobId);
      } else {
        await this.executeScheduledBackup(jobId, job.storageType);
      }

      const endTime = new Date();
      const result: ScheduleResult = {
        jobId,
        success: true,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
      };

      this.emit('job:executed', result);
      return result;

    } catch (error) {
      const endTime = new Date();
      const result: ScheduleResult = {
        jobId,
        success: false,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        error: error as Error,
      };

      this.emit('job:failed', result);
      return result;
    }
  }

  /**
   * Clear all schedules
   */
  async clearAllSchedules(): Promise<void> {
    for (const [jobId, job] of this.scheduledJobs) {
      job.cronJob.stop();
    }

    this.scheduledJobs.clear();
    this.logger.info('Cleared all scheduled jobs');
  }

  /**
   * Get scheduler statistics
   */
  getStatistics(): Record<string, any> {
    const jobs = Array.from(this.scheduledJobs.values());
    const enabled = jobs.filter(job => job.enabled);
    const totalRuns = jobs.reduce((sum, job) => sum + job.runCount, 0);
    const totalErrors = jobs.reduce((sum, job) => sum + job.errorCount, 0);

    return {
      totalJobs: jobs.length,
      enabledJobs: enabled.length,
      disabledJobs: jobs.length - enabled.length,
      totalRuns,
      totalErrors,
      successRate: totalRuns > 0 ? ((totalRuns - totalErrors) / totalRuns) * 100 : 0,
      nextExecution: this.getNextExecutionTime(),
      storageTypes: this.getStorageTypeStats(),
    };
  }

  /**
   * Shutdown scheduler
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Shutting down backup scheduler');

    await this.clearAllSchedules();

    this.logger.info('Backup scheduler shutdown complete');
  }

  // Private helper methods

  /**
   * Execute scheduled backup
   */
  private async executeScheduledBackup(
    jobId: string,
    storageType: BackupStorageType,
    storageConfig?: Partial<StorageBackupConfig>
  ): Promise<void> {
    const job = this.scheduledJobs.get(jobId);
    if (!job || this.isShuttingDown) {
      return;
    }

    const startTime = new Date();
    this.logger.info(`Executing scheduled backup: ${job.name} (${jobId})`);

    try {
      // Update job info
      job.lastRun = startTime;
      job.nextRun = job.cronJob.nextDate()?.toDate();

      // Execute backup with timeout
      const timeoutMs = job.schedule.timeout * 60 * 1000; // Convert minutes to milliseconds
      const backupPromise = this.backupManager!.startBackup(storageType, storageConfig);

      const backupJobId = await Promise.race([
        backupPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Backup timeout')), timeoutMs)
        ),
      ]);

      // Wait for backup to complete
      let backupJob = await this.backupManager!.getBackupStatus(backupJobId);
      while (backupJob && backupJob.status === 'in-progress') {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
        backupJob = await this.backupManager!.getBackupStatus(backupJobId);
      }

      if (backupJob?.status === 'completed') {
        job.runCount++;
        const duration = Date.now() - startTime.getTime();

        this.logger.info(`Scheduled backup completed: ${job.name} (${duration}ms)`);

        // Emit metrics
        if (this.metricsCollector) {
          this.metricsCollector.incrementCounter('backup_scheduled_success', {
            storage_type: storageType
          });
          this.metricsCollector.recordHistogram('backup_scheduled_duration', duration, {
            storage_type: storageType
          });
        }

        // Emit event
        this.emit('job:completed', {
          jobId,
          storageType,
          success: true,
          startTime,
          endTime: new Date(),
          duration,
        });

      } else {
        throw new Error(`Backup job failed: ${backupJob?.error?.message || 'Unknown error'}`);
      }

    } catch (error) {
      await this.handleScheduleError(job, error as Error, startTime);
    }
  }

  /**
   * Execute scheduled cleanup
   */
  private async executeScheduledCleanup(jobId: string): Promise<void> {
    const job = this.scheduledJobs.get(jobId);
    if (!job || this.isShuttingDown) {
      return;
    }

    const startTime = new Date();
    this.logger.info(`Executing scheduled cleanup: ${job.name} (${jobId})`);

    try {
      job.lastRun = startTime;
      job.nextRun = job.cronJob.nextDate()?.toDate();

      const deletedCount = await this.backupManager!.cleanupOldBackups();

      job.runCount++;
      const duration = Date.now() - startTime.getTime();

      this.logger.info(`Scheduled cleanup completed: deleted ${deletedCount} backups (${duration}ms)`);

      // Emit metrics
      if (this.metricsCollector) {
        this.metricsCollector.incrementCounter('backup_cleanup_scheduled_success');
        this.metricsCollector.recordHistogram('backup_cleanup_duration', duration);
        this.metricsCollector.recordGauge('backup_cleanup_deleted_count', deletedCount);
      }

      // Emit event
      this.emit('cleanup:completed', {
        jobId,
        success: true,
        startTime,
        endTime: new Date(),
        duration,
        deletedCount,
      });

    } catch (error) {
      await this.handleScheduleError(job, error as Error, startTime);
    }
  }

  /**
   * Handle schedule execution error
   */
  private async handleScheduleError(job: ScheduledJob, error: Error, startTime: Date): Promise<void> {
    job.errorCount++;
    job.lastError = error;

    const duration = Date.now() - startTime.getTime();

    this.logger.error(`Scheduled job failed: ${job.name} (${job.id}) - ${error.message}`);

    // Emit metrics
    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_scheduled_failure', {
        storage_type: job.storageType
      });
    }

    // Emit event
    this.emit('job:failed', {
      jobId: job.id,
      storageType: job.storageType,
      success: false,
      startTime,
      endTime: new Date(),
      duration,
      error,
    });

    // Retry logic
    const maxRetries = job.schedule.retries || 0;
    if (job.errorCount <= maxRetries) {
      this.logger.info(`Retrying scheduled job: ${job.name} (attempt ${job.errorCount}/${maxRetries})`);

      // Schedule retry with exponential backoff
      const retryDelay = Math.min(1000 * Math.pow(2, job.errorCount - 1), 300000); // Max 5 minutes
      setTimeout(() => {
        if (job.name === 'Backup Cleanup') {
          this.executeScheduledCleanup(job.id);
        } else {
          this.executeScheduledBackup(job.id, job.storageType);
        }
      }, retryDelay);
    }
  }

  /**
   * Get next execution time across all jobs
   */
  private getNextExecutionTime(): Date | null {
    let nextTime: Date | null = null;

    for (const job of this.scheduledJobs.values()) {
      if (job.enabled) {
        const jobNextTime = job.cronJob.nextDate()?.toDate();
        if (jobNextTime && (!nextTime || jobNextTime < nextTime)) {
          nextTime = jobNextTime;
        }
      }
    }

    return nextTime;
  }

  /**
   * Get storage type statistics
   */
  private getStorageTypeStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const job of this.scheduledJobs.values()) {
      if (!stats[job.storageType]) {
        stats[job.storageType] = {
          totalJobs: 0,
          enabledJobs: 0,
          totalRuns: 0,
          totalErrors: 0,
          lastRun: null,
          nextRun: null,
        };
      }

      const stat = stats[job.storageType];
      stat.totalJobs++;

      if (job.enabled) {
        stat.enabledJobs++;
      }

      stat.totalRuns += job.runCount;
      stat.totalErrors += job.errorCount;

      if (job.lastRun && (!stat.lastRun || job.lastRun > stat.lastRun)) {
        stat.lastRun = job.lastRun;
      }

      if (job.enabled && job.nextRun && (!stat.nextRun || job.nextRun < stat.nextRun)) {
        stat.nextRun = job.nextRun;
      }
    }

    return stats;
  }
}