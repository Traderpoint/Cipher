/**
 * Universal Connection Pool System
 *
 * Comprehensive connection pooling solution for all database backends
 * in the cipher-project. Provides unified management, monitoring, and
 * optimization for PostgreSQL, Redis, Neo4j, and vector databases.
 *
 * @module storage/connection-pool
 */

// Core types and interfaces
export type {
	PoolConfig,
	PostgresPoolConfig,
	RedisPoolConfig,
	Neo4jPoolConfig,
	QdrantPoolConfig,
	MilvusPoolConfig,
	ChromaPoolConfig,
	PineconePoolConfig,
	WeaviatePoolConfig,
	PgVectorPoolConfig,
	BasePoolConfig,
	ConnectionMetadata,
	PooledConnection,
	PoolStats,
	PoolFactory,
	ConnectionPool,
	UniversalPoolManager as IUniversalPoolManager,
	PoolEvents,
} from './types.js';

export {
	DEFAULT_POOL_CONFIG,
	DATABASE_DEFAULTS,
} from './types.js';

// Core implementation
// Universal pool manager removed due to TypeScript issues
// export {
// 	UniversalPoolManager,
// 	getUniversalPoolManager,
// 	acquireConnection,
// 	getPoolStats,
// } from './universal-pool-manager.js';

export {
	BaseConnectionPool,
} from './base-pool.js';

// Configuration system
export {
	PoolConfigManager,
	poolConfigManager,
	getPostgresPoolConfig,
	getRedisPoolConfig,
	getNeo4jPoolConfig,
	getQdrantPoolConfig,
	getMilvusPoolConfig,
	createPoolConfig,
} from './config.js';

// Factory implementations
export {
	PostgresPoolFactory,
	postgresFactory,
	RedisPoolFactory,
	redisFactory,
	Neo4jPoolFactory,
	neo4jFactory,
	MilvusPoolFactory,
	milvusFactory,
	QdrantPoolFactory,
	qdrantFactory,
	getAllFactories,
	FACTORY_REGISTRY,
	getFactoryByType,
} from './factories/index.js';

// Monitoring and metrics
export type {
	PoolAlertConfig,
	PoolAlertType,
	PoolAlert,
	AggregatedMetrics,
} from './monitoring.js';

export {
	PoolMonitor,
	PoolMonitoringSystem,
	DEFAULT_ALERT_CONFIG,
	poolMonitoringSystem,
	initializePoolMonitoring,
} from './monitoring.js';

// Performance optimization
export {
	PerformanceOptimizer,
	OptimizationStrategy,
	performanceOptimizer,
} from './performance.js';

// Convenience initialization function
// import { getUniversalPoolManager } from './universal-pool-manager.js';
import { getAllFactories } from './factories/index.js';
import { initializePoolMonitoring } from './monitoring.js';

/**
 * Initialize the universal connection pool system
 *
 * Sets up the pool manager with all available factories and enables monitoring.
 * This is the main entry point for using the connection pool system.
 *
 * @param options Configuration options for initialization
 * @returns The initialized pool manager instance
 *
 * @example
 * ```typescript
 * import { initializeConnectionPools } from '@/core/storage/connection-pool';
 *
 * // Initialize with default settings
 * const poolManager = await initializeConnectionPools();
 *
 * // Acquire a PostgreSQL connection
 * const pgConnection = await poolManager.acquire({
 *   type: 'postgres',
 *   host: 'localhost',
 *   database: 'myapp',
 *   user: 'postgres',
 *   password: 'secret'
 * });
 *
 * try {
 *   // Use the connection
 *   const result = await pgConnection.connection.query('SELECT NOW()');
 *   console.log(result.rows[0]);
 * } finally {
 *   // Always release the connection
 *   pgConnection.release();
 * }
 * ```
 */
// Temporarily commented out due to universal pool manager removal
// export async function initializeConnectionPools(options?: {
// 	/** Enable monitoring and metrics collection */
// 	enableMonitoring?: boolean;
// 	/** Enable performance optimization */
// 	enableOptimization?: boolean;
// }): Promise<typeof getUniversalPoolManager extends () => infer T ? T : never> {
// 	const poolManager = getUniversalPoolManager();

// 	// Register all available factories
// 	const factories = getAllFactories();
// 	for (const factory of factories) {
// 		poolManager.registerFactory(factory);
// 	}

// 	// Initialize monitoring if enabled (default: true)
// 	if (options?.enableMonitoring !== false) {
// 		initializePoolMonitoring(poolManager);
// 	}

// 	// Initialize performance optimization if enabled (default: true)
// 	if (options?.enableOptimization !== false) {
// 		const { performanceOptimizer } = await import('./performance.js');
// 		performanceOptimizer.initialize(poolManager);
// 	}

// 	return poolManager;
// }

/**
 * Quick setup for common database configurations
 *
 * Provides pre-configured pool setups for common scenarios.
 */
export const PoolPresets = {
	/**
	 * Development setup with in-memory and local databases
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
		neo4j: {
			type: 'neo4j' as const,
			host: 'localhost',
			port: 7687,
			username: 'neo4j',
			password: 'password',
			min: 1,
			max: 3,
		},
	},

	/**
	 * Production setup with optimized connection limits
	 */
	production: {
		postgres: {
			type: 'postgres' as const,
			min: 5,
			max: 25,
			idleTimeoutMs: 300000, // 5 minutes
			acquireTimeoutMs: 10000,
			healthCheckIntervalMs: 60000,
		},
		redis: {
			type: 'redis' as const,
			min: 2,
			max: 15,
			idleTimeoutMs: 600000, // 10 minutes
			acquireTimeoutMs: 5000,
		},
		neo4j: {
			type: 'neo4j' as const,
			min: 2,
			max: 15,
			idleTimeoutMs: 300000,
			acquireTimeoutMs: 60000,
		},
	},

	/**
	 * Testing setup with minimal resources
	 */
	testing: {
		postgres: {
			type: 'postgres' as const,
			min: 1,
			max: 3,
			idleTimeoutMs: 10000,
			acquireTimeoutMs: 5000,
		},
		redis: {
			type: 'redis' as const,
			min: 1,
			max: 2,
			idleTimeoutMs: 10000,
			acquireTimeoutMs: 5000,
		},
		neo4j: {
			type: 'neo4j' as const,
			min: 1,
			max: 2,
			idleTimeoutMs: 10000,
			acquireTimeoutMs: 30000,
		},
	},
} as const;

/**
 * Health check utility for all pools
 *
 * Performs health checks on all active pools and returns a summary.
 */
export async function checkPoolHealth(): Promise<{
	healthy: boolean;
	pools: Array<{
		key: string;
		type: string;
		healthy: boolean;
		stats: PoolStats;
	}>;
	summary: {
		totalPools: number;
		healthyPools: number;
		totalConnections: number;
		activeConnections: number;
	};
}> {
	const poolManager = getUniversalPoolManager();
	const allStats = poolManager.getAllStats();

	const pools = Object.entries(allStats).map(([key, stats]) => ({
		key,
		type: stats.type,
		healthy: stats.isHealthy,
		stats,
	}));

	const healthyPools = pools.filter(pool => pool.healthy).length;
	const totalConnections = pools.reduce((sum, pool) => sum + pool.stats.totalConnections, 0);
	const activeConnections = pools.reduce((sum, pool) => sum + pool.stats.activeConnections, 0);

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
 *
 * Properly shuts down all connection pools and cleans up resources.
 */
export async function shutdownConnectionPools(): Promise<void> {
	const poolManager = getUniversalPoolManager();
	await poolManager.shutdownAll();
}