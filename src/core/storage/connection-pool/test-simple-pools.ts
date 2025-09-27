/**
 * Test Suite for Simplified Connection Pool System
 *
 * Tests the basic functionality of the simplified pool system to ensure
 * it works correctly with TypeScript strict mode.
 */

import { logger } from '../../logger/index.js';
import {
  createSimpleConnectionPool,
  checkSimplePoolHealth,
  shutdownSimplePools,
  PoolPresets,
  type SimplePoolSystem,
} from './simple-index.js';

/**
 * Test the basic pool functionality
 */
async function testBasicPoolFunctionality(): Promise<void> {
  logger.info('Testing basic pool functionality...');

  const poolSystem = createSimpleConnectionPool({ enableMockFactories: true });

  try {
    // Test mock PostgreSQL connection
    logger.info('Testing mock PostgreSQL connection...');
    const mockPgConfig = {
      type: 'mock_postgres' as const,
      host: 'localhost',
      database: 'test_db',
      user: 'test_user',
    };

    const pgConnection = await poolSystem.acquire(mockPgConfig);
    logger.info('Acquired mock PostgreSQL connection', { connection: !!pgConnection });

    // Test using the connection
    const result = await pgConnection.query('SELECT 1');
    logger.info('Query result', { result });

    // Release the connection
    await poolSystem.release(mockPgConfig, pgConnection);
    logger.info('Released mock PostgreSQL connection');

    // Test mock Redis connection
    logger.info('Testing mock Redis connection...');
    const mockRedisConfig = {
      type: 'mock_redis' as const,
      host: 'localhost',
      database: 0,
    };

    const redisConnection = await poolSystem.acquire(mockRedisConfig);
    logger.info('Acquired mock Redis connection', { connection: !!redisConnection });

    // Test ping
    const pingResult = await redisConnection.ping();
    logger.info('Ping result', { pingResult });

    // Release the connection
    await poolSystem.release(mockRedisConfig, redisConnection);
    logger.info('Released mock Redis connection');

    logger.info('Basic pool functionality test passed');
  } catch (error) {
    logger.error('Basic pool functionality test failed', { error });
    throw error;
  }
}

/**
 * Test pool statistics and health checking
 */
async function testPoolStatistics(): Promise<void> {
  logger.info('Testing pool statistics...');

  const poolSystem = createSimpleConnectionPool({ enableMockFactories: true });

  try {
    // Acquire a few connections to generate stats
    const config = {
      type: 'mock_postgres' as const,
      host: 'localhost',
      database: 'stats_test',
    };

    const connections = [];
    for (let i = 0; i < 3; i++) {
      const conn = await poolSystem.acquire(config);
      connections.push(conn);
    }

    // Get pool stats
    const stats = poolSystem.getStats();
    logger.info('Pool statistics', { stats });

    // Check health
    const health = await checkSimplePoolHealth();
    logger.info('Pool health', { health });

    // Release connections
    for (const conn of connections) {
      await poolSystem.release(config, conn);
    }

    logger.info('Pool statistics test passed');
  } catch (error) {
    logger.error('Pool statistics test failed', { error });
    throw error;
  }
}

/**
 * Test pool configuration presets
 */
async function testPoolPresets(): Promise<void> {
  logger.info('Testing pool presets...');

  try {
    // Test development preset
    const devConfig = {
      ...PoolPresets.development.postgres,
      type: 'mock_postgres' as const,
    };

    const poolSystem = createSimpleConnectionPool();
    const connection = await poolSystem.acquire(devConfig);
    await poolSystem.release(devConfig, connection);

    logger.info('Pool presets test passed');
  } catch (error) {
    logger.error('Pool presets test failed', { error });
    throw error;
  }
}

/**
 * Test error handling
 */
async function testErrorHandling(): Promise<void> {
  logger.info('Testing error handling...');

  const poolSystem = createSimpleConnectionPool();

  try {
    // Test invalid database type
    try {
      await poolSystem.acquire({
        type: 'invalid_type' as any,
      });
      throw new Error('Should have thrown error for invalid type');
    } catch (error: any) {
      if (error.message.includes('No factory registered')) {
        logger.info('Correctly caught invalid database type error');
      } else {
        throw error;
      }
    }

    // Test missing required config
    try {
      await poolSystem.acquire({} as any);
      throw new Error('Should have thrown error for missing config');
    } catch (error: any) {
      if (error.message.includes('Database type is required')) {
        logger.info('Correctly caught missing config error');
      } else {
        throw error;
      }
    }

    logger.info('Error handling test passed');
  } catch (error) {
    logger.error('Error handling test failed', { error });
    throw error;
  }
}

/**
 * Run all tests
 */
export async function runSimplePoolTests(): Promise<void> {
  logger.info('Starting simplified connection pool tests...');

  try {
    await testBasicPoolFunctionality();
    await testPoolStatistics();
    await testPoolPresets();
    await testErrorHandling();

    logger.info('All simplified connection pool tests passed!');
  } catch (error) {
    logger.error('Simplified connection pool tests failed', { error });
    throw error;
  } finally {
    // Clean up
    try {
      await shutdownSimplePools();
    } catch (error) {
      logger.warn('Error during test cleanup', { error });
    }
  }
}

/**
 * Run tests if this file is executed directly
 */
if (require.main === module) {
  runSimplePoolTests()
    .then(() => {
      logger.info('Test execution completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Test execution failed', { error });
      process.exit(1);
    });
}