/**
 * Database Query Optimizer for Monitoring System
 *
 * Provides optimizations for handling large volumes of monitoring data
 * including connection pooling, query optimization, indexing strategies,
 * data partitioning, and performance monitoring.
 */

import { Pool, Client, type PoolConfig } from 'pg';
import { logger } from '../logger/index.js';

export interface QueryOptimizationConfig {
  // Connection pool optimization
  connectionPool: {
    min: number;
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
    acquireTimeoutMillis: number;
    maxUses?: number;
  };

  // Query performance settings
  query: {
    statementTimeout: number;
    queryTimeout: number;
    maxRows?: number;
    enablePreparedStatements: boolean;
    enableQueryPlan: boolean;
  };

  // Indexing strategy
  indexing: {
    autoCreateIndexes: boolean;
    indexMaintenanceInterval: number;
    customIndexes: Array<{
      table: string;
      columns: string[];
      type: 'btree' | 'hash' | 'gin' | 'gist';
      unique?: boolean;
    }>;
  };

  // Data partitioning
  partitioning: {
    enabled: boolean;
    strategy: 'time' | 'hash' | 'range';
    partitionSize: number;
    retentionDays: number;
  };

  // Performance monitoring
  monitoring: {
    enableSlowQueryLog: boolean;
    slowQueryThresholdMs: number;
    trackQueryStats: boolean;
    enableExplainAnalyze: boolean;
  };
}

export interface QueryStats {
  queryId: string;
  query: string;
  executionCount: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  lastExecuted: Date;
  slowExecutions: number;
}

export interface DatabaseMetrics {
  connectionPool: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingConnections: number;
    maxConnections: number;
    poolUtilization: number;
  };
  queries: {
    totalQueries: number;
    avgQueryTime: number;
    slowQueries: number;
    failedQueries: number;
    queriesPerSecond: number;
  };
  tables: Array<{
    tableName: string;
    rowCount: number;
    tableSize: string;
    indexSize: string;
    totalSize: string;
  }>;
  indexes: Array<{
    indexName: string;
    tableName: string;
    size: string;
    usage: number;
    effective: boolean;
  }>;
}

export class DatabaseOptimizer {
  private static instance: DatabaseOptimizer;
  private pool: Pool | null = null;
  private config: QueryOptimizationConfig;
  private queryStats: Map<string, QueryStats> = new Map();
  private maintenanceInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;

  private constructor(config: QueryOptimizationConfig) {
    this.config = config;
    this.initializeMaintenanceTasks();
  }

  static getInstance(config?: QueryOptimizationConfig): DatabaseOptimizer {
    if (!DatabaseOptimizer.instance && config) {
      DatabaseOptimizer.instance = new DatabaseOptimizer(config);
    }
    return DatabaseOptimizer.instance;
  }

