/**
 * Connection Pool Types and Interfaces
 *
 * Defines the core types and interfaces for the universal connection pooling system.
 * Supports multiple database backends with unified configuration and management.
 *
 * @module storage/connection-pool/types
 */

/**
 * Base connection pool configuration shared by all database types
 */
export interface BasePoolConfig {
	/** Minimum number of connections to maintain in the pool */
	min?: number;
	/** Maximum number of connections allowed in the pool */
	max?: number;
	/** Time in milliseconds before an idle connection is closed */
	idleTimeoutMs?: number;
	/** Time in milliseconds to wait for a connection acquisition */
	acquireTimeoutMs?: number;
	/** Time in milliseconds to wait for connection creation */
	createTimeoutMs?: number;
	/** Maximum lifetime of a connection in milliseconds */
	maxLifetimeMs?: number;
	/** Interval in milliseconds for health check operations */
	healthCheckIntervalMs?: number;
	/** Number of retries for failed connection attempts */
	maxRetries?: number;
	/** Enable/disable connection validation before use */
	validateOnAcquire?: boolean;
	/** Enable/disable connection validation before return */
	validateOnReturn?: boolean;
	/** Enable/disable connection logging */
	enableLogging?: boolean;
}

/**
 * PostgreSQL-specific pool configuration
 */
export interface PostgresPoolConfig extends BasePoolConfig {
	type: 'postgres';
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	url?: string;
	ssl?: boolean | any;
	application_name?: string;
	statement_timeout?: number;
	query_timeout?: number;
	connectionTimeoutMillis?: number;
	keepAlive?: boolean;
	keepAliveInitialDelayMillis?: number;
}

/**
 * Redis-specific pool configuration
 */
export interface RedisPoolConfig extends BasePoolConfig {
	type: 'redis';
	host?: string;
	port?: number;
	password?: string;
	username?: string;
	database?: number;
	url?: string;
	family?: 4 | 6;
	keepAlive?: number;
	connectTimeout?: number;
	commandTimeout?: number;
	retryDelayOnFailover?: number;
	enableOfflineQueue?: boolean;
	lazyConnect?: boolean;
	maxRetriesPerRequest?: number;
}

/**
 * Neo4j-specific pool configuration
 */
export interface Neo4jPoolConfig extends BasePoolConfig {
	type: 'neo4j';
	uri?: string;
	host?: string;
	port?: number;
	username: string;
	password: string;
	database?: string;
	encrypted?: boolean;
	trustServerCertificate?: boolean;
	maxTransactionRetryTime?: number;
	connectionAcquisitionTimeout?: number;
	maxConnectionLifetime?: number;
	connectionLivenessCheckTimeout?: number;
}

/**
 * Vector database pool configurations
 */
export interface QdrantPoolConfig extends BasePoolConfig {
	type: 'qdrant';
	url?: string;
	host?: string;
	port?: number;
	apiKey?: string;
	timeout?: number;
}

export interface MilvusPoolConfig extends BasePoolConfig {
	type: 'milvus';
	url?: string;
	host?: string;
	port?: number;
	username?: string;
	password?: string;
	token?: string;
	timeout?: number;
}

export interface ChromaPoolConfig extends BasePoolConfig {
	type: 'chroma';
	url?: string;
	host?: string;
	port?: number;
	ssl?: boolean;
	headers?: Record<string, string>;
	timeout?: number;
}

export interface PineconePoolConfig extends BasePoolConfig {
	type: 'pinecone';
	apiKey: string;
	environment?: string;
	region?: string;
	timeout?: number;
}

export interface WeaviatePoolConfig extends BasePoolConfig {
	type: 'weaviate';
	url?: string;
	host?: string;
	port?: number;
	grpcPort?: number;
	apiKey?: string;
	username?: string;
	password?: string;
	headers?: Record<string, string>;
	secure?: boolean;
	timeout?: number;
}

export interface PgVectorPoolConfig extends BasePoolConfig {
	type: 'pgvector';
	url?: string;
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
	schema?: string;
}

/**
 * Union type for all supported pool configurations
 */
