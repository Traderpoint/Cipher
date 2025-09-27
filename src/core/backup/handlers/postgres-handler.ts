/**
 * PostgreSQL Backup Handler
 *
 * Implements backup and restore operations for PostgreSQL databases.
 * Uses pg_dump and pg_restore for reliable database operations.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { Client } from 'pg';
import {
  StorageBackupConfig,
  BackupMetadata,
  RestoreOptions,
} from '../types.js';
import { BaseStorageBackupHandler } from './base-handler.js';
import { env } from '../../env.js';
import { Logger } from '../../logger/logger.js';

/**
 * PostgreSQL connection configuration
 */
interface PostgreSQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

/**
 * PostgreSQL Backup Handler Implementation
 */
export class PostgreSQLBackupHandler extends BaseStorageBackupHandler {
  private config?: PostgreSQLConfig;

  constructor(logger?: Logger) {
    super('postgres', logger);
  }

  /**
   * Check if PostgreSQL storage is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await this.getConnectionConfig();
      if (!config) {
        return false;
      }

      // Test connection
      const client = new Client(config);
      await client.connect();
      await client.query('SELECT 1');
      await client.end();

      return true;
    } catch (error) {
      this.logger.warn('PostgreSQL not available:', error);
      return false;
    }
  }

  /**
   * Get PostgreSQL storage information
   */
  async getStorageInfo(): Promise<Record<string, any>> {
    const config = await this.getConnectionConfig();
    if (!config) {
      return { error: 'PostgreSQL not configured' };
    }

    try {
      const client = new Client(config);
      await client.connect();

      // Get database information
      const [
        versionResult,
        sizeResult,
        tableCountResult,
        schemaResult,
      ] = await Promise.all([
        client.query('SELECT version()'),
        client.query('SELECT pg_database_size(current_database()) as size'),
        client.query(`
          SELECT COUNT(*) as count
          FROM information_schema.tables
          WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        `),
        client.query(`
          SELECT schema_name
          FROM information_schema.schemata
          WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
        `),
      ]);

      await client.end();

      return {
        host: config.host,
        port: config.port,
        database: config.database,
        version: versionResult.rows[0]?.version || 'unknown',
        size: parseInt(sizeResult.rows[0]?.size || '0', 10),
        tableCount: parseInt(tableCountResult.rows[0]?.count || '0', 10),
        schemas: schemaResult.rows.map(row => row.schema_name),
        ssl: config.ssl || false,
      };
    } catch (error) {
      this.logger.error('Failed to get PostgreSQL storage info:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get estimated backup size
   */
  async getEstimatedSize(): Promise<number> {
    const config = await this.getConnectionConfig();
    if (!config) {
      return 0;
    }

    try {
      const client = new Client(config);
      await client.connect();

      const result = await client.query('SELECT pg_database_size(current_database()) as size');
      await client.end();

      return parseInt(result.rows[0]?.size || '0', 10);
    } catch (error) {
      this.logger.error('Failed to estimate PostgreSQL backup size:', error);
      return 0;
    }
  }

  /**
   * Create PostgreSQL backup
   */
  protected async doCreateBackup(config: StorageBackupConfig, destination: string): Promise<string[]> {
    const connectionConfig = await this.getConnectionConfig();
    if (!connectionConfig) {
      throw new Error('PostgreSQL connection not configured');
    }

    const backupFiles: string[] = [];
    const backupConfig = config.config || {};

    try {
      // Check if pg_dump is available
      const hasPgDump = await this.isCommandAvailable('pg_dump');
      if (!hasPgDump) {
        throw new Error('pg_dump command not found. Please install PostgreSQL client tools.');
      }

      // Determine backup format
      const format = backupConfig.format || 'custom';
      const extension = this.getBackupExtension(format);
      const backupPath = path.join(destination, `postgres_backup.${extension}`);

      // Build pg_dump command
      const dumpArgs = [
        '--host', connectionConfig.host,
        '--port', connectionConfig.port.toString(),
        '--username', connectionConfig.user,
        '--dbname', connectionConfig.database,
        '--format', format,
        '--file', backupPath,
        '--verbose',
        '--no-password', // Use PGPASSWORD environment variable
      ];

      // Add additional options based on configuration
      if (backupConfig.includeSchema !== false) {
        // Schema is included by default
      }

      if (backupConfig.includeData !== false) {
        // Data is included by default
      } else {
        dumpArgs.push('--schema-only');
      }

      if (backupConfig.excludeTables && Array.isArray(backupConfig.excludeTables)) {
        for (const table of backupConfig.excludeTables) {
          dumpArgs.push('--exclude-table', table);
        }
      }

      if (backupConfig.compressLevel && format === 'custom') {
        dumpArgs.push('--compress', backupConfig.compressLevel.toString());
      }

      if (backupConfig.jobs && format === 'directory') {
        dumpArgs.push('--jobs', backupConfig.jobs.toString());
      }

      // Set environment variables for authentication
      const env = {
        ...process.env,
        PGPASSWORD: connectionConfig.password,
      };

      // Execute pg_dump
      this.logger.info('Starting PostgreSQL backup with pg_dump');
      await this.executeCommand('pg_dump', dumpArgs, {
        timeout: 3600000, // 1 hour timeout
      });

      backupFiles.push(backupPath);

      // Create schema-only backup if requested
      if (backupConfig.includeSchemaOnly) {
        const schemaPath = path.join(destination, 'postgres_schema.sql');
        const schemaArgs = [
          '--host', connectionConfig.host,
          '--port', connectionConfig.port.toString(),
          '--username', connectionConfig.user,
          '--dbname', connectionConfig.database,
          '--schema-only',
          '--file', schemaPath,
          '--no-password',
        ];

        await this.executeCommand('pg_dump', schemaArgs, { timeout: 300000 });
        backupFiles.push(schemaPath);
      }

      // Create globals backup if requested (roles, tablespaces, etc.)
      if (backupConfig.includeGlobals) {
        const hasPgDumpAll = await this.isCommandAvailable('pg_dumpall');
        if (hasPgDumpAll) {
          const globalsPath = path.join(destination, 'postgres_globals.sql');
          const globalsArgs = [
            '--host', connectionConfig.host,
            '--port', connectionConfig.port.toString(),
            '--username', connectionConfig.user,
            '--globals-only',
            '--file', globalsPath,
            '--no-password',
          ];

          await this.executeCommand('pg_dumpall', globalsArgs, { timeout: 300000 });
          backupFiles.push(globalsPath);
        }
      }

      this.logger.info(`PostgreSQL backup created with ${backupFiles.length} files`);
      return backupFiles;

    } catch (error) {
      this.logger.error('PostgreSQL backup failed:', error);
      throw error;
    }
  }

  /**
   * Restore PostgreSQL backup
   */
  protected async doRestoreBackup(
    files: string[],
    metadata: BackupMetadata,
    options: RestoreOptions
  ): Promise<boolean> {
    const connectionConfig = await this.getConnectionConfig();
    if (!connectionConfig) {
      throw new Error('PostgreSQL connection not configured');
    }

    try {
      // Find main backup file
      const backupFile = files.find(f =>
        f.includes('postgres_backup') && !f.includes('schema') && !f.includes('globals')
      );

      if (!backupFile) {
        throw new Error('No suitable PostgreSQL backup file found');
      }

      // Determine restore method based on backup format
      const format = this.detectBackupFormat(backupFile);

      if (format === 'custom' || format === 'tar') {
        // Use pg_restore for custom/tar formats
        await this.restoreWithPgRestore(backupFile, connectionConfig, options);
      } else {
        // Use psql for plain SQL format
        await this.restoreWithPsql(backupFile, connectionConfig, options);
      }

      // Restore globals if available
      const globalsFile = files.find(f => f.includes('globals'));
      if (globalsFile) {
        await this.restoreGlobals(globalsFile, connectionConfig);
      }

      this.logger.info('PostgreSQL database restored successfully');
      return true;

    } catch (error) {
      this.logger.error('PostgreSQL restore failed:', error);
      return false;
    }
  }

  // Private helper methods

  /**
   * Get PostgreSQL connection configuration
   */
  private async getConnectionConfig(): Promise<PostgreSQLConfig | null> {
    if (this.config) {
      return this.config;
    }

    // Try to get from environment configuration
    if (env.STORAGE_DATABASE_TYPE === 'postgres' || env.CIPHER_PG_URL) {
      if (env.CIPHER_PG_URL) {
        // Parse connection URL
        const url = new URL(env.CIPHER_PG_URL);
        this.config = {
          host: url.hostname,
          port: parseInt(url.port, 10) || 5432,
          database: url.pathname.slice(1), // Remove leading /
          user: url.username,
          password: url.password,
          ssl: url.searchParams.get('ssl') === 'true',
        };
      } else {
        // Use individual environment variables
        this.config = {
          host: env.STORAGE_DATABASE_HOST || 'localhost',
          port: env.STORAGE_DATABASE_PORT || 5432,
          database: env.STORAGE_DATABASE_NAME || 'cipher',
          user: env.STORAGE_DATABASE_USER || 'postgres',
          password: env.STORAGE_DATABASE_PASSWORD || '',
          ssl: env.STORAGE_DATABASE_SSL || false,
        };
      }

      return this.config;
    }

    return null;
  }

  /**
   * Get backup file extension based on format
   */
  private getBackupExtension(format: string): string {
    switch (format) {
      case 'custom':
        return 'dump';
      case 'tar':
        return 'tar';
      case 'directory':
        return 'dir';
      case 'plain':
      default:
        return 'sql';
    }
  }

  /**
   * Detect backup format from file
   */
  private detectBackupFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.dump':
        return 'custom';
      case '.tar':
        return 'tar';
      case '.sql':
        return 'plain';
      default:
        return 'custom'; // Default assumption
    }
  }

  /**
   * Restore using pg_restore
   */
  private async restoreWithPgRestore(
    backupFile: string,
    config: PostgreSQLConfig,
    options: RestoreOptions
  ): Promise<void> {
    const hasPgRestore = await this.isCommandAvailable('pg_restore');
    if (!hasPgRestore) {
      throw new Error('pg_restore command not found. Please install PostgreSQL client tools.');
    }

    // Build pg_restore command
    const restoreArgs = [
      '--host', config.host,
      '--port', config.port.toString(),
      '--username', config.user,
      '--dbname', config.database,
      '--verbose',
      '--no-password',
    ];

    if (options.overwrite) {
      restoreArgs.push('--clean', '--if-exists');
    }

    // Add parallel jobs if supported
    const format = this.detectBackupFormat(backupFile);
    if (format === 'custom' || format === 'directory') {
      restoreArgs.push('--jobs', '4'); // Use 4 parallel jobs
    }

    restoreArgs.push(backupFile);

    // Set environment variables for authentication
    const env = {
      ...process.env,
      PGPASSWORD: config.password,
    };

    // Execute pg_restore
    this.logger.info('Restoring PostgreSQL database with pg_restore');
    await this.executeCommand('pg_restore', restoreArgs, {
      timeout: 3600000, // 1 hour timeout
    });
  }

  /**
   * Restore using psql
   */
  private async restoreWithPsql(
    backupFile: string,
    config: PostgreSQLConfig,
    options: RestoreOptions
  ): Promise<void> {
    const hasPsql = await this.isCommandAvailable('psql');
    if (!hasPsql) {
      throw new Error('psql command not found. Please install PostgreSQL client tools.');
    }

    // If overwrite is requested, drop and recreate database
    if (options.overwrite) {
      await this.recreateDatabase(config);
    }

    // Build psql command
    const psqlArgs = [
      '--host', config.host,
      '--port', config.port.toString(),
      '--username', config.user,
      '--dbname', config.database,
      '--file', backupFile,
      '--no-password',
    ];

    // Set environment variables for authentication
    const env = {
      ...process.env,
      PGPASSWORD: config.password,
    };

    // Execute psql
    this.logger.info('Restoring PostgreSQL database with psql');
    await this.executeCommand('psql', psqlArgs, {
      timeout: 3600000, // 1 hour timeout
    });
  }

  /**
   * Restore global objects (roles, tablespaces, etc.)
   */
  private async restoreGlobals(globalsFile: string, config: PostgreSQLConfig): Promise<void> {
    const hasPsql = await this.isCommandAvailable('psql');
    if (!hasPsql) {
      this.logger.warn('psql not available, skipping globals restore');
      return;
    }

    // Connect to postgres database for globals
    const globalsConfig = { ...config, database: 'postgres' };

    const psqlArgs = [
      '--host', globalsConfig.host,
      '--port', globalsConfig.port.toString(),
      '--username', globalsConfig.user,
      '--dbname', globalsConfig.database,
      '--file', globalsFile,
      '--no-password',
    ];

    // Set environment variables for authentication
    const env = {
      ...process.env,
      PGPASSWORD: globalsConfig.password,
    };

    this.logger.info('Restoring PostgreSQL globals');
    await this.executeCommand('psql', psqlArgs, { timeout: 300000 });
  }

  /**
   * Recreate database for clean restore
   */
  private async recreateDatabase(config: PostgreSQLConfig): Promise<void> {
    // Connect to postgres database to drop/create target database
    const adminConfig = { ...config, database: 'postgres' };
    const client = new Client(adminConfig);

    try {
      await client.connect();

      // Terminate existing connections to target database
      await client.query(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
      `, [config.database]);

      // Drop database if exists
      await client.query(`DROP DATABASE IF EXISTS "${config.database}"`);

      // Create database
      await client.query(`CREATE DATABASE "${config.database}"`);

      this.logger.info(`Database ${config.database} recreated for restore`);

    } finally {
      await client.end();
    }
  }

  /**
   * Verify database connection and basic functionality
   */
  private async verifyDatabaseConnection(config: PostgreSQLConfig): Promise<boolean> {
    try {
      const client = new Client(config);
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return true;
    } catch (error) {
      this.logger.error('Database connection verification failed:', error);
      return false;
    }
  }

  /**
   * Override integrity verification for PostgreSQL
   */
  protected override async verifyIntegrity(metadata: BackupMetadata): Promise<boolean> {
    // First run base verification
    const baseVerification = await super.verifyIntegrity(metadata);
    if (!baseVerification) {
      return false;
    }

    // Additional PostgreSQL-specific verification
    const config = await this.getConnectionConfig();
    if (!config) {
      return false;
    }

    return this.verifyDatabaseConnection(config);
  }
}