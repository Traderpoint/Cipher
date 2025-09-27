/**
 * Vector Storage API Routes
 *
 * REST endpoints for vector storage operations including embeddings and similarity search
 */

import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { logger } from '@core/logger/index.js';
import {
	validateVectorEmbed,
	validateVectorSearch,
	validateVectorStore,
	validateVectorId,
} from '../middleware/validation.js';

export function createVectorRoutes(agent: MemAgent): Router {
	const router = Router();

	/**
	 * GET /vector
	 * Get vector storage system status and statistics
	 */
	router.get('/', async (req: Request, res: Response) => {
		try {
			const vectorStorage = agent.services.vectorStorage;
			const embeddingManager = agent.services.embeddingManager;

			if (!vectorStorage) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Vector storage not configured',
					503,
					undefined,
					req.requestId
				);
			}

			const stats = {
				storage: {
					type: vectorStorage.constructor.name,
					connected: true,
					collections: await vectorStorage.listCollections?.() || [],
				},
				embedding: {
					provider: embeddingManager?.getProviderName() || 'unknown',
					ready: embeddingManager?.isReady() || false,
					dimension: embeddingManager?.getDimension() || 'unknown',
				},
				capabilities: {
					search: true,
					store: true,
					delete: true,
					collections: !!vectorStorage.listCollections,
				},
				timestamp: new Date().toISOString(),
			};

			successResponse(res, stats, 200, req.requestId);
		} catch (error) {
			logger.error('Failed to get vector storage status', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to retrieve vector storage status',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /vector/embed
	 * Generate embeddings for text
	 */
	router.post('/embed', validateVectorEmbed, async (req: Request, res: Response) => {
		try {
			const { text, collection = 'default' } = req.body;

			const embeddingManager = agent.services.embeddingManager;
			if (!embeddingManager || !embeddingManager.isReady()) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Embedding service not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Generate embedding
			const embedding = await embeddingManager.generateEmbedding(text);

			successResponse(
				res,
				{
					text: text.substring(0, 200) + (text.length > 200 ? '...' : ''), // Truncate for response
					embedding,
					dimension: embedding.length,
					collection,
					provider: embeddingManager.getProviderName(),
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Embedding generation failed', {
				requestId: req.requestId,
				textLength: req.body.text?.length || 0,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Embedding generation failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /vector/search
	 * Perform similarity search in vector storage
	 */
	router.post('/search', validateVectorSearch, async (req: Request, res: Response) => {
		try {
			const { query, collection = 'knowledge', limit = 10, threshold = 0.7 } = req.body;

			const vectorStorage = agent.services.vectorStorage;
			const embeddingManager = agent.services.embeddingManager;

			if (!vectorStorage) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Vector storage not configured',
					503,
					undefined,
					req.requestId
				);
			}

			if (!embeddingManager || !embeddingManager.isReady()) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Embedding service not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Generate query embedding
			const queryEmbedding = await embeddingManager.generateEmbedding(query);

			// Perform similarity search
			const results = await vectorStorage.similaritySearch(
				queryEmbedding,
				Math.min(limit, 100), // Cap at 100 results
				{
					collection,
					threshold: Math.max(0, Math.min(1, threshold)), // Clamp between 0 and 1
				}
			);

			successResponse(
				res,
				{
					query,
					results,
					count: results.length,
					collection,
					limit,
					threshold,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Vector search failed', {
				requestId: req.requestId,
				query: req.body.query,
				collection: req.body.collection,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Vector search failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * POST /vector/store
	 * Store text with metadata in vector storage
	 */
	router.post('/store', validateVectorStore, async (req: Request, res: Response) => {
		try {
			const { text, metadata = {}, collection = 'knowledge', id } = req.body;

			const vectorStorage = agent.services.vectorStorage;
			const embeddingManager = agent.services.embeddingManager;

			if (!vectorStorage) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Vector storage not configured',
					503,
					undefined,
					req.requestId
				);
			}

			if (!embeddingManager || !embeddingManager.isReady()) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Embedding service not available',
					503,
					undefined,
					req.requestId
				);
			}

			// Generate embedding
			const embedding = await embeddingManager.generateEmbedding(text);

			// Store in vector database
			const vectorId = await vectorStorage.store(embedding, {
				...metadata,
				text,
				collection,
				timestamp: new Date().toISOString(),
			}, {
				collection,
				...(id && { id }),
			});

			successResponse(
				res,
				{
					stored: true,
					id: vectorId,
					text: text.substring(0, 200) + (text.length > 200 ? '...' : ''), // Truncate for response
					metadata,
					collection,
					dimension: embedding.length,
					timestamp: new Date().toISOString(),
				},
				201,
				req.requestId
			);
		} catch (error) {
			logger.error('Vector store failed', {
				requestId: req.requestId,
				textLength: req.body.text?.length || 0,
				collection: req.body.collection,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Vector store failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * DELETE /vector/:id
	 * Delete a vector by ID
	 */
	router.delete('/:id', validateVectorId, async (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const { collection = 'knowledge' } = req.query;

			const vectorStorage = agent.services.vectorStorage;

			if (!vectorStorage) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Vector storage not configured',
					503,
					undefined,
					req.requestId
				);
			}

			// Delete from vector database
			const deleted = await vectorStorage.delete?.(id, { collection: collection as string });

			if (deleted === false) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					`Vector with ID ${id} not found`,
					404,
					undefined,
					req.requestId
				);
			}

			successResponse(
				res,
				{
					deleted: true,
					id,
					collection,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Vector delete failed', {
				requestId: req.requestId,
				id: req.params.id,
				collection: req.query.collection,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Vector delete failed',
				500,
				undefined,
				req.requestId
			);
		}
	});

	/**
	 * GET /vector/collections
	 * List available collections
	 */
	router.get('/collections', async (req: Request, res: Response) => {
		try {
			const vectorStorage = agent.services.vectorStorage;

			if (!vectorStorage) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Vector storage not configured',
					503,
					undefined,
					req.requestId
				);
			}

			const collections = await vectorStorage.listCollections?.() || ['knowledge', 'reflection'];

			successResponse(
				res,
				{
					collections,
					count: collections.length,
					timestamp: new Date().toISOString(),
				},
				200,
				req.requestId
			);
		} catch (error) {
			logger.error('Failed to list collections', {
				requestId: req.requestId,
				error: error instanceof Error ? error.message : String(error),
			});

			errorResponse(
				res,
				ERROR_CODES.INTERNAL_ERROR,
				'Failed to list collections',
				500,
				undefined,
				req.requestId
			);
		}
	});

	return router;
}