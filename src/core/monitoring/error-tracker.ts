import { logger } from '../logger/index.js';
import { metricsCollector } from './metrics-collector.js';

export interface ErrorInfo {
	id: string;
	timestamp: Date;
	message: string;
	stack?: string;
	code?: string;
	type: 'api' | 'llm' | 'websocket' | 'memory' | 'system' | 'unknown';
	severity: 'low' | 'medium' | 'high' | 'critical';
	context?: {
		userId?: string;
		sessionId?: string;
		requestId?: string;
		endpoint?: string;
		provider?: string;
		model?: string;
		userAgent?: string;
		ip?: string;
		[key: string]: any;
	};
	resolved?: boolean;
	resolvedAt?: Date;
	resolution?: string;
}

export class ErrorTracker {
	private static instance: ErrorTracker;
	private errors: Map<string, ErrorInfo> = new Map();
	private maxErrors = 1000; // Keep last 1000 errors in memory
	private errorCounts: Record<string, number> = {};
	private errorRates: Record<string, { count: number; window: number }> = {};

	private constructor() {
		// Clean up old errors periodically
		setInterval(() => {
			this.cleanupOldErrors();
		}, 300000); // Every 5 minutes
	}

	static getInstance(): ErrorTracker {
		if (!ErrorTracker.instance) {
			ErrorTracker.instance = new ErrorTracker();
		}
		return ErrorTracker.instance;
	}

	/**
	 * Track a new error
	 */
	trackError(error: Error | string, type: ErrorInfo['type'], context?: ErrorInfo['context']): string {
		const errorId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const errorMessage = error instanceof Error ? error.message : error;
		const errorStack = error instanceof Error ? error.stack : undefined;

		const severity = this.determineSeverity(errorMessage, type, context);

		const errorInfo: ErrorInfo = {
			id: errorId,
			timestamp: new Date(),
			message: errorMessage,
			...(errorStack && { stack: errorStack }),
			type,
			severity,
			context,
			resolved: false
		};

		// Store error
		this.errors.set(errorId, errorInfo);

		// Update counters
		const errorKey = `${type}:${errorMessage}`;
		this.errorCounts[errorKey] = (this.errorCounts[errorKey] || 0) + 1;

		// Track error rates
		this.updateErrorRates(errorKey);

		// Log error
		this.logError(errorInfo);

		// Send to external monitoring if configured
		this.sendToExternalMonitoring(errorInfo);

		// Clean up if we have too many errors
		if (this.errors.size > this.maxErrors) {
			this.cleanupOldErrors();
		}

		return errorId;
	}

	/**
	 * Track API error
	 */
	trackAPIError(error: Error | string, endpoint: string, context?: Partial<ErrorInfo['context']>): string {
		return this.trackError(error, 'api', {
			endpoint,
			...context
		});
	}

	/**
	 * Track LLM error
	 */
	trackLLMError(error: Error | string, provider: string, model: string, context?: Partial<ErrorInfo['context']>): string {
		return this.trackError(error, 'llm', {
			provider,
			model,
			...context
		});
	}

	/**
	 * Track WebSocket error
	 */
	trackWebSocketError(error: Error | string, context?: Partial<ErrorInfo['context']>): string {
		return this.trackError(error, 'websocket', context);
	}

	/**
	 * Track memory system error
	 */
	trackMemoryError(error: Error | string, context?: Partial<ErrorInfo['context']>): string {
		return this.trackError(error, 'memory', context);
	}

	/**
	 * Track system error
	 */
	trackSystemError(error: Error | string, context?: Partial<ErrorInfo['context']>): string {
		return this.trackError(error, 'system', context);
	}

	/**
	 * Mark error as resolved
	 */
	resolveError(errorId: string, resolution?: string): boolean {
		const error = this.errors.get(errorId);
		if (!error) {
			return false;
		}

		error.resolved = true;
		error.resolvedAt = new Date();
		if (resolution !== undefined) {
			error.resolution = resolution;
		}

		logger.info('Error resolved', {
			errorId,
			resolution,
			originalMessage: error.message,
			type: error.type
		});

		return true;
	}

