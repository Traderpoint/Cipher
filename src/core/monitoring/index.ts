// Core monitoring system exports
export { MetricsCollector, metricsCollector } from './metrics-collector.js';
export { LLMPerformanceTracker, llmPerformanceTracker } from './llm-performance-tracker.js';
export { ErrorTracker, errorTracker } from './error-tracker.js';

// Middleware exports
export {
	requestMetricsMiddleware,
	llmMetricsWrapper,
	memorySearchWrapper,
	WebSocketTracker,
	errorTrackingMiddleware,
	healthCheckMiddleware,
	initializeMetricsCollection,
	integrateMetrics
} from './middleware.js';

// Type exports
export type {
	SystemMetrics,
	LLMMetrics,
	MemoryMetrics,
	WebSocketMetrics,
	APIMetrics,
	AllMetrics
} from './metrics-collector.js';

export type {
	LLMCallInfo,
	LLMResponse
} from './llm-performance-tracker.js';

export type {
	ErrorInfo
} from './error-tracker.js';

// Monitoring utilities
export class MonitoringIntegration {
	/**
	 * Initialize the complete monitoring system
	 */
	static initialize(): void {
		// Start metrics collection
		metricsCollector.startCollection(30000);

		console.log('✅ Cipher monitoring system initialized');
	}

	/**
	 * Get comprehensive system status
	 */
	static getSystemStatus() {
		const metrics = metricsCollector.getMetrics();
		const health = metricsCollector.getHealthStatus();
		const errorStats = errorTracker.getErrorStats();
		const errorHealth = errorTracker.getHealthStatus();

		return {
			timestamp: new Date(),
			overall: {
				status: health.status === 'critical' || errorHealth.status === 'critical' ? 'critical' :
					health.status === 'warning' || errorHealth.status === 'warning' ? 'warning' : 'healthy',
				uptime: metrics.system.uptime,
				issues: [...health.issues, ...errorHealth.issues]
			},
			system: metrics.system,
			services: {
				api: {
					status: 'running',
					requests: metrics.api.totalRequests,
					errors: errorStats.errorsByType.api || 0
				},
				websocket: {
					status: metrics.websocket.activeConnections > 0 ? 'active' : 'idle',
					connections: metrics.websocket.activeConnections,
					errors: errorStats.errorsByType.websocket || 0
				},
				llm: Object.entries(metrics.llm).map(([key, llm]) => ({
					provider: key.split(':')[0],
					model: key.split(':')[1],
					status: llm.lastRequestTime && (Date.now() - llm.lastRequestTime.getTime()) < 300000 ? 'active' : 'idle',
					requests: llm.totalRequests,
					errors: llm.failedRequests,
					avgResponseTime: llm.averageResponseTime
				})),
				memory: {
					status: metrics.memory.totalKnowledge > 0 ? 'active' : 'idle',
					knowledge: metrics.memory.totalKnowledge,
					searches: metrics.memory.totalSearches,
					errors: errorStats.errorsByType.memory || 0
				}
			},
			errors: {
				total: errorStats.totalErrors,
				recent: errorStats.recentErrors,
				critical: errorStats.errorsBySeverity.critical || 0,
				resolved: errorStats.resolvedErrors
			}
		};
	}

	/**
	 * Export metrics in Prometheus format
	 */
	static exportPrometheusMetrics(): string {
		const metrics = metricsCollector.getMetrics();
		const lines: string[] = [];

		// System metrics
		lines.push(`# HELP cipher_uptime_seconds System uptime in seconds`);
		lines.push(`# TYPE cipher_uptime_seconds gauge`);
		lines.push(`cipher_uptime_seconds ${metrics.system.uptime}`);

		lines.push(`# HELP cipher_memory_usage_percent Memory usage percentage`);
		lines.push(`# TYPE cipher_memory_usage_percent gauge`);
		lines.push(`cipher_memory_usage_percent ${metrics.system.memory.percentage}`);

		// WebSocket metrics
		lines.push(`# HELP cipher_websocket_connections_active Active WebSocket connections`);
		lines.push(`# TYPE cipher_websocket_connections_active gauge`);
		lines.push(`cipher_websocket_connections_active ${metrics.websocket.activeConnections}`);

		// API metrics
		lines.push(`# HELP cipher_api_requests_total Total API requests`);
		lines.push(`# TYPE cipher_api_requests_total counter`);
		lines.push(`cipher_api_requests_total ${metrics.api.totalRequests}`);

		// LLM metrics
		Object.entries(metrics.llm).forEach(([key, llm]) => {
			const [provider, model] = key.split(':');
			lines.push(`# HELP cipher_llm_requests_total Total LLM requests`);
			lines.push(`# TYPE cipher_llm_requests_total counter`);
			lines.push(`cipher_llm_requests_total{provider="${provider}",model="${model}"} ${llm.totalRequests}`);

			lines.push(`# HELP cipher_llm_response_time_ms Average LLM response time in milliseconds`);
			lines.push(`# TYPE cipher_llm_response_time_ms gauge`);
			lines.push(`cipher_llm_response_time_ms{provider="${provider}",model="${model}"} ${llm.averageResponseTime}`);

			lines.push(`# HELP cipher_llm_error_rate LLM error rate`);
			lines.push(`# TYPE cipher_llm_error_rate gauge`);
			lines.push(`cipher_llm_error_rate{provider="${provider}",model="${model}"} ${llm.errorRate}`);
		});

		// Memory metrics
		lines.push(`# HELP cipher_memory_knowledge_total Total knowledge items`);
		lines.push(`# TYPE cipher_memory_knowledge_total gauge`);
		lines.push(`cipher_memory_knowledge_total ${metrics.memory.totalKnowledge}`);

		lines.push(`# HELP cipher_memory_searches_total Total memory searches`);
		lines.push(`# TYPE cipher_memory_searches_total counter`);
		lines.push(`cipher_memory_searches_total ${metrics.memory.totalSearches}`);

		return lines.join('\n') + '\n';
	}

	/**
	 * Shutdown monitoring system
	 */
	static shutdown(): void {
		metricsCollector.stopCollection();
		console.log('✅ Monitoring system shut down');
	}
}