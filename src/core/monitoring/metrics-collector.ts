import { EventEmitter } from 'events';

export interface SystemMetrics {
	uptime: number;
	memory: {
		used: number;
		free: number;
		total: number;
		percentage: number;
	};
	cpu: {
		percentage: number;
		loadAverage: number[];
	};
	disk: {
		used: number;
		free: number;
		total: number;
		percentage: number;
	};
	network: {
		bytesIn: number;
		bytesOut: number;
	};
}

export interface LLMMetrics {
	provider: string;
	model: string;
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	averageResponseTime: number;
	totalTokensUsed: number;
	averageTokensPerRequest: number;
	lastRequestTime: Date | null;
	errorRate: number;
	requestsPerMinute: number;
}

export interface MemoryMetrics {
	totalKnowledge: number;
	totalReflections: number;
	vectorStorageSize: number;
	averageSearchTime: number;
	totalSearches: number;
	memoryEfficiencyScore: number;
	topSearchPatterns: Array<{
		pattern: string;
		count: number;
		averageRelevance: number;
	}>;
}

export interface WebSocketMetrics {
	totalConnections: number;
	activeConnections: number;
	messagesReceived: number;
	messagesSent: number;
	averageConnectionDuration: number;
	connectionErrors: number;
}

export interface APIMetrics {
	totalRequests: number;
	requestsByEndpoint: Record<string, number>;
	averageResponseTime: Record<string, number>;
	errorsByEndpoint: Record<string, number>;
	requestsPerMinute: number;
	popularEndpoints: Array<{
		endpoint: string;
		count: number;
		averageTime: number;
	}>;
}

export interface AllMetrics {
	timestamp: Date;
	system: SystemMetrics;
	llm: Record<string, LLMMetrics>;
	memory: MemoryMetrics;
	websocket: WebSocketMetrics;
	api: APIMetrics;
	sessions: {
		total: number;
		active: number;
		averageMessageCount: number;
		totalMessages: number;
	};
}

export class MetricsCollector extends EventEmitter {
	private metrics: AllMetrics;
	private collectInterval: NodeJS.Timeout | null = null;
	private llmRequestTimes: Map<string, number[]> = new Map();
	private apiRequestTimes: Map<string, number[]> = new Map();
	private searchTimes: number[] = [];
	private connectionStartTimes: Map<string, Date> = new Map();

	constructor() {
		super();
		this.metrics = this.initializeMetrics();
	}

	private initializeMetrics(): AllMetrics {
		return {
			timestamp: new Date(),
			system: {
				uptime: process.uptime(),
				memory: {
					used: 0,
					free: 0,
					total: 0,
					percentage: 0
				},
				cpu: {
					percentage: 0,
					loadAverage: []
				},
				disk: {
					used: 0,
					free: 0,
					total: 0,
					percentage: 0
				},
				network: {
					bytesIn: 0,
					bytesOut: 0
				}
			},
			llm: {},
			memory: {
				totalKnowledge: 0,
				totalReflections: 0,
				vectorStorageSize: 0,
				averageSearchTime: 0,
				totalSearches: 0,
				memoryEfficiencyScore: 0,
				topSearchPatterns: []
			},
			websocket: {
				totalConnections: 0,
				activeConnections: 0,
				messagesReceived: 0,
				messagesSent: 0,
				averageConnectionDuration: 0,
				connectionErrors: 0
			},
			api: {
				totalRequests: 0,
				requestsByEndpoint: {},
				averageResponseTime: {},
				errorsByEndpoint: {},
				requestsPerMinute: 0,
				popularEndpoints: []
			},
			sessions: {
				total: 0,
				active: 0,
				averageMessageCount: 0,
				totalMessages: 0
			}
		};
	}

	startCollection(intervalMs: number = 60000): void {
		if (this.collectInterval) {
			clearInterval(this.collectInterval);
		}

		this.collectInterval = setInterval(async () => {
			await this.collectMetrics();
			this.emit('metricsUpdated', this.metrics);
		}, intervalMs);

		// Initial collection
		this.collectMetrics();
	}

	stopCollection(): void {
		if (this.collectInterval) {
			clearInterval(this.collectInterval);
			this.collectInterval = null;
		}
	}

	private async collectMetrics(): Promise<void> {
		this.metrics.timestamp = new Date();
		await this.collectSystemMetrics();
		this.calculateAverages();
	}

