/**
 * Redis Backup Handler
 *
 * Implements backup and restore operations for Redis databases.
 * Supports both RDB and AOF backup methods.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { Redis } from 'ioredis';
type RedisType = Redis;
import {
  StorageBackupConfig,
  BackupMetadata,
  RestoreOptions,
} from '../types.js';
import { BaseStorageBackupHandler } from './base-handler.js';
import { env } from '../../env.js';
import { Logger } from '../../logger/logger.js';

/**
 * Redis connection configuration
 */
interface RedisConfig {
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  database?: number;
  url?: string;
}

/**
 * Redis Backup Handler Implementation
 */
export class RedisBackupHandler extends BaseStorageBackupHandler {
  private config?: RedisConfig;
  private client?: RedisType;

  constructor(logger?: Logger) {
    super('redis', logger);
  }

  /**
   * Check if Redis storage is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const config = await this.getConnectionConfig();
      if (!config) {
        return false;
      }

      const client = await this.getClient();
      await client.ping();

      return true;
    } catch (error) {
      this.logger.warn('Redis not available:', error);
      return false;
    }
  }

  /**
   * Get Redis storage information
   */
  async getStorageInfo(): Promise<Record<string, any>> {
    const config = await this.getConnectionConfig();
    if (!config) {
      return { error: 'Redis not configured' };
    }

    try {
      const client = await this.getClient();

      // Get Redis info
      const info = await client.info();
      const configInfo = await client.config('GET', '*');
      const dbSize = await client.dbsize();
      const memory = await client.memory('usage');

      // Parse info string
      const infoLines = info.split('\r\n');
      const parsedInfo: Record<string, any> = {};

      for (const line of infoLines) {
        if (line && !line.startsWith('#')) {
          const [key, value] = line.split(':');
          if (key && value) {
            parsedInfo[key] = isNaN(Number(value)) ? value : Number(value);
          }
        }
      }

      // Parse config
      const parsedConfig: Record<string, any> = {};
      for (let i = 0; i < configInfo.length; i += 2) {
        parsedConfig[configInfo[i]] = configInfo[i + 1];
      }

      return {
        host: config.host,
        port: config.port,
        database: config.database || 0,
        version: parsedInfo.redis_version,
        uptime: parsedInfo.uptime_in_seconds,
        connected_clients: parsedInfo.connected_clients,
        used_memory: parsedInfo.used_memory,
        used_memory_human: parsedInfo.used_memory_human,
        db_size: dbSize,
        total_keys: dbSize,
        rdb_last_save_time: parsedInfo.rdb_last_save_time,
        aof_enabled: parsedConfig.appendonly === 'yes',
        maxmemory: parsedConfig.maxmemory,
        persistence_mode: parsedConfig.appendonly === 'yes' ? 'AOF' : 'RDB',
        data_dir: parsedConfig.dir,
        rdb_filename: parsedConfig.dbfilename,
        aof_filename: parsedConfig.appendfilename,
      };
    } catch (error) {
      this.logger.error('Failed to get Redis storage info:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get estimated backup size
   */
  async getEstimatedSize(): Promise<number> {
    try {
      const client = await this.getClient();
      const info = await client.info('memory');

      // Parse memory info
      const infoLines = info.split('\r\n');
      let usedMemory = 0;

      for (const line of infoLines) {
        if (line.startsWith('used_memory:')) {
          usedMemory = parseInt(line.split(':')[1], 10);
          break;
        }
      }

      // Estimate compressed size (Redis RDB is already compressed)
      return Math.ceil(usedMemory * 0.3); // Rough estimate of RDB compression
    } catch (error) {
      this.logger.error('Failed to estimate Redis backup size:', error);
      return 0;
    }
  }

  /**
   * Create Redis backup
   */
  protected async doCreateBackup(config: StorageBackupConfig, destination: string): Promise<string[]> {
    const connectionConfig = await this.getConnectionConfig();
    if (!connectionConfig) {
      throw new Error('Redis connection not configured');
    }

    const backupFiles: string[] = [];
    const backupConfig = config.config || {};
    const method = backupConfig.method || 'rdb';

    try {
      const client = await this.getClient();

      if (method === 'rdb' || method === 'both') {
        const rdbFiles = await this.createRDBBackup(client, destination, backupConfig);
        backupFiles.push(...rdbFiles);
      }

      if (method === 'aof' || method === 'both') {
        const aofFiles = await this.createAOFBackup(client, destination, backupConfig);
        backupFiles.push(...aofFiles);
      }

      if (method === 'memory-dump') {
        const memoryFiles = await this.createMemoryDump(client, destination, backupConfig);
        backupFiles.push(...memoryFiles);
      }

      // Create configuration backup if requested
      if (backupConfig.includeConfig) {
        const configFile = await this.createConfigBackup(client, destination);
        backupFiles.push(configFile);
      }

      // Create key-value dump if requested
      if (backupConfig.includeKeyDump) {
        const keyDumpFile = await this.createKeyDump(client, destination, backupConfig);
        backupFiles.push(keyDumpFile);
      }

      this.logger.info(`Redis backup created with ${backupFiles.length} files using method: ${method}`);
      return backupFiles;

    } catch (error) {
      this.logger.error('Redis backup failed:', error);
      throw error;
    }
  }

  /**
   * Restore Redis backup
   */
  protected async doRestoreBackup(
    files: string[],
    metadata: BackupMetadata,
    options: RestoreOptions
  ): Promise<boolean> {
    const connectionConfig = await this.getConnectionConfig();
    if (!connectionConfig) {
      throw new Error('Redis connection not configured');
    }

    try {
      const client = await this.getClient();

      // Clear database if overwrite is requested
      if (options.overwrite) {
        await client.flushdb();
        this.logger.info('Redis database cleared for restore');
      }

      // Determine restore method based on available files
      const rdbFile = files.find(f => f.endsWith('.rdb'));
      const aofFile = files.find(f => f.endsWith('.aof'));
      const keyDumpFile = files.find(f => f.includes('key_dump'));

      if (rdbFile) {
        await this.restoreFromRDB(rdbFile, client, options);
      } else if (aofFile) {
        await this.restoreFromAOF(aofFile, client, options);
      } else if (keyDumpFile) {
        await this.restoreFromKeyDump(keyDumpFile, client, options);
      } else {
        throw new Error('No suitable Redis backup file found');
      }

      this.logger.info('Redis database restored successfully');
      return true;

    } catch (error) {
      this.logger.error('Redis restore failed:', error);
      return false;
    }
  }

  /**
   * Cleanup Redis client connection
   */
  async cleanup(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = undefined;
    }
  }

  // Private helper methods

  /**
   * Get Redis connection configuration
   */
  private async getConnectionConfig(): Promise<RedisConfig | null> {
    if (this.config) {
      return this.config;
    }

    // Try to get from environment configuration
    if (env.STORAGE_CACHE_TYPE === 'redis') {
      if (env.STORAGE_CACHE_HOST) {
        this.config = {
          host: env.STORAGE_CACHE_HOST,
          port: env.STORAGE_CACHE_PORT || 6379,
          password: env.STORAGE_CACHE_PASSWORD,
          username: env.STORAGE_CACHE_USERNAME,
          database: env.STORAGE_CACHE_DATABASE || 0,
        };
      }
    }

    // Try vector store Redis config
    if (!this.config && env.VECTOR_STORE_TYPE === 'redis') {
      if (env.VECTOR_STORE_URL) {
        this.config = { url: env.VECTOR_STORE_URL };
      } else if (env.VECTOR_STORE_HOST) {
        this.config = {
          host: env.VECTOR_STORE_HOST,
          port: env.VECTOR_STORE_PORT || 6379,
          password: env.VECTOR_STORE_PASSWORD,
          username: env.VECTOR_STORE_USERNAME,
        };
      }
    }

    return this.config || null;
  }

  /**
   * Get Redis client instance
   */
  private async getClient(): Promise<RedisType> {
    if (this.client) {
      return this.client;
    }

    const config = await this.getConnectionConfig();
    if (!config) {
      throw new Error('Redis configuration not available');
    }

    if (config.url) {
      this.client = new Redis(config.url);
    } else {
      this.client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        username: config.username,
        db: config.database,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
      });
    }

    return this.client;
  }

