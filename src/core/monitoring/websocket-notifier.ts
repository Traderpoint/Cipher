import { WebSocket } from 'ws';
import { logger } from '../logger/index.js';
import { alertManager, Alert } from './alert-manager.js';

export interface WebSocketNotifier {
	connections: Set<WebSocket>;
	start(): void;
	stop(): void;
	addConnection(ws: WebSocket): void;
	removeConnection(ws: WebSocket): void;
	broadcastAlert(alert: Alert): void;
	broadcastSystemStatus(status: any): void;
}

export class MonitoringWebSocketNotifier implements WebSocketNotifier {
	private static instance: MonitoringWebSocketNotifier;
	public connections = new Set<WebSocket>();
	private heartbeatInterval: NodeJS.Timeout | null = null;

	private constructor() {
		this.setupAlertListeners();
	}

	static getInstance(): MonitoringWebSocketNotifier {
		if (!MonitoringWebSocketNotifier.instance) {
			MonitoringWebSocketNotifier.instance = new MonitoringWebSocketNotifier();
		}
		return MonitoringWebSocketNotifier.instance;
	}

	/**
	 * Start the WebSocket notifier
	 */
	start(): void {
		// Set up heartbeat to keep connections alive
		this.heartbeatInterval = setInterval(() => {
			this.sendHeartbeat();
		}, 30000); // 30 seconds

		logger.info('Monitoring WebSocket notifier started');
	}

	/**
	 * Stop the WebSocket notifier
	 */
	stop(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}

		// Close all connections
		for (const ws of this.connections) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.close(1001, 'Service shutting down');
			}
		}
		this.connections.clear();

		logger.info('Monitoring WebSocket notifier stopped');
	}

	/**
	 * Add a WebSocket connection for monitoring notifications
	 */
	addConnection(ws: WebSocket): void {
		this.connections.add(ws);

		// Set up connection handlers
		ws.on('close', () => {
			this.removeConnection(ws);
		});

		ws.on('error', (error) => {
			logger.error('Monitoring WebSocket connection error', {
				error: error.message
			});
			this.removeConnection(ws);
		});

		// Send current system status on connect
		this.sendSystemStatus(ws);

		logger.info('Monitoring WebSocket connection added', {
			totalConnections: this.connections.size
		});
	}

	/**
	 * Remove a WebSocket connection
	 */
	removeConnection(ws: WebSocket): void {
		this.connections.delete(ws);
		logger.debug('Monitoring WebSocket connection removed', {
			totalConnections: this.connections.size
		});
	}

	/**
	 * Broadcast alert to all connected clients
	 */
	broadcastAlert(alert: Alert): void {
		const message = {
			type: 'alert',
			event: alert.resolved ? 'alertResolved' : 'alertTriggered',
			data: alert,
			timestamp: Date.now()
		};

		this.broadcast(message);
	}

	/**
	 * Broadcast system status to all connected clients
	 */
	broadcastSystemStatus(status: any): void {
		const message = {
			type: 'systemStatus',
			event: 'statusUpdate',
			data: status,
			timestamp: Date.now()
		};

		this.broadcast(message);
	}

	/**
	 * Send system status to a specific connection
	 */
	private sendSystemStatus(ws: WebSocket): void {
		if (ws.readyState !== WebSocket.OPEN) return;

		try {
			// Get current system status
			import('./index.js').then(({ MonitoringIntegration }) => {
				const systemStatus = MonitoringIntegration.getSystemStatus();
				const activeAlerts = alertManager.getActiveAlerts();
				const alertStats = alertManager.getAlertStats();

				const message = {
					type: 'systemStatus',
					event: 'initialStatus',
					data: {
						...systemStatus,
						alerts: {
							active: activeAlerts,
							stats: alertStats
						}
					},
					timestamp: Date.now()
				};

				ws.send(JSON.stringify(message));
			}).catch(error => {
				logger.error('Failed to send initial system status', {
					error: error.message
				});
			});
		} catch (error) {
			logger.error('Error sending system status', {
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Send heartbeat to all connections
	 */
	private sendHeartbeat(): void {
		const message = {
			type: 'heartbeat',
			event: 'ping',
			data: { timestamp: Date.now() },
			timestamp: Date.now()
		};

		this.broadcast(message);
	}

	/**
	 * Broadcast message to all connected clients
	 */
	private broadcast(message: any): void {
		const messageStr = JSON.stringify(message);
		const closedConnections: WebSocket[] = [];

		for (const ws of this.connections) {
			try {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(messageStr);
				} else {
					closedConnections.push(ws);
				}
			} catch (error) {
				logger.error('Error broadcasting message', {
					error: error instanceof Error ? error.message : String(error)
				});
				closedConnections.push(ws);
			}
		}

		// Clean up closed connections
		for (const ws of closedConnections) {
			this.removeConnection(ws);
		}
	}

	/**
	 * Set up alert manager listeners
	 */
	private setupAlertListeners(): void {
		alertManager.on('alertTriggered', (alert: Alert) => {
			this.broadcastAlert(alert);
		});

		alertManager.on('alertResolved', (alert: Alert) => {
			this.broadcastAlert(alert);
		});
	}

	/**
	 * Send metrics update to all connections
	 */
	sendMetricsUpdate(metrics: any): void {
		const message = {
			type: 'metrics',
			event: 'update',
			data: metrics,
			timestamp: Date.now()
		};

		this.broadcast(message);
	}

	/**
	 * Send error notification to all connections
	 */
	sendErrorNotification(error: any): void {
		const message = {
			type: 'error',
			event: 'newError',
			data: error,
			timestamp: Date.now()
		};

		this.broadcast(message);
	}

	/**
	 * Get connection stats
	 */
	getStats(): {
		totalConnections: number;
		activeConnections: number;
	} {
		let activeConnections = 0;
		for (const ws of this.connections) {
			if (ws.readyState === WebSocket.OPEN) {
				activeConnections++;
			}
		}

		return {
			totalConnections: this.connections.size,
			activeConnections
		};
	}
}

export const wsNotifier = MonitoringWebSocketNotifier.getInstance();