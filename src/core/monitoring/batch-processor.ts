import { logger } from '../logger/index.js';

export interface BatchItem {
	id: string;
	timestamp: Date;
	data: any;
	type: string;
}

export interface BatchProcessorConfig {
	batchSize: number;
	flushInterval: number; // milliseconds
	maxRetries: number;
	retryDelay: number; // milliseconds
}

export class BatchProcessor {
	private batch: BatchItem[] = [];
	private flushTimer: NodeJS.Timeout | null = null;
	private processing = false;
	private retryCount = 0;

	constructor(
		private config: BatchProcessorConfig,
		private processor: (items: BatchItem[]) => Promise<void>
	) {
		this.startFlushTimer();
	}

	/**
	 * Add item to batch
	 */
	add(item: BatchItem): void {
		this.batch.push(item);

		// Flush if batch size reached
		if (this.batch.length >= this.config.batchSize) {
			this.flush();
		}
	}

	/**
	 * Force flush current batch
	 */
	async flush(): Promise<void> {
		if (this.batch.length === 0 || this.processing) {
			return;
		}

		this.processing = true;
		const currentBatch = [...this.batch];
		this.batch = [];

		try {
			await this.processor(currentBatch);
			this.retryCount = 0; // Reset retry count on success
		} catch (error) {
			logger.error('Batch processing failed', {
				batchSize: currentBatch.length,
				attempt: this.retryCount + 1,
				error: error instanceof Error ? error.message : String(error)
			});

			// Retry logic
			if (this.retryCount < this.config.maxRetries) {
				this.retryCount++;

				// Add items back to batch for retry
				this.batch.unshift(...currentBatch);

				// Schedule retry with delay
				setTimeout(() => {
					this.processing = false;
					this.flush();
				}, this.config.retryDelay * this.retryCount);
				return;
			} else {
				logger.error('Batch processing failed permanently, dropping batch', {
					batchSize: currentBatch.length,
					maxRetries: this.config.maxRetries
				});
				this.retryCount = 0;
			}
		} finally {
			if (this.retryCount === 0) {
				this.processing = false;
			}
		}
	}

	/**
	 * Get current batch size
	 */
	getBatchSize(): number {
		return this.batch.length;
	}

	/**
	 * Check if processor is currently processing
	 */
	isProcessing(): boolean {
		return this.processing;
	}

	/**
	 * Start automatic flush timer
	 */
	private startFlushTimer(): void {
		this.flushTimer = setInterval(() => {
			this.flush();
		}, this.config.flushInterval);
	}

	/**
	 * Stop batch processor and flush remaining items
	 */
	async shutdown(): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}

		// Flush remaining items
		await this.flush();
	}
}

/**
 * Metrics Batch Processor - optimizes metrics collection
 */
export class MetricsBatchProcessor {
	private static instance: MetricsBatchProcessor;
	private batchProcessor: BatchProcessor;
	private metricsBuffer: Map<string, any> = new Map();

	private constructor() {
		const config: BatchProcessorConfig = {
			batchSize: parseInt(process.env.METRICS_BATCH_SIZE || '100'),
			flushInterval: parseInt(process.env.METRICS_FLUSH_INTERVAL || '10000'), // 10 seconds
			maxRetries: 3,
			retryDelay: 1000
		};

		this.batchProcessor = new BatchProcessor(config, this.processMetricsBatch.bind(this));
	}

	static getInstance(): MetricsBatchProcessor {
		if (!MetricsBatchProcessor.instance) {
			MetricsBatchProcessor.instance = new MetricsBatchProcessor();
		}
		return MetricsBatchProcessor.instance;
	}

	/**
	 * Add metrics data to batch
	 */
	addMetrics(type: string, data: any): void {
		const item: BatchItem = {
			id: `${type}-${Date.now()}-${Math.random()}`,
			timestamp: new Date(),
			data,
			type
		};

		this.batchProcessor.add(item);
	}

	/**
	 * Batch update for API requests
	 */
	batchAPIRequest(endpoint: string, responseTime: number, success: boolean): void {
		const key = `api-${endpoint}`;

		if (!this.metricsBuffer.has(key)) {
			this.metricsBuffer.set(key, {
				endpoint,
				requests: [],
				totalTime: 0,
				successCount: 0,
				errorCount: 0
			});
		}

		const buffer = this.metricsBuffer.get(key);
		buffer.requests.push({ responseTime, success, timestamp: Date.now() });
		buffer.totalTime += responseTime;

		if (success) {
			buffer.successCount++;
		} else {
			buffer.errorCount++;
		}

		// Add to batch when buffer reaches threshold
		if (buffer.requests.length >= 10) {
			this.addMetrics('api_batch', { ...buffer });
			this.metricsBuffer.delete(key);
		}
	}

	/**
	 * Batch update for LLM requests
	 */
	batchLLMRequest(provider: string, model: string, responseTime: number, success: boolean, tokensUsed: number): void {
		const key = `llm-${provider}-${model}`;

		if (!this.metricsBuffer.has(key)) {
			this.metricsBuffer.set(key, {
				provider,
				model,
				requests: [],
				totalTime: 0,
				totalTokens: 0,
				successCount: 0,
				errorCount: 0
			});
		}

		const buffer = this.metricsBuffer.get(key);
		buffer.requests.push({ responseTime, success, tokensUsed, timestamp: Date.now() });
		buffer.totalTime += responseTime;
		buffer.totalTokens += tokensUsed;

		if (success) {
			buffer.successCount++;
		} else {
			buffer.errorCount++;
		}

		// Add to batch when buffer reaches threshold
		if (buffer.requests.length >= 5) {
			this.addMetrics('llm_batch', { ...buffer });
			this.metricsBuffer.delete(key);
		}
	}

