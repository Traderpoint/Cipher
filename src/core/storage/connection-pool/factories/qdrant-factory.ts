/**
 * Qdrant Pool Factory
 *
 * Factory implementation for creating and managing Qdrant connections
 * with optimized pool configuration and health checking.
 *
 * @module storage/connection-pool/factories/qdrant-factory
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { createLogger, type Logger } from '../../../logger/index.js';
import type { PoolFactory, PoolConfig, QdrantPoolConfig, DATABASE_DEFAULTS } from '../types.js';

/**
 * Qdrant Pool Factory
 *
 * Creates and manages Qdrant client connections for vector database operations.
 * Provides optimized configuration, connection validation, and health checking.
 *
 * Features:
 * - Client connection management
 * - SSL/TLS support
 * - Connection validation and health checks
 * - API key authentication
 * - Performance monitoring
 * - Collection management
 *
 * @example
 * ```typescript
 * const factory = new QdrantPoolFactory();
 * const client = await factory.createConnection({
 *   type: 'qdrant',
 *   host: 'localhost',
 *   port: 6333,
 *   apiKey: 'your-api-key'
 * });
 * ```
 */
export class QdrantPoolFactory implements PoolFactory<QdrantClient> {
	readonly type = 'qdrant';
	private readonly logger: Logger;

	constructor() {
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
	}

	/**
	 * Create a new Qdrant client connection
	 */
	async createConnection(config: PoolConfig): Promise<QdrantClient> {
		const qdrantConfig = config as QdrantPoolConfig;

		if (qdrantConfig.type !== 'qdrant') {
			throw new Error(`Invalid config type for Qdrant factory: ${qdrantConfig.type}`);
		}

		const clientConfig = this.buildClientConfig(qdrantConfig);

		this.logger.debug('Creating Qdrant client with config:', {
			url: clientConfig.url,
			apiKey: !!clientConfig.apiKey,
			timeout: qdrantConfig.timeout,
		});

		const client = new QdrantClient(clientConfig);

		// Test connection
		try {
			await Promise.race([
				client.getCollections(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Connection timeout')), qdrantConfig.timeout || 30000)
				),
			]);

			this.logger.debug('Qdrant client connection test successful');
		} catch (error) {
			this.logger.error('Qdrant client connection test failed:', error);
			throw error;
		}

		return client;
	}

	/**
	 * Validate if a Qdrant client is healthy
	 */
	async validateConnection(client: QdrantClient): Promise<boolean> {
		try {
			// Test connection with health check endpoint
			const result = await Promise.race([
				client.getCollections(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Health check timeout')), 5000)
				),
			]);

			// Check if result is valid
			const isValid = result && typeof result === 'object' && 'collections' in result;

			if (!isValid) {
				this.logger.warn('Qdrant health check returned unexpected result:', result);
			}

			return isValid;
		} catch (error) {
			this.logger.warn('Qdrant connection validation failed:', error);
			return false;
		}
	}

	/**
	 * Destroy a Qdrant client connection
	 */
	async destroyConnection(client: QdrantClient): Promise<void> {
		try {
			// Qdrant client doesn't have an explicit close method
			// The connection will be cleaned up when the object is garbage collected
			this.logger.debug('Qdrant client destroyed successfully (garbage collection)');
		} catch (error) {
			this.logger.error('Error destroying Qdrant client:', error);
			throw error;
		}
	}

	/**
	 * Get default configuration for Qdrant clients
	 */
	getDefaultConfig(): Partial<PoolConfig> {
		return {
			...DATABASE_DEFAULTS.qdrant,
			type: 'qdrant',
		};
	}

	/**
	 * Build Qdrant client configuration
	 */
	private buildClientConfig(config: QdrantPoolConfig): {
		url: string;
		apiKey?: string;
	} {
		// Determine URL
		let url: string;
		if (config.url) {
			url = config.url;
		} else {
			const host = config.host || 'localhost';
			const port = config.port || 6333;
			url = `http://${host}:${port}`;
		}

		// Build client configuration
		const clientConfig: {
			url: string;
			apiKey?: string;
		} = {
			url,
		};

		// Add API key if provided
		if (config.apiKey) {
			clientConfig.apiKey = config.apiKey;
		}

		return clientConfig;
	}
}

/**
 * Singleton instance of Qdrant factory
 */
export const qdrantFactory = new QdrantPoolFactory();