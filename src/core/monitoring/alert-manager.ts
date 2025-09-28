import { EventEmitter } from 'events';
import { logger } from '../logger/index.js';
import { metricsCollector } from './metrics-collector.js';
import { errorTracker } from './error-tracker.js';

export interface AlertRule {
	id: string;
	name: string;
	condition: string;
	threshold: number;
	severity: 'info' | 'warning' | 'critical' | 'emergency';
	enabled: boolean;
	cooldown: number; // milliseconds
	lastTriggered?: number;
	description?: string;
}

export interface Alert {
	id: string;
	ruleId: string;
	ruleName: string;
	severity: 'info' | 'warning' | 'critical' | 'emergency';
	message: string;
	value: number;
	threshold: number;
	timestamp: Date;
	resolved?: boolean;
	resolvedAt?: Date;
}

export class AlertManager extends EventEmitter {
	private static instance: AlertManager;
	private rules: Map<string, AlertRule> = new Map();
	private activeAlerts: Map<string, Alert> = new Map();
	private checkInterval: NodeJS.Timeout | null = null;
	private alertHistory: Alert[] = [];
	private maxHistorySize = 1000;

	// Default alert rules
	private defaultRules: AlertRule[] = [
		{
			id: 'high_memory_usage',
			name: 'High Memory Usage',
			condition: 'memory_percentage',
			threshold: 90,
			severity: 'critical',
			enabled: true,
			cooldown: 300000, // 5 minutes
			description: 'Memory usage exceeds 90%'
		},
		{
			id: 'elevated_memory_usage',
			name: 'Elevated Memory Usage',
			condition: 'memory_percentage',
			threshold: 75,
			severity: 'warning',
			enabled: true,
			cooldown: 300000,
			description: 'Memory usage exceeds 75%'
		},
		{
			id: 'high_error_rate',
			name: 'High Error Rate',
			condition: 'error_rate',
			threshold: 0.1,
			severity: 'critical',
			enabled: true,
			cooldown: 180000, // 3 minutes
			description: 'Error rate exceeds 10%'
		},
		{
			id: 'llm_slow_response',
			name: 'LLM Slow Response',
			condition: 'llm_avg_response_time',
			threshold: 30000,
			severity: 'warning',
			enabled: true,
			cooldown: 600000, // 10 minutes
			description: 'LLM average response time exceeds 30 seconds'
		},
		{
			id: 'websocket_connection_errors',
			name: 'WebSocket Connection Errors',
			condition: 'websocket_error_rate',
			threshold: 0.1,
			severity: 'warning',
			enabled: true,
			cooldown: 300000,
			description: 'WebSocket connection error rate exceeds 10%'
		},
		{
			id: 'api_response_time',
			name: 'Slow API Response Time',
			condition: 'api_avg_response_time',
			threshold: 5000,
			severity: 'warning',
			enabled: true,
			cooldown: 300000,
			description: 'API average response time exceeds 5 seconds'
		}
	];

	private constructor() {
		super();
		this.initializeDefaultRules();
	}

	static getInstance(): AlertManager {
		if (!AlertManager.instance) {
			AlertManager.instance = new AlertManager();
		}
		return AlertManager.instance;
	}

	private initializeDefaultRules(): void {
		for (const rule of this.defaultRules) {
			this.rules.set(rule.id, rule);
		}
		logger.info('AlertManager initialized with default rules', {
			rulesCount: this.rules.size
		});
	}

	/**
	 * Start alert monitoring
	 */
	start(checkIntervalMs: number = 30000): void {
		if (this.checkInterval) {
			this.stop();
		}

		this.checkInterval = setInterval(() => {
			this.checkAlerts();
		}, checkIntervalMs);

		logger.info('AlertManager started', { checkIntervalMs });
	}

	/**
	 * Stop alert monitoring
	 */
	stop(): void {
		if (this.checkInterval) {
			clearInterval(this.checkInterval);
			this.checkInterval = null;
		}
		logger.info('AlertManager stopped');
	}