export type PoolConfig =
	| PostgresPoolConfig
	| RedisPoolConfig
	| Neo4jPoolConfig
	| QdrantPoolConfig
	| MilvusPoolConfig
	| ChromaPoolConfig
	| PineconePoolConfig
	| WeaviatePoolConfig
	| PgVectorPoolConfig;

/**
 * Connection metadata for tracking and monitoring
 */
export interface ConnectionMetadata {
	/** Unique identifier for the connection */
	id: string;
	/** Timestamp when the connection was created */
	createdAt: number;
	/** Timestamp when the connection was last used */
	lastUsedAt: number;
	/** Number of times this connection has been acquired */
	acquisitionCount: number;
	/** Whether the connection is currently healthy */
	isHealthy: boolean;
	/** Whether the connection is currently in use */
	inUse: boolean;
	/** Pool type this connection belongs to */
	poolType: string;
	/** Additional metadata specific to the connection type */
	metadata?: Record<string, any>;
}

/**
 * Pooled connection wrapper
 */
export interface PooledConnection<T = any> {
	/** The actual database connection/client */
	connection: T;
	/** Connection metadata */
	metadata: ConnectionMetadata;
	/** Release this connection back to the pool */
	release(): void;
	/** Destroy this connection */
	destroy(): Promise<void>;
}

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
	/** Pool type identifier */
	type: string;
	/** Pool configuration key/identifier */
	key: string;
	/** Total number of connections in the pool */
	totalConnections: number;
	/** Number of connections currently in use */
	activeConnections: number;
	/** Number of idle connections available */
	idleConnections: number;
	/** Number of requests waiting for connections */
	waitingRequests: number;
	/** Total connections created since pool start */
	totalCreated: number;
	/** Total connections destroyed since pool start */
	totalDestroyed: number;
	/** Total successful acquisitions */
	totalAcquisitions: number;
	/** Total failed acquisitions */
	totalAcquisitionFailures: number;
	/** Average connection acquisition time in ms */
	avgAcquisitionTime: number;
	/** Average connection lifetime in ms */
	avgConnectionLifetime: number;
	/** Pool health status */
	isHealthy: boolean;
	/** Last health check timestamp */
	lastHealthCheck: number;
	/** Pool uptime in milliseconds */
	uptime: number;
}

/**
 * Pool factory interface for creating database-specific pools
 */
export interface PoolFactory<T = any> {
	/** Database type this factory supports */
	type: string;
	/** Create a new connection using the provided configuration */
	createConnection(config: PoolConfig): Promise<T>;
	/** Validate if a connection is healthy */
	validateConnection(connection: T): Promise<boolean>;
	/** Destroy a connection */
	destroyConnection(connection: T): Promise<void>;
	/** Get default configuration for this pool type */
	getDefaultConfig(): Partial<PoolConfig>;
}

/**
 * Connection pool interface
 */
export interface ConnectionPool<T = any> {
	/** Pool configuration */
	readonly config: PoolConfig;
	/** Pool statistics */
	readonly stats: PoolStats;
	/** Whether the pool is initialized */
	readonly isInitialized: boolean;

	/** Initialize the pool with minimum connections */
	initialize(): Promise<void>;
	/** Acquire a connection from the pool */
	acquire(): Promise<PooledConnection<T>>;
	/** Release a connection back to the pool */
	release(connection: PooledConnection<T>): Promise<void>;
	/** Destroy a specific connection */
	destroy(connection: PooledConnection<T>): Promise<void>;
	/** Drain the pool (stop accepting new requests) */
	drain(): Promise<void>;
	/** Clear all connections from the pool */
	clear(): Promise<void>;
	/** Shutdown the pool completely */
	shutdown(): Promise<void>;
	/** Perform health checks on connections */
	healthCheck(): Promise<void>;
	/** Get current pool statistics */
	getStats(): PoolStats;
}

/**
 * Universal pool manager interface
 */
