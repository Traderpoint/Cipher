/**
 * Backup System Types
 *
 * Defines the types and interfaces for the comprehensive backup system
 * that supports all storage backends in the cipher-project.
 */

import { z } from 'zod';

/**
 * Supported backup storage backend types
 */
export type BackupStorageType =
  | 'sqlite'
  | 'postgres'
  | 'redis'
  | 'neo4j'
  | 'qdrant'
  | 'milvus'
  | 'chroma'
  | 'pinecone'
  | 'pgvector'
  | 'faiss'
  | 'weaviate'
  | 'file-system'
  | 'monitoring-data';

/**
 * Backup types supported
 */
export type BackupType = 'full' | 'incremental' | 'differential';

/**
 * Backup compression types
 */
export type CompressionType = 'none' | 'gzip' | 'brotli' | 'lz4';

/**
 * Backup destination types
 */
export type BackupDestinationType = 'local' | 'aws-s3' | 'azure-blob' | 'gcp-storage' | 'ftp' | 'sftp';

/**
 * Backup status types
 */
export type BackupStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Backup verification types
 */
export type VerificationType = 'checksum' | 'integrity-check' | 'restore-test' | 'size-validation';

/**
 * Backup schedule configuration schema
 */
export const BackupScheduleSchema = z.object({
  /** Cron expression for scheduling */
  cron: z.string().min(1).describe('Cron expression (e.g., "0 2 * * *" for daily at 2 AM)'),
  /** Timezone for schedule execution */
  timezone: z.string().default('UTC').describe('Timezone for schedule execution'),
  /** Whether the schedule is enabled */
  enabled: z.boolean().default(true).describe('Whether the schedule is enabled'),
  /** Maximum runtime before timeout (minutes) */
  timeout: z.number().min(1).max(1440).default(60).describe('Maximum runtime in minutes'),
  /** Retry attempts on failure */
  retries: z.number().min(0).max(10).default(3).describe('Number of retry attempts on failure'),
});

export type BackupSchedule = z.infer<typeof BackupScheduleSchema>;

/**
 * Backup retention policy schema
 */
export const RetentionPolicySchema = z.object({
  /** Keep daily backups for X days */
  dailyRetentionDays: z.number().min(1).max(365).default(7).describe('Keep daily backups for X days'),
  /** Keep weekly backups for X weeks */
  weeklyRetentionWeeks: z.number().min(1).max(104).default(4).describe('Keep weekly backups for X weeks'),
  /** Keep monthly backups for X months */
  monthlyRetentionMonths: z.number().min(1).max(60).default(12).describe('Keep monthly backups for X months'),
  /** Maximum total backups to keep */
  maxBackups: z.number().min(1).max(1000).default(100).describe('Maximum total backups to keep'),
  /** Auto-cleanup enabled */
  autoCleanup: z.boolean().default(true).describe('Enable automatic cleanup of old backups'),
});

export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

/**
 * Backup destination configuration schema
 */
export const BackupDestinationSchema = z.object({
  /** Destination type */
  type: z.enum(['local', 'aws-s3', 'azure-blob', 'gcp-storage', 'ftp', 'sftp']).describe('Backup destination type'),
  /** Base path or bucket name */
  path: z.string().min(1).describe('Base path or bucket name for backups'),
  /** Connection configuration */
  config: z.record(z.any()).optional().describe('Destination-specific configuration'),
  /** Whether to encrypt backups at destination */
  encryption: z.boolean().default(false).describe('Enable encryption at destination'),
  /** Encryption key or reference */
  encryptionKey: z.string().optional().describe('Encryption key or key reference'),
});

export type BackupDestination = z.infer<typeof BackupDestinationSchema>;

/**
 * Storage backend backup configuration schema
 */
export const StorageBackupConfigSchema = z.object({
  /** Storage backend type */
  type: z.enum(['sqlite', 'postgres', 'redis', 'neo4j', 'qdrant', 'milvus', 'chroma', 'pinecone', 'pgvector', 'faiss', 'weaviate', 'file-system', 'monitoring-data']).describe('Storage backend type'),
  /** Whether backup is enabled for this storage */
  enabled: z.boolean().default(true).describe('Enable backup for this storage'),
  /** Backup type preference */
  backupType: z.enum(['full', 'incremental', 'differential']).default('full').describe('Backup type preference'),
  /** Compression type */
  compression: z.enum(['none', 'gzip', 'brotli', 'lz4']).default('gzip').describe('Compression type'),
  /** Storage-specific configuration */
  config: z.record(z.any()).optional().describe('Storage-specific backup configuration'),
  /** Custom backup command or script */
  customCommand: z.string().optional().describe('Custom backup command or script'),
  /** Pre-backup hooks */
  preBackupHooks: z.array(z.string()).default([]).describe('Commands to run before backup'),
  /** Post-backup hooks */
  postBackupHooks: z.array(z.string()).default([]).describe('Commands to run after backup'),
});

