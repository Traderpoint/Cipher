/**
 * Backup Configuration Module
 *
 * Handles configuration loading, validation, and management for the backup system.
 * Supports environment variable overrides and runtime configuration updates.
 */

import { z } from 'zod';
import { env } from '../env.js';
import {
  BackupConfig,
  BackupConfigSchema,
  BackupDestination,
  StorageBackupConfig,
  RetentionPolicy,
  BackupSchedule
} from './types.js';

/**
 * Environment variable schema for backup configuration
 */
const BackupEnvSchema = z.object({
  // Core backup settings
  BACKUP_ENABLED: z.boolean().default(true),
  BACKUP_BASE_PATH: z.string().default('./backups'),
  BACKUP_MAX_PARALLEL_JOBS: z.number().min(1).max(10).default(3),
  BACKUP_ENABLE_VERIFICATION: z.boolean().default(true),
  BACKUP_ENABLE_MONITORING: z.boolean().default(true),

  // Default schedule settings
  BACKUP_DEFAULT_CRON: z.string().default('0 2 * * *'), // Daily at 2 AM
  BACKUP_DEFAULT_TIMEZONE: z.string().default('UTC'),
  BACKUP_DEFAULT_TIMEOUT: z.number().min(1).max(1440).default(60), // 60 minutes
  BACKUP_DEFAULT_RETRIES: z.number().min(0).max(10).default(3),

  // Retention policy settings
  BACKUP_DAILY_RETENTION_DAYS: z.number().min(1).max(365).default(7),
  BACKUP_WEEKLY_RETENTION_WEEKS: z.number().min(1).max(104).default(4),
  BACKUP_MONTHLY_RETENTION_MONTHS: z.number().min(1).max(60).default(12),
  BACKUP_MAX_BACKUPS: z.number().min(1).max(1000).default(100),
  BACKUP_AUTO_CLEANUP: z.boolean().default(true),

  // Destination settings
  BACKUP_DESTINATION_TYPE: z.enum(['local', 'aws-s3', 'azure-blob', 'gcp-storage', 'ftp', 'sftp']).default('local'),
  BACKUP_DESTINATION_PATH: z.string().optional(),
  BACKUP_DESTINATION_ENCRYPTION: z.boolean().default(false),
  BACKUP_DESTINATION_ENCRYPTION_KEY: z.string().optional(),

  // AWS S3 settings
  BACKUP_AWS_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_AWS_REGION: z.string().optional(),
  BACKUP_AWS_BUCKET: z.string().optional(),

  // Azure Blob settings
  BACKUP_AZURE_ACCOUNT_NAME: z.string().optional(),
  BACKUP_AZURE_ACCOUNT_KEY: z.string().optional(),
  BACKUP_AZURE_CONTAINER: z.string().optional(),

  // GCP Storage settings
  BACKUP_GCP_PROJECT_ID: z.string().optional(),
  BACKUP_GCP_KEY_FILE: z.string().optional(),
  BACKUP_GCP_BUCKET: z.string().optional(),

  // FTP/SFTP settings
  BACKUP_FTP_HOST: z.string().optional(),
  BACKUP_FTP_PORT: z.number().optional(),
  BACKUP_FTP_USERNAME: z.string().optional(),
  BACKUP_FTP_PASSWORD: z.string().optional(),
  BACKUP_FTP_SECURE: z.boolean().default(true), // Use SFTP by default

  // Storage-specific settings
  BACKUP_SQLITE_ENABLED: z.boolean().default(true),
  BACKUP_POSTGRES_ENABLED: z.boolean().default(true),
  BACKUP_REDIS_ENABLED: z.boolean().default(true),
  BACKUP_NEO4J_ENABLED: z.boolean().default(true),
  BACKUP_VECTOR_STORES_ENABLED: z.boolean().default(true),
  BACKUP_MONITORING_DATA_ENABLED: z.boolean().default(true),
  BACKUP_FILE_SYSTEM_ENABLED: z.boolean().default(true),

  // Compression settings
  BACKUP_DEFAULT_COMPRESSION: z.enum(['none', 'gzip', 'brotli', 'lz4']).default('gzip'),

  // Notification settings
  BACKUP_NOTIFY_ON_SUCCESS: z.boolean().default(false),
  BACKUP_NOTIFY_ON_FAILURE: z.boolean().default(true),
  BACKUP_NOTIFICATION_CHANNELS: z.string().optional(), // Comma-separated list

  // Verification settings
  BACKUP_VERIFICATION_TYPES: z.string().default('checksum,size-validation'), // Comma-separated list
});