	/**
	 * Add or update an alert rule
	 */
	addRule(rule: AlertRule): void {
		this.rules.set(rule.id, rule);
		logger.info('Alert rule added/updated', { ruleId: rule.id, ruleName: rule.name });
	}

	/**
	 * Remove an alert rule
	 */
	removeRule(ruleId: string): boolean {
		const removed = this.rules.delete(ruleId);
		if (removed) {
			// Remove any active alerts for this rule
			for (const [alertId, alert] of this.activeAlerts) {
				if (alert.ruleId === ruleId) {
					this.activeAlerts.delete(alertId);
				}
			}
			logger.info('Alert rule removed', { ruleId });
		}
		return removed;
	}

	/**
	 * Enable/disable an alert rule
	 */
	toggleRule(ruleId: string, enabled: boolean): boolean {
		const rule = this.rules.get(ruleId);
		if (rule) {
			rule.enabled = enabled;
			logger.info('Alert rule toggled', { ruleId, enabled });
			return true;
		}
		return false;
	}

	/**
	 * Get all alert rules
	 */
	getRules(): AlertRule[] {
		return Array.from(this.rules.values());
	}

	/**
	 * Get active alerts
	 */
	getActiveAlerts(): Alert[] {
		return Array.from(this.activeAlerts.values());
	}

	/**
	 * Get alert history
	 */
	getAlertHistory(limit: number = 50): Alert[] {
		return this.alertHistory.slice(0, limit);
	}

	/**
	 * Resolve an active alert
	 */
	resolveAlert(alertId: string): boolean {
		const alert = this.activeAlerts.get(alertId);
		if (alert) {
			alert.resolved = true;
			alert.resolvedAt = new Date();
			this.activeAlerts.delete(alertId);
			this.addToHistory(alert);

			this.emit('alertResolved', alert);
			logger.info('Alert resolved', { alertId, ruleName: alert.ruleName });
			return true;
		}
		return false;
	}

