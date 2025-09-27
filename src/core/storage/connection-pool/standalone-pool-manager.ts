/**
 * Standalone Connection Pool Manager
 *
 * A self-contained, minimal connection pool system that doesn't depend on
 * external modules with TypeScript issues. This version is designed to work
 * with TypeScript strict mode without any external dependencies.
 */

import { EventEmitter } from 'events';

// Simple logger interface
interface SimpleLogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  debug(message: string, meta?: any): void;
}

// Basic console logger implementation
const simpleLogger: SimpleLogger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
  debug: (message: string, meta?: any) => console.log(`[DEBUG] ${message}`, meta || ''),
};

/**
 * Pool configuration interface
 */
export interface StandalonePoolConfig {
  min: number;
  max: number;
  acquireTimeoutMillis: number;
  idleTimeoutMillis: number;
  reapIntervalMillis: number;
  createRetryIntervalMillis: number;
  createTimeoutMillis: number;
  destroyTimeoutMillis: number;
  maxUses: number;
  validateOnBorrow: boolean;
  validateOnReturn: boolean;
}

/**
 * Pool statistics interface
 */
export interface StandalonePoolStats {
  size: number;
  available: number;
  borrowed: number;
  invalid: number;
  pending: number;
  max: number;
  min: number;
}

/**
 * Enhanced pool configuration with database-specific options
 */
export interface StandaloneEnhancedPoolConfig extends StandalonePoolConfig {
  type: 'postgres' | 'redis' | 'neo4j' | 'mongodb' | 'mock_postgres' | 'mock_redis' | 'mock_neo4j';
  host?: string;
  port?: number;
  database?: string | number;
  user?: string;
  username?: string;
  password?: string;
  url?: string;
  ssl?: boolean;
  [key: string]: any; // Allow additional database-specific options
}

/**
 * Connection factory interface
 */
export interface StandaloneConnectionFactory<T = any> {
  type: string;
  createConnection(config: StandaloneEnhancedPoolConfig): Promise<T>;
  validateConnection(connection: T): Promise<boolean>;
  destroyConnection(connection: T): Promise<void>;
}

/**
 * Base connection pool implementation
 */
export abstract class StandaloneBaseConnectionPool<T> extends EventEmitter {
  protected resources: Set<T> = new Set();
  protected available: T[] = [];
  protected pending: Promise<T>[] = [];
  protected borrowed: Set<T> = new Set();
  protected invalid: Set<T> = new Set();
  protected creating = 0;
  protected destroying = 0;
  private reapTimer?: NodeJS.Timeout;

  constructor(protected config: StandalonePoolConfig, protected poolName: string) {
    super();
    this.startReaper();
  }

  abstract createResource(): Promise<T>;
  abstract destroyResource(resource: T): Promise<void>;
  abstract validateResource(resource: T): Promise<boolean>;