export type StorageBackupConfig = z.infer<typeof StorageBackupConfigSchema>;

/**
 * Global backup configuration schema
 */
export const BackupConfigSchema = z.object({
  /** Whether backup system is enabled */
  enabled: z.boolean().default(true).describe('Enable backup system'),
  /** Default backup schedule */
  defaultSchedule: BackupScheduleSchema.describe('Default backup schedule'),
  /** Backup destinations */
  destinations: z.array(BackupDestinationSchema).min(1).describe('Backup destinations'),
  /** Default retention policy */
  retentionPolicy: RetentionPolicySchema.describe('Default retention policy'),
  /** Storage backend configurations */
  storageConfigs: z.array(StorageBackupConfigSchema).describe('Storage backend backup configurations'),
  /** Global backup settings */
  global: z.object({
    /** Parallel backup jobs */
    maxParallelJobs: z.number().min(1).max(10).default(3).describe('Maximum parallel backup jobs'),
    /** Enable backup verification */
    enableVerification: z.boolean().default(true).describe('Enable backup verification'),
    /** Verification types to run */
    verificationTypes: z.array(z.enum(['checksum', 'integrity-check', 'restore-test', 'size-validation'])).default(['checksum', 'size-validation']).describe('Verification types to run'),
    /** Backup metadata format */
    metadataFormat: z.enum(['json', 'yaml']).default('json').describe('Backup metadata format'),
    /** Enable monitoring integration */
    enableMonitoring: z.boolean().default(true).describe('Enable monitoring integration'),
    /** Backup notification settings */
    notifications: z.object({
      /** Enable success notifications */
      onSuccess: z.boolean().default(false).describe('Send notifications on success'),
      /** Enable failure notifications */
      onFailure: z.boolean().default(true).describe('Send notifications on failure'),
      /** Notification channels */
      channels: z.array(z.string()).default([]).describe('Notification channels (email, slack, webhook)'),
    }).optional().describe('Backup notification settings'),
  }).describe('Global backup settings'),
});

export type BackupConfig = z.infer<typeof BackupConfigSchema>;

/**
 * Backup metadata interface
 */
export interface BackupMetadata {
  /** Unique backup ID */
  id: string;
  /** Storage backend type */
  storageType: BackupStorageType;
  /** Backup type */
  backupType: BackupType;
  /** Backup status */
  status: BackupStatus;
  /** Start timestamp */
  startTime: Date;
  /** End timestamp */
  endTime?: Date;
  /** Backup size in bytes */
  size?: number;
  /** Compressed size in bytes */
  compressedSize?: number;
  /** Compression type used */
  compression: CompressionType;
  /** Backup file paths */
  files: string[];
  /** Destination information */
  destination: {
    type: BackupDestinationType;
    path: string;
  };
  /** Checksum information */
  checksums: Record<string, string>;
  /** Source configuration snapshot */
  sourceConfig: Record<string, any>;
  /** Backup creation version */
  version: string;
  /** Error information if failed */
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  /** Verification results */
  verification?: {
    type: VerificationType;
    passed: boolean;
    details?: Record<string, any>;
  }[];
  /** Tags for categorization */
  tags: string[];
  /** Additional metadata */
  metadata: Record<string, any>;
}

/**
 * Backup job interface
 */
export interface BackupJob {
  /** Job ID */
  id: string;
  /** Storage type to backup */
  storageType: BackupStorageType;
  /** Backup configuration */
  config: StorageBackupConfig;
  /** Destination configuration */
  destination: BackupDestination;
  /** Job status */
  status: BackupStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current operation description */
  currentOperation: string;
  /** Start time */
  startTime: Date;
  /** Estimated completion time */
  estimatedCompletion?: Date;
  /** Error information */
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  /** Job metadata */
  metadata: BackupMetadata;
}

/**
 * Backup restore options
 */
export interface RestoreOptions {
  /** Backup ID to restore from */
  backupId: string;
  /** Target location for restore */
  targetPath?: string;
  /** Whether to overwrite existing data */
  overwrite: boolean;
  /** Specific files to restore (if not all) */
  files?: string[];
  /** Restore verification */
  verify: boolean;
  /** Custom restore configuration */
  config?: Record<string, any>;
}

/**
 * Backup search filters
 */
