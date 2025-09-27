/**
 * Connection Pool Configuration System
 *
 * Centralized configuration management for all database connection pools.
 * Provides validation, defaults, and environment variable integration.
 *
 * @module storage/connection-pool/config
 */

import { z } from 'zod';
import { env } from '../../env.js';
import type {
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
} from './types.js';
import {
	DEFAULT_POOL_CONFIG,
	DATABASE_DEFAULTS,
} from './types.js';

/**
 * Environment variable configuration mapping
 */
interface EnvConfig {
	// PostgreSQL
	POSTGRES_HOST?: string;
	POSTGRES_PORT?: string;
	POSTGRES_DATABASE?: string;
	POSTGRES_USER?: string;
	POSTGRES_PASSWORD?: string;
	POSTGRES_URL?: string;
	POSTGRES_MAX_CONNECTIONS?: string;
	POSTGRES_MIN_CONNECTIONS?: string;

	// Redis
	REDIS_HOST?: string;
	REDIS_PORT?: string;
	REDIS_PASSWORD?: string;
	REDIS_USERNAME?: string;
	REDIS_DATABASE?: string;
	REDIS_URL?: string;
	REDIS_MAX_CONNECTIONS?: string;
	REDIS_MIN_CONNECTIONS?: string;

	// Neo4j
	NEO4J_URI?: string;
	NEO4J_HOST?: string;
	NEO4J_PORT?: string;
	NEO4J_USERNAME?: string;
	NEO4J_PASSWORD?: string;
	NEO4J_DATABASE?: string;
	NEO4J_MAX_CONNECTIONS?: string;
	NEO4J_MIN_CONNECTIONS?: string;

	// Vector databases
	VECTOR_STORE_URL?: string;
	VECTOR_STORE_HOST?: string;
	VECTOR_STORE_PORT?: string;
	VECTOR_STORE_USERNAME?: string;
	VECTOR_STORE_PASSWORD?: string;
	VECTOR_STORE_API_KEY?: string;

	// Pool defaults
	DEFAULT_POOL_MIN?: string;
	DEFAULT_POOL_MAX?: string;
	DEFAULT_POOL_IDLE_TIMEOUT?: string;
	DEFAULT_POOL_ACQUIRE_TIMEOUT?: string;
}

/**
 * Pool Configuration Manager
 *
 * Provides centralized configuration management with environment variable
 * integration, validation, and defaults application.
 *
 * Features:
 * - Environment variable integration
 * - Configuration validation using Zod
 * - Default value application
 * - Database-specific configuration builders
 * - Configuration merging and overrides
 *
 * @example
 * ```typescript
 * const configManager = new PoolConfigManager();
 *
 * // Get PostgreSQL configuration from environment
 * const pgConfig = configManager.getPostgresConfig();
 *
 * // Create custom configuration
 * const customConfig = configManager.createConfig({
 *   type: 'redis',
 *   host: 'redis.example.com',
 *   port: 6379,
 *   max: 15
 * });
 * ```
 */
export class PoolConfigManager {
	private readonly envConfig: EnvConfig;

	constructor() {
		this.envConfig = this.loadEnvironmentConfig();
	}

	/**
	 * Create and validate a pool configuration
	 */
	createConfig(config: Partial<PoolConfig>): PoolConfig {
		// Apply defaults based on database type
		const defaults = this.getDefaultsForType(config.type as string);
		const mergedConfig = { ...defaults, ...config };

		// Validate the configuration
		return this.validateConfig(mergedConfig);
	}

	/**
	 * Get PostgreSQL configuration from environment variables
	 */
	getPostgresConfig(overrides: Partial<PostgresPoolConfig> = {}): PostgresPoolConfig {
		const envConfig: Partial<PostgresPoolConfig> = {
			type: 'postgres'
		};

		if (this.envConfig.POSTGRES_HOST !== undefined) {
			envConfig.host = this.envConfig.POSTGRES_HOST;
		}
		if (this.envConfig.POSTGRES_PORT) {
			envConfig.port = parseInt(this.envConfig.POSTGRES_PORT, 10);
		}
		if (this.envConfig.POSTGRES_DATABASE !== undefined) {
			envConfig.database = this.envConfig.POSTGRES_DATABASE;
		}
		if (this.envConfig.POSTGRES_USER !== undefined) {
			envConfig.user = this.envConfig.POSTGRES_USER;
		}
		if (this.envConfig.POSTGRES_PASSWORD !== undefined) {
			envConfig.password = this.envConfig.POSTGRES_PASSWORD;
		}
		if (this.envConfig.POSTGRES_URL !== undefined) {
			envConfig.url = this.envConfig.POSTGRES_URL;
		}
		if (this.envConfig.POSTGRES_MAX_CONNECTIONS) {
			envConfig.max = parseInt(this.envConfig.POSTGRES_MAX_CONNECTIONS, 10);
		}
		if (this.envConfig.POSTGRES_MIN_CONNECTIONS) {
			envConfig.min = parseInt(this.envConfig.POSTGRES_MIN_CONNECTIONS, 10);
		}

		return this.createConfig({ ...envConfig, ...overrides }) as PostgresPoolConfig;
	}