  /**
   * Initialize optimized connection pool
   */
  async initializePool(poolConfig: PoolConfig): Promise<void> {
    const optimizedConfig: PoolConfig = {
      ...poolConfig,
      // Apply optimization settings
      min: this.config.connectionPool.min,
      max: this.config.connectionPool.max,
      idleTimeoutMillis: this.config.connectionPool.idleTimeoutMillis,
      connectionTimeoutMillis: this.config.connectionPool.connectionTimeoutMillis,
      maxUses: this.config.connectionPool.maxUses || 7500,

      // Performance optimizations
      statement_timeout: this.config.query.statementTimeout,
      query_timeout: this.config.query.queryTimeout,

      // Connection-level optimizations
      options: '--search_path=public --default_transaction_isolation=read_committed'
    };

    this.pool = new Pool(optimizedConfig);

    // Handle pool events for monitoring
    this.pool.on('connect', (client) => {
      logger.debug('New database connection established');
    });

    this.pool.on('error', (err) => {
      logger.error('Database pool error', { error: err.message });
    });

    this.pool.on('remove', () => {
      logger.debug('Database connection removed from pool');
    });

    // Test initial connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      logger.info('Database optimizer pool initialized successfully');
    } finally {
      client.release();
    }
  }

  /**
   * Execute optimized query with monitoring
   */
  async executeQuery<T = any>(
    query: string,
    params: any[] = [],
    options: {
      enablePreparedStatement?: boolean;
      timeout?: number;
      maxRows?: number;
      trackStats?: boolean;
    } = {}
  ): Promise<{ rows: T[]; rowCount: number; duration: number }> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    const startTime = Date.now();
    const queryId = this.generateQueryId(query);

    try {
      const client = await this.pool.connect();

      try {
        // Set query timeout if specified
        if (options.timeout) {
          await client.query(`SET statement_timeout = ${options.timeout}`);
        }

        // Set max rows if specified
        if (options.maxRows) {
          query = `${query} LIMIT ${options.maxRows}`;
        }

        // Execute query with or without prepared statement
        let result;
        if (options.enablePreparedStatement && this.config.query.enablePreparedStatements) {
          result = await client.query({
            text: query,
            values: params,
            rowMode: 'array'
          });
        } else {
          result = await client.query(query, params);
        }

        const duration = Date.now() - startTime;

        // Track query statistics
        if (options.trackStats !== false) {
          this.updateQueryStats(queryId, query, duration);
        }

        // Log slow queries
        if (this.config.monitoring.enableSlowQueryLog &&
            duration > this.config.monitoring.slowQueryThresholdMs) {
          logger.warn('Slow query detected', {
            queryId,
            duration,
            query: query.substring(0, 200),
            params: params.length
          });
        }

        return {
          rows: result.rows,
          rowCount: result.rowCount || 0,
          duration
        };

      } finally {
        client.release();
      }

    } catch (error) {
      const duration = Date.now() - startTime;

      // Update failed query stats
      if (options.trackStats !== false) {
        this.updateQueryStats(queryId, query, duration, true);
      }

      logger.error('Database query failed', {
        queryId,
        duration,
        error: error instanceof Error ? error.message : String(error),
        query: query.substring(0, 200)
      });

      throw error;
    }
  }

  /**
   * Execute batch operations with transaction
   */
  async executeBatch(
    operations: Array<{ query: string; params: any[] }>,
    options: { timeout?: number; isolationLevel?: string } = {}
  ): Promise<void> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      if (options.isolationLevel) {
        await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
      }

      if (options.timeout) {
        await client.query(`SET statement_timeout = ${options.timeout}`);
      }

      for (const operation of operations) {
        await client.query(operation.query, operation.params);
      }

      await client.query('COMMIT');

      logger.debug('Batch operation completed successfully', {
        operationCount: operations.length
      });

    } catch (error) {
      await client.query('ROLLBACK');

      logger.error('Batch operation failed, rolled back', {
        operationCount: operations.length,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create optimized indexes for monitoring tables
   */
  async createOptimizedIndexes(): Promise<void> {
    if (!this.pool || !this.config.indexing.autoCreateIndexes) {
      return;
    }

    const monitoringIndexes = [
      // Cipher store optimizations
      {
        table: 'cipher_store',
        columns: ['updated_at'],
        type: 'btree' as const,
        name: 'idx_cipher_store_updated_at_opt'
      },
      {
        table: 'cipher_store',
        columns: ['key', 'updated_at'],
        type: 'btree' as const,
        name: 'idx_cipher_store_key_updated_composite'
      },

      // Cipher lists optimizations
      {
        table: 'cipher_lists',
        columns: ['key', 'position'],
        type: 'btree' as const,
        name: 'idx_cipher_lists_key_position_opt'
      },
      {
        table: 'cipher_lists',
        columns: ['created_at'],
        type: 'btree' as const,
        name: 'idx_cipher_lists_created_at_opt'
      },

      // Monitoring-specific tables (if they exist)
      {
        table: 'monitoring_metrics',
        columns: ['timestamp'],
        type: 'btree' as const,
        name: 'idx_monitoring_metrics_timestamp'
      },
      {
        table: 'monitoring_metrics',
        columns: ['metric_type', 'timestamp'],
        type: 'btree' as const,
        name: 'idx_monitoring_metrics_type_time'
      },
      {
        table: 'monitoring_alerts',
        columns: ['created_at', 'resolved_at'],
        type: 'btree' as const,
        name: 'idx_monitoring_alerts_time_range'
      },
      {
        table: 'monitoring_errors',
        columns: ['error_type', 'created_at'],
        type: 'btree' as const,
        name: 'idx_monitoring_errors_type_time'
      }
    ];

    // Add custom indexes from config
    const allIndexes = [
      ...monitoringIndexes,
      ...this.config.indexing.customIndexes.map(idx => ({
        table: idx.table,
        columns: idx.columns,
        type: idx.type,
        unique: idx.unique,
        name: `idx_${idx.table}_${idx.columns.join('_')}_custom`
      }))
    ];

    for (const index of allIndexes) {
      try {
        const indexName = index.name;
        const tableName = index.table;
        const columns = index.columns.join(', ');
        const indexType = index.type.toUpperCase();
        const uniqueClause = 'unique' in index && index.unique === true ? 'UNIQUE' : '';

        // Check if index already exists
        const existsQuery = `
          SELECT 1 FROM pg_indexes
          WHERE tablename = $1 AND indexname = $2
        `;
        const existsResult = await this.pool.query(existsQuery, [tableName, indexName]);

        if (existsResult.rows.length === 0) {
          // Check if table exists before creating index
          const tableExistsQuery = `
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
          `;
          const tableResult = await this.pool.query(tableExistsQuery, [tableName]);

          if (tableResult.rows.length > 0) {
            const createIndexQuery = `
              CREATE ${uniqueClause} INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
              ON ${tableName} USING ${indexType} (${columns})
            `;

            await this.pool.query(createIndexQuery);
            logger.info('Created optimized index', { indexName, tableName });
          }
        }
      } catch (error) {
        logger.warn('Failed to create index', {
          indexName: index.name,
          tableName: index.table,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Create partitioned tables for time-series data
   */
  async createPartitionedTables(): Promise<void> {
    if (!this.pool || !this.config.partitioning.enabled) {
      return;
    }

    const partitionedTables = [
      {
        name: 'monitoring_metrics_partitioned',
        baseTable: 'monitoring_metrics',
        partitionColumn: 'timestamp',
        partitionType: this.config.partitioning.strategy
      },
      {
        name: 'monitoring_alerts_partitioned',
        baseTable: 'monitoring_alerts',
        partitionColumn: 'created_at',
        partitionType: this.config.partitioning.strategy
      }
    ];

    for (const table of partitionedTables) {
      try {
        // Create parent partitioned table
        const createTableQuery = `
          CREATE TABLE IF NOT EXISTS ${table.name} (
            LIKE ${table.baseTable} INCLUDING ALL
          ) PARTITION BY RANGE (${table.partitionColumn})
        `;

        await this.pool.query(createTableQuery);

        // Create monthly partitions for the current and next month
        if (table.partitionType === 'time') {
          await this.createTimePartitions(table.name, table.partitionColumn);
        }

        logger.info('Created partitioned table', { tableName: table.name });

      } catch (error) {
        logger.warn('Failed to create partitioned table', {
          tableName: table.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Get comprehensive database metrics
   */
  async getDatabaseMetrics(): Promise<DatabaseMetrics> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    // Connection pool metrics
    const poolMetrics = {
      totalConnections: this.pool.totalCount,
      activeConnections: this.pool.totalCount - this.pool.idleCount,
      idleConnections: this.pool.idleCount,
      waitingConnections: this.pool.waitingCount,
      maxConnections: this.config.connectionPool.max,
      poolUtilization: (this.pool.totalCount / this.config.connectionPool.max) * 100
    };

    // Query performance metrics
    const totalQueries = Array.from(this.queryStats.values())
      .reduce((sum, stat) => sum + stat.executionCount, 0);

    const totalTime = Array.from(this.queryStats.values())
      .reduce((sum, stat) => sum + stat.totalTime, 0);

    const slowQueries = Array.from(this.queryStats.values())
      .reduce((sum, stat) => sum + stat.slowExecutions, 0);

    const queryMetrics = {
      totalQueries,
      avgQueryTime: totalQueries > 0 ? totalTime / totalQueries : 0,
      slowQueries,
      failedQueries: 0, // TODO: Track failed queries
      queriesPerSecond: this.calculateQueriesPerSecond()
    };

    // Table statistics
    const tableStats = await this.getTableStatistics();

    // Index statistics
    const indexStats = await this.getIndexStatistics();

    return {
      connectionPool: poolMetrics,
      queries: queryMetrics,
      tables: tableStats,
      indexes: indexStats
    };
  }

  /**
   * Optimize database performance
   */
  async optimizeDatabase(): Promise<void> {
    if (!this.pool) {
      return;
    }

    logger.info('Starting database optimization');

    try {
      // Update table statistics
      await this.pool.query('ANALYZE');

      // Vacuum to reclaim space
      await this.pool.query('VACUUM');

      // Reindex if needed
      if (this.config.indexing.autoCreateIndexes) {
        await this.reindexLowPerformanceIndexes();
      }

      // Clean up old partitions
      if (this.config.partitioning.enabled) {
        await this.cleanupOldPartitions();
      }

      logger.info('Database optimization completed');

    } catch (error) {
      logger.error('Database optimization failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get query performance statistics
   */
  getQueryStats(): QueryStats[] {
    return Array.from(this.queryStats.values())
      .sort((a, b) => b.totalTime - a.totalTime);
  }

  /**
   * Close database connections and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }

    logger.info('Database optimizer shutdown completed');
  }

  // Private helper methods

  private initializeMaintenanceTasks(): void {
    // Regular maintenance
    this.maintenanceInterval = setInterval(() => {
      this.optimizeDatabase().catch(error => {
        logger.error('Maintenance task failed', { error: error.message });
      });
    }, this.config.indexing.indexMaintenanceInterval);

    // Metrics collection
    this.metricsInterval = setInterval(() => {
      this.collectMetrics().catch(error => {
        logger.error('Metrics collection failed', { error: error.message });
      });
    }, 60000); // Every minute
  }

  private generateQueryId(query: string): string {
    // Simple hash of query text for identification
    return Buffer.from(query.replace(/\s+/g, ' ').trim()).toString('base64').substring(0, 16);
  }

  private updateQueryStats(queryId: string, query: string, duration: number, failed: boolean = false): void {
    const existing = this.queryStats.get(queryId);

    if (existing) {
      existing.executionCount++;
      existing.totalTime += duration;
      existing.averageTime = existing.totalTime / existing.executionCount;
      existing.minTime = Math.min(existing.minTime, duration);
      existing.maxTime = Math.max(existing.maxTime, duration);
      existing.lastExecuted = new Date();

      if (duration > this.config.monitoring.slowQueryThresholdMs) {
        existing.slowExecutions++;
      }
    } else {
      this.queryStats.set(queryId, {
        queryId,
        query: query.substring(0, 500), // Truncate for storage
        executionCount: 1,
        totalTime: duration,
        averageTime: duration,
        minTime: duration,
        maxTime: duration,
        lastExecuted: new Date(),
        slowExecutions: duration > this.config.monitoring.slowQueryThresholdMs ? 1 : 0
      });
    }
  }

  private async createTimePartitions(tableName: string, partitionColumn: string): Promise<void> {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    // Create partitions for current and next 3 months
    for (let i = 0; i < 4; i++) {
      const partitionDate = new Date(currentYear, currentMonth + i, 1);
      const nextPartitionDate = new Date(currentYear, currentMonth + i + 1, 1);

      const partitionName = `${tableName}_${partitionDate.getFullYear()}_${String(partitionDate.getMonth() + 1).padStart(2, '0')}`;

      const createPartitionQuery = `
        CREATE TABLE IF NOT EXISTS ${partitionName}
        PARTITION OF ${tableName}
        FOR VALUES FROM ('${partitionDate.toISOString()}') TO ('${nextPartitionDate.toISOString()}')
      `;

      try {
        await this.pool!.query(createPartitionQuery);
        logger.debug('Created time partition', { partitionName });
      } catch (error) {
        logger.warn('Failed to create time partition', {
          partitionName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async getTableStatistics(): Promise<Array<{
    tableName: string;
    rowCount: number;
    tableSize: string;
    indexSize: string;
    totalSize: string;
  }>> {
    try {
      const query = `
        SELECT
          schemaname,
          tablename,
          attname,
          n_distinct,
          correlation,
          most_common_vals,
          most_common_freqs,
          histogram_bounds
        FROM pg_stats
        WHERE schemaname = 'public'
        AND tablename IN ('cipher_store', 'cipher_lists', 'cipher_list_metadata')
      `;

      const result = await this.pool!.query(query);

      // Transform to required format
      return result.rows.map(row => ({
        tableName: row.tablename,
        rowCount: parseInt(row.n_distinct) || 0,
        tableSize: '0 bytes', // TODO: Get actual size
        indexSize: '0 bytes', // TODO: Get actual size
        totalSize: '0 bytes'  // TODO: Get actual size
      }));

    } catch (error) {
      logger.error('Failed to get table statistics', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async getIndexStatistics(): Promise<Array<{
    indexName: string;
    tableName: string;
    size: string;
    usage: number;
    effective: boolean;
  }>> {
    try {
      const query = `
        SELECT
          indexrelname as index_name,
          relname as table_name,
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes
        JOIN pg_stat_user_tables ON pg_stat_user_indexes.relid = pg_stat_user_tables.relid
        WHERE schemaname = 'public'
      `;

      const result = await this.pool!.query(query);

      return result.rows.map(row => ({
        indexName: row.index_name,
        tableName: row.table_name,
        size: '0 bytes', // TODO: Get actual size
        usage: parseInt(row.idx_tup_read) || 0,
        effective: (parseInt(row.idx_tup_read) || 0) > 0
      }));

    } catch (error) {
      logger.error('Failed to get index statistics', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async reindexLowPerformanceIndexes(): Promise<void> {
    // TODO: Implement reindex logic for underperforming indexes
    logger.debug('Reindexing low performance indexes');
  }

  private async cleanupOldPartitions(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.partitioning.retentionDays);

    // TODO: Implement partition cleanup logic
    logger.debug('Cleaning up old partitions', { cutoffDate });
  }

  private calculateQueriesPerSecond(): number {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    const recentQueries = Array.from(this.queryStats.values())
      .filter(stat => stat.lastExecuted.getTime() > oneMinuteAgo)
      .reduce((sum, stat) => sum + stat.executionCount, 0);

    return recentQueries / 60;
  }

  private async collectMetrics(): Promise<void> {
    try {
      // TODO: Implement periodic metrics collection
      logger.debug('Collecting database performance metrics');
    } catch (error) {
      logger.error('Failed to collect metrics', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Default configuration for production use
export const defaultOptimizationConfig: QueryOptimizationConfig = {
  connectionPool: {
    min: 5,
    max: 50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    acquireTimeoutMillis: 10000,
    maxUses: 7500
  },
  query: {
    statementTimeout: 30000,
    queryTimeout: 30000,
    maxRows: 10000,
    enablePreparedStatements: true,
    enableQueryPlan: false
  },
  indexing: {
    autoCreateIndexes: true,
    indexMaintenanceInterval: 3600000, // 1 hour
    customIndexes: []
  },
  partitioning: {
    enabled: true,
    strategy: 'time',
    partitionSize: 1000000, // 1M rows per partition
    retentionDays: 90
  },
  monitoring: {
    enableSlowQueryLog: true,
    slowQueryThresholdMs: 1000,
    trackQueryStats: true,
    enableExplainAnalyze: false
  }
};