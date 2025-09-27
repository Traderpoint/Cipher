import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { logger } from '@core/logger/index.js';
import crypto from 'crypto';

export interface JWTPayload {
	sessionId?: string;
	userId?: string;
	clientId?: string;
	permissions?: string[];
	iat?: number;
	exp?: number;
}

export interface AuthenticatedWebSocket extends WebSocket {
	sessionId?: string;
	userId?: string;
	clientId?: string;
	permissions?: string[];
	isAuthenticated?: boolean;
}

/**
 * JWT WebSocket Authentication Manager
 */
export class WebSocketJWTAuth {
	private readonly jwtSecret: string;
	private readonly tokenExpiry: string;
	private readonly issuer: string;

	constructor() {
		// Use environment variable or generate a secure secret
		this.jwtSecret = process.env.CIPHER_JWT_SECRET || this.generateSecureSecret();
		this.tokenExpiry = process.env.CIPHER_JWT_EXPIRY || '24h';
		this.issuer = process.env.CIPHER_JWT_ISSUER || 'cipher-websocket';

		if (!process.env.CIPHER_JWT_SECRET) {
			logger.warn('No JWT secret provided, using generated secret. Set CIPHER_JWT_SECRET environment variable for production.');
		}
	}

	/**
	 * Generate a secure JWT secret if none provided
	 */
	private generateSecureSecret(): string {
		return crypto.randomBytes(64).toString('hex');
	}

	/**
	 * Generate JWT token for WebSocket authentication
	 */
	generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
		return jwt.sign(payload, this.jwtSecret, {
			expiresIn: this.tokenExpiry,
			issuer: this.issuer,
			algorithm: 'HS256',
		} as jwt.SignOptions);
	}

	/**
	 * Verify JWT token and extract payload
	 */
	verifyToken(token: string): JWTPayload | null {
		try {
			const decoded = jwt.verify(token, this.jwtSecret, {
				issuer: this.issuer,
				algorithms: ['HS256'],
			}) as JWTPayload;

			return decoded;
		} catch (error) {
			if (error instanceof jwt.TokenExpiredError) {
				logger.debug('JWT token expired', { error: error.message });
			} else if (error instanceof jwt.JsonWebTokenError) {
				logger.debug('Invalid JWT token', { error: error.message });
			} else {
				logger.error('JWT verification error', { error: error instanceof Error ? error.message : String(error) });
			}
			return null;
		}
	}

	/**
	 * Extract token from WebSocket request
	 * Supports multiple methods: query parameter, header, subprotocol
	 */
	extractTokenFromRequest(request: any): string | null {
		// Method 1: Query parameter ?token=...
		const url = new URL(request.url || '', 'ws://localhost');
		const tokenFromQuery = url.searchParams.get('token');
		if (tokenFromQuery) {
			return tokenFromQuery;
		}

		// Method 2: Authorization header
		const authHeader = request.headers.authorization;
		if (authHeader && authHeader.startsWith('Bearer ')) {
			return authHeader.substring(7);
		}

		// Method 3: Sec-WebSocket-Protocol header (token as subprotocol)
		const protocols = request.headers['sec-websocket-protocol'];
		if (protocols) {
			const protocolList = protocols.split(',').map((p: string) => p.trim());
			const tokenProtocol = protocolList.find((p: string) => p.startsWith('cipher-jwt-'));
			if (tokenProtocol) {
				return tokenProtocol.substring(11); // Remove 'cipher-jwt-' prefix
			}
		}

		return null;
	}

	/**
	 * Authenticate WebSocket connection
	 */
	authenticateConnection(ws: WebSocket, request: any): AuthenticatedWebSocket | null {
		const token = this.extractTokenFromRequest(request);

		if (!token) {
			logger.debug('No JWT token provided for WebSocket connection');
			return null;
		}

		const payload = this.verifyToken(token);
		if (!payload) {
			logger.debug('Invalid JWT token for WebSocket connection');
			return null;
		}

		// Enhance WebSocket with authentication data
		const authenticatedWs = ws as AuthenticatedWebSocket;
		if (payload.sessionId !== undefined) {
			authenticatedWs.sessionId = payload.sessionId;
		}
		if (payload.userId !== undefined) {
			authenticatedWs.userId = payload.userId;
		}
		if (payload.clientId !== undefined) {
			authenticatedWs.clientId = payload.clientId;
		}
		authenticatedWs.permissions = payload.permissions || [];
		authenticatedWs.isAuthenticated = true;

		logger.info('WebSocket connection authenticated', {
			sessionId: payload.sessionId,
			userId: payload.userId,
			clientId: payload.clientId,
			permissions: payload.permissions,
		});

		return authenticatedWs;
	}

	/**
	 * Check if WebSocket has specific permission
	 */
	hasPermission(ws: AuthenticatedWebSocket, permission: string): boolean {
		if (!ws.isAuthenticated || !ws.permissions) {
			return false;
		}
		return ws.permissions.includes(permission) || ws.permissions.includes('*');
	}

	/**
	 * Middleware for WebSocket authentication
	 */
	authMiddleware() {
		return (ws: WebSocket, request: any, next: (error?: Error) => void) => {
			const authenticatedWs = this.authenticateConnection(ws, request);

			if (!authenticatedWs) {
				const error = new Error('WebSocket authentication failed');
				return next(error);
			}

			// Replace the original WebSocket with authenticated one
			Object.assign(ws, authenticatedWs);
			next();
		};
	}

	/**
	 * Generate authentication token for client
	 * This would typically be called from a REST endpoint
	 */
	generateClientToken(sessionId?: string, userId?: string, permissions: string[] = ['read', 'write']): string {
		const clientId = crypto.randomUUID();

		const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
			clientId,
			permissions,
		};

		if (sessionId !== undefined) {
			tokenPayload.sessionId = sessionId;
		}
		if (userId !== undefined) {
			tokenPayload.userId = userId;
		}

		return this.generateToken(tokenPayload);
	}

	/**
	 * Revoke token (add to blacklist)
	 * Note: For production, implement token blacklisting with Redis or database
	 */
	revokeToken(token: string): void {
		// TODO: Implement token blacklisting
		logger.info('Token revocation requested', { token: token.substring(0, 10) + '...' });
	}
}

// Singleton instance
export const wsJWTAuth = new WebSocketJWTAuth();

// Convenience functions
export const generateWebSocketToken = wsJWTAuth.generateClientToken.bind(wsJWTAuth);
export const authenticateWebSocket = wsJWTAuth.authenticateConnection.bind(wsJWTAuth);
export const hasWebSocketPermission = wsJWTAuth.hasPermission.bind(wsJWTAuth);