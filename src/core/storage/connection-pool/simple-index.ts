/**
 * Simplified Connection Pool System
 *
 * A working, minimal connection pool system that integrates with the existing
 * BaseConnectionPool implementation. This replaces the complex universal pool
 * system with a simpler, more maintainable solution.
 *
 * @example
 * ```typescript
 * import { createSimpleConnectionPool, simplePoolManager } from '@/core/storage/connection-pool/simple-index';
 *
 * // Initialize the pool system
 * const poolSystem = createSimpleConnectionPool();
 *
 * // Acquire a PostgreSQL connection
 * const pgConnection = await poolSystem.acquire({
 *   type: 'postgres',
 *   host: 'localhost',
 *   database: 'myapp',
 *   user: 'postgres',
 *   password: 'secret'
 * });
 *
 * // Use the connection
 * const result = await pgConnection.query('SELECT NOW()');
 *
 * // Release the connection
 * await poolSystem.release(pgConfig, pgConnection);
 * ```
 */

import { logger } from '../../logger/index.js';
import {
  SimpleConnectionPoolManager,
  simplePoolManager,
  createPoolConfig,
  DEFAULT_POOL_CONFIGS,
  type EnhancedPoolConfig,
  type ConnectionFactory,
} from './simple-pool-manager.js';
import {
  connectionFactories,
  registerAllFactories,
  SimplePostgresFactory,
  SimpleRedisFactory,
  MockConnectionFactory,
} from './simple-factories.js';

// Re-export types and classes
export type {
  EnhancedPoolConfig,
  ConnectionFactory,
};

export {
  SimpleConnectionPoolManager,
  simplePoolManager,
  createPoolConfig,
  DEFAULT_POOL_CONFIGS,
  connectionFactories,
  SimplePostgresFactory,
  SimpleRedisFactory,
  MockConnectionFactory,
};

/**
 * Pool system interface for easy usage
 */
export interface SimplePoolSystem {
  acquire(config: Partial<EnhancedPoolConfig>): Promise<any>;
  release(config: Partial<EnhancedPoolConfig>, connection: any): Promise<void>;
  getStats(): Record<string, any>;
  drain(): Promise<void>;
}

/**
 * Create and initialize the simple connection pool system
 */
export function createSimpleConnectionPool(options?: {
  enableMockFactories?: boolean;
}): SimplePoolSystem {
  const manager = simplePoolManager;

  // Register all available factories
  registerAllFactories(manager);

  logger.info('Initialized simple connection pool system', {
    factoryCount: Object.keys(connectionFactories).length,
    enableMockFactories: options?.enableMockFactories || false,
  });

  return {
    async acquire(config: Partial<EnhancedPoolConfig>): Promise<any> {
      const fullConfig = createPoolConfig(config);
      return manager.acquire(fullConfig);
    },

    async release(config: Partial<EnhancedPoolConfig>, connection: any): Promise<void> {
      const fullConfig = createPoolConfig(config);
      return manager.release(fullConfig, connection);
    },

    getStats(): Record<string, any> {
      return manager.getAllStats();
    },

    async drain(): Promise<void> {
      return manager.drainAll();
    },
  };
}

/**
 * Default pool configurations for quick setup
 */
export const PoolPresets = {
  /**
   * Development environment presets
   */
  development: {
    postgres: {
      type: 'postgres' as const,
      host: 'localhost',
      port: 5432,
      database: 'cipher_dev',
      user: 'postgres',
      password: 'postgres',
      min: 1,
      max: 5,
    },
    redis: {
      type: 'redis' as const,
      host: 'localhost',
      port: 6379,
      database: 0,
      min: 1,
      max: 3,
    },
  },

  /**
   * Production environment presets
   */
  production: {
    postgres: {
      type: 'postgres' as const,
      min: 5,
      max: 25,
      acquireTimeoutMillis: 10000,
      idleTimeoutMillis: 300000, // 5 minutes
    },
    redis: {
      type: 'redis' as const,
      min: 2,
      max: 15,
      acquireTimeoutMillis: 5000,
      idleTimeoutMillis: 600000, // 10 minutes
    },
  },

  /**
   * Testing environment presets
   */
  testing: {
    postgres: {
      type: 'postgres' as const,
      min: 1,
      max: 3,
      acquireTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    },
    redis: {
      type: 'redis' as const,
      min: 1,
      max: 2,
      acquireTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    },
  },
} as const;

/**
 * Health check utility
 */
export async function checkSimplePoolHealth(): Promise<{
  healthy: boolean;
  pools: Array<{
    key: string;
    stats: any;
    healthy: boolean;
  }>;
  summary: {
    totalPools: number;
    healthyPools: number;
    totalConnections: number;
    activeConnections: number;
  };
}> {
  const allStats = simplePoolManager.getAllStats();
  const pools = Object.entries(allStats).map(([key, stats]) => ({
    key,
    stats,
    healthy: stats.available >= 0 && stats.invalid === 0,
  }));

  const healthyPools = pools.filter(pool => pool.healthy).length;
  const totalConnections = pools.reduce((sum, pool) => sum + pool.stats.size, 0);
  const activeConnections = pools.reduce((sum, pool) => sum + pool.stats.borrowed, 0);

  return {
    healthy: pools.length === 0 || healthyPools === pools.length,
    pools,
    summary: {
      totalPools: pools.length,
      healthyPools,
      totalConnections,
      activeConnections,
    },
  };
}

/**
 * Graceful shutdown utility
 */
export async function shutdownSimplePools(): Promise<void> {
  await simplePoolManager.drainAll();
  logger.info('Simple connection pools shut down');
}