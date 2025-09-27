/**
 * Simplified Connection Factories
 *
 * Minimal implementations of connection factories for different database types.
 * These factories integrate with the simplified pool manager.
 */

import { logger } from '../../logger/index.js';
import type { ConnectionFactory, EnhancedPoolConfig } from './simple-pool-manager.js';

/**
 * PostgreSQL Connection Factory
 */
export class SimplePostgresFactory implements ConnectionFactory {
  readonly type = 'postgres';

  async createConnection(config: EnhancedPoolConfig): Promise<any> {
    try {
      // Try to import pg (PostgreSQL client)
      const { Pool } = await import('pg');

      const pgConfig = {
        host: config.host || 'localhost',
        port: config.port || 5432,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
        connectionString: config.url,
        connectionTimeoutMillis: config.createTimeoutMillis || 10000,
        query_timeout: 30000,
        statement_timeout: 30000,
      };

      // Remove undefined values
      Object.keys(pgConfig).forEach(key => {
        if (pgConfig[key as keyof typeof pgConfig] === undefined) {
          delete pgConfig[key as keyof typeof pgConfig];
        }
      });

      // Create a single client connection (not a pool)
      const { Client } = await import('pg');
      const client = new Client(pgConfig);
      await client.connect();

      logger.debug('Created PostgreSQL connection', { host: config.host, database: config.database });
      return client;
    } catch (error) {
      logger.error('Failed to create PostgreSQL connection', { error, config });
      throw error;
    }
  }

  async validateConnection(connection: any): Promise<boolean> {
    try {
      const result = await connection.query('SELECT 1');
      return result.rows && result.rows.length > 0;
    } catch (error) {
      logger.warn('PostgreSQL connection validation failed', { error });
      return false;
    }
  }

  async destroyConnection(connection: any): Promise<void> {
    try {
      await connection.end();
      logger.debug('Destroyed PostgreSQL connection');
    } catch (error) {
      logger.error('Error destroying PostgreSQL connection', { error });
      throw error;
    }
  }
}

/**
 * Redis Connection Factory
 */
export class SimpleRedisFactory implements ConnectionFactory {
  readonly type = 'redis';

  async createConnection(config: EnhancedPoolConfig): Promise<any> {
    try {
      // Try to import Redis client
      const { Redis } = await import('ioredis');

      const redisConfig: any = {
        host: config.host || 'localhost',
        port: config.port || 6379,
        password: config.password,
        username: config.username,
        db: typeof config.database === 'number' ? config.database : (config.database ? parseInt(config.database.toString(), 10) : 0),
        family: 4, // Force IPv4
        connectTimeout: config.createTimeoutMillis || 10000,
        commandTimeout: 5000,
        retryDelayOnFailover: 100,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      };

      // Handle connection URL if provided
      if (config.url) {
        const redis = new Redis(config.url);
        await redis.ping(); // Test connection
        logger.debug('Created Redis connection from URL', { url: config.url });
        return redis;
      }

      const redis = new Redis(redisConfig);
      await redis.ping(); // Test connection

      logger.debug('Created Redis connection', { host: config.host, database: config.database });
      return redis;
    } catch (error) {
      logger.error('Failed to create Redis connection', { error, config });
      throw error;
    }
  }

  async validateConnection(connection: any): Promise<boolean> {
    try {
      const result = await connection.ping();
      return result === 'PONG';
    } catch (error) {
      logger.warn('Redis connection validation failed', { error });
      return false;
    }
  }

  async destroyConnection(connection: any): Promise<void> {
    try {
      if (connection.status !== 'end') {
        await connection.quit();
      }
      logger.debug('Destroyed Redis connection');
    } catch (error) {
      logger.error('Error destroying Redis connection', { error });
      // Force disconnect if quit fails
      connection.disconnect();
      throw error;
    }
  }
}

/**
 * Mock Factory for testing and development
 */
export class MockConnectionFactory implements ConnectionFactory {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  async createConnection(config: EnhancedPoolConfig): Promise<any> {
    // Create a mock connection object
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

    logger.debug(`Created mock ${this.type} connection`, { config });
    return mockConnection;
  }

  async validateConnection(connection: any): Promise<boolean> {
    return connection && connection.connected === true;
  }

  async destroyConnection(connection: any): Promise<void> {
    if (connection) {
      connection.connected = false;
    }
    logger.debug(`Destroyed mock ${this.type} connection`);
  }
}

/**
 * Factory registry for easy access
 */
export const connectionFactories = {
  postgres: new SimplePostgresFactory(),
  redis: new SimpleRedisFactory(),

  // Mock factories for testing
  mock_postgres: new MockConnectionFactory('postgres'),
  mock_redis: new MockConnectionFactory('redis'),
  mock_neo4j: new MockConnectionFactory('neo4j'),
};

/**
 * Register all factories with the pool manager
 */
export function registerAllFactories(poolManager: any): void {
  Object.values(connectionFactories).forEach(factory => {
    poolManager.registerFactory(factory);
  });

  logger.info('Registered all connection factories');
}