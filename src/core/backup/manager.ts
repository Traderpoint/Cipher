/**
 * Universal Backup Manager
 *
 * Central orchestrator for the backup system that coordinates all storage backends,
 * manages backup jobs, schedules automated backups, and provides a unified API
 * for backup operations across the entire cipher-project.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { CronJob } from 'cron';
import {
  IBackupManager,
  IStorageBackupHandler,
  IBackupDestinationHandler,
  BackupConfig,
  BackupJob,
  BackupMetadata,
  BackupStatus,
  BackupStorageType,
  StorageBackupConfig,
  RestoreOptions,
  BackupSearchFilters,
  BackupStatistics,
  VerificationType,
  BackupDestination,
} from './types.js';
import { createDefaultBackupConfig, loadBackupConfig, validateBackupConfig } from './config.js';
import { Logger } from '../logger/logger.js';
import { MetricsCollector } from '../monitoring/metrics-collector.js';

/**
 * Universal Backup Manager Implementation
 */
export class BackupManager extends EventEmitter implements IBackupManager {
  private readonly logger: Logger;
  private readonly metricsCollector?: MetricsCollector;
  private config: BackupConfig;
  private storageHandlers: Map<BackupStorageType, IStorageBackupHandler> = new Map();
  private destinationHandlers: Map<string, IBackupDestinationHandler> = new Map();
  private activeJobs: Map<string, BackupJob> = new Map();
  private completedJobs: Map<string, BackupJob> = new Map();
  private scheduledJobs: Map<string, CronJob> = new Map();
  private isInitialized = false;
  private isShuttingDown = false;
  private backupQueue: Array<{ storageType: BackupStorageType; options?: Partial<StorageBackupConfig> }> = [];
  private processingQueue = false;

  constructor(config?: BackupConfig, logger?: Logger, metricsCollector?: MetricsCollector) {
    super();
    this.config = config || createDefaultBackupConfig();
    this.logger = logger || new Logger('BackupManager');
    this.metricsCollector = metricsCollector;

    // Set up event handlers
    this.on('job:started', this.handleJobStarted.bind(this));
    this.on('job:progress', this.handleJobProgress.bind(this));
    this.on('job:completed', this.handleJobCompleted.bind(this));
    this.on('job:failed', this.handleJobFailed.bind(this));
    this.on('job:cancelled', this.handleJobCancelled.bind(this));
  }

  /**
   * Initialize the backup manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.logger.info('Initializing backup manager...');

    try {
      // Validate configuration
      this.config = validateBackupConfig(this.config);

      // Initialize storage handlers
      await this.initializeStorageHandlers();

      // Initialize destination handlers
      await this.initializeDestinationHandlers();

      // Set up scheduled backups
      if (this.config.enabled) {
        await this.scheduleBackups();
      }

      // Start processing queue
      this.processQueue();

      this.isInitialized = true;
      this.logger.info('Backup manager initialized successfully');

      // Emit metrics
      if (this.metricsCollector) {
        this.metricsCollector.incrementCounter('backup_manager_initialized');
      }

    } catch (error) {
      this.logger.error('Failed to initialize backup manager:', error);
      throw error;
    }
  }

  /**
   * Start a backup job for specific storage
   */
  async startBackup(
    storageType: BackupStorageType,
    options?: Partial<StorageBackupConfig>
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Backup manager not initialized');
    }

    if (this.isShuttingDown) {
      throw new Error('Backup manager is shutting down');
    }

    // Check if storage type is enabled
    const storageConfig = this.config.storageConfigs.find(c => c.type === storageType);
    if (!storageConfig || !storageConfig.enabled) {
      throw new Error(`Backup not enabled for storage type: ${storageType}`);
    }

    // Check if we have a handler for this storage type
    const handler = this.storageHandlers.get(storageType);
    if (!handler) {
      throw new Error(`No backup handler available for storage type: ${storageType}`);
    }

