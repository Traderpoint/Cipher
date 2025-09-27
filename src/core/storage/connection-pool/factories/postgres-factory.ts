/**
 * PostgreSQL Pool Factory
 *
 * Factory implementation for creating and managing PostgreSQL connections
 * with optimized pool configuration and health checking.
 *
 * @module storage/connection-pool/factories/postgres-factory
 */

import { Pool, type PoolClient, type PoolConfig as PgPoolConfig } from 'pg';
import { createLogger, type Logger } from '../../../logger/index.js';
import type { PoolFactory, PoolConfig, PostgresPoolConfig, DATABASE_DEFAULTS } from '../types.js';

/**
 * PostgreSQL Pool Factory
 *
 * Creates and manages PostgreSQL connections using the node-postgres library.
 * Provides optimized configuration, connection validation, and health checking.
 *
 * Features:
 * - Connection pooling with configurable limits
 * - SSL/TLS support
 * - Connection validation and health checks
 * - Prepared statement support
 * - Transaction management
 * - Performance monitoring
 *
 * @example
 * ```typescript
 * const factory = new PostgresPoolFactory();
 * const connection = await factory.createConnection({
 *   type: 'postgres',
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'myapp',
 *   user: 'postgres',
 *   password: 'secret'
 * });
 * ```
 */
export class PostgresPoolFactory implements PoolFactory<Pool> {
	readonly type = 'postgres';
	private readonly logger: Logger;

	constructor() {
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
	}

	/**
	 * Create a new PostgreSQL pool connection
	 */
	async createConnection(config: PoolConfig): Promise<Pool> {
		const pgConfig = config as PostgresPoolConfig;

		if (pgConfig.type !== 'postgres') {
			throw new Error(`Invalid config type for PostgreSQL factory: ${pgConfig.type}`);
		}

		const poolConfig = this.buildPoolConfig(pgConfig);

		this.logger.debug('Creating PostgreSQL pool with config:', {
			host: poolConfig.host,
			port: poolConfig.port,
			database: poolConfig.database,
			user: poolConfig.user,
			ssl: !!poolConfig.ssl,
			max: poolConfig.max,
			min: poolConfig.min,
		});

		const pool = new Pool(poolConfig);

		// Set up error handlers
		pool.on('error', (err, client) => {
			this.logger.error('PostgreSQL pool error:', err);
			this.logger.debug('Error occurred on client:', { client: !!client });
		});

		pool.on('connect', (client) => {
			this.logger.debug('PostgreSQL client connected');

			// Set up client error handler
			client.on('error', (err) => {
				this.logger.error('PostgreSQL client error:', err);
			});
		});

		pool.on('acquire', (client) => {
			this.logger.debug('PostgreSQL client acquired from pool');
		});

		pool.on('remove', (client) => {
			this.logger.debug('PostgreSQL client removed from pool');
		});

		// Test the pool connection
		try {
			const client = await pool.connect();
			try {
				await client.query('SELECT 1');
				this.logger.debug('PostgreSQL pool connection test successful');
			} finally {
				client.release();
			}
		} catch (error) {
			this.logger.error('PostgreSQL pool connection test failed:', error);
			await pool.end();
			throw error;
		}

		return pool;
	}

	/**
	 * Validate if a PostgreSQL pool is healthy
	 */
	async validateConnection(pool: Pool): Promise<boolean> {
		try {
			const client = await Promise.race([
				pool.connect(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Connection timeout')), 5000)
				),
			]);

			try {
				const result = await Promise.race([
					client.query('SELECT 1 as health_check'),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error('Query timeout')), 3000)
					),
				]);

				const isValid = result && result.rows && result.rows.length > 0 && result.rows[0].health_check === 1;

				if (!isValid) {
					this.logger.warn('PostgreSQL health check returned unexpected result:', result);
				}

				return isValid;
			} finally {
				client.release();
			}
		} catch (error) {
			this.logger.warn('PostgreSQL connection validation failed:', error);
			return false;
		}
	}

	/**
	 * Destroy a PostgreSQL pool
	 */
	async destroyConnection(pool: Pool): Promise<void> {
		try {
			await pool.end();
			this.logger.debug('PostgreSQL pool destroyed successfully');
		} catch (error) {
			this.logger.error('Error destroying PostgreSQL pool:', error);
			throw error;
		}
	}

	/**
	 * Get default configuration for PostgreSQL pools
	 */
	getDefaultConfig(): Partial<PoolConfig> {
		return {
			...DATABASE_DEFAULTS.postgres,
			type: 'postgres',
		};
	}

	/**
	 * Build PostgreSQL pool configuration
	 */
	private buildPoolConfig(config: PostgresPoolConfig): PgPoolConfig {
		// If URL is provided, use it
		if (config.url) {
			return {
				connectionString: config.url,
				max: config.max || 20,
				min: config.min || 2,
				idleTimeoutMillis: config.idleTimeoutMs || 30000,
				connectionTimeoutMillis: config.acquireTimeoutMs || 10000,
				ssl: config.ssl,
				application_name: config.application_name || 'cipher-project',
				statement_timeout: config.statement_timeout || 30000,
				query_timeout: config.query_timeout || 30000,
				keepAlive: config.keepAlive !== false,
				keepAliveInitialDelayMillis: config.keepAliveInitialDelayMillis || 10000,
			};
		}

		// Build from individual parameters
		return {
			host: config.host || 'localhost',
			port: config.port || 5432,
			database: config.database,
			user: config.user,
			password: config.password,
			max: config.max || 20,
			min: config.min || 2,
			idleTimeoutMillis: config.idleTimeoutMs || 30000,
			connectionTimeoutMillis: config.acquireTimeoutMs || 10000,
			ssl: config.ssl,
			application_name: config.application_name || 'cipher-project',
			statement_timeout: config.statement_timeout || 30000,
			query_timeout: config.query_timeout || 30000,
			keepAlive: config.keepAlive !== false,
			keepAliveInitialDelayMillis: config.keepAliveInitialDelayMillis || 10000,
		};
	}
}

/**
 * Singleton instance of PostgreSQL factory
 */
export const postgresFactory = new PostgresPoolFactory();