	/**
	 * Get error by ID
	 */
	getError(errorId: string): ErrorInfo | undefined {
		return this.errors.get(errorId);
	}

	/**
	 * Get recent errors
	 */
	getRecentErrors(limit: number = 100, type?: ErrorInfo['type'], severity?: ErrorInfo['severity']): ErrorInfo[] {
		let errors = Array.from(this.errors.values());

		// Filter by type if specified
		if (type) {
			errors = errors.filter(error => error.type === type);
		}

		// Filter by severity if specified
		if (severity) {
			errors = errors.filter(error => error.severity === severity);
		}

		// Sort by timestamp (newest first) and limit
		return errors
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
			.slice(0, limit);
	}

	/**
	 * Get error statistics
	 */
	getErrorStats(): {
		totalErrors: number;
		errorsByType: Record<ErrorInfo['type'], number>;
		errorsBySeverity: Record<ErrorInfo['severity'], number>;
		topErrors: Array<{ message: string; count: number; type: ErrorInfo['type'] }>;
		errorRates: Record<string, number>;
		recentErrors: number;
		resolvedErrors: number;
	} {
		const allErrors = Array.from(this.errors.values());
		const now = Date.now();
		const oneHourAgo = now - (60 * 60 * 1000);

		// Errors by type
		const errorsByType = allErrors.reduce((acc, error) => {
			acc[error.type] = (acc[error.type] || 0) + 1;
			return acc;
		}, {} as Record<ErrorInfo['type'], number>);

		// Errors by severity
		const errorsBySeverity = allErrors.reduce((acc, error) => {
			acc[error.severity] = (acc[error.severity] || 0) + 1;
			return acc;
		}, {} as Record<ErrorInfo['severity'], number>);

		// Top errors
		const topErrors = Object.entries(this.errorCounts)
			.map(([key, count]) => {
				const [type, message] = key.split(':', 2);
				return { message: message || 'Unknown error', count, type: type as ErrorInfo['type'] };
			})
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		// Error rates (errors per minute in last hour)
		const errorRates = Object.entries(this.errorRates).reduce((acc, [key, data]) => {
			const ratePerMinute = data.count / (data.window / 60000);
			acc[key] = ratePerMinute;
			return acc;
		}, {} as Record<string, number>);

		// Recent errors (last hour)
		const recentErrors = allErrors.filter(error =>
			error.timestamp.getTime() > oneHourAgo
		).length;

		// Resolved errors
		const resolvedErrors = allErrors.filter(error => error.resolved).length;

		return {
			totalErrors: allErrors.length,
			errorsByType,
			errorsBySeverity,
			topErrors,
			errorRates,
			recentErrors,
			resolvedErrors
		};
	}

	/**
	 * Get health status based on error patterns
	 */
	getHealthStatus(): {
		status: 'healthy' | 'warning' | 'critical';
		issues: string[];
		criticalErrors: number;
		recentErrorRate: number;
	} {
		const stats = this.getErrorStats();
		const issues: string[] = [];
		let status: 'healthy' | 'warning' | 'critical' = 'healthy';

		const criticalErrors = stats.errorsBySeverity.critical || 0;
		const recentErrorRate = stats.recentErrors / 60; // per minute

		// Check critical errors
		if (criticalErrors > 0) {
			issues.push(`${criticalErrors} critical errors detected`);
			status = 'critical';
		}

		// Check error rate
		if (recentErrorRate > 5) {
			issues.push(`High error rate: ${recentErrorRate.toFixed(1)}/min`);
			if (status !== 'critical') status = 'critical';
		} else if (recentErrorRate > 2) {
			issues.push(`Elevated error rate: ${recentErrorRate.toFixed(1)}/min`);
			if (status === 'healthy') status = 'warning';
		}

		// Check for recurring errors
		const recurringErrors = stats.topErrors.filter(error => error.count > 10);
		if (recurringErrors.length > 0) {
			issues.push(`${recurringErrors.length} recurring error patterns detected`);
			if (status === 'healthy') status = 'warning';
		}

		return {
			status,
			issues,
			criticalErrors,
			recentErrorRate
		};
	}

