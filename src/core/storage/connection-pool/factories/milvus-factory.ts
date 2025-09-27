/**
 * Milvus Pool Factory
 *
 * Factory implementation for creating and managing Milvus connections
 * with optimized pool configuration and health checking.
 *
 * @module storage/connection-pool/factories/milvus-factory
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { createLogger, type Logger } from '../../../logger/index.js';
import type { PoolFactory, PoolConfig, MilvusPoolConfig } from '../types.js';
import { DATABASE_DEFAULTS } from '../types.js';

/**
 * Milvus Pool Factory
 *
 * Creates and manages Milvus client connections for vector database operations.
 * Provides optimized configuration, connection validation, and health checking.
 *
 * Features:
 * - Client connection management
 * - SSL/TLS support
 * - Connection validation and health checks
 * - Authentication support (Zilliz Cloud)
 * - Performance monitoring
 * - Collection management
 *
 * @example
 * ```typescript
 * const factory = new MilvusPoolFactory();
 * const client = await factory.createConnection({
 *   type: 'milvus',
 *   host: 'localhost',
 *   port: 19530,
 *   username: 'admin',
 *   password: 'password'
 * });
 * ```
 */
export class MilvusPoolFactory implements PoolFactory<MilvusClient> {
	readonly type = 'milvus';
	private readonly logger: Logger;

	constructor() {
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
	}

	/**
	 * Create a new Milvus client connection
	 */
	async createConnection(config: PoolConfig): Promise<MilvusClient> {
		const milvusConfig = config as MilvusPoolConfig;

		if (milvusConfig.type !== 'milvus') {
			throw new Error(`Invalid config type for Milvus factory: ${milvusConfig.type}`);
		}

		const clientConfig = this.buildClientConfig(milvusConfig);

		this.logger.debug('Creating Milvus client with config:', {
			address: clientConfig.address,
			username: clientConfig.username,
			timeout: milvusConfig.timeout,
		});

		const client = new MilvusClient(clientConfig);

		// Test connection
		try {
			await Promise.race([
				client.showCollections(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Connection timeout')), milvusConfig.timeout || 30000)
				),
			]);

			this.logger.debug('Milvus client connection test successful');
		} catch (error) {
			this.logger.error('Milvus client connection test failed:', error);
			throw error;
		}

		return client;
	}

	/**
	 * Validate if a Milvus client is healthy
	 */
	async validateConnection(client: MilvusClient): Promise<boolean> {
		try {
			// Test connection with timeout
			const result = await Promise.race([
				client.showCollections(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Health check timeout')), 5000)
				),
			]);

			// Check if result is valid
			const isValid = result && typeof result === 'object' && 'status' in result;

			if (!isValid) {
				this.logger.warn('Milvus health check returned unexpected result:', result);
			}

			return isValid;
		} catch (error) {
			this.logger.warn('Milvus connection validation failed:', error);
			return false;
		}
	}

	/**
	 * Destroy a Milvus client connection
	 */
	async destroyConnection(client: MilvusClient): Promise<void> {
		try {
			// Milvus client doesn't have an explicit close method
			// The connection will be cleaned up when the object is garbage collected
			this.logger.debug('Milvus client destroyed successfully (garbage collection)');
		} catch (error) {
			this.logger.error('Error destroying Milvus client:', error);
			throw error;
		}
	}

	/**
	 * Get default configuration for Milvus clients
	 */
	getDefaultConfig(): Partial<PoolConfig> {
		return {
			...DATABASE_DEFAULTS.milvus,
			type: 'milvus',
		};
	}

	/**
	 * Build Milvus client configuration
	 */
	private buildClientConfig(config: MilvusPoolConfig): {
		address: string;
		username?: string;
		password?: string;
		token?: string;
	} {
		// Determine address
		let address: string;
		if (config.url) {
			address = config.url;
		} else {
			const host = config.host || 'localhost';
			const port = config.port || 19530;
			address = `http://${host}:${port}`;
		}

		// Build client configuration
		const clientConfig: {
			address: string;
			username?: string;
			password?: string;
			token?: string;
		} = {
			address,
		};

		// Add authentication if provided
		if (config.username) {
			clientConfig.username = config.username;
		}
		if (config.password) {
			clientConfig.password = config.password;
		}
		if (config.token) {
			clientConfig.token = config.token;
		}

		return clientConfig;
	}
}

/**
 * Singleton instance of Milvus factory
 */
export const milvusFactory = new MilvusPoolFactory();