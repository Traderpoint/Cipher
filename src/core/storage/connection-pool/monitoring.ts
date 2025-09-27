/**
 * Connection Pool Monitoring and Metrics
 *
 * Comprehensive monitoring system for connection pools with metrics collection,
 * health monitoring, alerting, and performance tracking.
 *
 * @module storage/connection-pool/monitoring
 */

import { EventEmitter } from 'events';
import { createLogger, type Logger } from '../../logger/index.js';
import type {
	PoolStats,
	ConnectionMetadata,
	PoolConfig,
	UniversalPoolManager,
} from './types.js';

/**
 * Pool alert configuration
 */
export interface PoolAlertConfig {
	/** High connection usage threshold (percentage) */
	highUsageThreshold: number;
	/** Low connection availability threshold (absolute count) */
	lowAvailabilityThreshold: number;
	/** Maximum acceptable acquisition time (ms) */
	maxAcquisitionTime: number;
	/** Maximum acceptable error rate (percentage) */
	maxErrorRate: number;
	/** Health check failure threshold before alert */
	healthCheckFailureThreshold: number;
	/** Enable/disable alerting */
	enabled: boolean;
}

/**
 * Pool alert types
 */
export type PoolAlertType =
	| 'high_usage'
	| 'low_availability'
	| 'slow_acquisition'
	| 'high_error_rate'
	| 'health_check_failure'
	| 'pool_exhausted'
	| 'connection_leak';

/**
 * Pool alert
 */
export interface PoolAlert {
	type: PoolAlertType;
	poolKey: string;
	poolType: string;
	severity: 'warning' | 'error' | 'critical';
	message: string;
	timestamp: number;
	metadata: Record<string, any>;
}

/**
 * Aggregated metrics
 */
export interface AggregatedMetrics {
	/** Total pools being monitored */
	totalPools: number;
	/** Total connections across all pools */
	totalConnections: number;
	/** Total active connections */
	totalActiveConnections: number;
	/** Total waiting requests */
	totalWaitingRequests: number;
	/** Average acquisition time across all pools */
	avgAcquisitionTime: number;
	/** Overall health score (0-100) */
	healthScore: number;
	/** Connection efficiency ratio */
	connectionEfficiency: number;
	/** Pool utilization by type */
	utilizationByType: Record<string, number>;
	/** Error rates by pool type */
	errorRatesByType: Record<string, number>;
	/** Last update timestamp */
	lastUpdated: number;
}

/**
 * Performance metrics tracker
 */
interface PerformanceTracker {
	acquisitionTimes: number[];
	errorCounts: number;
	totalRequests: number;
	healthCheckFailures: number;
	lastResetTime: number;
}

/**
 * Pool Monitor
 *
 * Monitors individual connection pools and collects detailed metrics.
 * Tracks performance, health, and usage patterns for analysis and alerting.
 *
 * @example
 * ```typescript
 * const monitor = new PoolMonitor('postgres-main', alertConfig);
 * monitor.recordAcquisition(150); // 150ms acquisition time
 * monitor.recordError(new Error('Connection failed'));
 * monitor.recordHealthCheck(true);
 * ```
 */
export class PoolMonitor extends EventEmitter {
	private readonly poolKey: string;
	private readonly alertConfig: PoolAlertConfig;
	private readonly logger: Logger;
	private readonly performanceTracker: PerformanceTracker;
	private lastStats?: PoolStats;