	/**
	 * Clear all errors
	 */
	clearErrors(): void {
		this.errors.clear();
		this.errorCounts = {};
		this.errorRates = {};
	}

	private determineSeverity(message: string, type: ErrorInfo['type'], context?: ErrorInfo['context']): ErrorInfo['severity'] {
		// Critical patterns
		if (
			message.toLowerCase().includes('out of memory') ||
			message.toLowerCase().includes('segmentation fault') ||
			message.toLowerCase().includes('database connection lost') ||
			message.toLowerCase().includes('authentication failed') ||
			message.toLowerCase().includes('access denied')
		) {
			return 'critical';
		}

		// High severity patterns
		if (
			message.toLowerCase().includes('timeout') ||
			message.toLowerCase().includes('connection refused') ||
			message.toLowerCase().includes('rate limit') ||
			message.toLowerCase().includes('quota exceeded') ||
			type === 'llm' // LLM errors are usually important
		) {
			return 'high';
		}

		// Medium severity patterns
		if (
			message.toLowerCase().includes('validation') ||
			message.toLowerCase().includes('not found') ||
			message.toLowerCase().includes('invalid')
		) {
			return 'medium';
		}

		// Default to low severity
		return 'low';
	}

	private updateErrorRates(errorKey: string): void {
		const now = Date.now();
		const windowSize = 60000; // 1 minute window

		if (!this.errorRates[errorKey]) {
			this.errorRates[errorKey] = { count: 0, window: now };
		}

		const rate = this.errorRates[errorKey];

		// Reset window if it's been more than the window size
		if (now - rate.window > windowSize) {
			rate.count = 1;
			rate.window = now;
		} else {
			rate.count++;
		}
	}

	private cleanupOldErrors(): void {
		const now = Date.now();
		const maxAge = 24 * 60 * 60 * 1000; // 24 hours

		// Remove errors older than maxAge or keep only the most recent ones
		const sortedErrors = Array.from(this.errors.entries())
			.sort(([, a], [, b]) => b.timestamp.getTime() - a.timestamp.getTime());

		// Keep only the most recent errors or errors younger than maxAge
		const toKeep = sortedErrors
			.slice(0, this.maxErrors)
			.filter(([, error]) => now - error.timestamp.getTime() < maxAge);

		// Clear and repopulate
		this.errors.clear();
		toKeep.forEach(([id, error]) => {
			this.errors.set(id, error);
		});
	}

	private logError(errorInfo: ErrorInfo): void {
		const logData = {
			errorId: errorInfo.id,
			type: errorInfo.type,
			severity: errorInfo.severity,
			message: errorInfo.message,
			context: errorInfo.context
		};

		switch (errorInfo.severity) {
			case 'critical':
				logger.error('Critical error tracked', logData);
				break;
			case 'high':
				logger.error('High severity error tracked', logData);
				break;
			case 'medium':
				logger.warn('Medium severity error tracked', logData);
				break;
			case 'low':
				logger.info('Low severity error tracked', logData);
				break;
		}
	}

	private sendToExternalMonitoring(errorInfo: ErrorInfo): void {
		// This is where you would integrate with external monitoring services
		// like Sentry, Rollbar, Bugsnag, etc.

		// Example: Send critical errors to external service
		if (errorInfo.severity === 'critical') {
			// Placeholder for external monitoring integration
			console.warn('Critical error detected - would send to external monitoring:', {
				id: errorInfo.id,
				message: errorInfo.message,
				type: errorInfo.type,
				context: errorInfo.context
			});
		}
	}
}

// Global instance
export const errorTracker = ErrorTracker.getInstance();

// Global error handler
process.on('unhandledRejection', (reason, promise) => {
	errorTracker.trackSystemError(`Unhandled Promise Rejection: ${reason}`, {
		promise: promise.toString()
	});
});

process.on('uncaughtException', (error) => {
	errorTracker.trackSystemError(error, {
		type: 'uncaught_exception'
	});
});