	private async collectSystemMetrics(): Promise<void> {
		const memUsage = process.memoryUsage();

		this.metrics.system.uptime = process.uptime();
		this.metrics.system.memory = {
			used: memUsage.heapUsed,
			free: memUsage.heapTotal - memUsage.heapUsed,
			total: memUsage.heapTotal,
			percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100
		};

		// Load average (Unix-like systems only)
		try {
			const os = await import('os');
			this.metrics.system.cpu.loadAverage = os.loadavg();
		} catch {
			this.metrics.system.cpu.loadAverage = [0, 0, 0];
		}
	}

	private calculateAverages(): void {
		// Calculate LLM averages
		for (const [provider, times] of this.llmRequestTimes.entries()) {
			if (times.length > 0) {
				const avg = times.reduce((a, b) => a + b, 0) / times.length;
				if (this.metrics.llm[provider]) {
					this.metrics.llm[provider].averageResponseTime = avg;
				}
			}
		}

		// Calculate API averages
		for (const [endpoint, times] of this.apiRequestTimes.entries()) {
			if (times.length > 0) {
				const avg = times.reduce((a, b) => a + b, 0) / times.length;
				this.metrics.api.averageResponseTime[endpoint] = avg;
			}
		}

		// Calculate memory search average
		if (this.searchTimes.length > 0) {
			this.metrics.memory.averageSearchTime =
				this.searchTimes.reduce((a, b) => a + b, 0) / this.searchTimes.length;
		}

		// Update popular endpoints
		this.metrics.api.popularEndpoints = Object.entries(this.metrics.api.requestsByEndpoint)
			.map(([endpoint, count]) => ({
				endpoint,
				count,
				averageTime: this.metrics.api.averageResponseTime[endpoint] || 0
			}))
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);
	}

	// Event tracking methods
	trackLLMRequest(provider: string, model: string, responseTime: number, success: boolean, tokensUsed: number = 0): void {
		const key = `${provider}:${model}`;

		if (!this.metrics.llm[key]) {
			this.metrics.llm[key] = {
				provider,
				model,
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				averageResponseTime: 0,
				totalTokensUsed: 0,
				averageTokensPerRequest: 0,
				lastRequestTime: null,
				errorRate: 0,
				requestsPerMinute: 0
			};
		}

		const llmMetric = this.metrics.llm[key];
		llmMetric.totalRequests++;
		llmMetric.totalTokensUsed += tokensUsed;
		llmMetric.lastRequestTime = new Date();

		if (success) {
			llmMetric.successfulRequests++;
		} else {
			llmMetric.failedRequests++;
		}

		llmMetric.errorRate = llmMetric.failedRequests / llmMetric.totalRequests;
		llmMetric.averageTokensPerRequest = llmMetric.totalTokensUsed / llmMetric.totalRequests;

		// Track response time
		if (!this.llmRequestTimes.has(key)) {
			this.llmRequestTimes.set(key, []);
		}
		const times = this.llmRequestTimes.get(key)!;
		times.push(responseTime);

		// Keep only last 100 measurements
		if (times.length > 100) {
			times.shift();
		}
	}

	trackAPIRequest(endpoint: string, responseTime: number, success: boolean): void {
		this.metrics.api.totalRequests++;

		if (!this.metrics.api.requestsByEndpoint[endpoint]) {
			this.metrics.api.requestsByEndpoint[endpoint] = 0;
		}
		this.metrics.api.requestsByEndpoint[endpoint]++;

		if (!success) {
			if (!this.metrics.api.errorsByEndpoint[endpoint]) {
				this.metrics.api.errorsByEndpoint[endpoint] = 0;
			}
			this.metrics.api.errorsByEndpoint[endpoint]++;
		}

		// Track response time
		if (!this.apiRequestTimes.has(endpoint)) {
			this.apiRequestTimes.set(endpoint, []);
		}
		const times = this.apiRequestTimes.get(endpoint)!;
		times.push(responseTime);

		// Keep only last 100 measurements
		if (times.length > 100) {
			times.shift();
		}
	}

	trackMemorySearch(searchTime: number, pattern: string, relevanceScore: number = 0): void {
		this.metrics.memory.totalSearches++;
		this.searchTimes.push(searchTime);

		// Keep only last 1000 measurements
		if (this.searchTimes.length > 1000) {
			this.searchTimes.shift();
		}

		// Update search patterns
		let patternEntry = this.metrics.memory.topSearchPatterns.find(p => p.pattern === pattern);
		if (!patternEntry) {
			patternEntry = { pattern, count: 0, averageRelevance: 0 };
			this.metrics.memory.topSearchPatterns.push(patternEntry);
		}

		// Update pattern statistics
		const oldAvg = patternEntry.averageRelevance;
		const oldCount = patternEntry.count;
		patternEntry.count++;
		patternEntry.averageRelevance = (oldAvg * oldCount + relevanceScore) / patternEntry.count;

		// Keep only top 20 patterns
		this.metrics.memory.topSearchPatterns.sort((a, b) => b.count - a.count);
		this.metrics.memory.topSearchPatterns = this.metrics.memory.topSearchPatterns.slice(0, 20);
	}

	trackWebSocketConnection(connectionId: string): void {
		this.metrics.websocket.totalConnections++;
		this.metrics.websocket.activeConnections++;
		this.connectionStartTimes.set(connectionId, new Date());
	}

	trackWebSocketDisconnection(connectionId: string): void {
		this.metrics.websocket.activeConnections = Math.max(0, this.metrics.websocket.activeConnections - 1);

		const startTime = this.connectionStartTimes.get(connectionId);
		if (startTime) {
			const duration = Date.now() - startTime.getTime();
			const currentAvg = this.metrics.websocket.averageConnectionDuration;
			const totalConnections = this.metrics.websocket.totalConnections;

			this.metrics.websocket.averageConnectionDuration =
				(currentAvg * (totalConnections - 1) + duration) / totalConnections;

			this.connectionStartTimes.delete(connectionId);
		}
	}

	trackWebSocketMessage(incoming: boolean): void {
		if (incoming) {
			this.metrics.websocket.messagesReceived++;
		} else {
			this.metrics.websocket.messagesSent++;
		}
	}

	trackWebSocketError(): void {
		this.metrics.websocket.connectionErrors++;
	}

	updateMemoryMetrics(knowledge: number, reflections: number, vectorSize: number): void {
		this.metrics.memory.totalKnowledge = knowledge;
		this.metrics.memory.totalReflections = reflections;
		this.metrics.memory.vectorStorageSize = vectorSize;

		// Calculate efficiency score based on search success rate and relevance
		const avgRelevance = this.metrics.memory.topSearchPatterns.length > 0
			? this.metrics.memory.topSearchPatterns.reduce((sum, p) => sum + p.averageRelevance, 0) / this.metrics.memory.topSearchPatterns.length
			: 0;

		this.metrics.memory.memoryEfficiencyScore = Math.min(100, avgRelevance * 100);
	}

	updateSessionMetrics(total: number, active: number, totalMessages: number): void {
		this.metrics.sessions.total = total;
		this.metrics.sessions.active = active;
		this.metrics.sessions.totalMessages = totalMessages;
		this.metrics.sessions.averageMessageCount = total > 0 ? totalMessages / total : 0;
	}

	getMetrics(): AllMetrics {
		return { ...this.metrics };
	}

	getHealthStatus(): { status: 'healthy' | 'warning' | 'critical', issues: string[] } {
		const issues: string[] = [];
		let status: 'healthy' | 'warning' | 'critical' = 'healthy';

		// Check memory usage
		if (this.metrics.system.memory.percentage > 90) {
			issues.push('High memory usage (>90%)');
			status = 'critical';
		} else if (this.metrics.system.memory.percentage > 75) {
			issues.push('Elevated memory usage (>75%)');
			if (status === 'healthy') status = 'warning';
		}

		// Check error rates
		Object.entries(this.metrics.llm).forEach(([key, llm]) => {
			if (llm.errorRate > 0.1) {
				issues.push(`High LLM error rate for ${key}: ${(llm.errorRate * 100).toFixed(1)}%`);
				status = 'critical';
			} else if (llm.errorRate > 0.05) {
				issues.push(`Elevated LLM error rate for ${key}: ${(llm.errorRate * 100).toFixed(1)}%`);
				if (status === 'healthy') status = 'warning';
			}
		});

		// Check WebSocket errors
		const wsErrorRate = this.metrics.websocket.totalConnections > 0
			? this.metrics.websocket.connectionErrors / this.metrics.websocket.totalConnections
			: 0;

		if (wsErrorRate > 0.1) {
			issues.push(`High WebSocket error rate: ${(wsErrorRate * 100).toFixed(1)}%`);
			status = 'critical';
		}

		return { status, issues };
	}

	reset(): void {
		this.metrics = this.initializeMetrics();
		this.llmRequestTimes.clear();
		this.apiRequestTimes.clear();
		this.searchTimes = [];
		this.connectionStartTimes.clear();
	}
}

export const metricsCollector = new MetricsCollector();