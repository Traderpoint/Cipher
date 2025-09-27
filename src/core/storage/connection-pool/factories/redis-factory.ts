/**
 * Redis Pool Factory
 *
 * Factory implementation for creating and managing Redis connections
 * with optimized pool configuration and health checking.
 *
 * @module storage/connection-pool/factories/redis-factory
 */

import { Redis, type RedisOptions } from 'ioredis';
import { createLogger, type Logger } from '../../../logger/index.js';
import type { PoolFactory, PoolConfig, RedisPoolConfig } from '../types.js';
import { DATABASE_DEFAULTS } from '../types.js';

/**
 * Redis Pool Factory
 *
 * Creates and manages Redis connections using the ioredis library.
 * Provides optimized configuration, connection validation, and health checking.
 *
 * Features:
 * - Connection pooling with configurable limits
 * - SSL/TLS support
 * - Connection validation and health checks
 * - Automatic reconnection
 * - Performance monitoring
 * - Pipeline and cluster support
 *
 * @example
 * ```typescript
 * const factory = new RedisPoolFactory();
 * const connection = await factory.createConnection({
 *   type: 'redis',
 *   host: 'localhost',
 *   port: 6379,
 *   password: 'secret',
 *   database: 0
 * });
 * ```
 */
export class RedisPoolFactory implements PoolFactory<Redis> {
	readonly type = 'redis';
	private readonly logger: Logger;

	constructor() {
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
	}

	/**
	 * Create a new Redis connection
	 */
	async createConnection(config: PoolConfig): Promise<Redis> {
		const redisConfig = config as RedisPoolConfig;

		if (redisConfig.type !== 'redis') {
			throw new Error(`Invalid config type for Redis factory: ${redisConfig.type}`);
		}

		const connectionOptions = this.buildConnectionOptions(redisConfig);

		this.logger.debug('Creating Redis connection with config:', {
			host: connectionOptions.host,
			port: connectionOptions.port,
			db: connectionOptions.db,
			family: connectionOptions.family,
			connectTimeout: connectionOptions.connectTimeout,
			lazyConnect: connectionOptions.lazyConnect,
		});

		const redis = new Redis(connectionOptions);

		// Set up event handlers
		redis.on('connect', () => {
			this.logger.debug('Redis connection established');
		});

		redis.on('ready', () => {
			this.logger.debug('Redis connection ready');
		});

		redis.on('error', (error) => {
			this.logger.error('Redis connection error:', error);
		});

		redis.on('close', () => {
			this.logger.debug('Redis connection closed');
		});

		redis.on('reconnecting', (ms: number) => {
			this.logger.debug(`Redis reconnecting in ${ms}ms`);
		});

		redis.on('end', () => {
			this.logger.debug('Redis connection ended');
		});

		// Wait for connection to be ready if not using lazy connect
		if (!connectionOptions.lazyConnect) {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('Redis connection timeout'));
				}, connectionOptions.connectTimeout || 10000);

				redis.once('ready', () => {
					clearTimeout(timeout);
					resolve();
				});

				redis.once('error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		} else {
			// For lazy connect, ensure connection can be established
			try {
				await redis.ping();
			} catch (error) {
				await redis.quit();
				throw error;
			}
		}

		return redis;
	}

	/**
	 * Validate if a Redis connection is healthy
	 */
	async validateConnection(redis: Redis): Promise<boolean> {
		try {
			// Check connection status
			if (redis.status !== 'ready') {
				this.logger.debug(`Redis connection status is ${redis.status}, not ready`);
				return false;
			}

			// Send ping command with timeout
			const result = await Promise.race([
				redis.ping(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Ping timeout')), 3000)
				),
			]);

			const isValid = result === 'PONG';

			if (!isValid) {
				this.logger.warn('Redis ping returned unexpected result:', result);
			}

			return isValid;
		} catch (error) {
			this.logger.warn('Redis connection validation failed:', error);
			return false;
		}
	}

	/**
	 * Destroy a Redis connection
	 */
	async destroyConnection(redis: Redis): Promise<void> {
		try {
			if (redis.status !== 'end') {
				await redis.quit();
			}
			this.logger.debug('Redis connection destroyed successfully');
		} catch (error) {
			this.logger.error('Error destroying Redis connection:', error);
			// Force disconnect if quit fails
			redis.disconnect();
			throw error;
		}
	}

	/**
	 * Get default configuration for Redis connections
	 */
	getDefaultConfig(): Partial<PoolConfig> {
		return {
			...DATABASE_DEFAULTS.redis,
			type: 'redis',
		};
	}

	/**
	 * Build Redis connection options
	 */
	private buildConnectionOptions(config: RedisPoolConfig): RedisOptions {
		// Base options
		const options: RedisOptions = {
			// Connection settings
			host: config.host || 'localhost',
			port: config.port || 6379,
			family: config.family || 4, // Force IPv4 to avoid IPv6 issues
			db: config.database || 0,

			// Authentication
			username: config.username,
			password: config.password,

			// Timeouts
			connectTimeout: config.connectTimeout || config.acquireTimeoutMs || 10000,
			commandTimeout: config.commandTimeout || 5000,
			lazyConnect: config.lazyConnect !== false,

			// Retry configuration
			// retryDelayOnFailover removed as it's not supported in this version
			enableOfflineQueue: config.enableOfflineQueue !== false,
			maxRetriesPerRequest: config.maxRetriesPerRequest || 3,

			// Keep-alive settings
			keepAlive: config.keepAlive !== undefined ? config.keepAlive : 30000,
		};

		// Handle connection URL if provided
		if (config.url) {
			// Parse URL and override individual settings
			try {
				const url = new URL(config.url);
				options.host = url.hostname;
				options.port = url.port ? parseInt(url.port, 10) : 6379;

				if (url.username) {
					options.username = url.username;
				}
				if (url.password) {
					options.password = url.password;
				}

				// Extract database number from pathname
				if (url.pathname && url.pathname.length > 1) {
					const dbNum = parseInt(url.pathname.slice(1), 10);
					if (!isNaN(dbNum)) {
						options.db = dbNum;
					}
				}

				// Handle SSL
				if (url.protocol === 'rediss:') {
					options.tls = {};
				}
			} catch (error) {
				this.logger.warn('Failed to parse Redis URL, using individual parameters:', error);
			}
		}

		// Apply additional options if provided
		if ((config as any).options) {
			Object.assign(options, (config as any).options);
		}

		return options;
	}
}

/**
 * Singleton instance of Redis factory
 */
export const redisFactory = new RedisPoolFactory();