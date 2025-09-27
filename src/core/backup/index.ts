/**
 * Backup System Export Module
 *
 * Provides a centralized export point for all backup system components.
 * This module exports the main classes, types, and utilities needed
 * to use the comprehensive backup system.
 */

// Core types and interfaces
export * from './types.js';

// Configuration management
export * from './config.js';

// Main backup manager
export { BackupManager } from './manager.js';
import { BackupManager } from './manager.js';

// Backup scheduler
export { BackupScheduler } from './scheduler.js';
import { BackupScheduler } from './scheduler.js';

// Storage handlers
export { BaseStorageBackupHandler } from './handlers/base-handler.js';
export { SqliteBackupHandler } from './handlers/sqlite-handler.js';
export { PostgreSQLBackupHandler } from './handlers/postgres-handler.js';
export { RedisBackupHandler } from './handlers/redis-handler.js';
export { FileSystemBackupHandler } from './handlers/file-system-handler.js';

// Utility functions
export {
  createDefaultBackupConfig,
  loadBackupConfig,
  validateBackupConfig,
  mergeBackupConfig,
  saveBackupConfig,
  getStorageConfig,
  updateStorageConfig,
  updateDestination,
  removeDestination,
} from './config.js';

/**
 * Initialize backup system with default configuration
 */
export async function initializeBackupSystem(config?: any): Promise<{
  manager: import('./manager.js').BackupManager;
  scheduler: import('./scheduler.js').BackupScheduler;
}> {
  const { Logger } = await import('../logger/logger.js');
  const { BackupManager } = await import('./manager.js');
  const { BackupScheduler } = await import('./scheduler.js');
  const { createDefaultBackupConfig } = await import('./config.js');
  const logger = new Logger({ level: 'info' });

  try {
    // Create or load configuration
    const backupConfig = config || createDefaultBackupConfig();

    // Initialize components
    const manager = new BackupManager(backupConfig, logger);
    const scheduler = new BackupScheduler(logger);

    // Initialize manager
    await manager.initialize();

    // Initialize scheduler
    await scheduler.initialize(manager);

    // Schedule backups from configuration
    if (backupConfig.enabled) {
      await scheduler.scheduleFromConfig(backupConfig);
    }

    logger.info('Backup system initialized successfully');

    return { manager, scheduler };

  } catch (error) {
    logger.error('Failed to initialize backup system:', error);
    throw error;
  }
}

/**
 * Shutdown backup system gracefully
 */
export async function shutdownBackupSystem(
  manager: import('./manager.js').BackupManager,
  scheduler: import('./scheduler.js').BackupScheduler
): Promise<void> {
  const { Logger } = await import('../logger/logger.js');
  const logger = new Logger({ level: 'info' });

  try {
    logger.info('Shutting down backup system...');

    // Shutdown scheduler first to stop new jobs
    await scheduler.shutdown();

    // Shutdown manager to complete running jobs
    await manager.shutdown();

    logger.info('Backup system shutdown complete');

  } catch (error) {
    logger.error('Error during backup system shutdown:', error);
    throw error;
  }
}

/**
 * Create storage handler registry
 */
export async function createStorageHandlerRegistry(): Promise<Map<string, any>> {
  const registry = new Map();

  // Register built-in handlers
  const { SqliteBackupHandler } = await import('./handlers/sqlite-handler.js');
  const { PostgreSQLBackupHandler } = await import('./handlers/postgres-handler.js');
  const { RedisBackupHandler } = await import('./handlers/redis-handler.js');
  const { FileSystemBackupHandler } = await import('./handlers/file-system-handler.js');

  registry.set('sqlite', SqliteBackupHandler);
  registry.set('postgres', PostgreSQLBackupHandler);
  registry.set('redis', RedisBackupHandler);
  registry.set('file-system', FileSystemBackupHandler);

  return registry;
}

/**
 * Backup system health check
 */
