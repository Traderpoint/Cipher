/**
 * Connection Pool Factories
 *
 * Exports all database-specific pool factories for the universal connection pool system.
 *
 * @module storage/connection-pool/factories
 */

// Core database factories
export { PostgresPoolFactory, postgresFactory } from './postgres-factory.js';
export { RedisPoolFactory, redisFactory } from './redis-factory.js';
export { Neo4jPoolFactory, neo4jFactory } from './neo4j-factory.js';

// Vector database factories
export { MilvusPoolFactory, milvusFactory } from './milvus-factory.js';
export { QdrantPoolFactory, qdrantFactory } from './qdrant-factory.js';

// Additional vector database factories (to be implemented)
// export { ChromaPoolFactory, chromaFactory } from './chroma-factory.js';
// export { PineconePoolFactory, pineconeFactory } from './pinecone-factory.js';
// export { WeaviatePoolFactory, weaviateFactory } from './weaviate-factory.js';
// export { PgVectorPoolFactory, pgVectorFactory } from './pgvector-factory.js';

/**
 * Get all available factories
 */
export function getAllFactories() {
	return [
		postgresFactory,
		redisFactory,
		neo4jFactory,
		milvusFactory,
		qdrantFactory,
		// chromaFactory,
		// pineconeFactory,
		// weaviateFactory,
		// pgVectorFactory,
	];
}

/**
 * Factory registry for dynamic factory lookup
 */
export const FACTORY_REGISTRY = {
	postgres: postgresFactory,
	redis: redisFactory,
	neo4j: neo4jFactory,
	milvus: milvusFactory,
	qdrant: qdrantFactory,
	// chroma: chromaFactory,
	// pinecone: pineconeFactory,
	// weaviate: weaviateFactory,
	// pgvector: pgVectorFactory,
} as const;

/**
 * Get factory by type
 */
export function getFactoryByType(type: string) {
	return FACTORY_REGISTRY[type as keyof typeof FACTORY_REGISTRY];
}