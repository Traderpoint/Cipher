/**
 * Base Connection Pool Implementation
 *
 * Generic connection pool implementation that works with any database type
 * through the factory pattern. Provides connection lifecycle management,
 * health monitoring, and performance optimization.
 *
 * @module storage/connection-pool/base-pool
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger, type Logger } from '../../logger/index.js';
import type {
	ConnectionPool,
	PooledConnection,
	PoolConfig,
	PoolFactory,
	PoolStats,
	ConnectionMetadata,
} from './types.js';
import { DEFAULT_POOL_CONFIG } from './types.js';

/**
 * Connection queue item for managing acquisition requests
 */
interface QueueItem<T> {
	resolve: (connection: PooledConnection<T>) => void;
	reject: (error: Error) => void;
	requestedAt: number;
	timeoutId: NodeJS.Timeout;
}

/**
 * Internal connection wrapper
 */
interface InternalConnection<T> {
	connection: T;
	metadata: ConnectionMetadata;
	healthCheckPromise?: Promise<boolean>;
}

/**
 * Base Connection Pool Implementation
 *
 * Provides a robust, production-ready connection pool that supports:
 * - Connection lifecycle management
 * - Health monitoring and validation
 * - Automatic connection recovery
 * - Performance metrics and statistics
 * - Resource cleanup and graceful shutdown
 * - Queue management for connection requests
 *
 * @example
 * ```typescript
 * const pool = new BaseConnectionPool(config, factory, 'postgres-pool');
 * await pool.initialize();
 *
 * const connection = await pool.acquire();
 * try {
 *   // Use connection
 *   const result = await connection.connection.query('SELECT NOW()');
 * } finally {
 *   connection.release();
 * }
 * ```
 */
export class BaseConnectionPool<T = any> extends EventEmitter implements ConnectionPool<T> {
	readonly config: PoolConfig;
	private readonly factory: PoolFactory<T>;
	private readonly poolKey: string;
	private readonly logger: Logger;

	// Pool state
	private initialized = false;
	private draining = false;
	private isShutdown = false;

	// Connection management
	private readonly connections: Set<InternalConnection<T>> = new Set();
	private readonly idleConnections: InternalConnection<T>[] = [];
	private readonly activeConnections: Set<InternalConnection<T>> = new Set();
	private readonly queue: QueueItem<T>[] = [];

	// Statistics tracking
	private poolStats = {
		totalCreated: 0,
		totalDestroyed: 0,
		totalAcquisitions: 0,
		totalAcquisitionFailures: 0,
		acquisitionTimes: [] as number[],
		connectionLifetimes: [] as number[],
		lastHealthCheck: 0,
		poolStartTime: Date.now(),
	};

	// Timers
	private healthCheckTimer?: NodeJS.Timeout;
	private idleCheckTimer?: NodeJS.Timeout;

