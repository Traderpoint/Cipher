import { Pool, PoolClient, PoolConfig as PgPoolConfig } from 'pg';
import { BaseConnectionPool, PoolConfig } from './connection-pool-manager.js';
import { logger } from '../logger/index.js';

export interface PostgresPoolConfig extends PoolConfig {
	connectionString?: string;
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
}

export class PostgresConnectionPool extends BaseConnectionPool<PoolClient> {
	private pgPool: Pool;

	constructor(config: PostgresPoolConfig, poolName = 'postgres') {
		super(config, poolName);

		const pgConfig: PgPoolConfig = {
			min: config.min,
			max: config.max,
			idleTimeoutMillis: config.idleTimeoutMillis,
			connectionTimeoutMillis: config.acquireTimeoutMillis,
			...(config.connectionString ? { connectionString: config.connectionString } : {
				host: config.host || 'localhost',
				port: config.port || 5432,
				database: config.database,
				user: config.user,
				password: config.password,
				ssl: config.ssl,
			}),
		};

		this.pgPool = new Pool(pgConfig);

		this.pgPool.on('error', (err) => {
			logger.error('PostgreSQL pool error', { error: err.message, poolName });
		});

		this.pgPool.on('connect', () => {
			logger.debug('PostgreSQL client connected', { poolName });
		});

		this.pgPool.on('remove', () => {
			logger.debug('PostgreSQL client removed', { poolName });
		});
	}

	async createResource(): Promise<PoolClient> {
		try {
			const client = await this.pgPool.connect();
			return client;
		} catch (error) {
			logger.error('Failed to create PostgreSQL connection', {
				error: error instanceof Error ? error.message : String(error),
				poolName: this.poolName
			});
			throw error;
		}
	}

	async destroyResource(client: PoolClient): Promise<void> {
		try {
			client.release();
		} catch (error) {
			logger.error('Failed to destroy PostgreSQL connection', {
				error: error instanceof Error ? error.message : String(error),
				poolName: this.poolName
			});
		}
	}

	async validateResource(client: PoolClient): Promise<boolean> {
		try {
			await client.query('SELECT 1');
			return true;
		} catch (error) {
			logger.debug('PostgreSQL connection validation failed', {
				error: error instanceof Error ? error.message : String(error),
				poolName: this.poolName
			});
			return false;
		}
	}

	async query(text: string, params?: any[]): Promise<any> {
		const client = await this.acquire();
		try {
			const result = await client.query(text, params);
			return result;
		} finally {
			await this.release(client);
		}
	}

	async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
		const client = await this.acquire();
		try {
			await client.query('BEGIN');
			const result = await callback(client);
			await client.query('COMMIT');
			return result;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			await this.release(client);
		}
	}

	async drain(): Promise<void> {
		await super.drain();
		await this.pgPool.end();
	}
}