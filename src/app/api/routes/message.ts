import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { validateMessageRequest } from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

/**
 * Process message asynchronously without blocking the response
 */
async function processMessageAsync(
	agent: MemAgent,
	message: string,
	options: { sessionId?: string; images?: string[]; imageData?: string; fileData?: any },
	requestId?: string
): Promise<void> {
	try {
		// If sessionId is provided, ensure that session is loaded
		if (options.sessionId) {
			try {
				await agent.loadSession(options.sessionId);
			} catch {
				// Create new session with the provided ID
				await agent.createSession(options.sessionId);
			}
		}

		// Convert image data to expected format
		let imageData: { image: string; mimeType: string } | undefined;
		if (options.images && options.images.length > 0 && options.images[0]) {
			imageData = {
				image: options.images[0],
				mimeType: 'image/jpeg',
			};
		} else if (options.imageData && typeof options.imageData === 'string') {
			imageData = {
				image: options.imageData,
				mimeType: 'image/jpeg',
			};
		}

		// Process the message through the agent
		const { backgroundOperations } = await agent.run(message, imageData, options.sessionId);
		await backgroundOperations;

		logger.info('Async message processing completed', {
			requestId,
			sessionId: agent.getCurrentSessionId(),
		});
	} catch (error) {
		logger.error('Async message processing failed', {
			requestId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function createMessageRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * POST /api/message
	 * Process a message asynchronously and return 202 status immediately
	 */
	router.post('/', validateMessageRequest, async (req: Request, res: Response) => {
		try {
			const { message, sessionId, images, imageData, fileData, streaming = true } = req.body;

			logger.info('Processing async message request', {
				requestId: req.requestId,
				sessionId: sessionId || 'default',
				hasImages: Boolean(images && images.length > 0),
				hasImageData: Boolean(imageData),
				hasFileData: Boolean(fileData),
				messageLength: message.length,
				streaming,
			});

			// Return 202 immediately for async processing
			successResponse(
				res,
				{
					message: 'Message accepted for processing',
					sessionId: sessionId || agent.getCurrentSessionId(),
					requestId: req.requestId,
					timestamp: new Date().toISOString(),
				},
				202,
				req.requestId
			);

			// Process message asynchronously (no await)
			processMessageAsync(
				agent,
				message,
				{ sessionId, images, imageData, fileData },
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Async message processing setup failed', {
				requestId: req.requestId,
				error: errorMsg,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Message processing setup failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/message-sync
	 * Process a message synchronously and return the full response
	 */
	router.post('/sync', validateMessageRequest, async (req: Request, res: Response) => {
		try {
			const { message, sessionId, images } = req.body;

			logger.info('Processing message request', {
				requestId: req.requestId,
				sessionId: sessionId || 'default',
				hasImages: Boolean(images && images.length > 0),
				messageLength: message.length,
			});

			// If sessionId is provided, ensure that session is loaded
			if (sessionId) {
				try {
					const session = await agent.loadSession(sessionId);
					logger.info(`Loaded session: ${session.id}`, { requestId: req.requestId });
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					logger.warn(`Session ${sessionId} not found, will create new one: ${errorMsg}`, {
						requestId: req.requestId,
					});

					// Create new session with the provided ID
					try {
						const newSession = await agent.createSession(sessionId);
						logger.info(`Created new session: ${newSession.id}`, { requestId: req.requestId });
					} catch (createError) {
						errorResponse(
							res,
							ERROR_CODES.SESSION_NOT_FOUND,
							`Failed to create session: ${createError instanceof Error ? createError.message : String(createError)}`,
							400,
							undefined,
							req.requestId
						);
						return;
					}
				}
			}

			// Process the message through the agent
			// Convert images array to single image if provided
			let imageData: { image: string; mimeType: string } | undefined;
			if (images && images.length > 0) {
				// For now, use the first image (could be enhanced to handle multiple images)
				imageData = {
					image: images[0],
					mimeType: 'image/jpeg', // Default, could be enhanced to detect actual type
				};
			}

			const { response, backgroundOperations } = await agent.run(message, imageData, sessionId);
			// In API mode, always wait for background operations to complete before returning response
			await backgroundOperations;

			successResponse(
				res,
				{
					response,
					sessionId: agent.getCurrentSessionId(),
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Message processing failed', {
				requestId: req.requestId,
				error: errorMsg,
				stack: error instanceof Error ? error.stack : undefined,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Message processing failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /api/message/reset
	 * Reset conversation state for the current or specified session
	 */
	router.post('/reset', async (req: Request, res: Response) => {
		try {
			const { sessionId } = req.body;

			logger.info('Processing reset request', {
				requestId: req.requestId,
				sessionId: sessionId || 'current',
			});

			if (sessionId) {
				// Reset specific session by clearing its conversation history
				const session = await agent.getSession(sessionId);
				if (!session) {
					errorResponse(
						res,
						ERROR_CODES.SESSION_NOT_FOUND,
						`Session ${sessionId} not found`,
						404,
						undefined,
						req.requestId
					);
					return;
				}

				// Clear the conversation history instead of removing the session
				try {
					// First switch to a temporary session if this is the current session
					const currentSessionId = agent.getCurrentSessionId();
					let tempSessionId = null;
					if (currentSessionId === sessionId) {
						// Create temporary session and switch to it
						const tempSession = await agent.createSession();
						tempSessionId = tempSession.id;
						await agent.loadSession(tempSessionId);
					}

					// Now remove and recreate the session
					await agent.removeSession(sessionId);
					const newSession = await agent.createSession(sessionId);

					// Switch back to the reset session if it was current
					if (tempSessionId && currentSessionId === sessionId) {
						await agent.loadSession(sessionId);
						// Clean up temporary session
						await agent.removeSession(tempSessionId);
					}

					successResponse(
						res,
						{
							message: `Session ${sessionId} has been reset`,
							sessionId: sessionId,
							timestamp: new Date().toISOString(),
						},
						200,
						req.requestId
					);
				} catch (clearError) {
					throw new Error(`Failed to clear session history: ${clearError instanceof Error ? clearError.message : String(clearError)}`);
				}
			} else {
				// Reset current session
				const currentSessionId = agent.getCurrentSessionId();

				if (!currentSessionId) {
					errorResponse(
						res,
						ERROR_CODES.SESSION_NOT_FOUND,
						'No current session found',
						404,
						undefined,
						req.requestId
					);
					return;
				}

				// Create a new temporary session first
				const tempSession = await agent.createSession();
				await agent.loadSession(tempSession.id);

				// Now remove the old current session and recreate it
				await agent.removeSession(currentSessionId);
				const newSession = await agent.createSession(currentSessionId);
				await agent.loadSession(newSession.id);

				// Clean up temporary session
				await agent.removeSession(tempSession.id);

				successResponse(
					res,
					{
						message: 'Current session has been reset',
						sessionId: newSession.id,
						timestamp: new Date().toISOString(),
					},
					200,
					req.requestId
				);
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Reset operation failed', {
				requestId: req.requestId,
				error: errorMsg,
				stack: error instanceof Error ? error.stack : undefined,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Reset operation failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	return router;
}
