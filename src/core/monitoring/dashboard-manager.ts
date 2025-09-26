import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger/index.js';
import { metricsCollector } from './metrics-collector.js';
import { alertManager } from './alert-manager.js';
import { errorTracker } from './error-tracker.js';

export interface DashboardConfig {
	id: string;
	name: string;
	description?: string;
	version: string;
	createdAt: Date;
	updatedAt: Date;
	settings: {
		refreshInterval: number;
		enableAlerts: boolean;
		enableRealTimeUpdates: boolean;
		theme: 'light' | 'dark' | 'auto';
		defaultTimeRange: '1h' | '6h' | '24h' | '7d' | '30d';
		visiblePanels: string[];
	};
	alerts: {
		rules: any[];
		enabled: boolean;
	};
	customMetrics?: {
		name: string;
		query: string;
		type: 'gauge' | 'counter' | 'histogram';
	}[];
}

export interface HistoricalData {
	timestamp: Date;
	metrics: any;
	alerts: any[];
	errors: any[];
}

export class DashboardManager {
	private static instance: DashboardManager;
	private configPath: string;
	private dataPath: string;
	private historicalData: HistoricalData[] = [];
	private maxHistorySize = 10000; // Keep 10k data points
	private dataCollectionInterval: NodeJS.Timeout | null = null;

	private constructor() {
		this.configPath = process.env.CIPHER_MONITORING_CONFIG_PATH || './monitoring-data/configs';
		this.dataPath = process.env.CIPHER_MONITORING_DATA_PATH || './monitoring-data/historical';
		this.ensureDirectories();
	}

	static getInstance(): DashboardManager {
		if (!DashboardManager.instance) {
			DashboardManager.instance = new DashboardManager();
		}
		return DashboardManager.instance;
	}

	/**
	 * Start historical data collection
	 */
	startDataCollection(intervalMs: number = 60000): void {
		if (this.dataCollectionInterval) {
			this.stopDataCollection();
		}

		this.dataCollectionInterval = setInterval(() => {
			this.collectHistoricalData();
		}, intervalMs);

		logger.info('Dashboard historical data collection started', { intervalMs });
	}

	/**
	 * Stop historical data collection
	 */
	stopDataCollection(): void {
		if (this.dataCollectionInterval) {
			clearInterval(this.dataCollectionInterval);
			this.dataCollectionInterval = null;
		}
		logger.info('Dashboard historical data collection stopped');
	}

	/**
	 * Export dashboard configuration
	 */
	async exportDashboardConfig(configId: string): Promise<DashboardConfig> {
		const config = await this.getDashboardConfig(configId);
		if (!config) {
			throw new Error(`Dashboard config not found: ${configId}`);
		}

		// Include current alert rules
		config.alerts.rules = alertManager.getRules();

		logger.info('Dashboard config exported', { configId });
		return config;
	}

	/**
	 * Import dashboard configuration
	 */
	async importDashboardConfig(config: DashboardConfig): Promise<void> {
		// Validate config
		this.validateDashboardConfig(config);

		// Update timestamps
		config.updatedAt = new Date();

		// Save config
		await this.saveDashboardConfig(config);

		// Import alert rules if present
		if (config.alerts.rules && config.alerts.rules.length > 0) {
			for (const rule of config.alerts.rules) {
				alertManager.addRule(rule);
			}
		}

		logger.info('Dashboard config imported', { configId: config.id, configName: config.name });
	}

	/**
	 * Export historical data
	 */
	async exportHistoricalData(
		startDate: Date,
		endDate: Date,
		format: 'json' | 'csv' = 'json'
	): Promise<string> {
		const filteredData = this.historicalData.filter(
			data => data.timestamp >= startDate && data.timestamp <= endDate
		);

		if (format === 'csv') {
			return this.convertToCSV(filteredData);
		}

		const exportData = {
			exportedAt: new Date(),
			dateRange: { start: startDate, end: endDate },
			dataPoints: filteredData.length,
			data: filteredData
		};

		logger.info('Historical data exported', {
			format,
			dataPoints: filteredData.length,
			dateRange: { start: startDate, end: endDate }
		});

		return JSON.stringify(exportData, null, 2);
	}

	/**
	 * Get dashboard configuration
	 */
	async getDashboardConfig(configId: string): Promise<DashboardConfig | null> {
		try {
			const configFile = join(this.configPath, `${configId}.json`);
			if (!existsSync(configFile)) {
				return null;
			}

			const data = await readFile(configFile, 'utf-8');
			const config = JSON.parse(data);

			// Convert date strings back to Date objects
			config.createdAt = new Date(config.createdAt);
			config.updatedAt = new Date(config.updatedAt);

			return config;
		} catch (error) {
			logger.error('Error reading dashboard config', {
				configId,
				error: error instanceof Error ? error.message : String(error)
			});
			return null;
		}
	}

	/**
	 * Save dashboard configuration
	 */
	async saveDashboardConfig(config: DashboardConfig): Promise<void> {
		try {
			const configFile = join(this.configPath, `${config.id}.json`);
			await writeFile(configFile, JSON.stringify(config, null, 2));

			logger.info('Dashboard config saved', { configId: config.id });
		} catch (error) {
			logger.error('Error saving dashboard config', {
				configId: config.id,
				error: error instanceof Error ? error.message : String(error)
			});
			throw error;
		}
	}

