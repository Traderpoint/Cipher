import { metricsCollector } from './metrics-collector.js';
import { logger } from '../logger/index.js';

export interface LLMCallInfo {
	provider: string;
	model: string;
	requestId?: string;
	sessionId?: string;
	messageLength?: number;
	temperature?: number;
	maxTokens?: number;
}

export interface LLMResponse {
	success: boolean;
	responseTime: number;
	tokensUsed: number;
	inputTokens?: number;
	outputTokens?: number;
	error?: Error;
	response?: any;
}

export class LLMPerformanceTracker {
	private static instance: LLMPerformanceTracker;
	private activeRequests: Map<string, { startTime: number; info: LLMCallInfo }> = new Map();

	private constructor() {}

	static getInstance(): LLMPerformanceTracker {
		if (!LLMPerformanceTracker.instance) {
			LLMPerformanceTracker.instance = new LLMPerformanceTracker();
		}
		return LLMPerformanceTracker.instance;
	}

	/**
	 * Decorator for LLM service methods to automatically track performance
	 */
	static trackLLMCall<T extends (...args: any[]) => Promise<any>>(
		provider: string,
		model: string,
		originalMethod: T
	): T {
		return (async function(this: any, ...args: any[]) {
			const tracker = LLMPerformanceTracker.getInstance();
			const requestId = `${provider}-${model}-${Date.now()}-${Math.random()}`;

			const callInfo: LLMCallInfo = {
				provider,
				model,
				requestId,
				// Try to extract additional info from arguments
				...(typeof args[0] === 'string' && { messageLength: args[0].length }),
				...(args[0] && args[0].messages && { messageLength: JSON.stringify(args[0].messages).length }),
				...(args[0] && args[0].temperature && { temperature: args[0].temperature }),
				...(args[0] && args[0].max_tokens && { maxTokens: args[0].max_tokens })
			};

			tracker.startRequest(requestId, callInfo);

			try {
				const result = await originalMethod.apply(this, args);

				// Extract token information from response
				let tokensUsed = 0;
				let inputTokens = 0;
				let outputTokens = 0;

				if (result && typeof result === 'object') {
					// OpenAI format
					if (result.usage) {
						tokensUsed = result.usage.total_tokens || 0;
						inputTokens = result.usage.prompt_tokens || 0;
						outputTokens = result.usage.completion_tokens || 0;
					}
					// Anthropic format
					else if (result.token_count) {
						tokensUsed = result.token_count;
					}
					// Generic format
					else if (result.tokens) {
						tokensUsed = result.tokens;
					}
				}

				tracker.endRequest(requestId, {
					success: true,
					tokensUsed,
					inputTokens: inputTokens > 0 ? inputTokens : undefined,
					outputTokens: outputTokens > 0 ? outputTokens : undefined,
					response: result
				});

				return result;
			} catch (error) {
				tracker.endRequest(requestId, {
					success: false,
					tokensUsed: 0,
					error: error instanceof Error ? error : new Error(String(error))
				});

				throw error;
			}
		}) as T;
	}

	/**
	 * Start tracking a request
	 */
	startRequest(requestId: string, info: LLMCallInfo): void {
		this.activeRequests.set(requestId, {
			startTime: Date.now(),
			info
		});

		logger.debug('LLM request started', {
			requestId,
			provider: info.provider,
			model: info.model,
			messageLength: info.messageLength
		});
	}

	/**
	 * End tracking a request and record metrics
	 */
	endRequest(requestId: string, response: Omit<LLMResponse, 'responseTime'>): void {
		const requestData = this.activeRequests.get(requestId);
		if (!requestData) {
			logger.warn('LLM request end called for unknown request', { requestId });
			return;
		}

		const responseTime = Date.now() - requestData.startTime;
		const fullResponse: LLMResponse = {
			...response,
			responseTime
		};

		// Record metrics
		metricsCollector.trackLLMRequest(
			requestData.info.provider,
			requestData.info.model,
			responseTime,
			fullResponse.success,
			fullResponse.tokensUsed
		);

		// Log detailed performance info
		logger.info('LLM request completed', {
			requestId,
			provider: requestData.info.provider,
			model: requestData.info.model,
			success: fullResponse.success,
			responseTime,
			tokensUsed: fullResponse.tokensUsed,
			inputTokens: fullResponse.inputTokens,
			outputTokens: fullResponse.outputTokens,
			error: fullResponse.error?.message,
			messageLength: requestData.info.messageLength,
			temperature: requestData.info.temperature,
			maxTokens: requestData.info.maxTokens
		});

		// Performance warnings
		if (responseTime > 30000) { // 30 seconds
			logger.warn('Slow LLM response detected', {
				requestId,
				provider: requestData.info.provider,
				model: requestData.info.model,
				responseTime
			});
		}

		if (!fullResponse.success && fullResponse.error) {
			logger.error('LLM request failed', {
				requestId,
				provider: requestData.info.provider,
				model: requestData.info.model,
				error: fullResponse.error.message,
				stack: fullResponse.error.stack
			});
		}

		// Clean up
		this.activeRequests.delete(requestId);
	}

	/**
	 * Get current active requests
	 */
	getActiveRequests(): Array<{
		requestId: string;
		info: LLMCallInfo;
		duration: number;
	}> {
		const now = Date.now();
		return Array.from(this.activeRequests.entries()).map(([requestId, data]) => ({
			requestId,
			info: data.info,
			duration: now - data.startTime
		}));
	}

	/**
	 * Manual tracking for cases where decorator isn't suitable
	 */
	async trackManualRequest<T>(
		info: LLMCallInfo,
		requestFunction: () => Promise<T>
	): Promise<T> {
		const requestId = `manual-${info.provider}-${info.model}-${Date.now()}-${Math.random()}`;

		this.startRequest(requestId, info);

		try {
			const result = await requestFunction();

			// Try to extract tokens if result is structured
			let tokensUsed = 0;
			if (result && typeof result === 'object') {
				const resultObj = result as any;
				if (resultObj.usage && resultObj.usage.total_tokens) {
					tokensUsed = resultObj.usage.total_tokens;
				}
			}

			this.endRequest(requestId, {
				success: true,
				tokensUsed,
				response: result
			});

			return result;
		} catch (error) {
			this.endRequest(requestId, {
				success: false,
				tokensUsed: 0,
				error: error instanceof Error ? error : new Error(String(error))
			});

			throw error;
		}
	}

	/**
	 * Get performance statistics
	 */
	getPerformanceStats(): {
		activeRequests: number;
		averageResponseTime: Record<string, number>;
		errorRates: Record<string, number>;
		tokenUsage: Record<string, number>;
		requestCounts: Record<string, number>;
	} {
		const metrics = metricsCollector.getMetrics();

		const averageResponseTime: Record<string, number> = {};
		const errorRates: Record<string, number> = {};
		const tokenUsage: Record<string, number> = {};
		const requestCounts: Record<string, number> = {};

		Object.entries(metrics.llm).forEach(([key, llmMetric]) => {
			averageResponseTime[key] = llmMetric.averageResponseTime;
			errorRates[key] = llmMetric.errorRate;
			tokenUsage[key] = llmMetric.totalTokensUsed;
			requestCounts[key] = llmMetric.totalRequests;
		});

		return {
			activeRequests: this.activeRequests.size,
			averageResponseTime,
			errorRates,
			tokenUsage,
			requestCounts
		};
	}

	/**
	 * Reset all tracking data (useful for testing)
	 */
	reset(): void {
		this.activeRequests.clear();
	}
}

// Global instance
export const llmPerformanceTracker = LLMPerformanceTracker.getInstance();