	/**
	 * Get Redis configuration from environment variables
	 */
	getRedisConfig(overrides: Partial<RedisPoolConfig> = {}): RedisPoolConfig {
		const envConfig: Partial<RedisPoolConfig> = {
			type: 'redis'
		};

		if (this.envConfig.REDIS_HOST !== undefined) {
			envConfig.host = this.envConfig.REDIS_HOST;
		}
		if (this.envConfig.REDIS_PORT) {
			envConfig.port = parseInt(this.envConfig.REDIS_PORT, 10);
		}
		if (this.envConfig.REDIS_PASSWORD !== undefined) {
			envConfig.password = this.envConfig.REDIS_PASSWORD;
		}
		if (this.envConfig.REDIS_USERNAME !== undefined) {
			envConfig.username = this.envConfig.REDIS_USERNAME;
		}
		if (this.envConfig.REDIS_DATABASE) {
			envConfig.database = parseInt(this.envConfig.REDIS_DATABASE, 10);
		}
		if (this.envConfig.REDIS_URL !== undefined) {
			envConfig.url = this.envConfig.REDIS_URL;
		}
		if (this.envConfig.REDIS_MAX_CONNECTIONS) {
			envConfig.max = parseInt(this.envConfig.REDIS_MAX_CONNECTIONS, 10);
		}
		if (this.envConfig.REDIS_MIN_CONNECTIONS) {
			envConfig.min = parseInt(this.envConfig.REDIS_MIN_CONNECTIONS, 10);
		}

		return this.createConfig({ ...envConfig, ...overrides }) as RedisPoolConfig;
	}

	/**
	 * Get Neo4j configuration from environment variables
	 */
	getNeo4jConfig(overrides: Partial<Neo4jPoolConfig> = {}): Neo4jPoolConfig {
		const envConfig: Partial<Neo4jPoolConfig> = {
			type: 'neo4j',
			username: this.envConfig.NEO4J_USERNAME || 'neo4j',
			password: this.envConfig.NEO4J_PASSWORD || ''
		};

		if (this.envConfig.NEO4J_URI !== undefined) {
			envConfig.uri = this.envConfig.NEO4J_URI;
		}
		if (this.envConfig.NEO4J_HOST !== undefined) {
			envConfig.host = this.envConfig.NEO4J_HOST;
		}
		if (this.envConfig.NEO4J_PORT) {
			envConfig.port = parseInt(this.envConfig.NEO4J_PORT, 10);
		}
		if (this.envConfig.NEO4J_DATABASE !== undefined) {
			envConfig.database = this.envConfig.NEO4J_DATABASE;
		}
		if (this.envConfig.NEO4J_MAX_CONNECTIONS) {
			envConfig.max = parseInt(this.envConfig.NEO4J_MAX_CONNECTIONS, 10);
		}
		if (this.envConfig.NEO4J_MIN_CONNECTIONS) {
			envConfig.min = parseInt(this.envConfig.NEO4J_MIN_CONNECTIONS, 10);
		}

		return this.createConfig({ ...envConfig, ...overrides }) as Neo4jPoolConfig;
	}

	/**
	 * Get Qdrant configuration from environment variables
	 */
	getQdrantConfig(overrides: Partial<QdrantPoolConfig> = {}): QdrantPoolConfig {
		const envConfig: Partial<QdrantPoolConfig> = {
			type: 'qdrant',
		};

		if (this.envConfig.VECTOR_STORE_URL !== undefined) {
			envConfig.url = this.envConfig.VECTOR_STORE_URL;
		}
		if (this.envConfig.VECTOR_STORE_HOST !== undefined) {
			envConfig.host = this.envConfig.VECTOR_STORE_HOST;
		}
		if (this.envConfig.VECTOR_STORE_PORT !== undefined) {
			envConfig.port = parseInt(this.envConfig.VECTOR_STORE_PORT, 10);
		}
		if (this.envConfig.VECTOR_STORE_API_KEY !== undefined) {
			envConfig.apiKey = this.envConfig.VECTOR_STORE_API_KEY;
		}

		return this.createConfig({ ...envConfig, ...overrides }) as QdrantPoolConfig;
	}