type BackupEnvConfig = z.infer<typeof BackupEnvSchema>;

/**
 * Load backup configuration from environment variables
 */
function loadBackupEnvConfig(): BackupEnvConfig {
  return BackupEnvSchema.parse({
    BACKUP_ENABLED: env.BACKUP_ENABLED ?? true,
    BACKUP_BASE_PATH: process.env.BACKUP_BASE_PATH,
    BACKUP_MAX_PARALLEL_JOBS: process.env.BACKUP_MAX_PARALLEL_JOBS ?
      parseInt(process.env.BACKUP_MAX_PARALLEL_JOBS, 10) : undefined,
    BACKUP_ENABLE_VERIFICATION: process.env.BACKUP_ENABLE_VERIFICATION !== 'false',
    BACKUP_ENABLE_MONITORING: process.env.BACKUP_ENABLE_MONITORING !== 'false',

    BACKUP_DEFAULT_CRON: process.env.BACKUP_DEFAULT_CRON,
    BACKUP_DEFAULT_TIMEZONE: process.env.BACKUP_DEFAULT_TIMEZONE,
    BACKUP_DEFAULT_TIMEOUT: process.env.BACKUP_DEFAULT_TIMEOUT ?
      parseInt(process.env.BACKUP_DEFAULT_TIMEOUT, 10) : undefined,
    BACKUP_DEFAULT_RETRIES: process.env.BACKUP_DEFAULT_RETRIES ?
      parseInt(process.env.BACKUP_DEFAULT_RETRIES, 10) : undefined,

    BACKUP_DAILY_RETENTION_DAYS: process.env.BACKUP_DAILY_RETENTION_DAYS ?
      parseInt(process.env.BACKUP_DAILY_RETENTION_DAYS, 10) : undefined,
    BACKUP_WEEKLY_RETENTION_WEEKS: process.env.BACKUP_WEEKLY_RETENTION_WEEKS ?
      parseInt(process.env.BACKUP_WEEKLY_RETENTION_WEEKS, 10) : undefined,
    BACKUP_MONTHLY_RETENTION_MONTHS: process.env.BACKUP_MONTHLY_RETENTION_MONTHS ?
      parseInt(process.env.BACKUP_MONTHLY_RETENTION_MONTHS, 10) : undefined,
    BACKUP_MAX_BACKUPS: process.env.BACKUP_MAX_BACKUPS ?
      parseInt(process.env.BACKUP_MAX_BACKUPS, 10) : undefined,
    BACKUP_AUTO_CLEANUP: process.env.BACKUP_AUTO_CLEANUP !== 'false',

    BACKUP_DESTINATION_TYPE: process.env.BACKUP_DESTINATION_TYPE,
    BACKUP_DESTINATION_PATH: process.env.BACKUP_DESTINATION_PATH,
    BACKUP_DESTINATION_ENCRYPTION: process.env.BACKUP_DESTINATION_ENCRYPTION === 'true',
    BACKUP_DESTINATION_ENCRYPTION_KEY: process.env.BACKUP_DESTINATION_ENCRYPTION_KEY,

    BACKUP_AWS_ACCESS_KEY_ID: process.env.BACKUP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    BACKUP_AWS_SECRET_ACCESS_KEY: process.env.BACKUP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    BACKUP_AWS_REGION: process.env.BACKUP_AWS_REGION || process.env.AWS_REGION,
    BACKUP_AWS_BUCKET: process.env.BACKUP_AWS_BUCKET,

    BACKUP_AZURE_ACCOUNT_NAME: process.env.BACKUP_AZURE_ACCOUNT_NAME,
    BACKUP_AZURE_ACCOUNT_KEY: process.env.BACKUP_AZURE_ACCOUNT_KEY,
    BACKUP_AZURE_CONTAINER: process.env.BACKUP_AZURE_CONTAINER,

    BACKUP_GCP_PROJECT_ID: process.env.BACKUP_GCP_PROJECT_ID,
    BACKUP_GCP_KEY_FILE: process.env.BACKUP_GCP_KEY_FILE,
    BACKUP_GCP_BUCKET: process.env.BACKUP_GCP_BUCKET,

    BACKUP_FTP_HOST: process.env.BACKUP_FTP_HOST,
    BACKUP_FTP_PORT: process.env.BACKUP_FTP_PORT ?
      parseInt(process.env.BACKUP_FTP_PORT, 10) : undefined,
    BACKUP_FTP_USERNAME: process.env.BACKUP_FTP_USERNAME,
    BACKUP_FTP_PASSWORD: process.env.BACKUP_FTP_PASSWORD,
    BACKUP_FTP_SECURE: process.env.BACKUP_FTP_SECURE !== 'false',

    BACKUP_SQLITE_ENABLED: process.env.BACKUP_SQLITE_ENABLED !== 'false',
    BACKUP_POSTGRES_ENABLED: process.env.BACKUP_POSTGRES_ENABLED !== 'false',
    BACKUP_REDIS_ENABLED: process.env.BACKUP_REDIS_ENABLED !== 'false',
    BACKUP_NEO4J_ENABLED: process.env.BACKUP_NEO4J_ENABLED !== 'false',
    BACKUP_VECTOR_STORES_ENABLED: process.env.BACKUP_VECTOR_STORES_ENABLED !== 'false',
    BACKUP_MONITORING_DATA_ENABLED: process.env.BACKUP_MONITORING_DATA_ENABLED !== 'false',
    BACKUP_FILE_SYSTEM_ENABLED: process.env.BACKUP_FILE_SYSTEM_ENABLED !== 'false',

    BACKUP_DEFAULT_COMPRESSION: process.env.BACKUP_DEFAULT_COMPRESSION,

    BACKUP_NOTIFY_ON_SUCCESS: process.env.BACKUP_NOTIFY_ON_SUCCESS === 'true',
    BACKUP_NOTIFY_ON_FAILURE: process.env.BACKUP_NOTIFY_ON_FAILURE !== 'false',
    BACKUP_NOTIFICATION_CHANNELS: process.env.BACKUP_NOTIFICATION_CHANNELS,

    BACKUP_VERIFICATION_TYPES: process.env.BACKUP_VERIFICATION_TYPES,
  });
}

