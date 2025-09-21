import chalk from 'chalk';
import { TokenCount } from '../../core/brain/llm/tokenizer/types.js';
import { getTokenizerCache } from '../../core/brain/llm/tokenizer/cache.js';

/**
 * Interface for session token statistics
 */
export interface SessionTokenStats {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	requestCount: number;
	estimatedCost: number;
	provider: string;
	model: string;
	startTime: number;
	lastRequestTime: number;
}

/**
 * Token statistics tracker for CLI sessions
 */
export class TokenStatsTracker {
	private sessionStats: SessionTokenStats;
	private displayInterval?: NodeJS.Timeout | undefined;
	private isDisplayEnabled: boolean = true;

	constructor(provider: string = 'unknown', model: string = 'unknown') {
		this.sessionStats = {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			requestCount: 0,
			estimatedCost: 0,
			provider,
			model,
			startTime: Date.now(),
			lastRequestTime: Date.now(),
		};
	}

	/**
	 * Record input tokens for a request
	 */
	addInputTokens(count: TokenCount): void {
		this.sessionStats.inputTokens += count.total;
		this.sessionStats.totalTokens += count.total;
		this.sessionStats.requestCount++;
		this.sessionStats.lastRequestTime = Date.now();
		this.sessionStats.provider = count.provider;
		this.sessionStats.model = count.model;
		this.updateEstimatedCost();
	}

	/**
	 * Record output tokens for a response
	 */
	addOutputTokens(count: TokenCount): void {
		this.sessionStats.outputTokens += count.total;
		this.sessionStats.totalTokens += count.total;
		this.sessionStats.lastRequestTime = Date.now();
		this.updateEstimatedCost();
	}

	/**
	 * Update estimated cost based on provider and token usage
	 */
	private updateEstimatedCost(): void {
		// Approximate pricing per 1K tokens (as of 2024)
		const pricing: Record<string, { input: number; output: number }> = {
			openai: { input: 0.0015, output: 0.002 }, // GPT-4 turbo approximate
			anthropic: { input: 0.003, output: 0.015 }, // Claude-3 approximate
			google: { input: 0.00125, output: 0.00375 }, // Gemini Pro approximate
			gemini: { input: 0.00125, output: 0.00375 }, // Gemini Pro approximate
			default: { input: 0.002, output: 0.006 }, // Average estimate
		};

		const rates = pricing[this.sessionStats.provider.toLowerCase()] || pricing.default;

		const inputCost = (this.sessionStats.inputTokens / 1000) * rates!.input;
		const outputCost = (this.sessionStats.outputTokens / 1000) * rates!.output;

		this.sessionStats.estimatedCost = inputCost + outputCost;
	}

	/**
	 * Get current session statistics
	 */
	getStats(): SessionTokenStats {
		return { ...this.sessionStats };
	}

	/**
	 * Display current statistics in terminal
	 */
	displayStats(): void {
		if (!this.isDisplayEnabled) return;

		const duration = Date.now() - this.sessionStats.startTime;
		const minutes = Math.floor(duration / 60000);
		const seconds = Math.floor((duration % 60000) / 1000);

		console.log(chalk.cyan('\n Token Usage Statistics'));
		console.log(chalk.gray(''.repeat(50)));

		// Provider and model info
		console.log(chalk.white(` Provider: ${chalk.green(this.sessionStats.provider)} | Model: ${chalk.green(this.sessionStats.model)}`));

		// Token statistics
		console.log(chalk.white(` Input Tokens:  ${chalk.yellow(this.sessionStats.inputTokens.toLocaleString())}`));
		console.log(chalk.white(` Output Tokens: ${chalk.yellow(this.sessionStats.outputTokens.toLocaleString())}`));
		console.log(chalk.white(` Total Tokens:  ${chalk.bold.yellow(this.sessionStats.totalTokens.toLocaleString())}`));

		// Request statistics
		console.log(chalk.white(` Requests: ${chalk.blue(this.sessionStats.requestCount)}`));
		console.log(chalk.white(`  Session Time: ${chalk.magenta(minutes)}m ${chalk.magenta(seconds)}s`));

		// Cost estimation
		console.log(chalk.white(` Est. Cost: ${chalk.green('$' + this.sessionStats.estimatedCost.toFixed(4))}`));

		// Cache statistics
		const cacheStats = getTokenizerCache().getStats();
		console.log(chalk.white(` Cache: ${chalk.cyan(cacheStats.cacheSize)} entries, ${chalk.cyan((cacheStats.hitRate * 100).toFixed(1))}% hit rate`));

		console.log(chalk.gray(''.repeat(50)));
	}