  /**
   * Create RDB backup
   */
  private async createRDBBackup(
    client: RedisType,
    destination: string,
    backupConfig: any
  ): Promise<string[]> {
    const backupFiles: string[] = [];

    try {
      // Trigger background save if configured
      if (backupConfig.flushBeforeBackup) {
        await client.bgsave();
        this.logger.info('Background save triggered');

        // Wait for save to complete
        let saveInProgress = true;
        while (saveInProgress) {
          const lastSave = await client.info('persistence');
          if (lastSave.includes('rdb_bgsave_in_progress:0')) {
            saveInProgress = false;
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Get Redis configuration to find RDB file location
      const configInfo = await client.config('GET', 'dir');
      const dbFilename = await client.config('GET', 'dbfilename');

      const redisDataDir = (configInfo as string[])[1];
      const rdbFilename = (dbFilename as string[])[1];
      const rdbPath = path.join(redisDataDir, rdbFilename);

      // Copy RDB file to backup destination
      const backupRdbPath = path.join(destination, 'redis.rdb');
      await fs.copyFile(rdbPath, backupRdbPath);
      backupFiles.push(backupRdbPath);

      this.logger.info(`RDB backup created: ${backupRdbPath}`);

    } catch (error) {
      // Fallback: create in-memory dump
      this.logger.warn('RDB file copy failed, using memory dump fallback:', error);
      const memoryDumpFile = await this.createMemoryDump(client, destination, backupConfig);
      backupFiles.push(...memoryDumpFile);
    }

    return backupFiles;
  }

  /**
   * Create AOF backup
   */
  private async createAOFBackup(
    client: RedisType,
    destination: string,
    backupConfig: any
  ): Promise<string[]> {
    const backupFiles: string[] = [];

    try {
      // Check if AOF is enabled
      const aofConfig = await client.config('GET', 'appendonly');
      if ((aofConfig as string[])[1] !== 'yes') {
        throw new Error('AOF is not enabled on Redis server');
      }

      // Get AOF file location
      const configInfo = await client.config('GET', 'dir');
      const aofFilename = await client.config('GET', 'appendfilename');

      const redisDataDir = (configInfo as string[])[1];
      const aofFile = (aofFilename as string[])[1];
      const aofPath = path.join(redisDataDir, aofFile);

      // Copy AOF file to backup destination
      const backupAofPath = path.join(destination, 'redis.aof');
      await fs.copyFile(aofPath, backupAofPath);
      backupFiles.push(backupAofPath);

      this.logger.info(`AOF backup created: ${backupAofPath}`);

    } catch (error) {
      this.logger.error('AOF backup failed:', error);
      throw error;
    }

    return backupFiles;
  }

  /**
   * Create memory dump backup
   */
  private async createMemoryDump(
    client: RedisType,
    destination: string,
    backupConfig: any
  ): Promise<string[]> {
    const backupFiles: string[] = [];

    try {
      // Get all keys
      const keys = await client.keys('*');
      const dumpData: Record<string, any> = {};

      // Batch process keys to avoid blocking Redis
      const batchSize = backupConfig.batchSize || 1000;

      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const pipeline = client.pipeline();

        // Get type and value for each key in batch
        for (const key of batch) {
          pipeline.type(key);
          pipeline.ttl(key);
        }

        const results = await pipeline.exec();

        // Process results and get values
        for (let j = 0; j < batch.length; j++) {
          const key = batch[j];
          const typeResult = results![j * 2];
          const ttlResult = results![j * 2 + 1];

          if (typeResult![1] && ttlResult![1] !== undefined) {
            const type = typeResult![1] as string;
            const ttl = ttlResult![1] as number;

            let value;
            switch (type) {
              case 'string':
                value = await client.get(key);
                break;
              case 'hash':
                value = await client.hgetall(key);
                break;
              case 'list':
                value = await client.lrange(key, 0, -1);
                break;
              case 'set':
                value = await client.smembers(key);
                break;
              case 'zset':
                value = await client.zrange(key, 0, -1, 'WITHSCORES');
                break;
              default:
                continue; // Skip unknown types
            }

            dumpData[key] = {
              type,
              value,
              ttl: ttl > 0 ? ttl : null,
            };
          }
        }

        // Progress logging
        if (i + batchSize < keys.length) {
          this.logger.debug(`Processed ${i + batchSize}/${keys.length} keys`);
        }
      }

      // Save dump to file
      const dumpPath = path.join(destination, 'redis_memory_dump.json');
      await fs.writeFile(dumpPath, JSON.stringify(dumpData, null, 2));
      backupFiles.push(dumpPath);

      this.logger.info(`Memory dump created with ${Object.keys(dumpData).length} keys: ${dumpPath}`);

    } catch (error) {
      this.logger.error('Memory dump backup failed:', error);
      throw error;
    }

    return backupFiles;
  }

  /**
   * Create configuration backup
   */
  private async createConfigBackup(client: RedisType, destination: string): Promise<string> {
    const config = await client.config('GET', '*');
    const configObj: Record<string, string> = {};

    for (let i = 0; i < config.length; i += 2) {
      configObj[config[i]] = config[i + 1];
    }

    const configPath = path.join(destination, 'redis_config.json');
    await fs.writeFile(configPath, JSON.stringify(configObj, null, 2));

    return configPath;
  }

  /**
   * Create key dump backup
   */
  private async createKeyDump(
    client: RedisType,
    destination: string,
    backupConfig: any
  ): Promise<string> {
    const keys = await client.keys('*');
    const keyInfo: Array<{
      key: string;
      type: string;
      ttl: number;
      size?: number;
    }> = [];

    const batchSize = backupConfig.batchSize || 1000;

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const pipeline = client.pipeline();

      for (const key of batch) {
        pipeline.type(key);
        pipeline.ttl(key);
        pipeline.memory('usage', key);
      }

      const results = await pipeline.exec();

      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const type = results![j * 3][1] as string;
        const ttl = results![j * 3 + 1][1] as number;
        const size = results![j * 3 + 2][1] as number;

        keyInfo.push({
          key,
          type,
          ttl,
          size,
        });
      }
    }

    const keyDumpPath = path.join(destination, 'redis_key_dump.json');
    await fs.writeFile(keyDumpPath, JSON.stringify(keyInfo, null, 2));

    return keyDumpPath;
  }