	constructor(config: PoolConfig, factory: PoolFactory<T>, poolKey: string) {
		super();
		this.config = { ...DEFAULT_POOL_CONFIG, ...config };
		this.factory = factory;
		this.poolKey = poolKey;
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });

		if (this.config.enableLogging) {
			this.logger.debug(`Created connection pool: ${poolKey}`, { config: this.config });
		}
	}

	/**
	 * Pool statistics getter
	 */
	get stats(): PoolStats {
		return this.getStats();
	}

	/**
	 * Check if pool is initialized
	 */
	get isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Initialize the pool with minimum connections
	 */
	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		this.logger.debug(`Initializing pool ${this.poolKey} with min ${this.config.min} connections`);

		// Create minimum connections
		const minConnections = this.config.min || 0;
		const initPromises: Promise<void>[] = [];

		for (let i = 0; i < minConnections; i++) {
			initPromises.push(this.createConnection().then(() => {}));
		}

		await Promise.allSettled(initPromises);

		// Start maintenance timers
		this.startHealthCheckTimer();
		this.startIdleCheckTimer();

		this.initialized = true;
		this.logger.info(`Pool ${this.poolKey} initialized with ${this.connections.size} connections`);
	}

	/**
	 * Acquire a connection from the pool
	 */
	async acquire(): Promise<PooledConnection<T>> {
		if (this.isShutdown) {
			throw new Error(`Pool ${this.poolKey} is shut down`);
		}

		if (this.draining) {
			throw new Error(`Pool ${this.poolKey} is draining`);
		}

		const startTime = Date.now();

		// Try to get an idle connection first
		const idleConnection = this.getIdleConnection();
		if (idleConnection) {
			return this.activateConnection(idleConnection, startTime);
		}

		// Create new connection if under max limit
		if (this.connections.size < (this.config.max || 20)) {
			try {
				const newConnection = await this.createConnection();
				return this.activateConnection(newConnection, startTime);
			} catch (error) {
				this.poolStats.totalAcquisitionFailures++;
				this.emit('connectionFailed', error, this.config);
				throw error;
			}
		}

		// Queue the request if at max capacity
		return this.queueAcquisition(startTime);
	}

	/**
	 * Release a connection back to the pool
	 */
	async release(pooledConnection: PooledConnection<T>): Promise<void> {
		const internalConnection = this.findInternalConnection(pooledConnection.connection);
		if (!internalConnection) {
			this.logger.warn(`Attempted to release unknown connection in pool ${this.poolKey}`);
			return;
		}

		// Remove from active connections
		this.activeConnections.delete(internalConnection);

		// Update metadata
		internalConnection.metadata.inUse = false;
		internalConnection.metadata.lastUsedAt = Date.now();

		// Validate connection if configured
		let isValid = true;
		if (this.config.validateOnReturn) {
			try {
				isValid = await this.factory.validateConnection(internalConnection.connection);
				internalConnection.metadata.isHealthy = isValid;
			} catch (error) {
				this.logger.warn(`Connection validation failed on return in pool ${this.poolKey}:`, error);
				isValid = false;
				internalConnection.metadata.isHealthy = false;
			}
		}

		if (!isValid || this.shouldDestroyConnection(internalConnection)) {
			await this.destroyConnection(internalConnection);
			this.processQueue(); // Try to fulfill queued requests
			return;
		}

		// Return to idle pool
		this.idleConnections.push(internalConnection);
		this.emit('connectionReleased', internalConnection.metadata);

		// Process queued requests
		this.processQueue();
	}

	/**
	 * Destroy a specific connection
	 */
	async destroy(pooledConnection: PooledConnection<T>): Promise<void> {
		const internalConnection = this.findInternalConnection(pooledConnection.connection);
		if (internalConnection) {
			await this.destroyConnection(internalConnection);
		}
	}

	/**
	 * Drain the pool (stop accepting new requests)
	 */
	async drain(): Promise<void> {
		this.draining = true;
		this.logger.info(`Draining pool ${this.poolKey}`);

		// Reject all queued requests
		while (this.queue.length > 0) {
			const item = this.queue.shift()!;
			clearTimeout(item.timeoutId);
			item.reject(new Error('Pool is draining'));
		}

		// Wait for active connections to be released
		while (this.activeConnections.size > 0) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		this.emit('poolDrained');
		this.logger.info(`Pool ${this.poolKey} drained`);
	}

	/**
	 * Clear all connections from the pool
	 */
	async clear(): Promise<void> {
		this.logger.info(`Clearing all connections from pool ${this.poolKey}`);

		// Clear idle connections
		const idleConnections = [...this.idleConnections];
		this.idleConnections.length = 0;

		for (const connection of idleConnections) {
			await this.destroyConnection(connection);
		}

		// Note: Active connections will be destroyed when released
		this.logger.info(`Cleared ${idleConnections.length} idle connections from pool ${this.poolKey}`);
	}

	/**
	 * Shutdown the pool completely
	 */
	async shutdown(): Promise<void> {
		if (this.isShutdown) {
			return;
		}

		this.isShutdown = true;
		this.logger.info(`Shutting down pool ${this.poolKey}`);

		// Stop timers
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
		}
		if (this.idleCheckTimer) {
			clearInterval(this.idleCheckTimer);
		}

		// Drain first
		if (!this.draining) {
			await this.drain();
		}

		// Destroy all connections
		const allConnections = [...this.connections];
		const destroyPromises = allConnections.map(conn => this.destroyConnection(conn));
		await Promise.allSettled(destroyPromises);

		this.emit('poolShutdown');
		this.logger.info(`Pool ${this.poolKey} shut down completely`);
	}

	/**
	 * Perform health checks on connections
	 */
	async healthCheck(): Promise<void> {
		if (this.isShutdown) {
			return;
		}

		const healthCheckStart = Date.now();
		const unhealthyConnections: InternalConnection<T>[] = [];

		// Check all connections
		const healthPromises = Array.from(this.connections).map(async connection => {
			if (connection.healthCheckPromise) {
				// Health check already in progress
				return connection.healthCheckPromise;
			}

			connection.healthCheckPromise = this.factory.validateConnection(connection.connection);

			try {
				const isHealthy = await connection.healthCheckPromise;
				connection.metadata.isHealthy = isHealthy;

				if (!isHealthy) {
					unhealthyConnections.push(connection);
				}

				return isHealthy;
			} catch (error) {
				this.logger.warn(`Health check failed for connection ${connection.metadata.id}:`, error);
				connection.metadata.isHealthy = false;
				unhealthyConnections.push(connection);
				return false;
			} finally {
				delete connection.healthCheckPromise;
			}
		});

		await Promise.allSettled(healthPromises);

		// Remove unhealthy connections
		for (const connection of unhealthyConnections) {
			if (!this.activeConnections.has(connection)) {
				// Only destroy idle unhealthy connections
				await this.destroyConnection(connection);
			}
		}

		this.poolStats.lastHealthCheck = Date.now();

		if (this.config.enableLogging) {
			this.logger.debug(
				`Health check completed for pool ${this.poolKey} in ${Date.now() - healthCheckStart}ms`,
				{
					totalConnections: this.connections.size,
					unhealthyConnections: unhealthyConnections.length,
				}
			);
		}
	}

	/**
	 * Get current pool statistics
	 */
	getStats(): PoolStats {
		const now = Date.now();
		const avgAcquisitionTime =
			this.poolStats.acquisitionTimes.length > 0
				? this.poolStats.acquisitionTimes.reduce((a, b) => a + b, 0) / this.poolStats.acquisitionTimes.length
				: 0;
		const avgConnectionLifetime =
			this.poolStats.connectionLifetimes.length > 0
				? this.poolStats.connectionLifetimes.reduce((a, b) => a + b, 0) / this.poolStats.connectionLifetimes.length
				: 0;

		return {
			type: this.config.type,
			key: this.poolKey,
			totalConnections: this.connections.size,
			activeConnections: this.activeConnections.size,
			idleConnections: this.idleConnections.length,
			waitingRequests: this.queue.length,
			totalCreated: this.poolStats.totalCreated,
			totalDestroyed: this.poolStats.totalDestroyed,
			totalAcquisitions: this.poolStats.totalAcquisitions,
			totalAcquisitionFailures: this.poolStats.totalAcquisitionFailures,
			avgAcquisitionTime,
			avgConnectionLifetime,
			isHealthy: this.getHealthStatus(),
			lastHealthCheck: this.poolStats.lastHealthCheck,
			uptime: now - this.poolStats.poolStartTime,
		};
	}

	// Private methods

	/**
	 * Create a new connection
	 */
	private async createConnection(): Promise<InternalConnection<T>> {
		const createStartTime = Date.now();
		const connectionId = randomUUID();

		try {
			const connection = await Promise.race([
				this.factory.createConnection(this.config),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Connection creation timeout')), this.config.createTimeoutMs || 10000)
				),
			]);

			const metadata: ConnectionMetadata = {
				id: connectionId,
				createdAt: createStartTime,
				lastUsedAt: createStartTime,
				acquisitionCount: 0,
				isHealthy: true,
				inUse: false,
				poolType: this.config.type,
				metadata: {},
			};

			const internalConnection: InternalConnection<T> = {
				connection,
				metadata,
			};

			this.connections.add(internalConnection);
			this.poolStats.totalCreated++;

			this.emit('connectionCreated', metadata);

			if (this.config.enableLogging) {
				this.logger.debug(
					`Created connection ${connectionId} in pool ${this.poolKey} (${Date.now() - createStartTime}ms)`
				);
			}

			return internalConnection;
		} catch (error) {
			this.logger.error(`Failed to create connection in pool ${this.poolKey}:`, error);
			throw error;
		}
	}

	/**
	 * Destroy a connection
	 */
	private async destroyConnection(internalConnection: InternalConnection<T>): Promise<void> {
		const { metadata } = internalConnection;

		try {
			// Remove from all collections
			this.connections.delete(internalConnection);
			this.activeConnections.delete(internalConnection);
			const idleIndex = this.idleConnections.indexOf(internalConnection);
			if (idleIndex !== -1) {
				this.idleConnections.splice(idleIndex, 1);
			}

			// Destroy the actual connection
			await this.factory.destroyConnection(internalConnection.connection);

			// Update statistics
			this.poolStats.totalDestroyed++;
			this.poolStats.connectionLifetimes.push(Date.now() - metadata.createdAt);

			// Keep only recent statistics (last 1000 entries)
			if (this.poolStats.connectionLifetimes.length > 1000) {
				this.poolStats.connectionLifetimes = this.poolStats.connectionLifetimes.slice(-1000);
			}

			this.emit('connectionDestroyed', metadata);

			if (this.config.enableLogging) {
				this.logger.debug(`Destroyed connection ${metadata.id} in pool ${this.poolKey}`);
			}
		} catch (error) {
			this.logger.error(`Error destroying connection ${metadata.id} in pool ${this.poolKey}:`, error);
		}
	}

	/**
	 * Get an idle connection if available
	 */
	private getIdleConnection(): InternalConnection<T> | null {
		// Remove expired connections
		const now = Date.now();
		const maxLifetime = this.config.maxLifetimeMs || 300000;

		while (this.idleConnections.length > 0) {
			const connection = this.idleConnections[0];
			if (!connection) break;

			if (now - connection.metadata.createdAt > maxLifetime || !connection.metadata.isHealthy) {
				this.idleConnections.shift();
				this.destroyConnection(connection);
				continue;
			}

			// Validate connection if configured
			if (this.config.validateOnAcquire) {
				// We'll validate asynchronously, so return null and let acquire create a new one
				return null;
			}

			return this.idleConnections.shift()!;
		}

		return null;
	}

	/**
	 * Activate a connection for use
	 */
	private async activateConnection(
		internalConnection: InternalConnection<T>,
		acquisitionStartTime: number
	): Promise<PooledConnection<T>> {
		const { metadata } = internalConnection;

		// Validate connection if configured
		if (this.config.validateOnAcquire) {
			try {
				const isValid = await this.factory.validateConnection(internalConnection.connection);
				if (!isValid) {
					await this.destroyConnection(internalConnection);
					throw new Error('Connection validation failed');
				}
				metadata.isHealthy = true;
			} catch (error) {
				await this.destroyConnection(internalConnection);
				throw error;
			}
		}

		// Update metadata
		metadata.inUse = true;
		metadata.lastUsedAt = Date.now();
		metadata.acquisitionCount++;

		// Add to active connections
		this.activeConnections.add(internalConnection);

		// Update statistics
		this.poolStats.totalAcquisitions++;
		const acquisitionTime = Date.now() - acquisitionStartTime;
		this.poolStats.acquisitionTimes.push(acquisitionTime);

		// Keep only recent statistics (last 1000 entries)
		if (this.poolStats.acquisitionTimes.length > 1000) {
			this.poolStats.acquisitionTimes = this.poolStats.acquisitionTimes.slice(-1000);
		}

		this.emit('connectionAcquired', metadata);

		// Create pooled connection wrapper
		const pooledConnection: PooledConnection<T> = {
			connection: internalConnection.connection,
			metadata: { ...metadata },
			release: () => this.release(pooledConnection),
			destroy: () => this.destroy(pooledConnection),
		};

		return pooledConnection;
	}

	/**
	 * Queue an acquisition request
	 */
	private async queueAcquisition(acquisitionStartTime: number): Promise<PooledConnection<T>> {
		return new Promise<PooledConnection<T>>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const index = this.queue.findIndex(item => item.resolve === resolve);
				if (index !== -1) {
					this.queue.splice(index, 1);
				}
				this.poolStats.totalAcquisitionFailures++;
				reject(new Error(`Acquisition timeout after ${this.config.acquireTimeoutMs}ms`));
			}, this.config.acquireTimeoutMs || 10000);

			const queueItem: QueueItem<T> = {
				resolve,
				reject,
				requestedAt: acquisitionStartTime,
				timeoutId,
			};

			this.queue.push(queueItem);
		});
	}

	/**
	 * Process queued acquisition requests
	 */
	private processQueue(): void {
		while (this.queue.length > 0 && this.idleConnections.length > 0) {
			const queueItem = this.queue.shift()!;
			const idleConnection = this.idleConnections.shift()!;

			clearTimeout(queueItem.timeoutId);

			this.activateConnection(idleConnection, queueItem.requestedAt)
				.then(queueItem.resolve)
				.catch(queueItem.reject);
		}
	}

	/**
	 * Find internal connection by connection object
	 */
	private findInternalConnection(connection: T): InternalConnection<T> | undefined {
		for (const internalConnection of this.connections) {
			if (internalConnection.connection === connection) {
				return internalConnection;
			}
		}
		return undefined;
	}

	/**
	 * Check if a connection should be destroyed
	 */
	private shouldDestroyConnection(internalConnection: InternalConnection<T>): boolean {
		const now = Date.now();
		const maxLifetime = this.config.maxLifetimeMs || 300000;
		const maxIdleTime = this.config.idleTimeoutMs || 30000;

		return (
			now - internalConnection.metadata.createdAt > maxLifetime ||
			now - internalConnection.metadata.lastUsedAt > maxIdleTime ||
			!internalConnection.metadata.isHealthy
		);
	}

	/**
	 * Get overall pool health status
	 */
	private getHealthStatus(): boolean {
		const totalConnections = this.connections.size;
		const healthyConnections = Array.from(this.connections).filter(conn => conn.metadata.isHealthy).length;

		// Consider pool healthy if at least 50% of connections are healthy
		return totalConnections === 0 || healthyConnections / totalConnections >= 0.5;
	}

	/**
	 * Start health check timer
	 */
	private startHealthCheckTimer(): void {
		const interval = this.config.healthCheckIntervalMs || 60000;

		this.healthCheckTimer = setInterval(async () => {
			try {
				await this.healthCheck();
			} catch (error) {
				this.logger.error(`Error during health check in pool ${this.poolKey}:`, error);
			}
		}, interval);
	}

	/**
	 * Start idle connection check timer
	 */
	private startIdleCheckTimer(): void {
		const interval = Math.min(this.config.idleTimeoutMs || 30000, 30000);

		this.idleCheckTimer = setInterval(() => {
			this.cleanupIdleConnections();
		}, interval);
	}

	/**
	 * Cleanup expired idle connections
	 */
	private cleanupIdleConnections(): void {
		const now = Date.now();
		const idleTimeout = this.config.idleTimeoutMs || 30000;
		const minConnections = this.config.min || 0;

		let removed = 0;
		while (this.idleConnections.length > minConnections) {
			const connection = this.idleConnections[0];
			if (!connection) break;

			if (now - connection.metadata.lastUsedAt > idleTimeout) {
				this.idleConnections.shift();
				this.destroyConnection(connection);
				removed++;
			} else {
				break; // Connections are ordered by last used time
			}
		}

		if (removed > 0 && this.config.enableLogging) {
			this.logger.debug(`Cleaned up ${removed} idle connections from pool ${this.poolKey}`);
		}
	}
}