/**
 * Create default backup destination from environment
 */
function createDefaultDestination(envConfig: BackupEnvConfig): BackupDestination {
  const destination: BackupDestination = {
    type: envConfig.BACKUP_DESTINATION_TYPE,
    path: envConfig.BACKUP_DESTINATION_PATH || envConfig.BACKUP_BASE_PATH,
    encryption: envConfig.BACKUP_DESTINATION_ENCRYPTION,
    encryptionKey: envConfig.BACKUP_DESTINATION_ENCRYPTION_KEY,
    config: {},
  };

  // Add destination-specific configuration
  switch (envConfig.BACKUP_DESTINATION_TYPE) {
    case 'aws-s3':
      destination.config = {
        accessKeyId: envConfig.BACKUP_AWS_ACCESS_KEY_ID,
        secretAccessKey: envConfig.BACKUP_AWS_SECRET_ACCESS_KEY,
        region: envConfig.BACKUP_AWS_REGION,
        bucket: envConfig.BACKUP_AWS_BUCKET || envConfig.BACKUP_DESTINATION_PATH,
      };
      break;

    case 'azure-blob':
      destination.config = {
        accountName: envConfig.BACKUP_AZURE_ACCOUNT_NAME,
        accountKey: envConfig.BACKUP_AZURE_ACCOUNT_KEY,
        container: envConfig.BACKUP_AZURE_CONTAINER || envConfig.BACKUP_DESTINATION_PATH,
      };
      break;

    case 'gcp-storage':
      destination.config = {
        projectId: envConfig.BACKUP_GCP_PROJECT_ID,
        keyFile: envConfig.BACKUP_GCP_KEY_FILE,
        bucket: envConfig.BACKUP_GCP_BUCKET || envConfig.BACKUP_DESTINATION_PATH,
      };
      break;

    case 'ftp':
    case 'sftp':
      destination.config = {
        host: envConfig.BACKUP_FTP_HOST,
        port: envConfig.BACKUP_FTP_PORT || (envConfig.BACKUP_FTP_SECURE ? 22 : 21),
        username: envConfig.BACKUP_FTP_USERNAME,
        password: envConfig.BACKUP_FTP_PASSWORD,
        secure: envConfig.BACKUP_FTP_SECURE,
      };
      break;
  }

  return destination;
}