  /**
   * Restore from RDB file
   */
  private async restoreFromRDB(
    rdbFile: string,
    client: RedisType,
    options: RestoreOptions
  ): Promise<void> {
    // RDB restore typically requires Redis server restart
    // This is a simplified implementation that uses redis-cli if available
    const hasRedisCli = await this.isCommandAvailable('redis-cli');

    if (hasRedisCli) {
      const config = await this.getConnectionConfig();
      if (!config) {
        throw new Error('Redis configuration not available for restore');
      }
      const args = [
        '-h', config.host || 'localhost',
        '-p', (config.port || 6379).toString(),
        '--rdb', rdbFile,
      ];

      if (config.password) {
        args.push('-a', config.password);
      }

      await this.executeCommand('redis-cli', args, { timeout: 1800000 });
    } else {
      throw new Error('RDB restore requires redis-cli tool or server restart');
    }
  }

  /**
   * Restore from AOF file
   */
  private async restoreFromAOF(
    aofFile: string,
    client: RedisType,
    options: RestoreOptions
  ): Promise<void> {
    // Read AOF file and replay commands
    const aofContent = await fs.readFile(aofFile, 'utf-8');
    const commands = this.parseAOFCommands(aofContent);

    // Execute commands in batches
    const batchSize = 1000;
    for (let i = 0; i < commands.length; i += batchSize) {
      const batch = commands.slice(i, i + batchSize);
      const pipeline = client.pipeline();

      for (const command of batch) {
        pipeline.call(...command);
      }

      await pipeline.exec();
    }
  }

