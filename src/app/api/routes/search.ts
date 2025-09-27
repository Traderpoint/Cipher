/**
 * Search API Routes
 *
 * Provides REST endpoints for searching messages and sessions
 * Based on the Saiki WebUI architecture with comprehensive search capabilities
 */

import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
// TODO: SearchService will be implemented in the future
// import { SearchService } from '@core/ai/search/search-service.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { validateSearchMessages, validateSearchSessions } from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

export function createSearchRoutes(_agent: MemAgent): Router {
	const router = Router();

	// Helper function to calculate relevance score
	const calculateRelevance = (content: string, query: string): number => {
		const lowerContent = content.toLowerCase();
		const lowerQuery = query.toLowerCase();

		// Exact match bonus
		const exactMatches = (lowerContent.match(new RegExp(lowerQuery, 'g')) || []).length;
		let score = exactMatches * 10;

		// Position bonus (earlier matches score higher)
		const firstIndex = lowerContent.indexOf(lowerQuery);
		if (firstIndex >= 0) {
			score += Math.max(0, 100 - firstIndex);
		}

		// Length penalty (shorter content with matches scores higher)
		score += Math.max(0, 1000 - content.length) / 100;

		return score;
	};

	/**
	 * GET /api/search/messages
	 * Search messages across sessions
	 *
	 * Query parameters:
	 * - q: Search query (required)
	 * - sessionId: Filter by specific session (optional)
	 * - role: Filter by message role (optional) - user, assistant, system, tool
	 * - limit: Maximum number of results (optional, default: 50)
	 * - offset: Pagination offset (optional, default: 0)
	 */
	router.get('/messages', validateSearchMessages, async (req: Request, res: Response) => {
		try {
			const { q, sessionId, role, limit = 50, offset = 0 } = req.query;

			logger.info('Message search requested', {
				requestId: req.requestId,
				query: q,
				sessionId,
				role,
				limit,
				offset,
			});

			// Get all sessions to search through
			const sessionIds = sessionId && typeof sessionId === 'string'
				? [sessionId]
				: await _agent.listSessions();

			const results = [];
			const maxLimit = Math.min(parseInt(String(limit)) || 50, 100);
			const startOffset = parseInt(String(offset)) || 0;
			let totalCount = 0;

			for (const sId of sessionIds) {
				try {
					const history = await _agent.getSessionHistory(sId);
					if (!history || !Array.isArray(history)) continue;

					// Search through messages
					for (let i = 0; i < history.length; i++) {
						const message = history[i];
						if (!message || typeof message.content !== 'string') continue;

						// Role filter
						if (role && message.role !== role) continue;

						// Simple text search (case-insensitive)
						const searchTerm = q.toLowerCase();
						const messageText = message.content.toLowerCase();

						if (messageText.includes(searchTerm)) {
							totalCount++;

							// Apply pagination
							if (totalCount > startOffset && results.length < maxLimit) {
								results.push({
									sessionId: sId,
									messageId: message.id || `${sId}_${i}`,
									role: message.role,
									content: message.content,
									timestamp: message.timestamp || null,
									relevance: calculateRelevance(message.content, q),
								});
							}
						}
					}
				} catch (error) {
					logger.warn(`Failed to search session ${sId}:`, error);
					continue;
				}
			}

			// Sort by relevance (simple scoring based on exact matches and position)
			results.sort((a, b) => b.relevance - a.relevance);

			successResponse(
				res,
				{
					results,
					totalCount,
					query: q,
					limit: maxLimit,
					offset: startOffset,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Message search route error', {
				requestId: req.requestId,
				error: errorMsg,
				stack: error instanceof Error ? error.stack : undefined,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Message search failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /api/search/sessions
	 * Search sessions containing the query
	 *
	 * Query parameters:
	 * - q: Search query (required)
	 */
	router.get('/sessions', validateSearchSessions, async (req: Request, res: Response) => {
		try {
			const { q } = req.query;

			logger.info('Session search requested', {
				requestId: req.requestId,
				query: q,
			});

			// Get all sessions
			const sessionIds = await _agent.listSessions();
			const results = [];

			for (const sessionId of sessionIds) {
				try {
					const history = await _agent.getSessionHistory(sessionId);
					const metadata = await _agent.getSessionMetadata(sessionId);

					if (!history || !Array.isArray(history)) continue;

					let sessionRelevance = 0;
					let matchingMessages = 0;
					const searchTerm = q.toLowerCase();

					// Search through messages in this session
					for (const message of history) {
						if (message && typeof message.content === 'string') {
							const messageText = message.content.toLowerCase();
							if (messageText.includes(searchTerm)) {
								matchingMessages++;
								sessionRelevance += calculateRelevance(message.content, q);
							}
						}
					}

					// If we found matches, include this session in results
					if (matchingMessages > 0) {
						results.push({
							sessionId,
							relevance: sessionRelevance,
							matchingMessages,
							totalMessages: history.length,
							metadata: {
								...metadata,
								lastActivity: metadata?.lastActivity || null,
								messageCount: metadata?.messageCount || history.length,
							}
						});
					}

				} catch (error) {
					logger.warn(`Failed to search session ${sessionId}:`, error);
					continue;
				}
			}

			// Sort by relevance
			results.sort((a, b) => b.relevance - a.relevance);

			successResponse(
				res,
				{
					results,
					totalSessions: results.length,
					query: q,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error('Session search route error', {
				requestId: req.requestId,
				error: errorMsg,
				stack: error instanceof Error ? error.stack : undefined,
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				`Session search failed: ${errorMsg}`,
				500,
				process.env.NODE_ENV === 'development' ? error : undefined,
				req.requestId
			);
		}
	});

	return router;
}
