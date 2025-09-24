import { Request, Response, NextFunction } from 'express';
import { metricsCollector } from './metrics-collector.js';

export interface MonitoringRequest extends Request {
	startTime?: number;
}

/**
 * Middleware to track API request metrics
 */
export function requestMetricsMiddleware(req: MonitoringRequest, res: Response, next: NextFunction): void {
	req.startTime = Date.now();

	// Track request start
	const endpoint = `${req.method} ${req.route?.path || req.path}`;

	// Override res.end to capture response metrics
	const originalEnd = res.end.bind(res);
	res.end = function(chunk?: any): Response {
		const responseTime = Date.now() - (req.startTime || Date.now());
		const success = res.statusCode < 400;

		metricsCollector.trackAPIRequest(endpoint, responseTime, success);

		return originalEnd(chunk);
	};

	next();
}

/**
 * Middleware to track LLM call metrics
 */
export function llmMetricsWrapper<T extends (...args: any[]) => Promise<any>>(
	provider: string,
	model: string,
	originalFunction: T
): T {
	return (async (...args: any[]) => {
		const startTime = Date.now();
		let tokensUsed = 0;
		let success = false;

		try {
			const result = await originalFunction(...args);
			success = true;

			// Try to extract token usage from common response formats
			if (result && typeof result === 'object') {
				if (result.usage && result.usage.total_tokens) {
					tokensUsed = result.usage.total_tokens;
				} else if (result.token_count) {
					tokensUsed = result.token_count;
				} else if (result.tokens) {
					tokensUsed = result.tokens;
				}
			}

			return result;
		} catch (error) {
			success = false;
			throw error;
		} finally {
			const responseTime = Date.now() - startTime;
			metricsCollector.trackLLMRequest(provider, model, responseTime, success, tokensUsed);
		}
	}) as T;
}

/**
 * Middleware to track memory search operations
 */
export function memorySearchWrapper<T extends (...args: any[]) => Promise<any>>(
	originalFunction: T
): T {
	return (async (...args: any[]) => {
		const startTime = Date.now();
		let searchPattern = '';
		let relevanceScore = 0;

		try {
			// Try to extract search query from arguments
			if (args.length > 0 && typeof args[0] === 'string') {
				searchPattern = args[0];
			} else if (args.length > 0 && args[0] && typeof args[0] === 'object' && args[0].query) {
				searchPattern = args[0].query;
			}

			const result = await originalFunction(...args);

			// Try to calculate relevance score from results
			if (result && Array.isArray(result) && result.length > 0) {
				if (result[0].score) {
					relevanceScore = result.reduce((sum: number, item: any) => sum + (item.score || 0), 0) / result.length;
				} else if (result[0].similarity) {
					relevanceScore = result.reduce((sum: number, item: any) => sum + (item.similarity || 0), 0) / result.length;
				}
			}

			return result;
		} catch (error) {
			throw error;
		} finally {
			const searchTime = Date.now() - startTime;
			metricsCollector.trackMemorySearch(searchTime, searchPattern, relevanceScore);
		}
	}) as T;
}

/**
 * WebSocket connection tracking
 */
export class WebSocketTracker {
	private connectionId: string;

	constructor(connectionId: string) {
		this.connectionId = connectionId;
		metricsCollector.trackWebSocketConnection(connectionId);
	}

	trackMessage(incoming: boolean): void {
		metricsCollector.trackWebSocketMessage(incoming);
	}

	trackError(): void {
		metricsCollector.trackWebSocketError();
	}

	trackDisconnection(): void {
		metricsCollector.trackWebSocketDisconnection(this.connectionId);
	}
}

/**
 * Error tracking middleware
 */
export function errorTrackingMiddleware(error: Error, req: Request, res: Response, next: NextFunction): void {
	// Track the error in metrics
	const endpoint = `${req.method} ${req.route?.path || req.path}`;
	metricsCollector.trackAPIRequest(endpoint, 0, false);

	// Log error details for monitoring
	console.error(`API Error on ${endpoint}:`, {
		message: error.message,
		stack: error.stack,
		timestamp: new Date(),
		userAgent: req.headers['user-agent'],
		ip: req.ip || req.connection.remoteAddress
	});

	// Continue with normal error handling
	next(error);
}

/**
 * Health check middleware that responds to monitoring probes
 */
export function healthCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
	// Quick health check for load balancers/monitoring systems
	if (req.path === '/ping' || req.path === '/health-check') {
		const health = metricsCollector.getHealthStatus();
		res.status(health.status === 'critical' ? 503 : 200).json({
			status: health.status,
			timestamp: new Date(),
			uptime: process.uptime()
		});
		return;
	}

	next();
}

/**
 * Metrics update scheduler
 */
export function initializeMetricsCollection(): void {
	// Start metrics collection
	metricsCollector.startCollection(30000); // Collect every 30 seconds

	// Periodically update memory and session metrics
	setInterval(async () => {
		try {
			// These would be injected from the actual services
			// For now, we'll update with placeholder values
			// In real implementation, these would come from:
			// - VectorStorage service
			// - SessionManager
			// - MemAgent

			// Example placeholder updates - replace with actual service calls
			metricsCollector.updateMemoryMetrics(0, 0, 0);
			metricsCollector.updateSessionMetrics(0, 0, 0);
		} catch (error) {
			console.error('Failed to update periodic metrics:', error);
		}
	}, 60000); // Update every minute

	// Graceful shutdown
	process.on('SIGTERM', () => {
		metricsCollector.stopCollection();
	});

	process.on('SIGINT', () => {
		metricsCollector.stopCollection();
	});
}

/**
 * Express middleware to integrate metrics with existing server
 */
export function integrateMetrics(app: any): void {
	// Add request tracking middleware globally
	app.use(requestMetricsMiddleware);

	// Add health check middleware
	app.use(healthCheckMiddleware);

	// Add error tracking middleware (should be last)
	app.use(errorTrackingMiddleware);

	console.log('✅ Monitoring middleware integrated');
}