	constructor(poolKey: string, alertConfig: PoolAlertConfig) {
		super();
		this.poolKey = poolKey;
		this.alertConfig = alertConfig;
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });

		this.performanceTracker = {
			acquisitionTimes: [],
			errorCounts: 0,
			totalRequests: 0,
			healthCheckFailures: 0,
			lastResetTime: Date.now(),
		};

		// Reset performance tracker periodically
		setInterval(() => this.resetPerformanceTracker(), 300000); // 5 minutes
	}

	/**
	 * Update pool statistics and check for alerts
	 */
	updateStats(stats: PoolStats): void {
		this.lastStats = stats;

		if (this.alertConfig.enabled) {
			this.checkAlerts(stats);
		}

		this.emit('statsUpdated', stats);
	}

	/**
	 * Record connection acquisition metrics
	 */
	recordAcquisition(acquisitionTime: number): void {
		this.performanceTracker.acquisitionTimes.push(acquisitionTime);
		this.performanceTracker.totalRequests++;

		// Keep only recent acquisition times (last 1000)
		if (this.performanceTracker.acquisitionTimes.length > 1000) {
			this.performanceTracker.acquisitionTimes = this.performanceTracker.acquisitionTimes.slice(-1000);
		}

		// Check for slow acquisition alert
		if (this.alertConfig.enabled && acquisitionTime > this.alertConfig.maxAcquisitionTime) {
			this.emitAlert({
				type: 'slow_acquisition',
				severity: acquisitionTime > this.alertConfig.maxAcquisitionTime * 2 ? 'error' : 'warning',
				message: `Slow connection acquisition: ${acquisitionTime}ms (threshold: ${this.alertConfig.maxAcquisitionTime}ms)`,
				metadata: { acquisitionTime, threshold: this.alertConfig.maxAcquisitionTime },
			});
		}
	}

	/**
	 * Record connection error
	 */
	recordError(error: Error): void {
		this.performanceTracker.errorCounts++;
		this.performanceTracker.totalRequests++;

		this.logger.warn(`Pool ${this.poolKey} connection error:`, error);

		// Check error rate
		if (this.alertConfig.enabled) {
			const errorRate = this.getErrorRate();
			if (errorRate > this.alertConfig.maxErrorRate) {
				this.emitAlert({
					type: 'high_error_rate',
					severity: errorRate > this.alertConfig.maxErrorRate * 2 ? 'critical' : 'error',
					message: `High error rate: ${errorRate.toFixed(2)}% (threshold: ${this.alertConfig.maxErrorRate}%)`,
					metadata: { errorRate, threshold: this.alertConfig.maxErrorRate, error: error.message },
				});
			}
		}
	}

	/**
	 * Record health check result
	 */
	recordHealthCheck(isHealthy: boolean): void {
		if (!isHealthy) {
			this.performanceTracker.healthCheckFailures++;

			if (this.alertConfig.enabled &&
				this.performanceTracker.healthCheckFailures >= this.alertConfig.healthCheckFailureThreshold) {
				this.emitAlert({
					type: 'health_check_failure',
					severity: 'error',
					message: `Health check failures exceeded threshold: ${this.performanceTracker.healthCheckFailures}`,
					metadata: {
						failures: this.performanceTracker.healthCheckFailures,
						threshold: this.alertConfig.healthCheckFailureThreshold
					},
				});
			}
		} else {
			// Reset failure count on successful health check
			this.performanceTracker.healthCheckFailures = 0;
		}
	}

	/**
	 * Get current performance metrics
	 */
	getPerformanceMetrics(): {
		avgAcquisitionTime: number;
		errorRate: number;
		requestRate: number;
		healthCheckFailures: number;
	} {
		const avgAcquisitionTime = this.performanceTracker.acquisitionTimes.length > 0
			? this.performanceTracker.acquisitionTimes.reduce((a, b) => a + b, 0) / this.performanceTracker.acquisitionTimes.length
			: 0;

		const timeSinceReset = Date.now() - this.performanceTracker.lastResetTime;
		const requestRate = this.performanceTracker.totalRequests / (timeSinceReset / 1000); // requests per second

		return {
			avgAcquisitionTime,
			errorRate: this.getErrorRate(),
			requestRate,
			healthCheckFailures: this.performanceTracker.healthCheckFailures,
		};
	}

	/**
	 * Get last recorded pool statistics
	 */
	getLastStats(): PoolStats | undefined {
		return this.lastStats;
	}

	// Private methods

	/**
	 * Check for various alert conditions
	 */
	private checkAlerts(stats: PoolStats): void {
		// High usage alert
		const usagePercentage = (stats.activeConnections / stats.totalConnections) * 100;
		if (usagePercentage > this.alertConfig.highUsageThreshold) {
			this.emitAlert({
				type: 'high_usage',
				severity: usagePercentage > this.alertConfig.highUsageThreshold * 1.2 ? 'error' : 'warning',
				message: `High pool usage: ${usagePercentage.toFixed(1)}% (threshold: ${this.alertConfig.highUsageThreshold}%)`,
				metadata: { usagePercentage, threshold: this.alertConfig.highUsageThreshold },
			});
		}

		// Low availability alert
		if (stats.idleConnections < this.alertConfig.lowAvailabilityThreshold) {
			this.emitAlert({
				type: 'low_availability',
				severity: stats.idleConnections === 0 ? 'critical' : 'warning',
				message: `Low connection availability: ${stats.idleConnections} idle connections (threshold: ${this.alertConfig.lowAvailabilityThreshold})`,
				metadata: { idleConnections: stats.idleConnections, threshold: this.alertConfig.lowAvailabilityThreshold },
			});
		}

		// Pool exhausted alert
		if (stats.idleConnections === 0 && stats.waitingRequests > 0) {
			this.emitAlert({
				type: 'pool_exhausted',
				severity: 'critical',
				message: `Pool exhausted: ${stats.waitingRequests} requests waiting, no idle connections`,
				metadata: { waitingRequests: stats.waitingRequests, totalConnections: stats.totalConnections },
			});
		}

		// Connection leak detection (high acquisition count relative to pool size)
		if (stats.totalAcquisitions > 0 && stats.activeConnections > stats.totalConnections * 0.9 &&
			stats.avgConnectionLifetime < 30000) { // connections living less than 30 seconds
			this.emitAlert({
				type: 'connection_leak',
				severity: 'warning',
				message: `Possible connection leak detected: high acquisition rate with short connection lifetimes`,
				metadata: {
					activeConnections: stats.activeConnections,
					totalConnections: stats.totalConnections,
					avgLifetime: stats.avgConnectionLifetime
				},
			});
		}
	}

	/**
	 * Emit an alert
	 */
	private emitAlert(alertData: Omit<PoolAlert, 'poolKey' | 'poolType' | 'timestamp'>): void {
		const alert: PoolAlert = {
			...alertData,
			poolKey: this.poolKey,
			poolType: this.lastStats?.type || 'unknown',
			timestamp: Date.now(),
		};

		this.logger.warn(`Pool alert [${alert.severity}]:`, alert);
		this.emit('alert', alert);
	}

	/**
	 * Calculate current error rate
	 */
	private getErrorRate(): number {
		if (this.performanceTracker.totalRequests === 0) return 0;
		return (this.performanceTracker.errorCounts / this.performanceTracker.totalRequests) * 100;
	}

	/**
	 * Reset performance tracker
	 */
	private resetPerformanceTracker(): void {
		this.performanceTracker.acquisitionTimes = [];
		this.performanceTracker.errorCounts = 0;
		this.performanceTracker.totalRequests = 0;
		this.performanceTracker.lastResetTime = Date.now();
		// Note: Don't reset healthCheckFailures to maintain state
	}
}