  /**
   * Restore from key dump
   */
  private async restoreFromKeyDump(
    keyDumpFile: string,
    client: RedisType,
    options: RestoreOptions
  ): Promise<void> {
    const dumpContent = await fs.readFile(keyDumpFile, 'utf-8');
    const dumpData = JSON.parse(dumpContent);

    const pipeline = client.pipeline();
    let commandCount = 0;

    for (const [key, data] of Object.entries(dumpData)) {
      const { type, value, ttl } = data as any;

      switch (type) {
        case 'string':
          pipeline.set(key, value);
          break;
        case 'hash':
          pipeline.hset(key, value);
          break;
        case 'list':
          pipeline.lpush(key, ...value);
          break;
        case 'set':
          pipeline.sadd(key, ...value);
          break;
        case 'zset':
          const zsetArgs = [];
          for (let i = 0; i < value.length; i += 2) {
            zsetArgs.push(value[i + 1], value[i]); // score, member
          }
          pipeline.zadd(key, ...zsetArgs);
          break;
      }

      if (ttl && ttl > 0) {
        pipeline.expire(key, ttl);
      }

      commandCount++;

      // Execute in batches
      if (commandCount >= 1000) {
        await pipeline.exec();
        pipeline.clear();
        commandCount = 0;
      }
    }

    // Execute remaining commands
    if (commandCount > 0) {
      await pipeline.exec();
    }
  }

  /**
   * Parse AOF commands
   */
  private parseAOFCommands(aofContent: string): string[][] {
    const lines = aofContent.split('\n');
    const commands: string[][] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (line.startsWith('*')) {
        // Array length indicator
        const argCount = parseInt(line.substring(1), 10);
        const command: string[] = [];

        i++; // Move to first argument

        for (let j = 0; j < argCount; j++) {
          if (i < lines.length && lines[i].startsWith('$')) {
            i++; // Skip length indicator
            if (i < lines.length) {
              command.push(lines[i]);
              i++;
            }
          }
        }

        if (command.length > 0) {
          commands.push(command);
        }
      } else {
        i++;
      }
    }

    return commands;
  }
}