	/**
	 * List available dashboard configurations
	 */
	async listDashboardConfigs(): Promise<{ id: string; name: string; updatedAt: Date }[]> {
		try {
			const { readdir } = await import('fs/promises');
			const files = await readdir(this.configPath);
			const configs = [];

			for (const file of files) {
				if (file.endsWith('.json')) {
					const configId = file.replace('.json', '');
					const config = await this.getDashboardConfig(configId);
					if (config) {
						configs.push({
							id: config.id,
							name: config.name,
							updatedAt: config.updatedAt
						});
					}
				}
			}

			return configs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
		} catch (error) {
			logger.error('Error listing dashboard configs', {
				error: error instanceof Error ? error.message : String(error)
			});
			return [];
		}
	}

	/**
	 * Create default dashboard configuration
	 */
	async createDefaultConfig(): Promise<DashboardConfig> {
		const config: DashboardConfig = {
			id: 'default',
			name: 'Default Dashboard',
			description: 'Default monitoring dashboard configuration',
			version: '1.0.0',
			createdAt: new Date(),
			updatedAt: new Date(),
			settings: {
				refreshInterval: 30000,
				enableAlerts: true,
				enableRealTimeUpdates: true,
				theme: 'auto',
				defaultTimeRange: '24h',
				visiblePanels: [
					'system-overview',
					'llm-metrics',
					'api-performance',
					'websocket-status',
					'memory-analytics',
					'error-tracking',
					'alerts'
				]
			},
			alerts: {
				rules: alertManager.getRules(),
				enabled: true
			},
			customMetrics: []
		};

		await this.saveDashboardConfig(config);
		return config;
	}

	/**
	 * Get historical data for charts
	 */
	getHistoricalData(hours: number = 24): HistoricalData[] {
		const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
		return this.historicalData.filter(data => data.timestamp >= cutoff);
	}

	/**
	 * Get dashboard summary stats
	 */
	getDashboardStats(): {
		totalDataPoints: number;
		oldestDataPoint?: Date;
		newestDataPoint?: Date;
		avgMetricsPerHour: number;
		totalConfigs: number;
	} {
		const stats: {
			totalDataPoints: number;
			oldestDataPoint?: Date;
			newestDataPoint?: Date;
			avgMetricsPerHour: number;
			totalConfigs: number;
		} = {
			totalDataPoints: this.historicalData.length,
			avgMetricsPerHour: 0,
			totalConfigs: 0
		};

		if (this.historicalData.length > 0) {
			stats.oldestDataPoint = this.historicalData[this.historicalData.length - 1]!.timestamp;
			stats.newestDataPoint = this.historicalData[0]!.timestamp;
		}

		if (stats.oldestDataPoint && stats.newestDataPoint) {
			const hoursDiff = (stats.newestDataPoint!.getTime() - stats.oldestDataPoint!.getTime()) / (1000 * 60 * 60);
			stats.avgMetricsPerHour = hoursDiff > 0 ? this.historicalData.length / hoursDiff : 0;
		}

		return stats;
	}

	/**
	 * Collect current metrics for historical tracking
	 */
	private collectHistoricalData(): void {
		try {
			const metrics = metricsCollector.getMetrics();
			const activeAlerts = alertManager.getActiveAlerts();
			const recentErrors = errorTracker.getRecentErrors(10);

			const dataPoint: HistoricalData = {
				timestamp: new Date(),
				metrics,
				alerts: activeAlerts,
				errors: recentErrors
			};

			// Add to beginning of array (newest first)
			this.historicalData.unshift(dataPoint);

			// Maintain size limit
			if (this.historicalData.length > this.maxHistorySize) {
				this.historicalData = this.historicalData.slice(0, this.maxHistorySize);
			}
		} catch (error) {
			logger.error('Error collecting historical data', {
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Convert historical data to CSV format
	 */
	private convertToCSV(data: HistoricalData[]): string {
		if (data.length === 0) return '';

		const headers = [
			'timestamp',
			'memory_percentage',
			'cpu_percentage',
			'api_total_requests',
			'websocket_active_connections',
			'llm_total_requests',
			'active_alerts_count',
			'total_errors'
		];

		const rows = data.map(point => [
			point.timestamp.toISOString(),
			point.metrics.system.memory.percentage,
			point.metrics.system.cpu.percentage,
			point.metrics.api.totalRequests,
			point.metrics.websocket.activeConnections,
			Object.values(point.metrics.llm).reduce((sum: number, llm: any) => sum + llm.totalRequests, 0),
			point.alerts.length,
			point.errors.length
		]);

		return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
	}

	/**
	 * Validate dashboard configuration
	 */
	private validateDashboardConfig(config: DashboardConfig): void {
		if (!config.id || !config.name || !config.version) {
			throw new Error('Invalid dashboard config: missing required fields');
		}

		if (!config.settings) {
			throw new Error('Invalid dashboard config: missing settings');
		}

		// Add more validation as needed
	}

	/**
	 * Ensure data directories exist
	 */
	private async ensureDirectories(): Promise<void> {
		try {
			if (!existsSync(this.configPath)) {
				await mkdir(this.configPath, { recursive: true });
			}
			if (!existsSync(this.dataPath)) {
				await mkdir(this.dataPath, { recursive: true });
			}
		} catch (error) {
			logger.error('Error creating monitoring data directories', {
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
}

export const dashboardManager = DashboardManager.getInstance();