	/**
	 * Check all enabled rules and trigger alerts if needed
	 */
	private checkAlerts(): void {
		try {
			const metrics = metricsCollector.getMetrics();
			const errorStats = errorTracker.getErrorStats();

			for (const rule of this.rules.values()) {
				if (!rule.enabled) continue;

				// Check cooldown period
				if (rule.lastTriggered && (Date.now() - rule.lastTriggered) < rule.cooldown) {
					continue;
				}

				const value = this.evaluateCondition(rule.condition, metrics, errorStats);
				if (value !== null && this.shouldTriggerAlert(rule, value)) {
					this.triggerAlert(rule, value);
				}
			}
		} catch (error) {
			logger.error('Error checking alerts', {
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Evaluate alert condition and return current value
	 */
	private evaluateCondition(condition: string, metrics: any, errorStats: any): number | null {
		switch (condition) {
			case 'memory_percentage':
				return metrics.system.memory.percentage;

			case 'error_rate': {
				const totalRequests = metrics.api.totalRequests;
				const totalErrors = Object.values(errorStats.errorsByType).reduce((sum: number, count: any) => sum + count, 0);
				return totalRequests > 0 ? totalErrors / totalRequests : 0;
			}

			case 'llm_avg_response_time': {
				const llmMetrics = Object.values(metrics.llm);
				if (llmMetrics.length === 0) return null;
				const avgResponseTime = llmMetrics.reduce((sum: number, llm: any) => sum + llm.averageResponseTime, 0) / llmMetrics.length;
				return avgResponseTime;
			}

			case 'websocket_error_rate': {
				const totalConnections = metrics.websocket.totalConnections || 0;
				const connectionErrors = metrics.websocket.connectionErrors || 0;
				return totalConnections > 0 ? connectionErrors / totalConnections : 0;
			}

			case 'api_avg_response_time': {
				const responseTimeValues = Object.values(metrics.api.averageResponseTime || {});
				if (responseTimeValues.length === 0) return null;
				return responseTimeValues.reduce((sum: number, time: any) => sum + time, 0) / responseTimeValues.length;
			}

			default:
				logger.warn('Unknown alert condition', { condition });
				return null;
		}
	}

	/**
	 * Check if alert should be triggered based on rule and current value
	 */
	private shouldTriggerAlert(rule: AlertRule, value: number): boolean {
		// Check if alert is already active for this rule
		const existingAlert = Array.from(this.activeAlerts.values()).find(alert => alert.ruleId === rule.id);
		if (existingAlert) {
			return false; // Alert already active
		}

		return value >= rule.threshold;
	}

	/**
	 * Trigger an alert
	 */
	triggerAlert(rule: AlertRule, value: number): void;
	triggerAlert(alertData: { id: string; severity: string; title: string; message: string; data?: any }): void;
	triggerAlert(ruleOrAlertData: AlertRule | { id: string; severity: string; title: string; message: string; data?: any }, value?: number): void {
		// Check if it's the new alert data format
		if ('title' in ruleOrAlertData && 'severity' in ruleOrAlertData) {
			const alertData = ruleOrAlertData;
			const alertId = `${alertData.id}_${Date.now()}`;
			const alert: Alert = {
				id: alertId,
				ruleId: alertData.id,
				ruleName: alertData.title,
				severity: alertData.severity as 'info' | 'warning' | 'critical' | 'emergency',
				message: alertData.message,
				value: alertData.data?.value || 0,
				threshold: alertData.data?.threshold || 0,
				timestamp: new Date(),
				resolved: false
			};

			this.activeAlerts.set(alertId, alert);

			// Emit alert event
			this.emit('alertTriggered', alert);

			logger.warn('Alert triggered', {
				alertId,
				ruleId: alertData.id,
				ruleName: alertData.title,
				severity: alertData.severity,
				message: alertData.message
			});
		} else {
			// Original rule-based alert format
			const rule = ruleOrAlertData as AlertRule;
			const alertValue = value!;
			const alertId = `${rule.id}_${Date.now()}`;
			const alert: Alert = {
				id: alertId,
				ruleId: rule.id,
				ruleName: rule.name,
				severity: rule.severity,
				message: `${rule.description || rule.name}: ${alertValue.toFixed(2)} exceeds threshold ${rule.threshold}`,
				value: alertValue,
				threshold: rule.threshold,
				timestamp: new Date(),
				resolved: false
			};

			this.activeAlerts.set(alertId, alert);
			rule.lastTriggered = Date.now();

			// Emit alert event
			this.emit('alertTriggered', alert);

			logger.warn('Alert triggered', {
				alertId,
				ruleId: rule.id,
				ruleName: rule.name,
				severity: rule.severity,
				value: alertValue,
				threshold: rule.threshold
			});
		}
	}

	/**
	 * Add alert to history
	 */
	private addToHistory(alert: Alert): void {
		this.alertHistory.unshift(alert);

		// Maintain history size limit
		if (this.alertHistory.length > this.maxHistorySize) {
			this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
		}
	}

	/**
	 * Get alert statistics
	 */
	getAlertStats(): {
		activeAlertsCount: number;
		totalAlertsToday: number;
		alertsByRule: Record<string, number>;
		alertsBySeverity: Record<string, number>;
	} {
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const todayAlerts = this.alertHistory.filter(alert => alert.timestamp >= today);

		const alertsByRule: Record<string, number> = {};
		const alertsBySeverity: Record<string, number> = {};

		for (const alert of todayAlerts) {
			alertsByRule[alert.ruleId] = (alertsByRule[alert.ruleId] || 0) + 1;
			alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;
		}

		return {
			activeAlertsCount: this.activeAlerts.size,
			totalAlertsToday: todayAlerts.length,
			alertsByRule,
			alertsBySeverity
		};
	}

	/**
	 * Reset alert manager (for testing)
	 */
	reset(): void {
		this.activeAlerts.clear();
		this.alertHistory = [];

		// Reset rule triggers
		for (const rule of this.rules.values()) {
			delete rule.lastTriggered;
		}

		logger.info('AlertManager reset');
	}
}

export const alertManager = AlertManager.getInstance();