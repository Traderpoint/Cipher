/**
 * Simplified Connection Pool Manager
 *
 * A minimal, working connection pool system that integrates with the existing
 * BaseConnectionPool implementation. Provides type-safe pool management
 * without the complexity of the universal pool system.
 */

import { EventEmitter } from 'events';
import { BaseConnectionPool, type PoolConfig as BasePoolConfig, type PoolStats as BasePoolStats } from '../../database/connection-pool-manager.js';
import { logger } from '../../logger/index.js';

/**
 * Enhanced pool configuration with database-specific options
 */
export interface EnhancedPoolConfig extends BasePoolConfig {
  type: 'postgres' | 'redis' | 'neo4j' | 'mongodb';
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  username?: string;
  password?: string;
  url?: string;
  ssl?: boolean;
  [key: string]: any; // Allow additional database-specific options
}

/**
 * Connection factory interface for creating database connections
 */
export interface ConnectionFactory<T = any> {
  type: string;
  createConnection(config: EnhancedPoolConfig): Promise<T>;
  validateConnection(connection: T): Promise<boolean>;
  destroyConnection(connection: T): Promise<void>;
}

/**
 * Simplified PostgreSQL connection pool
 */
export class PostgresConnectionPool extends BaseConnectionPool<any> {
  constructor(
    config: EnhancedPoolConfig,
    private factory: ConnectionFactory
  ) {
    super(config, `postgres-${config.host || 'default'}-${config.database || 'default'}`);
  }

  async createResource(): Promise<any> {
    return this.factory.createConnection(this.config as EnhancedPoolConfig);
  }

  async destroyResource(resource: any): Promise<void> {
    return this.factory.destroyConnection(resource);
  }

  async validateResource(resource: any): Promise<boolean> {
    return this.factory.validateConnection(resource);
  }
}

/**
 * Simplified Redis connection pool
 */
export class RedisConnectionPool extends BaseConnectionPool<any> {
  constructor(
    config: EnhancedPoolConfig,
    private factory: ConnectionFactory
  ) {
    super(config, `redis-${config.host || 'default'}-${config.database || 0}`);
  }

  async createResource(): Promise<any> {
    return this.factory.createConnection(this.config as EnhancedPoolConfig);
  }

  async destroyResource(resource: any): Promise<void> {
    return this.factory.destroyConnection(resource);
  }

  async validateResource(resource: any): Promise<boolean> {
    return this.factory.validateConnection(resource);
  }
}

/**
 * Simplified connection pool manager
 */
export class SimpleConnectionPoolManager extends EventEmitter {
  private static instance: SimpleConnectionPoolManager | null = null;
  private pools = new Map<string, BaseConnectionPool<any>>();
  private factories = new Map<string, ConnectionFactory>();

  private constructor() {
    super();
  }

  static getInstance(): SimpleConnectionPoolManager {
    if (!SimpleConnectionPoolManager.instance) {
      SimpleConnectionPoolManager.instance = new SimpleConnectionPoolManager();
    }
    return SimpleConnectionPoolManager.instance;
  }

  /**
   * Register a connection factory for a database type
   */
  registerFactory(factory: ConnectionFactory): void {
    this.factories.set(factory.type, factory);
    logger.info(`Registered connection factory for type: ${factory.type}`);
  }

  /**
   * Get or create a connection pool
   */
  async getPool(config: EnhancedPoolConfig): Promise<BaseConnectionPool<any>> {
    const poolKey = this.generatePoolKey(config);

    // Return existing pool if available
    const existingPool = this.pools.get(poolKey);
    if (existingPool) {
      return existingPool;
    }

    // Get factory for this database type
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(`No factory registered for database type: ${config.type}`);
    }

    // Create appropriate pool type
    let pool: BaseConnectionPool<any>;
    switch (config.type) {
      case 'postgres':
        pool = new PostgresConnectionPool(config, factory);
        break;
      case 'redis':
        pool = new RedisConnectionPool(config, factory);
        break;
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }

    // Store and return the pool
    this.pools.set(poolKey, pool);

    // Forward pool events
    pool.on('stats', (stats: BasePoolStats) => {
      this.emit('poolStats', { poolKey, stats });
    });

    logger.info(`Created connection pool: ${poolKey}`);
    return pool;
  }

  /**
   * Acquire a connection from a pool
   */
  async acquire(config: EnhancedPoolConfig): Promise<any> {
    const pool = await this.getPool(config);
    return pool.acquire();
  }

  /**
   * Release a connection back to its pool
   */
  async release(config: EnhancedPoolConfig, connection: any): Promise<void> {
    const pool = await this.getPool(config);
    return pool.release(connection);
  }

  /**
   * Get statistics for all pools
   */
  getAllStats(): Record<string, BasePoolStats> {
    const stats: Record<string, BasePoolStats> = {};
    this.pools.forEach((pool, key) => {
      stats[key] = pool.getStats();
    });
    return stats;
  }

  /**
   * Drain all pools
   */
  async drainAll(): Promise<void> {
    const drainPromises = Array.from(this.pools.values()).map(pool => pool.drain());
    await Promise.all(drainPromises);
    logger.info('Drained all connection pools');
  }

  /**
   * Generate a unique pool key
   */
  private generatePoolKey(config: EnhancedPoolConfig): string {
    const parts: string[] = [config.type];

    switch (config.type) {
      case 'postgres':
        parts.push(`${config.host || 'localhost'}:${config.port || 5432}/${config.database || 'default'}`);
        break;
      case 'redis':
        parts.push(`${config.host || 'localhost'}:${config.port || 6379}/${config.database || 0}`);
        break;
      default:
        parts.push(`${config.host || 'localhost'}:${config.port || 'default'}`);
    }

    return parts.join('-');
  }
}

/**
 * Get the singleton instance
 */
export const simplePoolManager = SimpleConnectionPoolManager.getInstance();

/**
 * Default pool configurations for different database types
 */
export const DEFAULT_POOL_CONFIGS: Record<string, Partial<EnhancedPoolConfig>> = {
  postgres: {
    min: 2,
    max: 20,
    acquireTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 10000,
    createRetryIntervalMillis: 200,
    createTimeoutMillis: 10000,
    destroyTimeoutMillis: 5000,
    maxUses: 1000,
    validateOnBorrow: true,
    validateOnReturn: false,
  },
  redis: {
    min: 1,
    max: 10,
    acquireTimeoutMillis: 5000,
    idleTimeoutMillis: 300000, // 5 minutes
    reapIntervalMillis: 30000,
    createRetryIntervalMillis: 200,
    createTimeoutMillis: 10000,
    destroyTimeoutMillis: 5000,
    maxUses: 10000,
    validateOnBorrow: true,
    validateOnReturn: false,
  },
};

/**
 * Merge user config with defaults
 */
export function createPoolConfig(userConfig: Partial<EnhancedPoolConfig>): EnhancedPoolConfig {
  if (!userConfig.type) {
    throw new Error('Database type is required in pool configuration');
  }

  const defaults = DEFAULT_POOL_CONFIGS[userConfig.type] || {};
  return {
    ...defaults,
    ...userConfig,
  } as EnhancedPoolConfig;
}