export interface UniversalPoolManager {
	/** Register a pool factory for a specific database type */
	registerFactory(factory: PoolFactory): void;
	/** Get or create a connection pool for the given configuration */
	getPool<T = any>(config: PoolConfig): Promise<ConnectionPool<T>>;
	/** Get an existing pool by key */
	getExistingPool<T = any>(key: string): ConnectionPool<T> | undefined;
	/** Acquire a connection from a specific pool */
	acquire<T = any>(config: PoolConfig): Promise<PooledConnection<T>>;
	/** Get statistics for all pools */
	getAllStats(): Record<string, PoolStats>;
	/** Shutdown all pools */
	shutdownAll(): Promise<void>;
	/** Perform health checks on all pools */
	healthCheckAll(): Promise<void>;
}

/**
 * Pool events for monitoring and logging
 */
export interface PoolEvents {
	connectionCreated: (metadata: ConnectionMetadata) => void;
	connectionDestroyed: (metadata: ConnectionMetadata) => void;
	connectionAcquired: (metadata: ConnectionMetadata) => void;
	connectionReleased: (metadata: ConnectionMetadata) => void;
	connectionFailed: (error: Error, config: PoolConfig) => void;
	poolHealthCheck: (stats: PoolStats) => void;
	poolDrained: (poolKey: string) => void;
	poolShutdown: (poolKey: string) => void;
}

/**
 * Pool configuration defaults
 */
export const DEFAULT_POOL_CONFIG: Required<BasePoolConfig> = {
	min: 2,
	max: 20,
	idleTimeoutMs: 30000,
	acquireTimeoutMs: 10000,
	createTimeoutMs: 10000,
	maxLifetimeMs: 300000, // 5 minutes
	healthCheckIntervalMs: 60000, // 1 minute
	maxRetries: 3,
	validateOnAcquire: true,
	validateOnReturn: false,
	enableLogging: true,
};

/**
 * Database-specific default configurations
 */
export const DATABASE_DEFAULTS = {
	postgres: {
		min: 2,
		max: 20,
		idleTimeoutMs: 30000,
		acquireTimeoutMs: 10000,
		statement_timeout: 30000,
		query_timeout: 30000,
	} as Partial<PostgresPoolConfig>,

	redis: {
		min: 1,
		max: 10,
		idleTimeoutMs: 300000, // 5 minutes
		acquireTimeoutMs: 5000,
		connectTimeout: 10000,
		commandTimeout: 5000,
		maxRetriesPerRequest: 3,
		lazyConnect: true,
	} as Partial<RedisPoolConfig>,

	neo4j: {
		min: 1,
		max: 10,
		idleTimeoutMs: 300000,
		acquireTimeoutMs: 60000,
		maxTransactionRetryTime: 15000,
		connectionAcquisitionTimeout: 60000,
		maxConnectionLifetime: 3600000, // 1 hour
	} as Partial<Neo4jPoolConfig>,

	qdrant: {
		min: 1,
		max: 10,
		idleTimeoutMs: 300000,
		acquireTimeoutMs: 10000,
		timeout: 30000,
	} as Partial<QdrantPoolConfig>,

	milvus: {
		min: 1,
		max: 10,
		idleTimeoutMs: 300000,
		acquireTimeoutMs: 10000,
		timeout: 30000,
	} as Partial<MilvusPoolConfig>,

	chroma: {
		min: 1,
		max: 5,
		idleTimeoutMs: 300000,
		acquireTimeoutMs: 10000,
		timeout: 30000,
	} as Partial<ChromaPoolConfig>,

	pinecone: {
		min: 1,
		max: 5,
		idleTimeoutMs: 600000, // 10 minutes
		acquireTimeoutMs: 15000,
		timeout: 30000,
	} as Partial<PineconePoolConfig>,

	weaviate: {
		min: 1,
		max: 10,
		idleTimeoutMs: 300000,
		acquireTimeoutMs: 10000,
		timeout: 30000,
	} as Partial<WeaviatePoolConfig>,

	pgvector: {
		min: 2,
		max: 15,
		idleTimeoutMs: 30000,
		acquireTimeoutMs: 10000,
	} as Partial<PgVectorPoolConfig>,
};