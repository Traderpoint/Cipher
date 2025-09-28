/**
 * Authentication API Routes
 *
 * REST endpoints for JWT token generation and WebSocket authentication
 */

import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { logger } from '@core/logger/index.js';
import { generateWebSocketToken } from '../websocket/jwt-auth.js';
import { handleValidationErrors, sanitizeTextInput } from '../middleware/validation.js';

export function createAuthRoutes(): Router {
	const router = Router();

	/**
	 * Validation for WebSocket token generation
	 */
	const validateTokenRequest = [
		body('sessionId')
			.optional()
			.isString()
			.isLength({ min: 1, max: 100 })
			.withMessage('Session ID must be between 1 and 100 characters'),
		body('userId')
			.optional()
			.isString()
			.isLength({ min: 1, max: 100 })
			.withMessage('User ID must be between 1 and 100 characters'),
		body('permissions')
			.optional()
			.isArray()
			.withMessage('Permissions must be an array'),
		body('permissions.*')
			.optional()
			.isString()
			.isIn(['read', 'write', 'admin', 'monitor'])
			.withMessage('Each permission must be: read, write, admin, or monitor'),
		body('expiresIn')
			.optional()
			.isString()
			.matches(/^(\d+[smhd])|(\d+)$/)
			.withMessage('ExpiresIn must be a valid duration (e.g., 1h, 30m, 7d)'),
		sanitizeTextInput(['sessionId', 'userId']),
		handleValidationErrors,
	];

	/**
	 * POST /auth/websocket/token
	 * Generate JWT token for WebSocket authentication
	 */
	router.post('/websocket/token', validateTokenRequest, async (req: Request, res: Response) => {
		try {
			const { sessionId, userId, permissions = ['read', 'write'], expiresIn } = req.body;

			// Validate permissions
			const validPermissions = ['read', 'write', 'admin', 'monitor'];
			const requestedPermissions = Array.isArray(permissions) ? permissions : [];
			const invalidPermissions = requestedPermissions.filter(p => !validPermissions.includes(p));

			if (invalidPermissions.length > 0) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					`Invalid permissions: ${invalidPermissions.join(', ')}`,
					400,
					{ invalidPermissions },
					req.requestId
				);
			}

			// Generate token
			const token = generateWebSocketToken(sessionId, userId, requestedPermissions);

			// Calculate expiry time (default 24h)
			const expiresAt = new Date();
			const duration = expiresIn || '24h';

			if (duration.endsWith('h')) {
				expiresAt.setHours(expiresAt.getHours() + parseInt(duration));
			} else if (duration.endsWith('m')) {
				expiresAt.setMinutes(expiresAt.getMinutes() + parseInt(duration));
			} else if (duration.endsWith('d')) {
				expiresAt.setDate(expiresAt.getDate() + parseInt(duration));
			} else {
				expiresAt.setHours(expiresAt.getHours() + 24); // Default 24h
			}

			logger.info('WebSocket JWT token generated', {
				sessionId,
				userId,
				permissions: requestedPermissions,
				expiresAt,
				requestId: req.requestId,
			});

			successResponse(
				res,
				{
					token,
					expiresAt: expiresAt.toISOString(),
					permissions: requestedPermissions,
					sessionId,
					userId,
					usage: {
						websocketUrl: `ws://localhost:${process.env.PORT || 3001}?token=${token}`,
						authHeader: `Authorization: Bearer ${token}`,
						subprotocol: `cipher-jwt-${token}`,
					},
				},
				201,
				req.requestId
			);
		} catch (error) {
			logger.error('Failed to generate WebSocket token', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to generate authentication token',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /auth/websocket/verify
	 * Verify JWT token validity (for testing)
	 */
	router.post('/websocket/verify', async (req: Request, res: Response) => {
		try {
			const { token } = req.body;

			if (!token || typeof token !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Token is required and must be a string',
					400,
					undefined,
					req.requestId
				);
			}

			// Import here to avoid circular dependency
			const { wsJWTAuth } = await import('../websocket/jwt-auth.js');
			const payload = wsJWTAuth.verifyToken(token);

			if (!payload) {
				return errorResponse(
					res,
					ERROR_CODES.UNAUTHORIZED,
					'Invalid or expired token',
					401,
					undefined,
					req.requestId
				);
			}

			logger.info('WebSocket JWT token verified', {
				sessionId: payload.sessionId,
				userId: payload.userId,
				permissions: payload.permissions,
				requestId: req.requestId,
			});

			successResponse(
				res,
				{
					valid: true,
					payload: {
						sessionId: payload.sessionId,
						userId: payload.userId,
						clientId: payload.clientId,
						permissions: payload.permissions,
						issuedAt: new Date(payload.iat! * 1000).toISOString(),
						expiresAt: new Date(payload.exp! * 1000).toISOString(),
					},
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Failed to verify WebSocket token', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to verify authentication token',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /auth/websocket/info
	 * Get WebSocket authentication information and usage examples
	 */
	router.get('/websocket/info', async (req: Request, res: Response) => {
		try {
			const info = {
				description: 'WebSocket JWT Authentication System',
				supportedMethods: [
					{
						method: 'query_parameter',
						example: 'ws://localhost:3001?token=YOUR_JWT_TOKEN',
						description: 'Pass token as query parameter',
					},
					{
						method: 'authorization_header',
						example: 'Authorization: Bearer YOUR_JWT_TOKEN',
						description: 'Pass token in Authorization header during handshake',
					},
					{
						method: 'subprotocol',
						example: 'Sec-WebSocket-Protocol: cipher-jwt-YOUR_JWT_TOKEN',
						description: 'Pass token as WebSocket subprotocol',
					},
				],
				permissions: [
					{
						name: 'read',
						description: 'Read access to WebSocket messages and events',
					},
					{
						name: 'write',
						description: 'Write access to send messages through WebSocket',
					},
					{
						name: 'admin',
						description: 'Administrative access to manage connections',
					},
					{
						name: 'monitor',
						description: 'Access to monitoring and metrics events',
					},
				],
				tokenGeneration: {
					endpoint: '/api/auth/websocket/token',
					method: 'POST',
					description: 'Generate new JWT token for WebSocket authentication',
				},
				tokenVerification: {
					endpoint: '/api/auth/websocket/verify',
					method: 'POST',
					description: 'Verify JWT token validity',
				},
			};

			successResponse(res, info, 200, req.requestId);
		} catch (error) {
			logger.error('Failed to get WebSocket auth info', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to retrieve authentication information',
				500,
				undefined,
				req.requestId
			);
		}
	});

	return router;
}