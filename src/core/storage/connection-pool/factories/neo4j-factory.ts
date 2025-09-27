/**
 * Neo4j Pool Factory
 *
 * Factory implementation for creating and managing Neo4j connections
 * with optimized pool configuration and health checking.
 *
 * @module storage/connection-pool/factories/neo4j-factory
 */

import neo4j, { type Driver, type Config } from 'neo4j-driver';
import { createLogger, type Logger } from '../../../logger/index.js';
import type { PoolFactory, PoolConfig, Neo4jPoolConfig } from '../types.js';
import { DATABASE_DEFAULTS } from '../types.js';

/**
 * Neo4j Pool Factory
 *
 * Creates and manages Neo4j driver connections with built-in connection pooling.
 * Provides optimized configuration, connection validation, and health checking.
 *
 * Features:
 * - Driver connection pooling with configurable limits
 * - SSL/TLS support
 * - Connection validation and health checks
 * - Transaction management
 * - Load balancing for clusters
 * - Performance monitoring
 *
 * @example
 * ```typescript
 * const factory = new Neo4jPoolFactory();
 * const driver = await factory.createConnection({
 *   type: 'neo4j',
 *   uri: 'neo4j://localhost:7687',
 *   username: 'neo4j',
 *   password: 'password'
 * });
 * ```
 */
export class Neo4jPoolFactory implements PoolFactory<Driver> {
	readonly type = 'neo4j';
	private readonly logger: Logger;

	constructor() {
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
	}

	/**
	 * Create a new Neo4j driver connection
	 */
	async createConnection(config: PoolConfig): Promise<Driver> {
		const neo4jConfig = config as Neo4jPoolConfig;

		if (neo4jConfig.type !== 'neo4j') {
			throw new Error(`Invalid config type for Neo4j factory: ${neo4jConfig.type}`);
		}

		const uri = this.buildConnectionUri(neo4jConfig);
		const auth = neo4j.auth.basic(neo4jConfig.username, neo4jConfig.password);
		const driverConfig = this.buildDriverConfig(neo4jConfig);

		this.logger.debug('Creating Neo4j driver with config:', {
			uri,
			username: neo4jConfig.username,
			database: neo4jConfig.database,
			encrypted: neo4jConfig.encrypted,
			maxConnectionPoolSize: driverConfig.maxConnectionPoolSize,
			connectionAcquisitionTimeout: driverConfig.connectionAcquisitionTimeout,
		});

		const driver = neo4j.driver(uri, auth, driverConfig);

		// Test connection
		try {
			await driver.verifyConnectivity();
			this.logger.debug('Neo4j driver connection test successful');
		} catch (error) {
			this.logger.error('Neo4j driver connection test failed:', error);
			await driver.close();
			throw error;
		}

		return driver;
	}

	/**
	 * Validate if a Neo4j driver is healthy
	 */
	async validateConnection(driver: Driver): Promise<boolean> {
		try {
			// Test connectivity with timeout
			await Promise.race([
				driver.verifyConnectivity(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Connectivity check timeout')), 5000)
				),
			]);

			// Additional health check with a simple query
			const session = driver.session();
			try {
				const result = await Promise.race([
					session.run('RETURN 1 as health_check'),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error('Health query timeout')), 3000)
					),
				]);

				const isValid = result && result.records && result.records.length > 0 &&
					result.records[0].get('health_check').toNumber() === 1;

				if (!isValid) {
					this.logger.warn('Neo4j health check returned unexpected result:', result);
				}

				return isValid;
			} finally {
				await session.close();
			}
		} catch (error) {
			this.logger.warn('Neo4j connection validation failed:', error);
			return false;
		}
	}

	/**
	 * Destroy a Neo4j driver connection
	 */
	async destroyConnection(driver: Driver): Promise<void> {
		try {
			await driver.close();
			this.logger.debug('Neo4j driver destroyed successfully');
		} catch (error) {
			this.logger.error('Error destroying Neo4j driver:', error);
			throw error;
		}
	}

	/**
	 * Get default configuration for Neo4j drivers
	 */
	getDefaultConfig(): Partial<PoolConfig> {
		return {
			...DATABASE_DEFAULTS.neo4j,
			type: 'neo4j',
		};
	}

	/**
	 * Build Neo4j connection URI
	 */
	private buildConnectionUri(config: Neo4jPoolConfig): string {
		if (config.uri) {
			return config.uri;
		}

		const protocol = config.encrypted ? 'neo4j+s' : 'neo4j';
		const host = config.host || 'localhost';
		const port = config.port || 7687;

		return `${protocol}://${host}:${port}`;
	}

	/**
	 * Build Neo4j driver configuration
	 */
	private buildDriverConfig(config: Neo4jPoolConfig): Config {
		const driverConfig: Config = {
			// Connection pool settings
			maxConnectionPoolSize: config.max || 10,
			connectionAcquisitionTimeout: config.connectionAcquisitionTimeout || 60000,
			maxTransactionRetryTime: config.maxTransactionRetryTime || 15000,
			maxConnectionLifetime: config.maxConnectionLifetime || 3600000, // 1 hour
			connectionLivenessCheckTimeout: config.connectionLivenessCheckTimeout || 30000,

			// Trust settings
			encrypted: config.encrypted || false,
			trust: config.trustServerCertificate ? 'TRUST_ALL_CERTIFICATES' : 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES',

			// Logging
			logging: {
				level: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
				logger: (level, message) => {
					if (level === 'error') {
						this.logger.error(`Neo4j Driver: ${message}`);
					} else if (level === 'warn') {
						this.logger.warn(`Neo4j Driver: ${message}`);
					} else if (level === 'info') {
						this.logger.info(`Neo4j Driver: ${message}`);
					} else if (level === 'debug') {
						this.logger.debug(`Neo4j Driver: ${message}`);
					}
				},
			},

			// Resolver settings for routing
			resolver: (address: string) => [address], // Use default resolver
		};

		return driverConfig;
	}
}

/**
 * Singleton instance of Neo4j factory
 */
export const neo4jFactory = new Neo4jPoolFactory();