/**
 * Pool Monitoring System
 *
 * Centralized monitoring system that tracks all connection pools,
 * collects aggregated metrics, and provides alerting capabilities.
 *
 * Features:
 * - Multi-pool monitoring
 * - Aggregated metrics collection
 * - Real-time alerting
 * - Performance tracking
 * - Health scoring
 * - Trend analysis
 *
 * @example
 * ```typescript
 * const monitoring = new PoolMonitoringSystem();
 * monitoring.initialize(poolManager);
 *
 * monitoring.on('alert', (alert) => {
 *   console.log(`ALERT: ${alert.message}`);
 * });
 *
 * const metrics = monitoring.getAggregatedMetrics();
 * console.log(`Overall health score: ${metrics.healthScore}`);
 * ```
 */
export class PoolMonitoringSystem extends EventEmitter {
	private readonly logger: Logger;
	private readonly monitors: Map<string, PoolMonitor> = new Map();
	private poolManager?: UniversalPoolManager;
	private metricsTimer?: NodeJS.Timeout;
	private aggregatedMetrics?: AggregatedMetrics;

	constructor(
		private readonly alertConfig: PoolAlertConfig = {
			highUsageThreshold: 80,
			lowAvailabilityThreshold: 2,
			maxAcquisitionTime: 5000,
			maxErrorRate: 5,
			healthCheckFailureThreshold: 3,
			enabled: true,
		}
	) {
		super();
		this.logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
	}

	/**
	 * Initialize monitoring system with pool manager
	 */
	initialize(poolManager: UniversalPoolManager): void {
		this.poolManager = poolManager;

		// Listen to pool manager events
		poolManager.on('connectionCreated', (metadata: ConnectionMetadata) => {
			// Track connection creation
		});

		poolManager.on('connectionAcquired', (metadata: ConnectionMetadata) => {
			const monitor = this.getOrCreateMonitor(metadata.poolType);
			// Note: We'd need acquisition time from the pool manager
		});

		poolManager.on('connectionFailed', (error: Error, config: PoolConfig) => {
			const poolKey = this.generatePoolKey(config);
			const monitor = this.getOrCreateMonitor(poolKey);
			monitor.recordError(error);
		});

		poolManager.on('poolHealthCheck', (stats: PoolStats) => {
			const monitor = this.getOrCreateMonitor(stats.key);
			monitor.updateStats(stats);
			monitor.recordHealthCheck(stats.isHealthy);
		});

		// Start metrics collection
		this.startMetricsCollection();

		this.logger.info('Pool monitoring system initialized');
	}