export async function checkBackupSystemHealth(
  manager: BackupManager,
  scheduler: BackupScheduler
): Promise<{
  healthy: boolean;
  details: Record<string, any>;
}> {
  const details: Record<string, any> = {};

  try {
    // Check manager status
    const config = manager.getConfig();
    const statistics = await manager.getStatistics();

    details.manager = {
      enabled: config.enabled,
      maxParallelJobs: config.global.maxParallelJobs,
      totalBackups: statistics.totalBackups,
      successfulBackups: statistics.successfulBackups,
      successRate: statistics.successRate,
      lastBackupTime: statistics.lastBackupTime,
    };

    // Check scheduler status
    const schedulerStats = scheduler.getStatistics();
    const nextExecutions = scheduler.getNextExecutions();

    details.scheduler = {
      totalJobs: schedulerStats.totalJobs,
      enabledJobs: schedulerStats.enabledJobs,
      totalRuns: schedulerStats.totalRuns,
      successRate: schedulerStats.successRate,
      nextExecution: schedulerStats.nextExecution,
      upcomingJobs: Object.keys(nextExecutions).length,
    };

    // Check storage configurations
    details.storage = {};
    for (const storageConfig of config.storageConfigs) {
      details.storage[storageConfig.type] = {
        enabled: storageConfig.enabled,
        backupType: storageConfig.backupType,
        compression: storageConfig.compression,
        hasPreHooks: storageConfig.preBackupHooks.length > 0,
        hasPostHooks: storageConfig.postBackupHooks.length > 0,
      };
    }

    // Check destinations
    details.destinations = config.destinations.map(dest => ({
      type: dest.type,
      path: dest.path,
      encryption: dest.encryption,
    }));

    // Overall health assessment
    const healthy =
      config.enabled &&
      statistics.successRate >= 80 && // At least 80% success rate
      schedulerStats.enabledJobs > 0 && // At least one scheduled job
      config.destinations.length > 0; // At least one destination

    return {
      healthy,
      details,
    };

  } catch (error) {
    return {
      healthy: false,
      details: {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Backup system version information
 */
export const BACKUP_SYSTEM_VERSION = '1.0.0';

/**
 * Supported storage types
 */
export const SUPPORTED_STORAGE_TYPES = [
  'sqlite',
  'postgres',
  'redis',
  'neo4j',
  'qdrant',
  'milvus',
  'chroma',
  'pinecone',
  'pgvector',
  'faiss',
  'weaviate',
  'file-system',
  'monitoring-data',
] as const;

/**
 * Supported backup types
 */
export const SUPPORTED_BACKUP_TYPES = [
  'full',
  'incremental',
  'differential',
] as const;

/**
 * Supported compression types
 */
export const SUPPORTED_COMPRESSION_TYPES = [
  'none',
  'gzip',
  'brotli',
  'lz4',
] as const;

/**
 * Supported destination types
 */
export const SUPPORTED_DESTINATION_TYPES = [
  'local',
  'aws-s3',
  'azure-blob',
  'gcp-storage',
  'ftp',
  'sftp',
] as const;

/**
 * Default backup configuration templates
 */
export const BACKUP_CONFIG_TEMPLATES = {
  minimal: {
    enabled: true,
    defaultSchedule: {
      cron: '0 2 * * *', // Daily at 2 AM
      timezone: 'UTC',
      enabled: true,
      timeout: 60,
      retries: 3,
    },
    destinations: [{
      type: 'local' as const,
      path: './backups',
      encryption: false,
    }],
    retentionPolicy: {
      dailyRetentionDays: 7,
      weeklyRetentionWeeks: 4,
      monthlyRetentionMonths: 12,
      maxBackups: 100,
      autoCleanup: true,
    },
    storageConfigs: [],
    global: {
      maxParallelJobs: 2,
      enableVerification: true,
      verificationTypes: ['checksum', 'size-validation'],
      metadataFormat: 'json' as const,
      enableMonitoring: true,
    },
  },

  production: {
    enabled: true,
    defaultSchedule: {
      cron: '0 1 * * *', // Daily at 1 AM
      timezone: 'UTC',
      enabled: true,
      timeout: 120,
      retries: 5,
    },
    destinations: [
      {
        type: 'local' as const,
        path: './backups',
        encryption: true,
      },
      {
        type: 'aws-s3' as const,
        path: 'backup-bucket',
        encryption: true,
      },
    ],
    retentionPolicy: {
      dailyRetentionDays: 30,
      weeklyRetentionWeeks: 12,
      monthlyRetentionMonths: 24,
      maxBackups: 200,
      autoCleanup: true,
    },
    storageConfigs: [],
    global: {
      maxParallelJobs: 5,
      enableVerification: true,
      verificationTypes: ['checksum', 'integrity-check', 'size-validation'],
      metadataFormat: 'json' as const,
      enableMonitoring: true,
      notifications: {
        onSuccess: false,
        onFailure: true,
        channels: ['email', 'slack'],
      },
    },
  },
};

export default {
  BackupManager,
  BackupScheduler,
  initializeBackupSystem,
  shutdownBackupSystem,
  checkBackupSystemHealth,
  createStorageHandlerRegistry,
  BACKUP_SYSTEM_VERSION,
  SUPPORTED_STORAGE_TYPES,
  SUPPORTED_BACKUP_TYPES,
  SUPPORTED_COMPRESSION_TYPES,
  SUPPORTED_DESTINATION_TYPES,
  BACKUP_CONFIG_TEMPLATES,
};