/**
 * Create default storage configurations from environment
 */
function createDefaultStorageConfigs(envConfig: BackupEnvConfig): StorageBackupConfig[] {
  const configs: StorageBackupConfig[] = [];

  // SQLite backup config
  if (envConfig.BACKUP_SQLITE_ENABLED) {
    configs.push({
      type: 'sqlite',
      enabled: true,
      backupType: 'full',
      compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
      config: {
        vacuumBeforeBackup: true,
        includeWAL: true,
        includeShm: false,
      },
      preBackupHooks: ['PRAGMA wal_checkpoint(FULL);'],
      postBackupHooks: [],
    });
  }

  // PostgreSQL backup config
  if (envConfig.BACKUP_POSTGRES_ENABLED) {
    configs.push({
      type: 'postgres',
      enabled: true,
      backupType: 'full',
      compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
      config: {
        format: 'custom', // pg_dump custom format
        includeSchema: true,
        includeData: true,
        excludeTables: [],
      },
      preBackupHooks: [],
      postBackupHooks: [],
    });
  }

  // Redis backup config
  if (envConfig.BACKUP_REDIS_ENABLED) {
    configs.push({
      type: 'redis',
      enabled: true,
      backupType: 'full',
      compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
      config: {
        method: 'rdb', // or 'aof'
        includeConfig: true,
        flushBeforeBackup: false,
      },
      preBackupHooks: ['BGSAVE'],
      postBackupHooks: [],
    });
  }

  // Neo4j backup config
  if (envConfig.BACKUP_NEO4J_ENABLED) {
    configs.push({
      type: 'neo4j',
      enabled: true,
      backupType: 'full',
      compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
      config: {
        includeTransactionLogs: false,
        consistencyCheck: true,
      },
      preBackupHooks: [],
      postBackupHooks: [],
    });
  }

  // Vector stores backup configs
  if (envConfig.BACKUP_VECTOR_STORES_ENABLED) {
    const vectorStoreTypes = ['qdrant', 'milvus', 'chroma', 'pinecone', 'pgvector', 'faiss', 'weaviate'] as const;

    vectorStoreTypes.forEach(type => {
      configs.push({
        type,
        enabled: true,
        backupType: 'full',
        compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
        config: {
          includeIndexes: true,
          includeMetadata: true,
          collectionFilter: [], // Backup all collections
        },
        preBackupHooks: [],
        postBackupHooks: [],
      });
    });
  }

  // Monitoring data backup config
  if (envConfig.BACKUP_MONITORING_DATA_ENABLED) {
    configs.push({
      type: 'monitoring-data',
      enabled: true,
      backupType: 'incremental',
      compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
      config: {
        includeMetrics: true,
        includeLogs: true,
        includeAlerts: true,
        retentionDays: 30, // Only backup recent monitoring data
      },
      preBackupHooks: [],
      postBackupHooks: [],
    });
  }

  // File system backup config
  if (envConfig.BACKUP_FILE_SYSTEM_ENABLED) {
    configs.push({
      type: 'file-system',
      enabled: true,
      backupType: 'incremental',
      compression: envConfig.BACKUP_DEFAULT_COMPRESSION,
      config: {
        paths: [
          './config',
          './data',
          './logs',
          './.env',
        ],
        excludePatterns: [
          '*.tmp',
          '*.log',
          'node_modules/**',
          '.git/**',
          'dist/**',
          'build/**',
        ],
        followSymlinks: false,
      },
      preBackupHooks: [],
      postBackupHooks: [],
    });
  }

  return configs;
}

