/**
 * Test for Standalone Connection Pool System
 *
 * Simple test to verify the standalone system works correctly.
 */

import {
  initializeStandalonePoolManager,
  createStandalonePoolConfig,
  type StandaloneEnhancedPoolConfig,
} from './standalone-pool-manager.js';

/**
 * Run basic tests for the standalone pool system
 */
async function runStandaloneTests(): Promise<void> {
  console.log('🧪 Starting standalone connection pool tests...');

  const manager = initializeStandalonePoolManager();

  try {
    // Test 1: Basic PostgreSQL mock connection
    console.log('📋 Test 1: Mock PostgreSQL connection');
    const pgConfig = createStandalonePoolConfig({
      type: 'mock_postgres',
      host: 'localhost',
      database: 'test_db',
      user: 'test_user',
      min: 1,
      max: 3,
    });

    const pgConnection = await manager.acquire(pgConfig);
    console.log('✅ Acquired PostgreSQL connection');

    const queryResult = await pgConnection.query('SELECT NOW()');
    console.log('✅ Query executed:', queryResult);

    await manager.release(pgConfig, pgConnection);
    console.log('✅ Released PostgreSQL connection');

    // Test 2: Basic Redis mock connection
    console.log('📋 Test 2: Mock Redis connection');
    const redisConfig = createStandalonePoolConfig({
      type: 'mock_redis',
      host: 'localhost',
      database: 0,
      min: 1,
      max: 2,
    });

    const redisConnection = await manager.acquire(redisConfig);
    console.log('✅ Acquired Redis connection');

    const pingResult = await redisConnection.ping();
    console.log('✅ Ping executed:', pingResult);

    await manager.release(redisConfig, redisConnection);
    console.log('✅ Released Redis connection');

    // Test 3: Pool statistics
    console.log('📋 Test 3: Pool statistics');
    const stats = manager.getAllStats();
    console.log('✅ Pool statistics:', JSON.stringify(stats, null, 2));

    // Test 4: Multiple connections
    console.log('📋 Test 4: Multiple connections');
    const connections = [];
    for (let i = 0; i < 2; i++) {
      const conn = await manager.acquire(pgConfig);
      connections.push(conn);
    }
    console.log(`✅ Acquired ${connections.length} connections`);

    for (const conn of connections) {
      await manager.release(pgConfig, conn);
    }
    console.log('✅ Released all connections');

    // Test 5: Error handling
    console.log('📋 Test 5: Error handling');
    try {
      await manager.acquire(createStandalonePoolConfig({
        type: 'invalid_type' as any,
      }));
      throw new Error('Should have thrown an error');
    } catch (error: any) {
      if (error.message.includes('No factory registered')) {
        console.log('✅ Correctly caught invalid type error');
      } else {
        throw error;
      }
    }

    console.log('🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    // Cleanup
    await manager.drainAll();
    console.log('🧹 Cleaned up pools');
  }
}

// Export for use in other modules
export { runStandaloneTests };

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStandaloneTests()
    .then(() => {
      console.log('✨ Test execution completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test execution failed:', error);
      process.exit(1);
    });
}