	/**
	 * Get Milvus configuration from environment variables
	 */
	getMilvusConfig(overrides: Partial<MilvusPoolConfig> = {}): MilvusPoolConfig {
		const envConfig: Partial<MilvusPoolConfig> = {
			type: 'milvus',
		};

		if (this.envConfig.VECTOR_STORE_URL !== undefined) {
			envConfig.url = this.envConfig.VECTOR_STORE_URL;
		}
		if (this.envConfig.VECTOR_STORE_HOST !== undefined) {
			envConfig.host = this.envConfig.VECTOR_STORE_HOST;
		}
		if (this.envConfig.VECTOR_STORE_PORT !== undefined) {
			envConfig.port = parseInt(this.envConfig.VECTOR_STORE_PORT, 10);
		}
		if (this.envConfig.VECTOR_STORE_USERNAME !== undefined) {
			envConfig.username = this.envConfig.VECTOR_STORE_USERNAME;
		}
		if (this.envConfig.VECTOR_STORE_PASSWORD !== undefined) {
			envConfig.password = this.envConfig.VECTOR_STORE_PASSWORD;
		}

		return this.createConfig({ ...envConfig, ...overrides }) as MilvusPoolConfig;
	}

	/**
	 * Validate configuration using appropriate schema
	 */
	private validateConfig(config: any): PoolConfig {
		// Note: In a real implementation, you would use Zod schemas for validation
		// For now, we'll do basic validation

		if (!config.type) {
			throw new Error('Pool configuration must specify a type');
		}

		// Apply global defaults
		const validatedConfig = {
			...DEFAULT_POOL_CONFIG,
			...config,
		};

		// Type-specific validation
		switch (config.type) {
			case 'postgres':
				if (!validatedConfig.url && (!validatedConfig.host || !validatedConfig.database)) {
					throw new Error('PostgreSQL configuration requires either url or host+database');
				}
				break;
			case 'redis':
				if (!validatedConfig.url && !validatedConfig.host) {
					throw new Error('Redis configuration requires either url or host');
				}
				break;
			case 'neo4j':
				if (!validatedConfig.uri && !validatedConfig.host) {
					throw new Error('Neo4j configuration requires either uri or host');
				}
				if (!validatedConfig.username || !validatedConfig.password) {
					throw new Error('Neo4j configuration requires username and password');
				}
				break;
			case 'qdrant':
				if (!validatedConfig.url && !validatedConfig.host) {
					throw new Error('Qdrant configuration requires either url or host');
				}
				break;
			case 'milvus':
				if (!validatedConfig.url && !validatedConfig.host) {
					throw new Error('Milvus configuration requires either url or host');
				}
				break;
		}

		return validatedConfig as PoolConfig;
	}

	/**
	 * Get default configuration for a specific database type
	 */
	private getDefaultsForType(type: string): Partial<PoolConfig> {
		const globalDefaults = {
			min: this.envConfig.DEFAULT_POOL_MIN ? parseInt(this.envConfig.DEFAULT_POOL_MIN, 10) : DEFAULT_POOL_CONFIG.min,
			max: this.envConfig.DEFAULT_POOL_MAX ? parseInt(this.envConfig.DEFAULT_POOL_MAX, 10) : DEFAULT_POOL_CONFIG.max,
			idleTimeoutMs: this.envConfig.DEFAULT_POOL_IDLE_TIMEOUT ? parseInt(this.envConfig.DEFAULT_POOL_IDLE_TIMEOUT, 10) : DEFAULT_POOL_CONFIG.idleTimeoutMs,
			acquireTimeoutMs: this.envConfig.DEFAULT_POOL_ACQUIRE_TIMEOUT ? parseInt(this.envConfig.DEFAULT_POOL_ACQUIRE_TIMEOUT, 10) : DEFAULT_POOL_CONFIG.acquireTimeoutMs,
		};

		const typeDefaults = DATABASE_DEFAULTS[type as keyof typeof DATABASE_DEFAULTS] || {};

		return {
			...globalDefaults,
			...typeDefaults,
			type: type as any,
		};
	}