	/**
	 * Batch update for memory searches
	 */
	batchMemorySearch(searchTime: number, pattern: string, relevanceScore: number): void {
		const key = 'memory_search';

		if (!this.metricsBuffer.has(key)) {
			this.metricsBuffer.set(key, {
				searches: [],
				patterns: new Map(),
				totalTime: 0,
				totalRelevance: 0
			});
		}

		const buffer = this.metricsBuffer.get(key);
		buffer.searches.push({ searchTime, pattern, relevanceScore, timestamp: Date.now() });
		buffer.totalTime += searchTime;
		buffer.totalRelevance += relevanceScore;

		// Update pattern statistics
		const patternStats = buffer.patterns.get(pattern) || { count: 0, totalRelevance: 0 };
		patternStats.count++;
		patternStats.totalRelevance += relevanceScore;
		buffer.patterns.set(pattern, patternStats);

		// Add to batch when buffer reaches threshold
		if (buffer.searches.length >= 20) {
			// Convert Map to array for serialization
			const patterns = Array.from(buffer.patterns.entries() as IterableIterator<[string, any]>).map(([pattern, stats]) => ({
				pattern,
				count: stats.count,
				averageRelevance: stats.totalRelevance / stats.count
			}));

			this.addMetrics('memory_batch', {
				...buffer,
				patterns
			});
			this.metricsBuffer.delete(key);
		}
	}

	/**
	 * Force flush all buffered metrics
	 */
	async flushBuffered(): Promise<void> {
		// Add all buffered data to batch
		for (const [key, data] of this.metricsBuffer.entries()) {
			const type = key.startsWith('api-') ? 'api_batch' :
				key.startsWith('llm-') ? 'llm_batch' :
				key.startsWith('memory') ? 'memory_batch' : 'unknown';

			this.addMetrics(type, data);
		}

		this.metricsBuffer.clear();

		// Flush batch processor
		await this.batchProcessor.flush();
	}

	/**
	 * Get statistics about the batch processor
	 */
	getStats(): {
		currentBatchSize: number;
		bufferedMetrics: number;
		isProcessing: boolean;
		bufferKeys: string[];
	} {
		return {
			currentBatchSize: this.batchProcessor.getBatchSize(),
			bufferedMetrics: this.metricsBuffer.size,
			isProcessing: this.batchProcessor.isProcessing(),
			bufferKeys: Array.from(this.metricsBuffer.keys())
		};
	}

	/**
	 * Process batch of metrics items
	 */
	private async processMetricsBatch(items: BatchItem[]): Promise<void> {
		try {
			// Group items by type for efficient processing
			const grouped = new Map<string, BatchItem[]>();

			for (const item of items) {
				if (!grouped.has(item.type)) {
					grouped.set(item.type, []);
				}
				grouped.get(item.type)!.push(item);
			}

			// Process each type
			for (const [type, typeItems] of grouped) {
				await this.processMetricsByType(type, typeItems);
			}

			logger.debug('Metrics batch processed successfully', {
				totalItems: items.length,
				types: Array.from(grouped.keys())
			});
		} catch (error) {
			logger.error('Error processing metrics batch', {
				error: error instanceof Error ? error.message : String(error),
				itemCount: items.length
			});
			throw error;
		}
	}

	/**
	 * Process metrics items by type
	 */
	private async processMetricsByType(type: string, items: BatchItem[]): Promise<void> {
		const { metricsCollector } = await import('./metrics-collector.js');

		switch (type) {
			case 'api_batch':
				for (const item of items) {
					const data = item.data;
					const avgResponseTime = data.totalTime / data.requests.length;
					const successRate = data.successCount / data.requests.length;

					metricsCollector.trackAPIRequest(data.endpoint, avgResponseTime, successRate > 0.5);
				}
				break;

			case 'llm_batch':
				for (const item of items) {
					const data = item.data;
					const avgResponseTime = data.totalTime / data.requests.length;
					const avgTokens = data.totalTokens / data.requests.length;
					const successRate = data.successCount / data.requests.length;

					metricsCollector.trackLLMRequest(
						data.provider,
						data.model,
						avgResponseTime,
						successRate > 0.5,
						avgTokens
					);
				}
				break;

			case 'memory_batch':
				for (const item of items) {
					const data = item.data;
					const avgSearchTime = data.totalTime / data.searches.length;
					const avgRelevance = data.totalRelevance / data.searches.length;

					// Update search metrics
					for (const pattern of data.patterns) {
						metricsCollector.trackMemorySearch(avgSearchTime, pattern.pattern, pattern.averageRelevance);
					}
				}
				break;

			default:
				logger.warn('Unknown metrics batch type', { type });
		}
	}

	/**
	 * Shutdown the batch processor
	 */
	async shutdown(): Promise<void> {
		await this.flushBuffered();
		await this.batchProcessor.shutdown();
	}
}

export const metricsBatchProcessor = MetricsBatchProcessor.getInstance();