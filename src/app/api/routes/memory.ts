/**
 * Memory API Routes
 *
 * REST endpoints for memory operations including search, store, and management
 */

import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { validateRequest } from '../middleware/validation.js';
import { logger } from '@core/logger/index.js';

export function createMemoryRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /memory
	 * Get memory system status and statistics
	 */
	router.get('/', async (req: Request, res: Response) => {
		try {
			const vectorStorage = agent.services.vectorStorage;
			const stats = {
				vectorStorage: {
					connected: !!vectorStorage,
					type: vectorStorage?.constructor.name || 'unknown',
				},
				memoryTools: {
					available: true,
					embeddingEnabled: agent.services.embeddingManager?.isReady() || false,
				},
				timestamp: new Date().toISOString(),
			};

			successResponse(res, stats, 200, req.requestId);
		} catch (error) {
			logger.error('Failed to get memory status', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to retrieve memory status',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /memory/search
	 * Search memory for relevant information
	 */
	router.post('/search', async (req: Request, res: Response) => {
		try {
			const { query, limit = 10, sessionId } = req.body;

			if (!query || typeof query !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Query parameter is required and must be a string',
					400,
					undefined,
					req.requestId
				);
			}

			// Use the agent's internal memory search tool
			const session = sessionId ? agent.getSession(sessionId) : null;
			const toolRegistry = agent.services.toolRegistry;

			// Get the memory search tool
			const searchTool = await toolRegistry.getTool('cipher_memory_search');
			if (!searchTool) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Memory search tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Execute the search
			const result = await searchTool.execute({
				query,
				limit: Math.min(limit, 50), // Cap at 50 results
			}, session);

			const memories = Array.isArray(result) ? result : [result];

			successResponse(
				res,
				{
					query,
					results: memories,
					count: memories.length,
					limit,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Memory search failed', {
				requestId: req.requestId,
				query: req.body.query,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Memory search failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /memory/store
	 * Store new information in memory
	 */
	router.post('/store', async (req: Request, res: Response) => {
		try {
			const { content, type = 'knowledge', sessionId, metadata = {} } = req.body;

			if (!content || typeof content !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Content parameter is required and must be a string',
					400,
					undefined,
					req.requestId
				);
			}

			// Use the agent's internal memory operation tool
			const session = sessionId ? agent.getSession(sessionId) : null;
			const toolRegistry = agent.services.toolRegistry;

			// Get the extract and operate memory tool
			const memoryTool = await toolRegistry.getTool('cipher_extract_and_operate_memory');
			if (!memoryTool) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Memory operation tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Execute the memory operation
			const result = await memoryTool.execute({
				content,
				operation: 'ADD',
				type,
				metadata: JSON.stringify(metadata),
			}, session);

			successResponse(
				res,
				{
					stored: true,
					content,
					type,
					metadata,
					result,
					timestamp: new Date().toISOString(),
				},
				201,
				req.requestId
			);
		} catch (error) {
			logger.error('Memory store failed', {
				requestId: req.requestId,
				contentLength: req.body.content?.length || 0,
				type: req.body.type,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Memory store failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /memory/reasoning
	 * Store reasoning traces in reflection memory
	 */
	router.post('/reasoning', async (req: Request, res: Response) => {
		try {
			const { reasoning, quality = 'high', sessionId, metadata = {} } = req.body;

			if (!reasoning || typeof reasoning !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Reasoning parameter is required and must be a string',
					400,
					undefined,
					req.requestId
				);
			}

			// Use the agent's reasoning memory tool
			const session = sessionId ? agent.getSession(sessionId) : null;
			const toolRegistry = agent.services.toolRegistry;

			// Get the reasoning memory tool
			const reasoningTool = await toolRegistry.getTool('cipher_store_reasoning_memory');
			if (!reasoningTool) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Reasoning memory tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Execute the reasoning storage
			const result = await reasoningTool.execute({
				reasoning,
				quality,
				metadata: JSON.stringify(metadata),
			}, session);

			successResponse(
				res,
				{
					stored: true,
					reasoning,
					quality,
					metadata,
					result,
					timestamp: new Date().toISOString(),
				},
				201,
				req.requestId
			);
		} catch (error) {
			logger.error('Reasoning memory store failed', {
				requestId: req.requestId,
				reasoningLength: req.body.reasoning?.length || 0,
				quality: req.body.quality,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Reasoning memory store failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /memory/reasoning/search
	 * Search reasoning patterns in reflection memory
	 */
	router.post('/reasoning/search', async (req: Request, res: Response) => {
		try {
			const { query, limit = 10, sessionId } = req.body;

			if (!query || typeof query !== 'string') {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Query parameter is required and must be a string',
					400,
					undefined,
					req.requestId
				);
			}

			// Use the agent's reasoning search tool
			const session = sessionId ? agent.getSession(sessionId) : null;
			const toolRegistry = agent.services.toolRegistry;

			// Get the reasoning search tool
			const searchTool = await toolRegistry.getTool('cipher_search_reasoning_patterns');
			if (!searchTool) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Reasoning search tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Execute the search
			const result = await searchTool.execute({
				query,
				limit: Math.min(limit, 50), // Cap at 50 results
			}, session);

			const patterns = Array.isArray(result) ? result : [result];

			successResponse(
				res,
				{
					query,
					patterns,
					count: patterns.length,
					limit,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Reasoning search failed', {
				requestId: req.requestId,
				query: req.body.query,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Reasoning search failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /memory/tools
	 * List available memory tools and their capabilities
	 */
	router.get('/tools', async (req: Request, res: Response) => {
		try {
			const toolRegistry = agent.services.toolRegistry;
			const memoryToolNames = [
				'cipher_extract_and_operate_memory',
				'cipher_memory_search',
				'cipher_store_reasoning_memory',
				'cipher_search_reasoning_patterns',
				'cipher_workspace_search',
				'cipher_workspace_store',
			];

			const availableTools = [];

			for (const toolName of memoryToolNames) {
				const tool = await toolRegistry.getTool(toolName);
				if (tool) {
					availableTools.push({
						name: toolName,
						description: tool.description,
						category: 'memory',
						available: true,
					});
				}
			}

			successResponse(
				res,
				{
					tools: availableTools,
					count: availableTools.length,
					embeddingEnabled: agent.services.embeddingManager?.isReady() || false,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Failed to list memory tools', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to list memory tools',
				500,
				undefined,
				req.requestId
			);
		}
	});

	return router;
}