/**
 * Create default backup configuration from environment variables
 */
export function createDefaultBackupConfig(): BackupConfig {
  const envConfig = loadBackupEnvConfig();

  const defaultSchedule: BackupSchedule = {
    cron: envConfig.BACKUP_DEFAULT_CRON,
    timezone: envConfig.BACKUP_DEFAULT_TIMEZONE,
    enabled: true,
    timeout: envConfig.BACKUP_DEFAULT_TIMEOUT,
    retries: envConfig.BACKUP_DEFAULT_RETRIES,
  };

  const retentionPolicy: RetentionPolicy = {
    dailyRetentionDays: envConfig.BACKUP_DAILY_RETENTION_DAYS,
    weeklyRetentionWeeks: envConfig.BACKUP_WEEKLY_RETENTION_WEEKS,
    monthlyRetentionMonths: envConfig.BACKUP_MONTHLY_RETENTION_MONTHS,
    maxBackups: envConfig.BACKUP_MAX_BACKUPS,
    autoCleanup: envConfig.BACKUP_AUTO_CLEANUP,
  };

  const destination = createDefaultDestination(envConfig);
  const storageConfigs = createDefaultStorageConfigs(envConfig);

  // Parse notification channels
  const notificationChannels = envConfig.BACKUP_NOTIFICATION_CHANNELS
    ? envConfig.BACKUP_NOTIFICATION_CHANNELS.split(',').map(c => c.trim())
    : [];

  // Parse verification types
  const verificationTypes = envConfig.BACKUP_VERIFICATION_TYPES
    .split(',')
    .map(t => t.trim())
    .filter(t => ['checksum', 'integrity-check', 'restore-test', 'size-validation'].includes(t)) as any[];

  const config: BackupConfig = {
    enabled: envConfig.BACKUP_ENABLED,
    defaultSchedule,
    destinations: [destination],
    retentionPolicy,
    storageConfigs,
    global: {
      maxParallelJobs: envConfig.BACKUP_MAX_PARALLEL_JOBS,
      enableVerification: envConfig.BACKUP_ENABLE_VERIFICATION,
      verificationTypes,
      metadataFormat: 'json',
      enableMonitoring: envConfig.BACKUP_ENABLE_MONITORING,
      notifications: {
        onSuccess: envConfig.BACKUP_NOTIFY_ON_SUCCESS,
        onFailure: envConfig.BACKUP_NOTIFY_ON_FAILURE,
        channels: notificationChannels,
      },
    },
  };

  return config;
}

/**
 * Validate backup configuration
 */
export function validateBackupConfig(config: unknown): BackupConfig {
  return BackupConfigSchema.parse(config);
}

/**
 * Merge backup configurations with environment overrides
 */