  async acquire(): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Acquire timeout after ${this.config.acquireTimeoutMillis}ms`));
      }, this.config.acquireTimeoutMillis);

      this.tryAcquire()
        .then(resource => {
          clearTimeout(timeout);
          resolve(resource);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private async tryAcquire(): Promise<T> {
    // Try to get available resource
    if (this.available.length > 0) {
      const resource = this.available.shift()!;
      if (this.config.validateOnBorrow && !(await this.validateResource(resource))) {
        this.markInvalid(resource);
        return this.tryAcquire();
      }
      this.borrowed.add(resource);
      this.emitStats();
      return resource;
    }

    // Create new resource if under max
    if (this.resources.size + this.creating < this.config.max) {
      return this.createAndBorrow();
    }

    // Wait for available resource
    await new Promise(resolve => setTimeout(resolve, 10));
    return this.tryAcquire();
  }

  private async createAndBorrow(): Promise<T> {
    this.creating++;
    try {
      const resource = await this.createResource();
      this.resources.add(resource);
      this.borrowed.add(resource);
      this.creating--;
      this.emitStats();
      simpleLogger.debug(`Created new resource in pool ${this.poolName}`);
      return resource;
    } catch (error) {
      this.creating--;
      simpleLogger.error(`Failed to create resource in pool ${this.poolName}`, { error });
      throw error;
    }
  }

  async release(resource: T): Promise<void> {
    if (!this.borrowed.has(resource)) {
      simpleLogger.warn(`Attempting to release resource not borrowed from pool ${this.poolName}`);
      return;
    }

    this.borrowed.delete(resource);

    if (this.config.validateOnReturn && !(await this.validateResource(resource))) {
      this.markInvalid(resource);
      return;
    }

    this.available.push(resource);
    this.emitStats();
  }

  private markInvalid(resource: T): void {
    this.borrowed.delete(resource);
    this.available = this.available.filter(r => r !== resource);
    this.invalid.add(resource);
    this.destroyResource(resource).catch(error => {
      simpleLogger.error(`Failed to destroy invalid resource in pool ${this.poolName}`, { error });
    });
    this.resources.delete(resource);
    this.invalid.delete(resource);
  }

  private startReaper(): void {
    this.reapTimer = setInterval(() => {
      this.reapIdleResources();
    }, this.config.reapIntervalMillis);
  }

  private async reapIdleResources(): Promise<void> {
    // Keep minimum connections
    const surplus = this.available.length - this.config.min;
    if (surplus > 0) {
      const toDestroy: T[] = this.available.splice(0, surplus);

      for (const resource of toDestroy) {
        this.resources.delete(resource);
        try {
          await this.destroyResource(resource);
        } catch (error) {
          simpleLogger.error(`Failed to destroy idle resource in pool ${this.poolName}`, { error });
        }
      }

      this.emitStats();
    }
  }

  getStats(): StandalonePoolStats {
    return {
      size: this.resources.size,
      available: this.available.length,
      borrowed: this.borrowed.size,
      invalid: this.invalid.size,
      pending: this.creating,
      max: this.config.max,
      min: this.config.min,
    };
  }

  private emitStats(): void {
    const stats = this.getStats();
    this.emit('stats', stats);
  }

  async drain(): Promise<void> {
    // Stop reaper
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = undefined;
    }

    // Stop accepting new requests
    this.available.length = 0;

    // Wait for borrowed resources to be returned
    while (this.borrowed.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Destroy all resources
    const allResources = Array.from(this.resources);
    for (const resource of allResources) {
      try {
        await this.destroyResource(resource);
      } catch (error) {
        simpleLogger.error(`Failed to destroy resource during drain in pool ${this.poolName}`, { error });
      }
    }

    this.resources.clear();
    this.available.length = 0;
    this.borrowed.clear();
    this.invalid.clear();
  }
}

/**
 * PostgreSQL connection pool
 */
export class StandalonePostgresConnectionPool extends StandaloneBaseConnectionPool<any> {
  constructor(
    config: StandaloneEnhancedPoolConfig,
    private factory: StandaloneConnectionFactory
  ) {
    super(config, `postgres-${config.host || 'default'}-${config.database || 'default'}`);
  }

  async createResource(): Promise<any> {
    return this.factory.createConnection(this.config as StandaloneEnhancedPoolConfig);
  }

  async destroyResource(resource: any): Promise<void> {
    return this.factory.destroyConnection(resource);
  }

  async validateResource(resource: any): Promise<boolean> {
    return this.factory.validateConnection(resource);
  }
}

/**
 * Redis connection pool
 */
export class StandaloneRedisConnectionPool extends StandaloneBaseConnectionPool<any> {
  constructor(
    config: StandaloneEnhancedPoolConfig,
    private factory: StandaloneConnectionFactory
  ) {
    super(config, `redis-${config.host || 'default'}-${config.database || 0}`);
  }

  async createResource(): Promise<any> {
    return this.factory.createConnection(this.config as StandaloneEnhancedPoolConfig);
  }

  async destroyResource(resource: any): Promise<void> {
    return this.factory.destroyConnection(resource);
  }

  async validateResource(resource: any): Promise<boolean> {
    return this.factory.validateConnection(resource);
  }
}

/**
 * Mock connection factory for testing
 */
export class StandaloneMockFactory implements StandaloneConnectionFactory {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  async createConnection(config: StandaloneEnhancedPoolConfig): Promise<any> {
    const mockConnection = {
      type: this.type,
      config,
      connected: true,
      createdAt: Date.now(),
      query: async (sql: string) => ({ rows: [{ result: 'mock' }] }),
      ping: async () => 'PONG',
      end: async () => { mockConnection.connected = false; },
      quit: async () => { mockConnection.connected = false; },
      disconnect: () => { mockConnection.connected = false; },
    };

    simpleLogger.debug(`Created mock ${this.type} connection`, { config });
    return mockConnection;
  }

  async validateConnection(connection: any): Promise<boolean> {
    return connection && connection.connected === true;
  }

  async destroyConnection(connection: any): Promise<void> {
    if (connection) {
      connection.connected = false;
    }
    simpleLogger.debug(`Destroyed mock ${this.type} connection`);
  }
}

/**
 * Standalone connection pool manager
 */
export class StandaloneConnectionPoolManager extends EventEmitter {
  private static instance: StandaloneConnectionPoolManager | null = null;
  private pools = new Map<string, StandaloneBaseConnectionPool<any>>();
  private factories = new Map<string, StandaloneConnectionFactory>();

  private constructor() {
    super();
  }

  static getInstance(): StandaloneConnectionPoolManager {
    if (!StandaloneConnectionPoolManager.instance) {
      StandaloneConnectionPoolManager.instance = new StandaloneConnectionPoolManager();
    }
    return StandaloneConnectionPoolManager.instance;
  }

  /**
   * Register a connection factory
   */
  registerFactory(factory: StandaloneConnectionFactory): void {
    this.factories.set(factory.type, factory);
    simpleLogger.info(`Registered connection factory for type: ${factory.type}`);
  }

  /**
   * Get or create a connection pool
   */
  async getPool(config: StandaloneEnhancedPoolConfig): Promise<StandaloneBaseConnectionPool<any>> {
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
    let pool: StandaloneBaseConnectionPool<any>;
    switch (config.type) {
      case 'postgres':
      case 'mock_postgres':
        pool = new StandalonePostgresConnectionPool(config, factory);
        break;
      case 'redis':
      case 'mock_redis':
        pool = new StandaloneRedisConnectionPool(config, factory);
        break;
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }

    // Store and return the pool
    this.pools.set(poolKey, pool);

    // Forward pool events
    pool.on('stats', (stats: StandalonePoolStats) => {
      this.emit('poolStats', { poolKey, stats });
    });

    simpleLogger.info(`Created connection pool: ${poolKey}`);
    return pool;
  }

  /**
   * Acquire a connection from a pool
   */
  async acquire(config: StandaloneEnhancedPoolConfig): Promise<any> {
    const pool = await this.getPool(config);
    return pool.acquire();
  }

  /**
   * Release a connection back to its pool
   */
  async release(config: StandaloneEnhancedPoolConfig, connection: any): Promise<void> {
    const pool = await this.getPool(config);
    return pool.release(connection);
  }

  /**
   * Get statistics for all pools
   */
  getAllStats(): Record<string, StandalonePoolStats> {
    const stats: Record<string, StandalonePoolStats> = {};
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
    this.pools.clear();
    simpleLogger.info('Drained all connection pools');
  }

  /**
   * Generate a unique pool key
   */
  private generatePoolKey(config: StandaloneEnhancedPoolConfig): string {
    const parts: string[] = [config.type];

    switch (config.type) {
      case 'postgres':
      case 'mock_postgres':
        parts.push(`${config.host || 'localhost'}:${config.port || 5432}/${config.database || 'default'}`);
        break;
      case 'redis':
      case 'mock_redis':
        parts.push(`${config.host || 'localhost'}:${config.port || 6379}/${config.database || 0}`);
        break;
      default:
        parts.push(`${config.host || 'localhost'}:${config.port || 'default'}`);
    }

    return parts.join('-');
  }
}

/**
 * Default pool configurations
 */
export const STANDALONE_DEFAULT_CONFIGS: Record<string, Partial<StandaloneEnhancedPoolConfig>> = {
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
    idleTimeoutMillis: 300000,
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
export function createStandalonePoolConfig(userConfig: Partial<StandaloneEnhancedPoolConfig>): StandaloneEnhancedPoolConfig {
  if (!userConfig.type) {
    throw new Error('Database type is required in pool configuration');
  }

  const baseType = userConfig.type.replace('mock_', '') as keyof typeof STANDALONE_DEFAULT_CONFIGS;
  const defaults = STANDALONE_DEFAULT_CONFIGS[baseType] || {};

  return {
    ...defaults,
    ...userConfig,
  } as StandaloneEnhancedPoolConfig;
}

/**
 * Get the singleton instance
 */
export const standalonePoolManager = StandaloneConnectionPoolManager.getInstance();

/**
 * Initialize with mock factories for testing
 */
export function initializeStandalonePoolManager(): StandaloneConnectionPoolManager {
  const manager = standalonePoolManager;

  // Register mock factories
  manager.registerFactory(new StandaloneMockFactory('mock_postgres'));
  manager.registerFactory(new StandaloneMockFactory('mock_redis'));
  manager.registerFactory(new StandaloneMockFactory('mock_neo4j'));

  simpleLogger.info('Initialized standalone connection pool manager with mock factories');
  return manager;
}