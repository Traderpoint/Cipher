import { EventEmitter } from 'events';
import { logger } from '../logger/index.js';
import { metricsCollector } from '../monitoring/metrics-collector.js';

export interface PoolConfig {
	min: number;
	max: number;
	acquireTimeoutMillis: number;
	idleTimeoutMillis: number;
	reapIntervalMillis: number;
	createRetryIntervalMillis: number;
	createTimeoutMillis: number;
	destroyTimeoutMillis: number;
	maxUses: number;
	validateOnBorrow: boolean;
	validateOnReturn: boolean;
}

export interface PoolStats {
	size: number;
	available: number;
	borrowed: number;
	invalid: number;
	pending: number;
	max: number;
	min: number;
}

export abstract class BaseConnectionPool<T> extends EventEmitter {
	protected resources: Set<T> = new Set();
	protected available: T[] = [];
	protected pending: Promise<T>[] = [];
	protected borrowed: Set<T> = new Set();
	protected invalid: Set<T> = new Set();
	protected creating = 0;
	protected destroying = 0;

	constructor(protected config: PoolConfig, protected poolName: string) {
		super();
		this.startReaper();
	}

	abstract createResource(): Promise<T>;
	abstract destroyResource(resource: T): Promise<void>;
	abstract validateResource(resource: T): Promise<boolean>;

	async acquire(): Promise<T> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Acquire timeout after ${this.config.acquireTimeoutMillis}ms`));
			}, this.config.acquireTimeoutMillis);

			this.tryAcquire()
				.then(resource => {
					clearTimeout(timeout);
					resolve(resource);
				})
				.catch(error => {
					clearTimeout(timeout);
					reject(error);
				});
		});
	}

	private async tryAcquire(): Promise<T> {
		// Try to get available resource
		if (this.available.length > 0) {
			const resource = this.available.shift()!;
			if (this.config.validateOnBorrow && !(await this.validateResource(resource))) {
				this.markInvalid(resource);
				return this.tryAcquire();
			}
			this.borrowed.add(resource);
			this.emitStats();
			return resource;
		}

		// Create new resource if under max
		if (this.resources.size + this.creating < this.config.max) {
			return this.createAndBorrow();
		}

		// Wait for available resource
		await new Promise(resolve => setTimeout(resolve, 10));
		return this.tryAcquire();
	}

	private async createAndBorrow(): Promise<T> {
		this.creating++;
		try {
			const resource = await this.createResource();
			this.resources.add(resource);
			this.borrowed.add(resource);
			this.creating--;
			this.emitStats();
			logger.debug(`Created new resource in pool ${this.poolName}`);
			return resource;
		} catch (error) {
			this.creating--;
			logger.error(`Failed to create resource in pool ${this.poolName}`, { error });
			throw error;
		}
	}

	async release(resource: T): Promise<void> {
		if (!this.borrowed.has(resource)) {
			logger.warn(`Attempting to release resource not borrowed from pool ${this.poolName}`);
			return;
		}

		this.borrowed.delete(resource);

		if (this.config.validateOnReturn && !(await this.validateResource(resource))) {
			this.markInvalid(resource);
			return;
		}

		this.available.push(resource);
		this.emitStats();
	}

	private markInvalid(resource: T): void {
		this.borrowed.delete(resource);
		this.available = this.available.filter(r => r !== resource);
		this.invalid.add(resource);
		this.destroyResource(resource).catch(error => {
			logger.error(`Failed to destroy invalid resource in pool ${this.poolName}`, { error });
		});
		this.resources.delete(resource);
		this.invalid.delete(resource);
	}

	private startReaper(): void {
		setInterval(() => {
			this.reapIdleResources();
		}, this.config.reapIntervalMillis);
	}

	private async reapIdleResources(): Promise<void> {
		const now = Date.now();
		const toDestroy: T[] = [];

		// Keep minimum connections
		const surplus = this.available.length - this.config.min;
		if (surplus > 0) {
			toDestroy.push(...this.available.splice(0, surplus));
		}

		for (const resource of toDestroy) {
			this.resources.delete(resource);
			try {
				await this.destroyResource(resource);
			} catch (error) {
				logger.error(`Failed to destroy idle resource in pool ${this.poolName}`, { error });
			}
		}

		this.emitStats();
	}

	getStats(): PoolStats {
		return {
			size: this.resources.size,
			available: this.available.length,
			borrowed: this.borrowed.size,
			invalid: this.invalid.size,
			pending: this.creating,
			max: this.config.max,
			min: this.config.min,
		};
	}

	private emitStats(): void {
		const stats = this.getStats();
		this.emit('stats', stats);

		// Send to metrics collector
		metricsCollector.recordConnectionPoolStats(this.poolName, stats);
	}

	async drain(): Promise<void> {
		// Stop accepting new requests
		this.available.length = 0;

		// Wait for borrowed resources to be returned
		while (this.borrowed.size > 0) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// Destroy all resources
		for (const resource of this.resources) {
			try {
				await this.destroyResource(resource);
			} catch (error) {
				logger.error(`Failed to destroy resource during drain in pool ${this.poolName}`, { error });
			}
		}

		this.resources.clear();
		this.available.length = 0;
		this.borrowed.clear();
		this.invalid.clear();
	}
}

export class ConnectionPoolManager {
	private pools = new Map<string, BaseConnectionPool<any>>();
	private static instance: ConnectionPoolManager;

	static getInstance(): ConnectionPoolManager {
		if (!ConnectionPoolManager.instance) {
			ConnectionPoolManager.instance = new ConnectionPoolManager();
		}
		return ConnectionPoolManager.instance;
	}

	registerPool<T>(name: string, pool: BaseConnectionPool<T>): void {
		this.pools.set(name, pool);
		logger.info(`Registered connection pool: ${name}`);
	}

	getPool<T>(name: string): BaseConnectionPool<T> | undefined {
		return this.pools.get(name);
	}

	getAllStats(): Record<string, PoolStats> {
		const stats: Record<string, PoolStats> = {};
		for (const [name, pool] of this.pools) {
			stats[name] = pool.getStats();
		}
		return stats;
	}

	async drainAll(): Promise<void> {
		const drainPromises = Array.from(this.pools.values()).map(pool => pool.drain());
		await Promise.all(drainPromises);
		logger.info('Drained all connection pools');
	}
}

export const connectionPoolManager = ConnectionPoolManager.getInstance();