	/**
	 * Display compact one-line statistics
	 */
	displayCompactStats(): void {
		if (!this.isDisplayEnabled) return;

		const cost = this.sessionStats.estimatedCost.toFixed(4);
		const total = this.sessionStats.totalTokens.toLocaleString();
		const requests = this.sessionStats.requestCount;

		console.log(chalk.gray(`[${chalk.yellow(total)} tokens | ${chalk.blue(requests)} requests | ${chalk.green('$' + cost)}]`));
	}

	/**
	 * Start auto-display of statistics (every 10 requests)
	 */
	startAutoDisplay(): void {
		if (this.displayInterval) {
			clearInterval(this.displayInterval);
		}

		// Display stats every 5 minutes or after every 10 requests
		this.displayInterval = setInterval(() => {
			if (this.sessionStats.requestCount % 10 === 0 && this.sessionStats.requestCount > 0) {
				this.displayStats();
			}
		}, 300000); // 5 minutes
	}

	/**
	 * Stop auto-display
	 */
	stopAutoDisplay(): void {
		if (this.displayInterval) {
			clearInterval(this.displayInterval);
			this.displayInterval = undefined;
		}
	}

	/**
	 * Toggle display on/off
	 */
	toggleDisplay(enabled?: boolean): void {
		this.isDisplayEnabled = enabled !== undefined ? enabled : !this.isDisplayEnabled;
		console.log(chalk.cyan(`Token statistics display ${this.isDisplayEnabled ? 'enabled' : 'disabled'}`));
	}

	/**
	 * Reset statistics
	 */
	reset(): void {
		const provider = this.sessionStats.provider;
		const model = this.sessionStats.model;

		this.sessionStats = {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			requestCount: 0,
			estimatedCost: 0,
			provider,
			model,
			startTime: Date.now(),
			lastRequestTime: Date.now(),
		};

		console.log(chalk.green(' Token statistics reset'));
	}

	/**
	 * Create a summary report
	 */
	generateReport(): string {
		const duration = Date.now() - this.sessionStats.startTime;
		const hours = Math.floor(duration / 3600000);
		const minutes = Math.floor((duration % 3600000) / 60000);

		const avgTokensPerRequest = this.sessionStats.requestCount > 0
			? (this.sessionStats.totalTokens / this.sessionStats.requestCount).toFixed(1)
			: '0';

		return `
${chalk.cyan(' Token Usage Report')}
${chalk.gray(''.repeat(40))}
Provider: ${this.sessionStats.provider}
Model: ${this.sessionStats.model}
Session Duration: ${hours}h ${minutes}m
Total Requests: ${this.sessionStats.requestCount}
Input Tokens: ${this.sessionStats.inputTokens.toLocaleString()}
Output Tokens: ${this.sessionStats.outputTokens.toLocaleString()}
Total Tokens: ${this.sessionStats.totalTokens.toLocaleString()}
Avg Tokens/Request: ${avgTokensPerRequest}
Estimated Cost: $${this.sessionStats.estimatedCost.toFixed(4)}
${chalk.gray(''.repeat(40))}
		`.trim();
	}
}

/**
 * Global token stats tracker instance
 */
let globalTokenTracker: TokenStatsTracker | null = null;

/**
 * Get or create global token tracker
 */
export function getTokenTracker(provider?: string, model?: string): TokenStatsTracker {
	if (!globalTokenTracker) {
		globalTokenTracker = new TokenStatsTracker(provider, model);
	}
	return globalTokenTracker;
}

/**
 * Reset global token tracker
 */
export function resetTokenTracker(): void {
	if (globalTokenTracker) {
		globalTokenTracker.reset();
	}
}
