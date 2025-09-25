/**
 * Memory API Routes
 *
 * REST endpoints for memory operations including search, store, and management
 */

import { Router, Request, Response } from 'express';
import { MemAgent } from '@core/brain/memAgent/index.js';
import { successResponse, errorResponse, ERROR_CODES } from '../utils/response.js';
import { logger } from '@core/logger/index.js';

const MEMORY_TOOL_NAMES = [
	'cipher_extract_and_operate_memory',
	'cipher_memory_search',
	'cipher_store_reasoning_memory',
	'cipher_search_reasoning_patterns',
	'cipher_workspace_search',
	'cipher_workspace_store',
] as const;

interface MemoryToolInfo {
	name: string;
	description: string;
	category: string;
	source?: string;
}

interface ToolInventory {
	tools: MemoryToolInfo[];
	unifiedTools?: Record<string, any> | undefined;
	internalTools?: Record<string, any> | undefined;
}

export function createMemoryRoutes(agent: MemAgent): Router {
	const router = Router();

	const getUnifiedToolManager = () => agent.unifiedToolManager;

	const getInternalToolManager = () =>
		agent.internalToolManager ?? agent.services?.internalToolManager;

	const getDefaultSessionId = (): string | undefined => {
		if (typeof agent.getCurrentActiveSessionId === 'function') {
			return agent.getCurrentActiveSessionId();
		}

		if (typeof agent.getCurrentSessionId === 'function') {
			return agent.getCurrentSessionId();
		}

		return undefined;
	};

	const resolveSessionId = async (
		requestedSessionId?: string
	): Promise<{ resolvedSessionId?: string | undefined; notFound: boolean }> => {
		if (!requestedSessionId) {
			return {
				resolvedSessionId: getDefaultSessionId(),
				notFound: false,
			};
		}

		const session = await agent.getSession(requestedSessionId);
		if (!session) {
			return {
				resolvedSessionId: undefined,
				notFound: true,
			};
		}

		return { resolvedSessionId: session.id, notFound: false };
	};

	const fetchMemoryTools = async (): Promise<ToolInventory> => {
		const unifiedManager = getUnifiedToolManager();
		const internalManager = getInternalToolManager();

		let unifiedTools: Record<string, any> | undefined;
		if (unifiedManager && typeof unifiedManager.getAllTools === 'function') {
			try {
				unifiedTools = await unifiedManager.getAllTools();
			} catch (error) {
				logger.warn('Failed to load memory tools from unified tool manager', {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		let internalTools: Record<string, any> | undefined;
		if (internalManager && typeof internalManager.getAllTools === 'function') {
			try {
				internalTools = internalManager.getAllTools();
			} catch (error) {
				logger.warn('Failed to load memory tools from internal tool manager', {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const collected = new Map<string, MemoryToolInfo>();

		for (const name of MEMORY_TOOL_NAMES) {
			const tool = unifiedTools?.[name];
			if (tool) {
				collected.set(name, {
					name,
					description: tool.description ?? '',
					category: 'memory',
					source: tool.source ?? 'internal',
				});
			}
		}

		if (internalTools) {
			for (const name of MEMORY_TOOL_NAMES) {
				const tool = internalTools[name];
				if (!tool) continue;

				if (!collected.has(name)) {
					collected.set(name, {
						name,
						description: tool.description ?? '',
						category: tool.category ?? 'memory',
						source: 'internal',
					});
				} else {
					const existing = collected.get(name)!;
					if (!existing.description && tool.description) {
						existing.description = tool.description;
					}
					if (!existing.source) {
						existing.source = 'internal';
					}
				}
			}
		}

		return {
			tools: Array.from(collected.values()),
			unifiedTools,
			internalTools,
		};
	};

	const hasInternalTool = (
		toolName: string,
		inventory?: ToolInventory
	): boolean => {
		if (inventory?.internalTools && inventory.internalTools[toolName]) {
			return true;
		}

		const manager = getInternalToolManager();
		if (!manager || typeof manager.getTool !== 'function') {
			return false;
		}

		try {
			return !!manager.getTool(toolName);
		} catch (error) {
			logger.warn(`Internal tool lookup failed for ${toolName}`, {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	const isToolAvailable = async (
		toolName: string,
		inventory?: ToolInventory
	): Promise<boolean> => {
		const snapshot = inventory ?? (await fetchMemoryTools());

		if (snapshot.unifiedTools && toolName in snapshot.unifiedTools) {
			return true;
		}

		if (hasInternalTool(toolName, snapshot)) {
			return true;
		}

		const toolManager = getUnifiedToolManager();
		if (toolManager && typeof toolManager.isToolAvailable === 'function') {
			try {
				const available = await toolManager.isToolAvailable(toolName);
				if (available) {
					return true;
				}
			} catch (error) {
				logger.warn(`Unified tool availability check failed for ${toolName}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return hasInternalTool(toolName, snapshot);
	};

	const normalizeSearchResult = (
		result: any,
		query: string,
		limit: number
	) => {
		if (!result) {
			return {
				success: false,
				query,
				results: [],
				count: 0,
				limit,
				metadata: null,
				timestamp: new Date().toISOString(),
			};
		}

		const resultsArray = Array.isArray(result?.results)
			? result.results
			: Array.isArray(result)
			? result
			: result?.result
			? Array.isArray(result.result)
				? result.result
				: [result.result]
			: [];

		return {
			success: result?.success ?? true,
			query: result?.query ?? query,
			results: resultsArray,
			count: resultsArray.length,
			limit,
			metadata: result?.metadata ?? null,
			timestamp: result?.timestamp ?? new Date().toISOString(),
		};
	};

	/**
	 * GET /memory
	 * Get memory system status and statistics
	 */
	router.get('/', async (req: Request, res: Response) => {
		try {
			const vectorStorage = agent.services.vectorStorage;
			const vectorStoreManager = agent.services.vectorStoreManager;
			const vectorInfo =
				vectorStoreManager && typeof vectorStoreManager.getInfo === 'function'
					? vectorStoreManager.getInfo()
					: undefined;
			const inventory = await fetchMemoryTools();
			const embeddingManager = agent.services.embeddingManager;
			const embeddingEnabled = typeof embeddingManager?.isReady === 'function'
				? embeddingManager.isReady()
				: typeof embeddingManager?.hasAvailableEmbeddings === 'function'
				? embeddingManager.hasAvailableEmbeddings()
				: !!embeddingManager;

			const stats = {
				vectorStorage: {
					connected: vectorInfo && 'connected' in vectorInfo
						? vectorInfo.connected
						: vectorInfo && 'knowledge' in vectorInfo
						? vectorInfo.knowledge.connected
						: !!vectorStorage,
					type: vectorStorage?.constructor?.name ||
						(vectorInfo && 'backend' in vectorInfo ? vectorInfo.backend?.type : undefined) ||
						'unknown',
					...(vectorInfo && 'backend' in vectorInfo && vectorInfo.backend && {
						backend: {
							type: vectorInfo.backend.type,
							collection: vectorInfo.backend.collectionName,
							dimension: vectorInfo.backend.dimension,
							fallback: vectorInfo.backend.fallback,
						},
					}),
				},
				memoryTools: {
					available: inventory.tools.length > 0,
					count: inventory.tools.length,
					embeddingEnabled,
					tools: inventory.tools.map(tool => ({
						name: tool.name,
						source: tool.source ?? 'internal',
					})),
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
				(error instanceof Error ? { message: error.message } : String(error)),
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

			const toolManager = getUnifiedToolManager();
			if (!toolManager || typeof toolManager.executeTool !== 'function') {
				return errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					'Unified tool manager is not available',
					503,
					undefined,
					req.requestId
				);
			}

			const { resolvedSessionId, notFound } = await resolveSessionId(sessionId);
			if (sessionId && notFound) {
				return errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session not found: ${sessionId}`,
					404,
					undefined,
					req.requestId
				);
			}

			const inventory = await fetchMemoryTools();
			const topK = Math.min(Number(limit) || 10, 50);
			const toolAvailable = await isToolAvailable('cipher_memory_search', inventory);
			if (!toolAvailable) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Memory search tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			const result = await toolManager.executeTool(
				'cipher_memory_search',
				{
					query,
					top_k: topK,
					limit: topK,
				},
				resolvedSessionId
			);

			const normalized = normalizeSearchResult(result, query, topK);

			successResponse(res, normalized, 200, req.requestId);
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
			const {
				content,
				type = 'knowledge',
				sessionId,
				metadata = {},
				options: optionsInput,
				knowledgeInfo,
			} = req.body;

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

			if (metadata && (typeof metadata !== 'object' || Array.isArray(metadata))) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Metadata must be an object',
					400,
					undefined,
					req.requestId
				);
			}

			if (
				optionsInput !== undefined &&
				(typeof optionsInput !== 'object' || Array.isArray(optionsInput))
			) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'Options must be an object when provided',
					400,
					undefined,
					req.requestId
				);
			}

			if (
				knowledgeInfo !== undefined &&
				(typeof knowledgeInfo !== 'object' || Array.isArray(knowledgeInfo))
			) {
				return errorResponse(
					res,
					ERROR_CODES.VALIDATION_ERROR,
					'knowledgeInfo must be an object when provided',
					400,
					undefined,
					req.requestId
				);
			}

			const toolManager = getUnifiedToolManager();
			if (!toolManager || typeof toolManager.executeTool !== 'function') {
				return errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					'Unified tool manager is not available',
					503,
					undefined,
					req.requestId
				);
			}

			const baseMetadata: Record<string, any> =
				typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
			baseMetadata.source = baseMetadata.source ?? 'api';
			if (type && !baseMetadata.memoryType) {
				baseMetadata.memoryType = type;
			}

			const optionsPayload =
				typeof optionsInput === 'object' && optionsInput && !Array.isArray(optionsInput)
					? { ...optionsInput }
					: undefined;

			const knowledgeInfoPayload =
				typeof knowledgeInfo === 'object' && knowledgeInfo && !Array.isArray(knowledgeInfo)
					? { ...knowledgeInfo }
					: undefined;

			const { resolvedSessionId, notFound } = await resolveSessionId(sessionId);
			if (sessionId && notFound) {
				return errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session not found: ${sessionId}`,
					404,
					undefined,
					req.requestId
				);
			}

			if (resolvedSessionId) {
				baseMetadata.sourceSessionId = resolvedSessionId;
			}

			const inventory = await fetchMemoryTools();
			const toolAvailable = await isToolAvailable('cipher_extract_and_operate_memory', inventory);
			if (!toolAvailable) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Memory operation tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			const toolArgs: Record<string, any> = {
				interaction: content,
				memoryMetadata: baseMetadata,
			};
			if (resolvedSessionId) {
				toolArgs.context = { sessionId: resolvedSessionId };
			}
			if (knowledgeInfoPayload && Object.keys(knowledgeInfoPayload).length > 0) {
				toolArgs.knowledgeInfo = knowledgeInfoPayload;
			}
			if (optionsPayload && Object.keys(optionsPayload).length > 0) {
				toolArgs.options = optionsPayload;
			}

			const result = await toolManager.executeTool(
				'cipher_extract_and_operate_memory',
				toolArgs,
				resolvedSessionId
			);

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

			const toolManager = getUnifiedToolManager();
			if (!toolManager || typeof toolManager.executeTool !== 'function') {
				return errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					'Unified tool manager is not available',
					503,
					undefined,
					req.requestId
				);
			}

			const { resolvedSessionId, notFound } = await resolveSessionId(sessionId);
			if (sessionId && notFound) {
				return errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session not found: ${sessionId}`,
					404,
					undefined,
					req.requestId
				);
			}

			const inventory = await fetchMemoryTools();
			const toolAvailable = await isToolAvailable('cipher_store_reasoning_memory', inventory);
			if (!toolAvailable) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Reasoning memory tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			const result = await toolManager.executeTool(
				'cipher_store_reasoning_memory',
				{
					reasoning,
					quality,
					metadata: JSON.stringify(metadata),
				},
				resolvedSessionId
			);

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

			const toolManager = getUnifiedToolManager();
			if (!toolManager || typeof toolManager.executeTool !== 'function') {
				return errorResponse(
					res,
					ERROR_CODES.INTERNAL_ERROR,
					'Unified tool manager is not available',
					503,
					undefined,
					req.requestId
				);
			}

			const { resolvedSessionId, notFound } = await resolveSessionId(sessionId);
			if (sessionId && notFound) {
				return errorResponse(
					res,
					ERROR_CODES.SESSION_NOT_FOUND,
					`Session not found: ${sessionId}`,
					404,
					undefined,
					req.requestId
				);
			}

			const inventory = await fetchMemoryTools();
			const topK = Math.min(Number(limit) || 10, 50);
			const toolAvailable = await isToolAvailable(
				'cipher_search_reasoning_patterns',
				inventory
			);
			if (!toolAvailable) {
				return errorResponse(
					res,
					ERROR_CODES.NOT_FOUND,
					'Reasoning search tool not available',
					503,
					undefined,
					req.requestId
				);
			}

			const result = await toolManager.executeTool(
				'cipher_search_reasoning_patterns',
				{
					query,
					top_k: topK,
					limit: topK,
				},
				resolvedSessionId
			);

			const normalized = normalizeSearchResult(result, query, topK);

			successResponse(res, normalized, 200, req.requestId);
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
			const { tools: availableTools } = await fetchMemoryTools();
			const embeddingManager = agent.services.embeddingManager;
			const embeddingEnabled = typeof embeddingManager?.isReady === 'function'
				? embeddingManager.isReady()
				: typeof embeddingManager?.hasAvailableEmbeddings === 'function'
				? embeddingManager.hasAvailableEmbeddings()
				: !!embeddingManager;

			successResponse(
				res,
				{
					tools: availableTools,
					count: availableTools.length,
					embeddingEnabled,
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





