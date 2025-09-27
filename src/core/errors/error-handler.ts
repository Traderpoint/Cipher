import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger/index.js';
import { errorTracker } from '../monitoring/error-tracker.js';

export class AppError extends Error {
	public readonly statusCode: number;
	public readonly isOperational: boolean;
	public readonly errorCode?: string;

	constructor(message: string, statusCode = 500, errorCode?: string, isOperational = true) {
		super(message);
		this.statusCode = statusCode;
		this.isOperational = isOperational;
		this.errorCode = errorCode;
		Error.captureStackTrace(this, this.constructor);
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: any) {
		super(message, 400, 'VALIDATION_ERROR');
		this.name = 'ValidationError';
	}
}

export class AuthenticationError extends AppError {
	constructor(message = 'Authentication failed') {
		super(message, 401, 'AUTHENTICATION_ERROR');
		this.name = 'AuthenticationError';
	}
}

export class AuthorizationError extends AppError {
	constructor(message = 'Insufficient permissions') {
		super(message, 403, 'AUTHORIZATION_ERROR');
		this.name = 'AuthorizationError';
	}
}

export class NotFoundError extends AppError {
	constructor(message = 'Resource not found') {
		super(message, 404, 'NOT_FOUND_ERROR');
		this.name = 'NotFoundError';
	}
}

export class ConflictError extends AppError {
	constructor(message = 'Resource conflict') {
		super(message, 409, 'CONFLICT_ERROR');
		this.name = 'ConflictError';
	}
}

export class RateLimitError extends AppError {
	constructor(message = 'Rate limit exceeded') {
		super(message, 429, 'RATE_LIMIT_ERROR');
		this.name = 'RateLimitError';
	}
}

export class ServiceUnavailableError extends AppError {
	constructor(message = 'Service temporarily unavailable') {
		super(message, 503, 'SERVICE_UNAVAILABLE_ERROR');
		this.name = 'ServiceUnavailableError';
	}
}

export const globalErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
	let statusCode = 500;
	let errorCode = 'INTERNAL_SERVER_ERROR';
	let message = 'Internal server error';

	if (err instanceof AppError) {
		statusCode = err.statusCode;
		errorCode = err.errorCode || 'APP_ERROR';
		message = err.message;
	}

	// Log error
	logger.error('Application error', {
		error: err.message,
		stack: err.stack,
		statusCode,
		errorCode,
		requestId: req.requestId,
		url: req.url,
		method: req.method,
		userAgent: req.get('User-Agent'),
		ip: req.ip,
	});

	// Track error in monitoring
	errorTracker.trackError(err, 'api', {
		statusCode,
		requestId: req.requestId,
		endpoint: `${req.method} ${req.route?.path || req.url}`,
		userAgent: req.get('User-Agent'),
		ip: req.ip,
	});

	// Send error response
	res.status(statusCode).json({
		success: false,
		error: {
			code: errorCode,
			message,
			...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
		},
		requestId: req.requestId,
		timestamp: new Date().toISOString(),
	});
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
	Promise.resolve(fn(req, res, next)).catch(next);
};

export const notFoundHandler = (req: Request, res: Response): void => {
	throw new NotFoundError(`Route ${req.method} ${req.url} not found`);
};

export const createError = {
	validation: (message: string, details?: any) => new ValidationError(message, details),
	authentication: (message?: string) => new AuthenticationError(message),
	authorization: (message?: string) => new AuthorizationError(message),
	notFound: (message?: string) => new NotFoundError(message),
	conflict: (message?: string) => new ConflictError(message),
	rateLimit: (message?: string) => new RateLimitError(message),
	serviceUnavailable: (message?: string) => new ServiceUnavailableError(message),
	internal: (message?: string) => new AppError(message || 'Internal server error', 500, 'INTERNAL_ERROR'),
};