export function mergeBackupConfig(baseConfig: BackupConfig, envOverrides?: Partial<BackupConfig>): BackupConfig {
  if (!envOverrides) {
    return baseConfig;
  }

  // Deep merge configuration objects
  const merged = {
    ...baseConfig,
    ...envOverrides,
    defaultSchedule: {
      ...baseConfig.defaultSchedule,
      ...envOverrides.defaultSchedule,
    },
    retentionPolicy: {
      ...baseConfig.retentionPolicy,
      ...envOverrides.retentionPolicy,
    },
    global: {
      ...baseConfig.global,
      ...envOverrides.global,
      notifications: {
        ...baseConfig.global.notifications,
        ...envOverrides.global?.notifications,
      },
    },
  };

  // Merge destinations array
  if (envOverrides.destinations) {
    merged.destinations = [...baseConfig.destinations, ...envOverrides.destinations];
  }

  // Merge storage configs array
  if (envOverrides.storageConfigs) {
    const mergedStorageConfigs = [...baseConfig.storageConfigs];

    envOverrides.storageConfigs.forEach(newConfig => {
      const existingIndex = mergedStorageConfigs.findIndex(c => c.type === newConfig.type);
      if (existingIndex >= 0) {
        mergedStorageConfigs[existingIndex] = {
          ...mergedStorageConfigs[existingIndex],
          ...newConfig,
        };
      } else {
        mergedStorageConfigs.push(newConfig);
      }
    });

    merged.storageConfigs = mergedStorageConfigs;
  }

  return validateBackupConfig(merged);
}

/**
 * Load backup configuration from file or environment
 */
export async function loadBackupConfig(configPath?: string): Promise<BackupConfig> {
  let baseConfig = createDefaultBackupConfig();

  // If config path is provided, try to load from file
  if (configPath) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      const configContent = await fs.readFile(configPath, 'utf-8');
      const ext = path.extname(configPath).toLowerCase();

      let fileConfig: unknown;
      if (ext === '.json') {
        fileConfig = JSON.parse(configContent);
      } else if (ext === '.yaml' || ext === '.yml') {
        const yaml = await import('yaml');
        fileConfig = yaml.parse(configContent);
      } else {
        throw new Error(`Unsupported config file format: ${ext}`);
      }

      baseConfig = mergeBackupConfig(baseConfig, fileConfig as Partial<BackupConfig>);
    } catch (error) {
      console.warn(`Failed to load backup config from ${configPath}:`, error);
      console.info('Using default configuration from environment variables');
    }
  }

  return baseConfig;
}

/**
 * Save backup configuration to file
 */
export async function saveBackupConfig(config: BackupConfig, configPath: string): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  // Ensure directory exists
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  const ext = path.extname(configPath).toLowerCase();
  let content: string;

  if (ext === '.json') {
    content = JSON.stringify(config, null, 2);
  } else if (ext === '.yaml' || ext === '.yml') {
    const yaml = await import('yaml');
    content = yaml.stringify(config);
  } else {
    throw new Error(`Unsupported config file format: ${ext}`);
  }

  await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * Get storage configuration by type
 */
export function getStorageConfig(config: BackupConfig, storageType: string): StorageBackupConfig | null {
  return config.storageConfigs.find(c => c.type === storageType) || null;
}

/**
 * Update storage configuration
 */
export function updateStorageConfig(
  config: BackupConfig,
  storageType: string,
  updates: Partial<StorageBackupConfig>
): BackupConfig {
  const updatedConfigs = config.storageConfigs.map(c =>
    c.type === storageType ? { ...c, ...updates } : c
  );

  return {
    ...config,
    storageConfigs: updatedConfigs,
  };
}

/**
 * Add or update destination
 */
export function updateDestination(
  config: BackupConfig,
  destination: BackupDestination,
  index?: number
): BackupConfig {
  const destinations = [...config.destinations];

  if (index !== undefined && index >= 0 && index < destinations.length) {
    destinations[index] = destination;
  } else {
    destinations.push(destination);
  }

  return {
    ...config,
    destinations,
  };
}

/**
 * Remove destination
 */
export function removeDestination(config: BackupConfig, index: number): BackupConfig {
  const destinations = config.destinations.filter((_, i) => i !== index);

  if (destinations.length === 0) {
    throw new Error('At least one backup destination is required');
  }

  return {
    ...config,
    destinations,
  };
}