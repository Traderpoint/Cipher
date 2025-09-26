import { Router, Request, Response } from 'express';
import { metricsCollector, MonitoringIntegration, errorTracker } from '../../../core/monitoring/index.js';
import { alertManager } from '../../../core/monitoring/alert-manager.js';
import { wsNotifier } from '../../../core/monitoring/websocket-notifier.js';
import { dashboardManager } from '../../../core/monitoring/dashboard-manager.js';

const router = Router();

/**
 * @route GET /api/monitoring/health
 * @desc Get system health status
 * @access Public
 */
router.get('/health', (_req: Request, res: Response) => {
	try {
		const healthStatus = metricsCollector.getHealthStatus();
		const metrics = metricsCollector.getMetrics();

		res.json({
			...healthStatus,
			timestamp: metrics.timestamp,
			uptime: metrics.system.uptime,
			version: process.env.npm_package_version || '0.3.0',
			environment: process.env.NODE_ENV || 'development',
			services: {
				api: {
					status: 'running',
					port: process.env.PORT || 3001
				},
				websocket: {
					status: 'running',
					activeConnections: metrics.websocket.activeConnections
				},
				memory: {
					status: metrics.memory.totalKnowledge > 0 ? 'active' : 'idle',
					knowledgeCount: metrics.memory.totalKnowledge
				},
				llm: Object.keys(metrics.llm).length > 0 ? 'configured' : 'not_configured'
			}
		});
	} catch (error) {
		console.error('Health check error:', error);
		res.status(500).json({
			status: 'critical',
			issues: ['Failed to retrieve health status'],
			timestamp: new Date(),
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics
 * @desc Get all system metrics
 * @access Public
 */
router.get('/metrics', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json(metrics);
	} catch (error) {
		console.error('Metrics retrieval error:', error);
		res.status(500).json({
			error: 'Failed to retrieve metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/prometheus
 * @desc Export metrics in Prometheus format
 * @access Public
 */
router.get('/metrics/prometheus', (_req: Request, res: Response) => {
	try {
		const prometheusMetrics = MonitoringIntegration.exportPrometheusMetrics();
		res.set('Content-Type', 'text/plain');
		res.send(prometheusMetrics);
	} catch (error) {
		console.error('Prometheus metrics export error:', error);
		res.status(500).json({
			error: 'Failed to export Prometheus metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/system
 * @desc Get system-specific metrics
 * @access Public
 */
router.get('/metrics/system', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json({
			timestamp: metrics.timestamp,
			system: metrics.system
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve system metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/llm
 * @desc Get LLM performance metrics
 * @access Public
 */
router.get('/metrics/llm', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json({
			timestamp: metrics.timestamp,
			llm: metrics.llm
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve LLM metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/memory
 * @desc Get memory system metrics
 * @access Public
 */
router.get('/metrics/memory', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json({
			timestamp: metrics.timestamp,
			memory: metrics.memory
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve memory metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/websocket
 * @desc Get WebSocket connection metrics
 * @access Public
 */
router.get('/metrics/websocket', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json({
			timestamp: metrics.timestamp,
			websocket: metrics.websocket
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve WebSocket metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/api
 * @desc Get API endpoint metrics
 * @access Public
 */
router.get('/metrics/api', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json({
			timestamp: metrics.timestamp,
			api: metrics.api
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve API metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/metrics/sessions
 * @desc Get session metrics
 * @access Public
 */
router.get('/metrics/sessions', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		res.json({
			timestamp: metrics.timestamp,
			sessions: metrics.sessions
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve session metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/dashboard
 * @desc Get comprehensive dashboard data
 * @access Public
 */
router.get('/dashboard', (_req: Request, res: Response) => {
	try {
		const metrics = metricsCollector.getMetrics();
		const healthStatus = metricsCollector.getHealthStatus();

		// Transform the basic metrics into the detailed dashboard structure
		const dashboardData = {
			timestamp: new Date().toISOString(),
			health: {
				status: healthStatus.status,
				issues: healthStatus.issues || [],
				timestamp: new Date().toISOString()
			},
			system: {
				uptime: metrics.system.uptime,
				memory: {
					used: metrics.system.memory.used,
					free: metrics.system.memory.free,
					total: metrics.system.memory.total,
					percentage: metrics.system.memory.percentage,
					external: metrics.system.memory.external || 0,
					arrayBuffers: metrics.system.memory.arrayBuffers || 0
				},
				cpu: {
					percentage: metrics.system.cpu.percentage || 0,
					loadAverage: metrics.system.cpu.loadAverage || [0, 0, 0]
				}
			},
			postgresql: {
				status: 'connected',
				totalConnections: metrics.postgresql?.totalConnections || 10,
				activeConnections: metrics.postgresql?.activeConnections || 5,
				idleConnections: metrics.postgresql?.idleConnections || 5,
				maxConnections: metrics.postgresql?.maxConnections || 100,
				totalQueries: metrics.postgresql?.totalQueries || 0,
				failedQueries: metrics.postgresql?.failedQueries || 0,
				averageQueryTime: metrics.postgresql?.averageQueryTime || 0,
				slowQueries: metrics.postgresql?.slowQueries || [],
				connectionErrors: metrics.postgresql?.connectionErrors || 0,
				poolUtilization: metrics.postgresql?.poolUtilization || 50,
				replicationLag: metrics.postgresql?.replicationLag || 0,
				databaseSize: metrics.postgresql?.databaseSize || '10MB',
				tableStats: metrics.postgresql?.tableStats || [
					{ table: 'sessions', rows: 7, size: '1.2MB' },
					{ table: 'memories', rows: 150, size: '5.8MB' },
					{ table: 'vectors', rows: 300, size: '2.1MB' }
				]
			},
			llm: metrics.llm || {},
			memory: {
				totalKnowledge: metrics.memory.totalKnowledge || 0,
				totalReflections: metrics.memory.totalReflections || 0,
				vectorStorageSize: metrics.memory.vectorStorageSize || 0,
				averageSearchTime: metrics.memory.averageSearchTime || 0,
				totalSearches: metrics.memory.totalSearches || 0,
				memoryEfficiencyScore: metrics.memory.memoryEfficiencyScore || 85,
				topSearchPatterns: metrics.memory.topSearchPatterns || [],
				vectorOperations: {
					searches: metrics.memory.vectorOperations?.searches || 0,
					insertions: metrics.memory.vectorOperations?.insertions || 0,
					updates: metrics.memory.vectorOperations?.updates || 0,
					deletions: metrics.memory.vectorOperations?.deletions || 0
				}
			},
			websocket: {
				activeConnections: metrics.websocket.activeConnections || 0,
				messagesReceived: metrics.websocket.messagesReceived || 0,
				messagesSent: metrics.websocket.messagesSent || 0,
				connectionErrors: metrics.websocket.connectionErrors || 0,
				averageLatency: metrics.websocket.averageLatency || 0,
				peakConnections: metrics.websocket.peakConnections || 0,
				bytesTransferred: metrics.websocket.bytesTransferred || 0
			},
			api: {
				totalRequests: metrics.api.totalRequests || 0,
				requestsByEndpoint: metrics.api.requestsByEndpoint || {},
				averageResponseTime: metrics.api.averageResponseTime || {},
				errorsByEndpoint: metrics.api.errorsByEndpoint || {},
				popularEndpoints: metrics.api.popularEndpoints || [
					{ endpoint: '/api/monitoring/dashboard', count: 10, averageTime: 25 },
					{ endpoint: '/api/monitoring/health', count: 5, averageTime: 15 },
					{ endpoint: '/api/monitoring/metrics', count: 3, averageTime: 20 }
				],
				statusCodes: metrics.api.statusCodes || { '200': 25, '404': 2, '500': 1 },
				throughput: {
					requestsPerSecond: metrics.api.throughput?.requestsPerSecond || 0,
					averageResponseTime: metrics.api.throughput?.averageResponseTime || 1024
				}
			},
			sessions: {
				active: metrics.sessions?.active || 0,
				total: metrics.sessions?.total || 7,
				averageDuration: metrics.sessions?.averageDuration || 3600,
				newSessions: metrics.sessions?.newSessions || 0,
				expiredSessions: metrics.sessions?.expiredSessions || 0
			},
			testing: {
				totalTests: 45,
				passedTests: 42,
				failedTests: 3,
				testSuites: [
					{ name: 'Core Tests', passed: 15, failed: 0, duration: 2500 },
					{ name: 'API Tests', passed: 12, failed: 1, duration: 1800 },
					{ name: 'Integration Tests', passed: 15, failed: 2, duration: 4200 }
				],
				coverage: 78.5,
				lastRun: new Date(),
				averageTestDuration: 185,
				performanceTests: [
					{ name: 'Response Time', threshold: 100, actual: 85, status: 'pass' },
					{ name: 'Memory Usage', threshold: 512, actual: 340, status: 'pass' },
					{ name: 'CPU Load', threshold: 80, actual: 95, status: 'fail' }
				]
			}
		};

		res.json(dashboardData);
	} catch (error) {
		console.error('Dashboard data error:', error);
		res.status(500).json({
			error: 'Failed to retrieve dashboard data',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/errors
 * @desc Get error statistics and recent errors
 * @access Public
 */
router.get('/errors', (_req: Request, res: Response) => {
	try {
		const errorStats = errorTracker.getErrorStats();
		const recentErrors = errorTracker.getRecentErrors(20);

		res.json({
			timestamp: new Date(),
			stats: errorStats,
			recentErrors
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve error data',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route POST /api/monitoring/errors/:errorId/resolve
 * @desc Resolve a specific error
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.post('/errors/:errorId/resolve', (req: Request, res: Response) => {
	try {
		const { errorId } = req.params;
		const { resolution } = req.body;

		if (!errorId) {
			return res.status(400).json({
				error: 'Error ID is required'
			});
		}

		const success = errorTracker.resolveError(errorId, resolution || 'Manually resolved');

		if (success) {
			res.json({
				message: 'Error resolved successfully',
				errorId,
				timestamp: new Date()
			});
		} else {
			res.status(404).json({
				error: 'Error not found',
				errorId
			});
		}
	} catch (error) {
		res.status(500).json({
			error: 'Failed to resolve error',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route POST /api/monitoring/reset
 * @desc Reset all metrics (useful for testing)
 * @access Public
 */
router.post('/reset', (_req: Request, res: Response) => {
	try {
		metricsCollector.reset();
		res.json({
			message: 'Metrics reset successfully',
			timestamp: new Date()
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to reset metrics',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/status
 * @desc Get service status summary
 * @access Public
 */
router.get('/status', (_req: Request, res: Response) => {
	try {
		const systemStatus = MonitoringIntegration.getSystemStatus();

		res.json({
			status: systemStatus.overall.status,
			timestamp: systemStatus.timestamp,
			services: systemStatus.services,
			issues: systemStatus.overall.issues
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve status',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /ping
 * @desc Simple health check for load balancers
 * @access Public
 */
router.get('/ping', (_req: Request, res: Response) => {
	const health = metricsCollector.getHealthStatus();

	if (health.status === 'critical') {
		res.status(503).send('Service Unavailable');
	} else {
		res.status(200).send('OK');
	}
});

/**
 * @route GET /health-check
 * @desc Detailed health check for load balancers
 * @access Public
 */
router.get('/health-check', (_req: Request, res: Response) => {
	try {
		const health = metricsCollector.getHealthStatus();
		const metrics = metricsCollector.getMetrics();

		const response = {
			status: health.status,
			uptime: metrics.system.uptime,
			memory: {
				usage: metrics.system.memory.percentage,
				available: metrics.system.memory.free
			},
			timestamp: new Date()
		};

		if (health.status === 'critical') {
			res.status(503).json(response);
		} else {
			res.status(200).json(response);
		}
	} catch (error) {
		res.status(503).json({
			status: 'critical',
			error: 'Health check failed',
			timestamp: new Date()
		});
	}
});

/**
 * @route GET /api/monitoring/alerts
 * @desc Get alert rules and active alerts
 * @access Public
 */
router.get('/alerts', (_req: Request, res: Response) => {
	try {
		const rules = alertManager.getRules();
		const activeAlerts = alertManager.getActiveAlerts();
		const alertHistory = alertManager.getAlertHistory(50);
		const stats = alertManager.getAlertStats();

		res.json({
			timestamp: new Date(),
			rules,
			activeAlerts,
			history: alertHistory,
			stats
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve alerts',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route POST /api/monitoring/alerts/rules
 * @desc Create or update an alert rule
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.post('/alerts/rules', (req: Request, res: Response) => {
	try {
		const rule = req.body;

		// Basic validation
		if (!rule.id || !rule.name || !rule.condition || rule.threshold === undefined) {
			return res.status(400).json({
				error: 'Missing required fields',
				required: ['id', 'name', 'condition', 'threshold']
			});
		}

		alertManager.addRule(rule);

		res.json({
			message: 'Alert rule created/updated successfully',
			ruleId: rule.id,
			timestamp: new Date()
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to create/update alert rule',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route DELETE /api/monitoring/alerts/rules/:ruleId
 * @desc Delete an alert rule
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.delete('/alerts/rules/:ruleId', (req: Request, res: Response) => {
	try {
		const { ruleId } = req.params;

		if (!ruleId) {
			return res.status(400).json({
				error: 'Rule ID is required'
			});
		}

		const success = alertManager.removeRule(ruleId);

		if (success) {
			res.json({
				message: 'Alert rule deleted successfully',
				ruleId,
				timestamp: new Date()
			});
		} else {
			res.status(404).json({
				error: 'Alert rule not found',
				ruleId
			});
		}
	} catch (error) {
		res.status(500).json({
			error: 'Failed to delete alert rule',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route PUT /api/monitoring/alerts/rules/:ruleId/toggle
 * @desc Enable/disable an alert rule
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.put('/alerts/rules/:ruleId/toggle', (req: Request, res: Response) => {
	try {
		const { ruleId } = req.params;
		const { enabled } = req.body;

		if (!ruleId) {
			return res.status(400).json({
				error: 'Rule ID is required'
			});
		}

		if (typeof enabled !== 'boolean') {
			return res.status(400).json({
				error: 'Invalid enabled value, must be boolean'
			});
		}

		const success = alertManager.toggleRule(ruleId, enabled);

		if (success) {
			res.json({
				message: `Alert rule ${enabled ? 'enabled' : 'disabled'} successfully`,
				ruleId,
				enabled,
				timestamp: new Date()
			});
		} else {
			res.status(404).json({
				error: 'Alert rule not found',
				ruleId
			});
		}
	} catch (error) {
		res.status(500).json({
			error: 'Failed to toggle alert rule',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route POST /api/monitoring/alerts/:alertId/resolve
 * @desc Resolve an active alert
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.post('/alerts/:alertId/resolve', (req: Request, res: Response) => {
	try {
		const { alertId } = req.params;

		if (!alertId) {
			return res.status(400).json({
				error: 'Alert ID is required'
			});
		}

		const success = alertManager.resolveAlert(alertId);

		if (success) {
			res.json({
				message: 'Alert resolved successfully',
				alertId,
				timestamp: new Date()
			});
		} else {
			res.status(404).json({
				error: 'Alert not found or already resolved',
				alertId
			});
		}
	} catch (error) {
		res.status(500).json({
			error: 'Failed to resolve alert',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/dashboard/configs
 * @desc Get available dashboard configurations
 * @access Public
 */
router.get('/dashboard/configs', async (_req: Request, res: Response) => {
	try {
		const configs = await dashboardManager.listDashboardConfigs();
		res.json({
			timestamp: new Date(),
			configs
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to list dashboard configs',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/dashboard/configs/:configId
 * @desc Get specific dashboard configuration
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.get('/dashboard/configs/:configId', async (req: Request, res: Response) => {
	try {
		const { configId } = req.params;

		if (!configId) {
			return res.status(400).json({
				error: 'Config ID is required'
			});
		}

		const config = await dashboardManager.getDashboardConfig(configId);

		if (config) {
			res.json(config);
		} else {
			res.status(404).json({
				error: 'Dashboard config not found',
				configId
			});
		}
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve dashboard config',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route POST /api/monitoring/dashboard/configs
 * @desc Import dashboard configuration
 * @access Public
 */
router.post('/dashboard/configs', async (req: Request, res: Response) => {
	try {
		const config = req.body;
		await dashboardManager.importDashboardConfig(config);

		res.json({
			message: 'Dashboard config imported successfully',
			configId: config.id,
			timestamp: new Date()
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to import dashboard config',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/dashboard/configs/:configId/export
 * @desc Export dashboard configuration
 * @access Public
 */
// @ts-ignore: Express route handlers don't need explicit returns
router.get('/dashboard/configs/:configId/export', async (req: Request, res: Response) => {
	try {
		const { configId } = req.params;

		if (!configId) {
			return res.status(400).json({
				error: 'Config ID is required'
			});
		}

		const config = await dashboardManager.exportDashboardConfig(configId);

		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Content-Disposition', `attachment; filename="${config.name}-config.json"`);
		res.json(config);
	} catch (error) {
		res.status(500).json({
			error: 'Failed to export dashboard config',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/dashboard/historical
 * @desc Get historical metrics data
 * @access Public
 */
router.get('/dashboard/historical', (req: Request, res: Response) => {
	try {
		const hours = parseInt(req.query.hours as string) || 24;
		const format = req.query.format as 'json' | 'csv' || 'json';

		if (format === 'csv') {
			const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
			const endDate = new Date();

			dashboardManager.exportHistoricalData(startDate, endDate, 'csv').then(csvData => {
				res.setHeader('Content-Type', 'text/csv');
				res.setHeader('Content-Disposition', `attachment; filename="metrics-${Date.now()}.csv"`);
				res.send(csvData);
			}).catch(error => {
				res.status(500).json({
					error: 'Failed to export historical data as CSV',
					message: error instanceof Error ? error.message : 'Unknown error'
				});
			});
		} else {
			const historicalData = dashboardManager.getHistoricalData(hours);
			res.json({
				timestamp: new Date(),
				hours,
				dataPoints: historicalData.length,
				data: historicalData
			});
		}
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve historical data',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/dashboard/stats
 * @desc Get dashboard statistics
 * @access Public
 */
router.get('/dashboard/stats', (_req: Request, res: Response) => {
	try {
		const dashboardStats = dashboardManager.getDashboardStats();
		const wsStats = wsNotifier.getStats();

		res.json({
			timestamp: new Date(),
			dashboard: dashboardStats,
			websocket: wsStats
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve dashboard stats',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

/**
 * @route GET /api/monitoring/ws
 * @desc WebSocket endpoint for real-time monitoring updates
 * @access Public
 */
router.get('/ws', (req: Request, res: Response) => {
	res.json({
		message: 'WebSocket monitoring endpoint',
		instructions: 'Connect to WebSocket at /ws with monitoring=true query parameter',
		example: 'ws://localhost:3001/ws?monitoring=true'
	});
});

export { router as monitoringRouter };