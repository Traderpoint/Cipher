import { Router, Request, Response } from 'express';
import { metricsCollector } from '../../core/monitoring/metrics-collector.js';

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

		// Calculate some dashboard-specific aggregations
		const totalLLMRequests = Object.values(metrics.llm).reduce((sum, llm) => sum + llm.totalRequests, 0);
		const averageLLMResponseTime = Object.values(metrics.llm).length > 0
			? Object.values(metrics.llm).reduce((sum, llm) => sum + llm.averageResponseTime, 0) / Object.values(metrics.llm).length
			: 0;

		const totalAPIRequests = metrics.api.totalRequests;
		const averageAPIResponseTime = Object.keys(metrics.api.averageResponseTime).length > 0
			? Object.values(metrics.api.averageResponseTime).reduce((sum, time) => sum + time, 0) / Object.values(metrics.api.averageResponseTime).length
			: 0;

		res.json({
			timestamp: metrics.timestamp,
			health: healthStatus,
			summary: {
				uptime: metrics.system.uptime,
				memoryUsage: metrics.system.memory.percentage,
				activeConnections: metrics.websocket.activeConnections,
				activeSessions: metrics.sessions.active,
				totalKnowledge: metrics.memory.totalKnowledge,
				llm: {
					totalRequests: totalLLMRequests,
					averageResponseTime: averageLLMResponseTime,
					providers: Object.keys(metrics.llm).length
				},
				api: {
					totalRequests: totalAPIRequests,
					averageResponseTime: averageAPIResponseTime,
					endpoints: Object.keys(metrics.api.requestsByEndpoint).length
				}
			},
			charts: {
				memoryUsage: {
					current: metrics.system.memory.percentage,
					threshold: 75
				},
				llmPerformance: Object.entries(metrics.llm).map(([key, llm]) => ({
					provider: key,
					requests: llm.totalRequests,
					avgTime: llm.averageResponseTime,
					errorRate: llm.errorRate,
					tokens: llm.totalTokensUsed
				})),
				apiEndpoints: metrics.api.popularEndpoints.slice(0, 5),
				searchPatterns: metrics.memory.topSearchPatterns.slice(0, 10),
				websocketActivity: {
					received: metrics.websocket.messagesReceived,
					sent: metrics.websocket.messagesSent,
					errors: metrics.websocket.connectionErrors
				}
			}
		});
	} catch (error) {
		console.error('Dashboard data error:', error);
		res.status(500).json({
			error: 'Failed to retrieve dashboard data',
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
		const metrics = metricsCollector.getMetrics();
		const health = metricsCollector.getHealthStatus();

		res.json({
			status: health.status,
			timestamp: metrics.timestamp,
			services: {
				api: {
					status: 'running',
					requests: metrics.api.totalRequests,
					errors: Object.values(metrics.api.errorsByEndpoint).reduce((sum, errors) => sum + errors, 0)
				},
				websocket: {
					status: metrics.websocket.activeConnections > 0 ? 'active' : 'idle',
					connections: metrics.websocket.activeConnections,
					errors: metrics.websocket.connectionErrors
				},
				memory: {
					status: metrics.memory.totalKnowledge > 0 ? 'active' : 'idle',
					knowledge: metrics.memory.totalKnowledge,
					efficiency: metrics.memory.memoryEfficiencyScore
				},
				llm: Object.entries(metrics.llm).map(([key, llm]) => ({
					provider: key.split(':')[0],
					model: key.split(':')[1],
					status: llm.lastRequestTime && (Date.now() - llm.lastRequestTime.getTime()) < 300000 ? 'active' : 'idle',
					requests: llm.totalRequests,
					errorRate: llm.errorRate
				}))
			},
			issues: health.issues
		});
	} catch (error) {
		res.status(500).json({
			error: 'Failed to retrieve status',
			message: error instanceof Error ? error.message : 'Unknown error'
		});
	}
});

export { router as monitoringRouter };