export interface BackupSearchFilters {
  /** Storage type filter */
  storageType?: BackupStorageType;
  /** Status filter */
  status?: BackupStatus;
  /** Date range filter */
  dateRange?: {
    start: Date;
    end: Date;
  };
  /** Size range filter (bytes) */
  sizeRange?: {
    min: number;
    max: number;
  };
  /** Tags filter */
  tags?: string[];
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order */
  sortBy?: 'startTime' | 'size' | 'storageType';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Backup statistics interface
 */
export interface BackupStatistics {
  /** Total backups */
  totalBackups: number;
  /** Successful backups */
  successfulBackups: number;
  /** Failed backups */
  failedBackups: number;
  /** Total backup size */
  totalSize: number;
  /** Average backup size */
  averageSize: number;
  /** Last backup time */
  lastBackupTime?: Date;
  /** Next scheduled backup */
  nextScheduledBackup?: Date;
  /** Backup success rate */
  successRate: number;
  /** Storage type breakdown */
  storageTypeStats: Record<BackupStorageType, {
    count: number;
    size: number;
    lastBackup?: Date;
  }>;
}

/**
 * Storage handler interface
 */
export interface IStorageBackupHandler {
  /** Storage type this handler supports */
  readonly storageType: BackupStorageType;

  /** Check if the storage is available and accessible */
  isAvailable(): Promise<boolean>;

  /** Get storage configuration information */
  getStorageInfo(): Promise<Record<string, any>>;

  /** Create a backup of the storage */
  createBackup(config: StorageBackupConfig, destination: string): Promise<BackupMetadata>;

  /** Restore from a backup */
  restoreBackup(metadata: BackupMetadata, options: RestoreOptions): Promise<boolean>;

  /** Verify backup integrity */
  verifyBackup(metadata: BackupMetadata, verificationType: VerificationType): Promise<boolean>;

  /** Get estimated backup size */
  getEstimatedSize(): Promise<number>;

  /** Cleanup temporary files */
  cleanup(): Promise<void>;
}

/**
 * Backup destination handler interface
 */
export interface IBackupDestinationHandler {
  /** Destination type this handler supports */
  readonly destinationType: BackupDestinationType;

  /** Upload backup files to destination */
  upload(files: string[], destination: BackupDestination): Promise<string[]>;

  /** Download backup files from destination */
  download(remotePaths: string[], localPath: string, destination: BackupDestination): Promise<string[]>;

  /** Delete backup files from destination */
  delete(remotePaths: string[], destination: BackupDestination): Promise<boolean>;

  /** List backup files at destination */
  list(destination: BackupDestination): Promise<string[]>;

  /** Check if destination is accessible */
  isAccessible(destination: BackupDestination): Promise<boolean>;

  /** Get file metadata from destination */
  getFileMetadata(remotePath: string, destination: BackupDestination): Promise<Record<string, any>>;
}

/**
 * Backup manager interface
 */
export interface IBackupManager {
  /** Initialize the backup manager */
  initialize(): Promise<void>;

  /** Start a backup job for specific storage */
  startBackup(storageType: BackupStorageType, options?: Partial<StorageBackupConfig>): Promise<string>;

  /** Start a full system backup */
  startFullBackup(): Promise<string[]>;

  /** Get backup job status */
  getBackupStatus(jobId: string): Promise<BackupJob | null>;

  /** Cancel a running backup job */
  cancelBackup(jobId: string): Promise<boolean>;

  /** List all backup jobs */
  listJobs(filters?: Partial<BackupSearchFilters>): Promise<BackupJob[]>;

  /** Search backups */
  searchBackups(filters: BackupSearchFilters): Promise<BackupMetadata[]>;

  /** Restore from backup */
  restoreBackup(backupId: string, options: RestoreOptions): Promise<boolean>;

  /** Delete backup */
  deleteBackup(backupId: string): Promise<boolean>;

  /** Get backup statistics */
  getStatistics(): Promise<BackupStatistics>;

  /** Verify backup integrity */
  verifyBackup(backupId: string, verificationType?: VerificationType): Promise<boolean>;

  /** Get backup configuration */
  getConfig(): BackupConfig;

  /** Update backup configuration */
  updateConfig(config: Partial<BackupConfig>): Promise<void>;

  /** Cleanup old backups based on retention policy */
  cleanupOldBackups(): Promise<number>;

  /** Schedule automatic backups */
  scheduleBackups(): Promise<void>;

  /** Stop all scheduled backups */
  stopScheduledBackups(): Promise<void>;

  /** Get next scheduled backup times */
  getNextScheduledBackups(): Promise<Record<BackupStorageType, Date>>;

  /** Force run scheduled backups */
  runScheduledBackups(): Promise<void>;

  /** Shutdown the backup manager */
  shutdown(): Promise<void>;
}