	/**
	 * Get aggregated metrics across all pools
	 */
	getAggregatedMetrics(): AggregatedMetrics {
		if (!this.poolManager) {
			throw new Error('Monitoring system not initialized');
		}

		const allStats = this.poolManager.getAllStats();
		const statsList = Object.values(allStats);

		if (statsList.length === 0) {
			return {
				totalPools: 0,
				totalConnections: 0,
				totalActiveConnections: 0,
				totalWaitingRequests: 0,
				avgAcquisitionTime: 0,
				healthScore: 100,
				connectionEfficiency: 0,
				utilizationByType: {},
				errorRatesByType: {},
				lastUpdated: Date.now(),
			};
		}

		const totalConnections = statsList.reduce((sum, stats) => sum + stats.totalConnections, 0);
		const totalActiveConnections = statsList.reduce((sum, stats) => sum + stats.activeConnections, 0);
		const totalWaitingRequests = statsList.reduce((sum, stats) => sum + stats.waitingRequests, 0);

		// Calculate average acquisition time
		const acquisitionTimes = statsList.map(stats => stats.avgAcquisitionTime).filter(time => time > 0);
		const avgAcquisitionTime = acquisitionTimes.length > 0
			? acquisitionTimes.reduce((sum, time) => sum + time, 0) / acquisitionTimes.length
			: 0;

		// Calculate health score (0-100)
		const healthyPools = statsList.filter(stats => stats.isHealthy).length;
		const healthScore = statsList.length > 0 ? (healthyPools / statsList.length) * 100 : 100;

		// Calculate connection efficiency
		const connectionEfficiency = totalConnections > 0 ? (totalActiveConnections / totalConnections) * 100 : 0;

		// Calculate utilization by type
		const utilizationByType: Record<string, number> = {};
		const errorRatesByType: Record<string, number> = {};

		statsList.forEach(stats => {
			const utilization = stats.totalConnections > 0 ? (stats.activeConnections / stats.totalConnections) * 100 : 0;
			utilizationByType[stats.type] = (utilizationByType[stats.type] || 0) + utilization;

			const errorRate = stats.totalAcquisitions > 0 ? (stats.totalAcquisitionFailures / stats.totalAcquisitions) * 100 : 0;
			errorRatesByType[stats.type] = (errorRatesByType[stats.type] || 0) + errorRate;
		});

		this.aggregatedMetrics = {
			totalPools: statsList.length,
			totalConnections,
			totalActiveConnections,
			totalWaitingRequests,
			avgAcquisitionTime,
			healthScore,
			connectionEfficiency,
			utilizationByType,
			errorRatesByType,
			lastUpdated: Date.now(),
		};

		return this.aggregatedMetrics;
	}

	/**
	 * Get monitor for specific pool
	 */
	getPoolMonitor(poolKey: string): PoolMonitor | undefined {
		return this.monitors.get(poolKey);
	}

	/**
	 * Get all active monitors
	 */
	getAllMonitors(): Map<string, PoolMonitor> {
		return new Map(this.monitors);
	}

	/**
	 * Update alert configuration
	 */
	updateAlertConfig(config: Partial<PoolAlertConfig>): void {
		Object.assign(this.alertConfig, config);
		this.logger.info('Pool alert configuration updated', config);
	}

	/**
	 * Shutdown monitoring system
	 */
	shutdown(): void {
		if (this.metricsTimer) {
			clearInterval(this.metricsTimer);
		}

		this.monitors.clear();
		this.logger.info('Pool monitoring system shut down');
	}

	// Private methods

	/**
	 * Get or create monitor for a pool
	 */
	private getOrCreateMonitor(poolKey: string): PoolMonitor {
		let monitor = this.monitors.get(poolKey);
		if (!monitor) {
			monitor = new PoolMonitor(poolKey, this.alertConfig);

			// Forward alerts
			monitor.on('alert', (alert: PoolAlert) => {
				this.emit('alert', alert);
			});

			this.monitors.set(poolKey, monitor);
		}
		return monitor;
	}

	/**
	 * Generate pool key from config
	 */
	private generatePoolKey(config: PoolConfig): string {
		// Simple implementation - in practice, should match the pool manager's key generation
		return `${config.type}-${config.host || 'default'}`;
	}

	/**
	 * Start metrics collection timer
	 */
	private startMetricsCollection(): void {
		this.metricsTimer = setInterval(() => {
			try {
				this.aggregatedMetrics = this.getAggregatedMetrics();
				this.emit('metricsUpdated', this.aggregatedMetrics);
			} catch (error) {
				this.logger.error('Error collecting aggregated metrics:', error);
			}
		}, 30000); // Collect metrics every 30 seconds
	}
}

/**
 * Default alert configuration
 */
export const DEFAULT_ALERT_CONFIG: PoolAlertConfig = {
	highUsageThreshold: 80,
	lowAvailabilityThreshold: 2,
	maxAcquisitionTime: 5000,
	maxErrorRate: 5,
	healthCheckFailureThreshold: 3,
	enabled: true,
};

/**
 * Singleton monitoring system instance
 */
export const poolMonitoringSystem = new PoolMonitoringSystem();

/**
 * Initialize pool monitoring
 */
export const initializePoolMonitoring = (poolManager: UniversalPoolManager): void => {
	poolMonitoringSystem.initialize(poolManager);
};