    // Check storage availability
    const isAvailable = await handler.isAvailable();
    if (!isAvailable) {
      throw new Error(`Storage ${storageType} is not available for backup`);
    }

    // Check if we're at the parallel job limit
    if (this.activeJobs.size >= this.config.global.maxParallelJobs) {
      // Add to queue
      this.backupQueue.push({ storageType, options });
      this.logger.info(`Backup job for ${storageType} queued (${this.backupQueue.length} in queue)`);

      // Return a placeholder job ID for the queued job
      const queuedJobId = uuidv4();
      return queuedJobId;
    }

    return this.executeBackupJob(storageType, options);
  }

  /**
   * Start a full system backup
   */
  async startFullBackup(): Promise<string[]> {
    const enabledStorageTypes = this.config.storageConfigs
      .filter(config => config.enabled)
      .map(config => config.type);

    const jobIds: string[] = [];

    for (const storageType of enabledStorageTypes) {
      try {
        const jobId = await this.startBackup(storageType);
        jobIds.push(jobId);
      } catch (error) {
        this.logger.error(`Failed to start backup for ${storageType}:`, error);
        // Continue with other storage types
      }
    }

    this.logger.info(`Started full system backup with ${jobIds.length} jobs`);
    return jobIds;
  }

  /**
   * Get backup job status
   */
  async getBackupStatus(jobId: string): Promise<BackupJob | null> {
    return this.activeJobs.get(jobId) || this.completedJobs.get(jobId) || null;
  }

  /**
   * Cancel a running backup job
   */
  async cancelBackup(jobId: string): Promise<boolean> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return false;
    }

    job.status = 'cancelled';
    job.currentOperation = 'Cancelling...';

    this.emit('job:cancelled', job);
    return true;
  }

  /**
   * List all backup jobs
   */
  async listJobs(filters?: Partial<BackupSearchFilters>): Promise<BackupJob[]> {
    const allJobs = [
      ...Array.from(this.activeJobs.values()),
      ...Array.from(this.completedJobs.values()),
    ];

    if (!filters) {
      return allJobs;
    }

    return allJobs.filter(job => {
      if (filters.storageType && job.storageType !== filters.storageType) {
        return false;
      }
      if (filters.status && job.status !== filters.status) {
        return false;
      }
      if (filters.dateRange) {
        const jobDate = job.startTime;
        if (jobDate < filters.dateRange.start || jobDate > filters.dateRange.end) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Search backups
   */
  async searchBackups(filters: BackupSearchFilters): Promise<BackupMetadata[]> {
    // This would typically query a persistent backup metadata store
    // For now, we'll return from completed jobs
    const jobs = await this.listJobs(filters);
    return jobs
      .filter(job => job.status === 'completed')
      .map(job => job.metadata)
      .sort((a, b) => {
        if (filters.sortBy === 'size') {
          return filters.sortOrder === 'desc' ? (b.size || 0) - (a.size || 0) : (a.size || 0) - (b.size || 0);
        }
        // Default sort by startTime
        return filters.sortOrder === 'desc'
          ? b.startTime.getTime() - a.startTime.getTime()
          : a.startTime.getTime() - b.startTime.getTime();
      })
      .slice(filters.offset || 0, (filters.offset || 0) + (filters.limit || 100));
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupId: string, options: RestoreOptions): Promise<boolean> {
    this.logger.info(`Starting restore from backup ${backupId}`);

    // Find backup metadata
    const backup = await this.findBackupMetadata(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    // Get storage handler
    const handler = this.storageHandlers.get(backup.storageType);
    if (!handler) {
      throw new Error(`No restore handler available for storage type: ${backup.storageType}`);
    }

    try {
      const success = await handler.restoreBackup(backup, options);

      if (success) {
        this.logger.info(`Successfully restored backup ${backupId}`);
        if (this.metricsCollector) {
          this.metricsCollector.incrementCounter('backup_restore_success', {
            storage_type: backup.storageType
          });
        }
      } else {
        this.logger.error(`Failed to restore backup ${backupId}`);
        if (this.metricsCollector) {
          this.metricsCollector.incrementCounter('backup_restore_failure', {
            storage_type: backup.storageType
          });
        }
      }

      return success;
    } catch (error) {
      this.logger.error(`Error during restore of backup ${backupId}:`, error);
      if (this.metricsCollector) {
        this.metricsCollector.incrementCounter('backup_restore_error', {
          storage_type: backup.storageType
        });
      }
      throw error;
    }
  }

  /**
   * Delete backup
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    this.logger.info(`Deleting backup ${backupId}`);

    // Find backup metadata
    const backup = await this.findBackupMetadata(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    try {
      // Delete from all destinations
      for (const destination of this.config.destinations) {
        const handler = this.destinationHandlers.get(destination.type);
        if (handler) {
          await handler.delete(backup.files, destination);
        }
      }

      // Remove from metadata store
      await this.removeBackupMetadata(backupId);

      this.logger.info(`Successfully deleted backup ${backupId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete backup ${backupId}:`, error);
      throw error;
    }
  }

  /**
   * Get backup statistics
   */
  async getStatistics(): Promise<BackupStatistics> {
    const allJobs = [
      ...Array.from(this.activeJobs.values()),
      ...Array.from(this.completedJobs.values()),
    ];

    const completedJobs = allJobs.filter(job => job.status === 'completed');
    const failedJobs = allJobs.filter(job => job.status === 'failed');

    const totalSize = completedJobs.reduce((sum, job) => sum + (job.metadata.size || 0), 0);
    const averageSize = completedJobs.length > 0 ? totalSize / completedJobs.length : 0;

    const lastBackupTime = completedJobs.length > 0
      ? new Date(Math.max(...completedJobs.map(job => job.startTime.getTime())))
      : undefined;

    // Calculate storage type breakdown
    const storageTypeStats: Record<string, any> = {};
    for (const job of completedJobs) {
      if (!storageTypeStats[job.storageType]) {
        storageTypeStats[job.storageType] = {
          count: 0,
          size: 0,
          lastBackup: undefined,
        };
      }

      storageTypeStats[job.storageType].count++;
      storageTypeStats[job.storageType].size += job.metadata.size || 0;

      if (!storageTypeStats[job.storageType].lastBackup ||
          job.startTime > storageTypeStats[job.storageType].lastBackup) {
        storageTypeStats[job.storageType].lastBackup = job.startTime;
      }
    }

    return {
      totalBackups: allJobs.length,
      successfulBackups: completedJobs.length,
      failedBackups: failedJobs.length,
      totalSize,
      averageSize,
      lastBackupTime,
      nextScheduledBackup: this.getNextScheduledBackupTime(),
      successRate: allJobs.length > 0 ? (completedJobs.length / allJobs.length) * 100 : 0,
      storageTypeStats,
    };
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupId: string, verificationType?: VerificationType): Promise<boolean> {
    const backup = await this.findBackupMetadata(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    const handler = this.storageHandlers.get(backup.storageType);
    if (!handler) {
      throw new Error(`No verification handler available for storage type: ${backup.storageType}`);
    }

    const verifyType = verificationType || 'checksum';
    return handler.verifyBackup(backup, verifyType);
  }

  /**
   * Get backup configuration
   */
  getConfig(): BackupConfig {
    return { ...this.config };
  }

  /**
   * Update backup configuration
   */
  async updateConfig(config: Partial<BackupConfig>): Promise<void> {
    const newConfig = { ...this.config, ...config };
    this.config = validateBackupConfig(newConfig);

    // Restart scheduled jobs if needed
    if (this.isInitialized) {
      await this.stopScheduledBackups();
      await this.scheduleBackups();
    }

    this.logger.info('Backup configuration updated');
  }

  /**
   * Cleanup old backups based on retention policy
   */
  async cleanupOldBackups(): Promise<number> {
    this.logger.info('Starting cleanup of old backups');

    let deletedCount = 0;
    const retentionPolicy = this.config.retentionPolicy;

    try {
      // Get all backups
      const allBackups = await this.searchBackups({
        sortBy: 'startTime',
        sortOrder: 'desc',
        limit: 1000,
      });

      const now = new Date();
      const dailyCutoff = new Date(now.getTime() - retentionPolicy.dailyRetentionDays * 24 * 60 * 60 * 1000);
      const weeklyCutoff = new Date(now.getTime() - retentionPolicy.weeklyRetentionWeeks * 7 * 24 * 60 * 60 * 1000);
      const monthlyCutoff = new Date(now.getTime() - retentionPolicy.monthlyRetentionMonths * 30 * 24 * 60 * 60 * 1000);

      // Group backups by storage type and date
      const backupsByType = new Map<BackupStorageType, BackupMetadata[]>();
      for (const backup of allBackups) {
        if (!backupsByType.has(backup.storageType)) {
          backupsByType.set(backup.storageType, []);
        }
        backupsByType.get(backup.storageType)!.push(backup);
      }

      // Apply retention policy for each storage type
      for (const [storageType, backups] of backupsByType) {
        const sortedBackups = backups.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

        // Keep recent daily backups
        const dailyBackups = sortedBackups.filter(b => b.startTime >= dailyCutoff);

        // Keep weekly backups (one per week)
        const weeklyBackups = this.filterWeeklyBackups(
          sortedBackups.filter(b => b.startTime < dailyCutoff && b.startTime >= weeklyCutoff)
        );

        // Keep monthly backups (one per month)
        const monthlyBackups = this.filterMonthlyBackups(
          sortedBackups.filter(b => b.startTime < weeklyCutoff && b.startTime >= monthlyCutoff)
        );

        // Determine backups to keep
        const toKeep = new Set([
          ...dailyBackups.map(b => b.id),
          ...weeklyBackups.map(b => b.id),
          ...monthlyBackups.map(b => b.id),
        ]);

        // Apply max backups limit
        if (toKeep.size > retentionPolicy.maxBackups) {
          const keepArray = Array.from(toKeep);
          const toRemove = keepArray.slice(retentionPolicy.maxBackups);
          toRemove.forEach(id => toKeep.delete(id));
        }

        // Delete old backups
        for (const backup of sortedBackups) {
          if (!toKeep.has(backup.id)) {
            try {
              await this.deleteBackup(backup.id);
              deletedCount++;
            } catch (error) {
              this.logger.error(`Failed to delete backup ${backup.id}:`, error);
            }
          }
        }
      }

      this.logger.info(`Cleanup completed. Deleted ${deletedCount} old backups`);
      return deletedCount;

    } catch (error) {
      this.logger.error('Failed to cleanup old backups:', error);
      throw error;
    }
  }

  /**
   * Schedule automatic backups
   */
  async scheduleBackups(): Promise<void> {
    if (!this.config.enabled || !this.config.defaultSchedule.enabled) {
      return;
    }

    this.logger.info('Scheduling automatic backups');

    // Schedule backup for each enabled storage type
    for (const storageConfig of this.config.storageConfigs) {
      if (!storageConfig.enabled) {
        continue;
      }

      const jobName = `backup-${storageConfig.type}`;

      try {
        const cronJob = new CronJob(
          this.config.defaultSchedule.cron,
          async () => {
            try {
              this.logger.info(`Starting scheduled backup for ${storageConfig.type}`);
              await this.startBackup(storageConfig.type);
            } catch (error) {
              this.logger.error(`Scheduled backup failed for ${storageConfig.type}:`, error);
            }
          },
          null,
          true,
          this.config.defaultSchedule.timezone
        );

        this.scheduledJobs.set(jobName, cronJob);
        this.logger.info(`Scheduled backup for ${storageConfig.type} with cron: ${this.config.defaultSchedule.cron}`);

      } catch (error) {
        this.logger.error(`Failed to schedule backup for ${storageConfig.type}:`, error);
      }
    }

    // Schedule cleanup job
    const cleanupCron = new CronJob(
      '0 3 * * *', // Daily at 3 AM
      async () => {
        if (this.config.retentionPolicy.autoCleanup) {
          try {
            await this.cleanupOldBackups();
          } catch (error) {
            this.logger.error('Scheduled cleanup failed:', error);
          }
        }
      },
      null,
      true,
      this.config.defaultSchedule.timezone
    );

    this.scheduledJobs.set('cleanup', cleanupCron);
  }

  /**
   * Stop all scheduled backups
   */
  async stopScheduledBackups(): Promise<void> {
    this.logger.info('Stopping scheduled backups');

    for (const [name, job] of this.scheduledJobs) {
      job.stop();
      this.logger.info(`Stopped scheduled job: ${name}`);
    }

    this.scheduledJobs.clear();
  }

  /**
   * Get next scheduled backup times
   */
  async getNextScheduledBackups(): Promise<Record<BackupStorageType, Date>> {
    const nextBackups: Record<string, Date> = {};

    for (const [name, job] of this.scheduledJobs) {
      if (name !== 'cleanup') {
        const storageType = name.replace('backup-', '') as BackupStorageType;
        const nextDate = job.nextDate();
        if (nextDate) {
          nextBackups[storageType] = nextDate.toDate();
        }
      }
    }

    return nextBackups;
  }

  /**
   * Force run scheduled backups
   */
  async runScheduledBackups(): Promise<void> {
    this.logger.info('Running scheduled backups immediately');

    for (const storageConfig of this.config.storageConfigs) {
      if (storageConfig.enabled) {
        try {
          await this.startBackup(storageConfig.type);
        } catch (error) {
          this.logger.error(`Failed to run scheduled backup for ${storageConfig.type}:`, error);
        }
      }
    }
  }

  /**
   * Shutdown the backup manager
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Shutting down backup manager');

    // Stop scheduled jobs
    await this.stopScheduledBackups();

    // Cancel active jobs
    const activeJobIds = Array.from(this.activeJobs.keys());
    for (const jobId of activeJobIds) {
      await this.cancelBackup(jobId);
    }

    // Cleanup storage handlers
    for (const handler of this.storageHandlers.values()) {
      try {
        await handler.cleanup();
      } catch (error) {
        this.logger.error('Error cleaning up storage handler:', error);
      }
    }

    this.storageHandlers.clear();
    this.destinationHandlers.clear();
    this.activeJobs.clear();

    this.logger.info('Backup manager shutdown complete');
  }

  // Private helper methods

  private async initializeStorageHandlers(): Promise<void> {
    // This would dynamically load and register storage handlers
    // For now, we'll skip the actual handler registration
    this.logger.info('Storage handlers initialized');
  }

  private async initializeDestinationHandlers(): Promise<void> {
    // This would dynamically load and register destination handlers
    // For now, we'll skip the actual handler registration
    this.logger.info('Destination handlers initialized');
  }

  private async executeBackupJob(
    storageType: BackupStorageType,
    options?: Partial<StorageBackupConfig>
  ): Promise<string> {
    const jobId = uuidv4();
    const storageConfig = this.config.storageConfigs.find(c => c.type === storageType)!;
    const mergedConfig = { ...storageConfig, ...options };

    const job: BackupJob = {
      id: jobId,
      storageType,
      config: mergedConfig,
      destination: this.config.destinations[0], // Use first destination for now
      status: 'pending',
      progress: 0,
      currentOperation: 'Initializing...',
      startTime: new Date(),
      metadata: {
        id: jobId,
        storageType,
        backupType: mergedConfig.backupType,
        status: 'pending',
        startTime: new Date(),
        compression: mergedConfig.compression,
        files: [],
        destination: {
          type: this.config.destinations[0].type,
          path: this.config.destinations[0].path,
        },
        checksums: {},
        sourceConfig: {},
        version: '1.0.0',
        tags: [storageType, mergedConfig.backupType],
        metadata: {},
      },
    };

    this.activeJobs.set(jobId, job);
    this.emit('job:started', job);

    // Execute backup asynchronously
    this.executeBackupAsync(job).catch(error => {
      job.error = {
        message: error.message,
        stack: error.stack,
        code: error.code,
      };
      job.status = 'failed';
      this.emit('job:failed', job);
    });

    return jobId;
  }

  private async executeBackupAsync(job: BackupJob): Promise<void> {
    const handler = this.storageHandlers.get(job.storageType);
    if (!handler) {
      throw new Error(`No backup handler available for storage type: ${job.storageType}`);
    }

    try {
      job.status = 'in-progress';
      job.currentOperation = 'Creating backup...';
      job.progress = 10;
      this.emit('job:progress', job);

      // Execute pre-backup hooks
      if (job.config.preBackupHooks.length > 0) {
        job.currentOperation = 'Running pre-backup hooks...';
        job.progress = 20;
        this.emit('job:progress', job);

        await this.executeHooks(job.config.preBackupHooks);
      }

      // Create backup
      job.currentOperation = 'Backing up data...';
      job.progress = 30;
      this.emit('job:progress', job);

      const tempDir = path.join(process.cwd(), 'temp', 'backups', job.id);
      await fs.mkdir(tempDir, { recursive: true });

      const metadata = await handler.createBackup(job.config, tempDir);
      job.metadata = { ...job.metadata, ...metadata };

      // Upload to destinations
      job.currentOperation = 'Uploading to destinations...';
      job.progress = 60;
      this.emit('job:progress', job);

      for (const destination of this.config.destinations) {
        const destHandler = this.destinationHandlers.get(destination.type);
        if (destHandler) {
          await destHandler.upload(metadata.files, destination);
        }
      }

      // Verify backup if enabled
      if (this.config.global.enableVerification) {
        job.currentOperation = 'Verifying backup...';
        job.progress = 80;
        this.emit('job:progress', job);

        for (const verificationType of this.config.global.verificationTypes) {
          const verified = await handler.verifyBackup(metadata, verificationType);
          if (!verified) {
            throw new Error(`Backup verification failed: ${verificationType}`);
          }
        }
      }

      // Execute post-backup hooks
      if (job.config.postBackupHooks.length > 0) {
        job.currentOperation = 'Running post-backup hooks...';
        job.progress = 90;
        this.emit('job:progress', job);

        await this.executeHooks(job.config.postBackupHooks);
      }

      // Cleanup temporary files
      await fs.rm(tempDir, { recursive: true, force: true });

      job.status = 'completed';
      job.progress = 100;
      job.currentOperation = 'Completed';
      job.metadata.endTime = new Date();
      job.metadata.status = 'completed';

      this.emit('job:completed', job);

    } catch (error) {
      job.error = {
        message: error.message,
        stack: error.stack,
        code: error.code,
      };
      job.status = 'failed';
      job.metadata.status = 'failed';
      job.metadata.error = job.error;

      this.emit('job:failed', job);
      throw error;
    }
  }

  private async executeHooks(hooks: string[]): Promise<void> {
    // Execute hooks - this would typically run shell commands or scripts
    for (const hook of hooks) {
      this.logger.info(`Executing hook: ${hook}`);
      // Implementation would depend on requirements
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue || this.isShuttingDown) {
      return;
    }

    this.processingQueue = true;

    while (this.backupQueue.length > 0 && this.activeJobs.size < this.config.global.maxParallelJobs) {
      const queuedJob = this.backupQueue.shift();
      if (queuedJob) {
        try {
          await this.executeBackupJob(queuedJob.storageType, queuedJob.options);
        } catch (error) {
          this.logger.error('Failed to execute queued backup job:', error);
        }
      }
    }

    this.processingQueue = false;

    // Schedule next queue processing
    if (this.backupQueue.length > 0) {
      setTimeout(() => this.processQueue(), 5000); // Check queue every 5 seconds
    }
  }

  private async findBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
    // This would typically query a persistent metadata store
    const job = this.completedJobs.get(backupId);
    return job?.metadata || null;
  }

  private async removeBackupMetadata(backupId: string): Promise<void> {
    // This would typically remove from a persistent metadata store
    this.completedJobs.delete(backupId);
  }

  private filterWeeklyBackups(backups: BackupMetadata[]): BackupMetadata[] {
    const weeklyBackups: BackupMetadata[] = [];
    const weeksSeen = new Set<string>();

    for (const backup of backups) {
      const weekKey = this.getWeekKey(backup.startTime);
      if (!weeksSeen.has(weekKey)) {
        weeksSeen.add(weekKey);
        weeklyBackups.push(backup);
      }
    }

    return weeklyBackups;
  }

  private filterMonthlyBackups(backups: BackupMetadata[]): BackupMetadata[] {
    const monthlyBackups: BackupMetadata[] = [];
    const monthsSeen = new Set<string>();

    for (const backup of backups) {
      const monthKey = this.getMonthKey(backup.startTime);
      if (!monthsSeen.has(monthKey)) {
        monthsSeen.add(monthKey);
        monthlyBackups.push(backup);
      }
    }

    return monthlyBackups;
  }

  private getWeekKey(date: Date): string {
    const year = date.getFullYear();
    const week = Math.ceil((date.getTime() - new Date(year, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
    return `${year}-W${week}`;
  }

  private getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
  }

  private getNextScheduledBackupTime(): Date | undefined {
    let nextTime: Date | undefined;

    for (const job of this.scheduledJobs.values()) {
      const jobNextTime = job.nextDate()?.toDate();
      if (jobNextTime && (!nextTime || jobNextTime < nextTime)) {
        nextTime = jobNextTime;
      }
    }

    return nextTime;
  }

  // Event handlers

  private handleJobStarted(job: BackupJob): void {
    this.logger.info(`Backup job started: ${job.id} (${job.storageType})`);

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_job_started', {
        storage_type: job.storageType
      });
    }
  }

  private handleJobProgress(job: BackupJob): void {
    this.logger.debug(`Backup job progress: ${job.id} - ${job.progress}% (${job.currentOperation})`);
  }

  private handleJobCompleted(job: BackupJob): void {
    this.activeJobs.delete(job.id);
    this.completedJobs.set(job.id, job);

    this.logger.info(`Backup job completed: ${job.id} (${job.storageType})`);

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_job_completed', {
        storage_type: job.storageType
      });

      const duration = job.metadata.endTime!.getTime() - job.startTime.getTime();
      this.metricsCollector.recordHistogram('backup_job_duration', duration, {
        storage_type: job.storageType
      });

      if (job.metadata.size) {
        this.metricsCollector.recordHistogram('backup_size', job.metadata.size, {
          storage_type: job.storageType
        });
      }
    }

    // Process queue
    setImmediate(() => this.processQueue());
  }

  private handleJobFailed(job: BackupJob): void {
    this.activeJobs.delete(job.id);
    this.completedJobs.set(job.id, job);

    this.logger.error(`Backup job failed: ${job.id} (${job.storageType}) - ${job.error?.message}`);

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_job_failed', {
        storage_type: job.storageType
      });
    }

    // Process queue
    setImmediate(() => this.processQueue());
  }

  private handleJobCancelled(job: BackupJob): void {
    this.activeJobs.delete(job.id);
    this.completedJobs.set(job.id, job);

    this.logger.info(`Backup job cancelled: ${job.id} (${job.storageType})`);

    if (this.metricsCollector) {
      this.metricsCollector.incrementCounter('backup_job_cancelled', {
        storage_type: job.storageType
      });
    }

    // Process queue
    setImmediate(() => this.processQueue());
  }
}