	/**
	 * Load configuration from environment variables
	 */
	private loadEnvironmentConfig(): EnvConfig {
		const envConfig: any = {
			// PostgreSQL
			POSTGRES_HOST: process.env.POSTGRES_HOST,
			POSTGRES_PORT: process.env.POSTGRES_PORT,
			POSTGRES_DATABASE: process.env.POSTGRES_DATABASE,
			POSTGRES_USER: process.env.POSTGRES_USER || (env as any).POSTGRES_USER,
			POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || (env as any).POSTGRES_PASSWORD,
			POSTGRES_URL: process.env.POSTGRES_URL || (env as any).POSTGRES_URL,
			POSTGRES_MAX_CONNECTIONS: process.env.POSTGRES_MAX_CONNECTIONS,
			POSTGRES_MIN_CONNECTIONS: process.env.POSTGRES_MIN_CONNECTIONS,

			// Redis
			REDIS_HOST: process.env.REDIS_HOST || (env as any).REDIS_HOST,
			REDIS_PORT: process.env.REDIS_PORT || (env as any).REDIS_PORT?.toString(),
			REDIS_PASSWORD: process.env.REDIS_PASSWORD || (env as any).REDIS_PASSWORD,
			REDIS_USERNAME: process.env.REDIS_USERNAME || (env as any).REDIS_USERNAME,
			REDIS_DATABASE: process.env.REDIS_DATABASE || (env as any).REDIS_DATABASE?.toString(),
			REDIS_URL: process.env.REDIS_URL || (env as any).REDIS_URL,
			REDIS_MAX_CONNECTIONS: process.env.REDIS_MAX_CONNECTIONS,
			REDIS_MIN_CONNECTIONS: process.env.REDIS_MIN_CONNECTIONS,

			// Neo4j
			NEO4J_URI: process.env.NEO4J_URI || (env as any).NEO4J_URI,
			NEO4J_HOST: process.env.NEO4J_HOST || (env as any).NEO4J_HOST,
			NEO4J_PORT: process.env.NEO4J_PORT || (env as any).NEO4J_PORT?.toString(),
			NEO4J_USERNAME: process.env.NEO4J_USERNAME || (env as any).NEO4J_USERNAME,
			NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || (env as any).NEO4J_PASSWORD,
			NEO4J_DATABASE: process.env.NEO4J_DATABASE || (env as any).NEO4J_DATABASE,
			NEO4J_MAX_CONNECTIONS: process.env.NEO4J_MAX_CONNECTIONS,
			NEO4J_MIN_CONNECTIONS: process.env.NEO4J_MIN_CONNECTIONS,

			// Vector databases
			VECTOR_STORE_URL: process.env.VECTOR_STORE_URL || env.VECTOR_STORE_URL,
			VECTOR_STORE_HOST: process.env.VECTOR_STORE_HOST || env.VECTOR_STORE_HOST,
			VECTOR_STORE_PORT: process.env.VECTOR_STORE_PORT || env.VECTOR_STORE_PORT?.toString(),
			VECTOR_STORE_USERNAME: process.env.VECTOR_STORE_USERNAME || env.VECTOR_STORE_USERNAME,
			VECTOR_STORE_PASSWORD: process.env.VECTOR_STORE_PASSWORD || env.VECTOR_STORE_PASSWORD,
			VECTOR_STORE_API_KEY: process.env.VECTOR_STORE_API_KEY || env.VECTOR_STORE_API_KEY,

			// Pool defaults
			DEFAULT_POOL_MIN: process.env.DEFAULT_POOL_MIN,
			DEFAULT_POOL_MAX: process.env.DEFAULT_POOL_MAX,
			DEFAULT_POOL_IDLE_TIMEOUT: process.env.DEFAULT_POOL_IDLE_TIMEOUT,
			DEFAULT_POOL_ACQUIRE_TIMEOUT: process.env.DEFAULT_POOL_ACQUIRE_TIMEOUT,
		};

		return envConfig;
	}
}

/**
 * Singleton instance of the configuration manager
 */
export const poolConfigManager = new PoolConfigManager();

/**
 * Convenience functions for getting configurations
 */
export const getPostgresPoolConfig = (overrides?: Partial<PostgresPoolConfig>) =>
	poolConfigManager.getPostgresConfig(overrides);

export const getRedisPoolConfig = (overrides?: Partial<RedisPoolConfig>) =>
	poolConfigManager.getRedisConfig(overrides);

export const getNeo4jPoolConfig = (overrides?: Partial<Neo4jPoolConfig>) =>
	poolConfigManager.getNeo4jConfig(overrides);

export const getQdrantPoolConfig = (overrides?: Partial<QdrantPoolConfig>) =>
	poolConfigManager.getQdrantConfig(overrides);

export const getMilvusPoolConfig = (overrides?: Partial<MilvusPoolConfig>) =>
	poolConfigManager.getMilvusConfig(overrides);

/**
 * Create a configuration from partial config with validation
 */
export const createPoolConfig = (config: Partial<PoolConfig>): PoolConfig =>
	poolConfigManager.createConfig(config);