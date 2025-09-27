/**
 * Backup API Routes
 *
 * REST API endpoints for backup management operations.
 * Provides comprehensive backup control and monitoring capabilities.
 */

import { Router, Request, Response } from 'express';
import {
  BackupManager,
  BackupScheduler,
  BackupConfig,
  BackupStorageType,
  BackupSearchFilters,
  RestoreOptions,
  StorageBackupConfig,
  BackupSchedule,
  VerificationType,
} from '../../../core/backup/index.js';
import { createLogger } from '../../../core/logger/logger.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { body, param } from 'express-validator';

const router = Router();
const logger = createLogger({ level: 'info' });

// Global backup manager and scheduler instances
let backupManager: BackupManager;
let backupScheduler: BackupScheduler;

/**
 * Initialize backup manager and scheduler
 */
export function initializeBackupAPI(manager: BackupManager, scheduler: BackupScheduler): void {
  backupManager = manager;
  backupScheduler = scheduler;
}


/**
 * GET /api/backup/status
 * Get backup system status and configuration
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const [config, statistics] = await Promise.all([
      backupManager.getConfig(),
      backupManager.getStatistics(),
    ]);

    const schedulerStats = backupScheduler ? backupScheduler.getStatistics() : null;

    res.json({
      success: true,
      data: {
        enabled: config.enabled,
        config: {
          maxParallelJobs: config.global.maxParallelJobs,
          enableVerification: config.global.enableVerification,
          enableMonitoring: config.global.enableMonitoring,
          destinations: config.destinations.map(dest => ({
            type: dest.type,
            path: dest.path,
            encryption: dest.encryption,
          })),
          storageTypes: config.storageConfigs.map(sc => ({
            type: sc.type,
            enabled: sc.enabled,
            backupType: sc.backupType,
            compression: sc.compression,
          })),
        },
        statistics,
        scheduler: schedulerStats,
      },
    });

  } catch (error) {
    logger.error('Failed to get backup status:', error);
    res.status(500).json({
      error: 'Failed to get backup status',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_STATUS_ERROR'
    });
  }
});

/**
 * POST /api/backup/start
 * Start a backup for specific storage type
 */
// Create validation middleware for start backup
const validateStartBackup = [
  body('storageType')
    .isIn(['sqlite', 'postgres', 'redis', 'neo4j', 'qdrant', 'milvus', 'chroma', 'pinecone', 'pgvector', 'faiss', 'weaviate', 'file-system', 'monitoring-data'])
    .withMessage('Invalid storage type'),
  body('options.backupType')
    .optional()
    .isIn(['full', 'incremental', 'differential'])
    .withMessage('Invalid backup type'),
  body('options.compression')
    .optional()
    .isIn(['none', 'gzip', 'brotli', 'lz4'])
    .withMessage('Invalid compression type'),
  handleValidationErrors,
];

router.post('/start', validateStartBackup, async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const { storageType, options } = req.body;

    const jobId = await backupManager.startBackup(storageType, options);

    res.json({
      success: true,
      data: {
        jobId,
        storageType,
        status: 'started',
        message: `Backup started for ${storageType}`,
      },
    });

  } catch (error) {
    logger.error('Failed to start backup:', error);
    res.status(400).json({
      error: 'Failed to start backup',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_START_ERROR'
    });
  }
});

/**
 * POST /api/backup/start-full
 * Start a full system backup
 */
router.post('/start-full', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const jobIds = await backupManager.startFullBackup();

    res.json({
      success: true,
      data: {
        jobIds,
        totalJobs: jobIds.length,
        status: 'started',
        message: `Full system backup started with ${jobIds.length} jobs`,
      },
    });

  } catch (error) {
    logger.error('Failed to start full backup:', error);
    res.status(400).json({
      error: 'Failed to start full backup',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_FULL_START_ERROR'
    });
  }
});

/**
 * GET /api/backup/jobs
 * List backup jobs with optional filtering
 */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const filters: Partial<BackupSearchFilters> = {};

    if (req.query.storageType) {
      filters.storageType = req.query.storageType as BackupStorageType;
    }

    if (req.query.status) {
      filters.status = req.query.status as any;
    }

    if (req.query.dateStart && req.query.dateEnd) {
      filters.dateRange = {
        start: new Date(req.query.dateStart as string),
        end: new Date(req.query.dateEnd as string),
      };
    }

    const jobs = await backupManager.listJobs(filters);

    res.json({
      success: true,
      data: {
        jobs: jobs.map(job => ({
          id: job.id,
          storageType: job.storageType,
          status: job.status,
          progress: job.progress,
          currentOperation: job.currentOperation,
          startTime: job.startTime,
          estimatedCompletion: job.estimatedCompletion,
          error: job.error,
          metadata: {
            id: job.metadata.id,
            backupType: job.metadata.backupType,
            size: job.metadata.size,
            compressedSize: job.metadata.compressedSize,
            compression: job.metadata.compression,
            files: job.metadata.files.length,
            endTime: job.metadata.endTime,
          },
        })),
        total: jobs.length,
      },
    });

  } catch (error) {
    logger.error('Failed to list backup jobs:', error);
    res.status(500).json({
      error: 'Failed to list backup jobs',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_LIST_ERROR'
    });
  }
});

/**
 * GET /api/backup/jobs/:jobId
 * Get specific backup job status
 */
router.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID is required',
        code: 'MISSING_JOB_ID'
      });
    }
    const job = await backupManager.getBackupStatus(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Backup job not found',
        code: 'BACKUP_JOB_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        id: job.id,
        storageType: job.storageType,
        status: job.status,
        progress: job.progress,
        currentOperation: job.currentOperation,
        startTime: job.startTime,
        estimatedCompletion: job.estimatedCompletion,
        error: job.error,
        config: job.config,
        destination: job.destination,
        metadata: job.metadata,
      },
    });

  } catch (error) {
    logger.error('Failed to get backup job status:', error);
    res.status(500).json({
      error: 'Failed to get backup job status',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_JOB_STATUS_ERROR'
    });
  }
});

/**
 * DELETE /api/backup/jobs/:jobId
 * Cancel a running backup job
 */
router.delete('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID is required',
        code: 'MISSING_JOB_ID'
      });
    }
    const cancelled = await backupManager.cancelBackup(jobId);

    if (!cancelled) {
      return res.status(404).json({
        error: 'Backup job not found or cannot be cancelled',
        code: 'BACKUP_JOB_CANCEL_FAILED'
      });
    }

    res.json({
      success: true,
      data: {
        jobId,
        status: 'cancelled',
        message: 'Backup job cancelled successfully',
      },
    });

  } catch (error) {
    logger.error('Failed to cancel backup job:', error);
    res.status(500).json({
      error: 'Failed to cancel backup job',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_JOB_CANCEL_ERROR'
    });
  }
});

/**
 * POST /api/backup/search
 * Search backups with advanced filtering
 */
// Create validation middleware for search backups
const validateSearchBackups = [
  body('storageType')
    .optional()
    .isIn(['sqlite', 'postgres', 'redis', 'neo4j', 'qdrant', 'milvus', 'chroma', 'pinecone', 'pgvector', 'faiss', 'weaviate', 'file-system', 'monitoring-data'])
    .withMessage('Invalid storage type'),
  body('status')
    .optional()
    .isIn(['pending', 'in-progress', 'completed', 'failed', 'cancelled'])
    .withMessage('Invalid status'),
  body('dateRange.start')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  body('dateRange.end')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
  body('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  body('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer'),
  handleValidationErrors,
];

router.post('/search', validateSearchBackups, async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const filters: BackupSearchFilters = req.body;

    // Convert string dates to Date objects
    if (filters.dateRange) {
      filters.dateRange.start = new Date(filters.dateRange.start as any);
      filters.dateRange.end = new Date(filters.dateRange.end as any);
    }

    const backups = await backupManager.searchBackups(filters);

    res.json({
      success: true,
      data: {
        backups: backups.map(backup => ({
          id: backup.id,
          storageType: backup.storageType,
          backupType: backup.backupType,
          status: backup.status,
          startTime: backup.startTime,
          endTime: backup.endTime,
          size: backup.size,
          compressedSize: backup.compressedSize,
          compression: backup.compression,
          files: backup.files.length,
          destination: backup.destination,
          tags: backup.tags,
          version: backup.version,
        })),
        total: backups.length,
        filters,
      },
    });

  } catch (error) {
    logger.error('Failed to search backups:', error);
    res.status(500).json({
      error: 'Failed to search backups',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_SEARCH_ERROR'
    });
  }
});

/**
 * POST /api/backup/restore
 * Restore from backup
 */
// Create validation middleware for restore backup
const validateRestoreBackup = [
  body('backupId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Backup ID is required'),
  body('targetPath')
    .optional()
    .isString()
    .withMessage('Target path must be a string'),
  body('overwrite')
    .optional()
    .isBoolean()
    .withMessage('Overwrite must be a boolean'),
  body('verify')
    .optional()
    .isBoolean()
    .withMessage('Verify must be a boolean'),
  handleValidationErrors,
];

router.post('/restore', validateRestoreBackup, async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const options: RestoreOptions = req.body;
    const success = await backupManager.restoreBackup(options.backupId, options);

    res.json({
      success: true,
      data: {
        backupId: options.backupId,
        restored: success,
        message: success ? 'Backup restored successfully' : 'Backup restore failed',
      },
    });

  } catch (error) {
    logger.error('Failed to restore backup:', error);
    res.status(400).json({
      error: 'Failed to restore backup',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_RESTORE_ERROR'
    });
  }
});

/**
 * DELETE /api/backup/:backupId
 * Delete a backup
 */
router.delete('/:backupId', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const { backupId } = req.params;
    if (!backupId) {
      return res.status(400).json({
        error: 'Backup ID is required',
        code: 'MISSING_BACKUP_ID'
      });
    }
    const deleted = await backupManager.deleteBackup(backupId);

    res.json({
      success: true,
      data: {
        backupId,
        deleted,
        message: deleted ? 'Backup deleted successfully' : 'Backup deletion failed',
      },
    });

  } catch (error) {
    logger.error('Failed to delete backup:', error);
    res.status(400).json({
      error: 'Failed to delete backup',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_DELETE_ERROR'
    });
  }
});

/**
 * POST /api/backup/verify/:backupId
 * Verify backup integrity
 */
router.post('/verify/:backupId', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const { backupId } = req.params;
    if (!backupId) {
      return res.status(400).json({
        error: 'Backup ID is required',
        code: 'MISSING_BACKUP_ID'
      });
    }
    const verificationType = req.body.type as VerificationType || 'checksum';

    const isValid = await backupManager.verifyBackup(backupId, verificationType);

    res.json({
      success: true,
      data: {
        backupId,
        verificationType,
        valid: isValid,
        message: isValid ? 'Backup verification passed' : 'Backup verification failed',
      },
    });

  } catch (error) {
    logger.error('Failed to verify backup:', error);
    res.status(400).json({
      error: 'Failed to verify backup',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_VERIFY_ERROR'
    });
  }
});

/**
 * POST /api/backup/cleanup
 * Cleanup old backups
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const deletedCount = await backupManager.cleanupOldBackups();

    res.json({
      success: true,
      data: {
        deletedCount,
        message: `Cleanup completed. Deleted ${deletedCount} old backups`,
      },
    });

  } catch (error) {
    logger.error('Failed to cleanup old backups:', error);
    res.status(500).json({
      error: 'Failed to cleanup old backups',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_CLEANUP_ERROR'
    });
  }
});

/**
 * GET /api/backup/statistics
 * Get backup statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    if (!backupManager) {
      return res.status(503).json({
        error: 'Backup manager not initialized',
        code: 'BACKUP_NOT_INITIALIZED'
      });
    }

    const statistics = await backupManager.getStatistics();

    res.json({
      success: true,
      data: statistics,
    });

  } catch (error) {
    logger.error('Failed to get backup statistics:', error);
    res.status(500).json({
      error: 'Failed to get backup statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'BACKUP_STATISTICS_ERROR'
    });
  }
});

// Schedule management endpoints

/**
 * GET /api/backup/schedules
 * Get all scheduled backup jobs
 */
router.get('/schedules', async (req: Request, res: Response) => {
  try {
    if (!backupScheduler) {
      return res.status(503).json({
        error: 'Backup scheduler not initialized',
        code: 'SCHEDULER_NOT_INITIALIZED'
      });
    }

    const schedules = backupScheduler.getScheduledJobs();
    const nextExecutions = backupScheduler.getNextExecutions();

    res.json({
      success: true,
      data: {
        schedules: schedules.map(schedule => ({
          ...schedule,
          nextExecution: nextExecutions[schedule.id],
        })),
        total: schedules.length,
      },
    });

  } catch (error) {
    logger.error('Failed to get scheduled jobs:', error);
    res.status(500).json({
      error: 'Failed to get scheduled jobs',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'SCHEDULE_LIST_ERROR'
    });
  }
});

/**
 * POST /api/backup/schedules
 * Add a new backup schedule
 */
// Create validation middleware for add schedule
const validateAddSchedule = [
  body('name')
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('storageType')
    .isIn(['sqlite', 'postgres', 'redis', 'neo4j', 'qdrant', 'milvus', 'chroma', 'pinecone', 'pgvector', 'faiss', 'weaviate', 'file-system', 'monitoring-data'])
    .withMessage('Invalid storage type'),
  body('schedule.cron')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Cron expression is required'),
  body('schedule.enabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled must be a boolean'),
  body('schedule.timeout')
    .optional()
    .isInt({ min: 1, max: 1440 })
    .withMessage('Timeout must be between 1 and 1440 minutes'),
  handleValidationErrors,
];

router.post('/schedules', validateAddSchedule, async (req: Request, res: Response) => {
  try {
    if (!backupScheduler) {
      return res.status(503).json({
        error: 'Backup scheduler not initialized',
        code: 'SCHEDULER_NOT_INITIALIZED'
      });
    }

    const { name, storageType, schedule, storageConfig } = req.body;

    const jobId = await backupScheduler.addSchedule(name, storageType, schedule, storageConfig);

    res.json({
      success: true,
      data: {
        jobId,
        name,
        storageType,
        schedule,
        message: 'Backup schedule added successfully',
      },
    });

  } catch (error) {
    logger.error('Failed to add backup schedule:', error);
    res.status(400).json({
      error: 'Failed to add backup schedule',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'SCHEDULE_ADD_ERROR'
    });
  }
});

/**
 * PUT /api/backup/schedules/:jobId
 * Update backup schedule
 */
// Create validation middleware for update schedule
const validateUpdateSchedule = [
  param('jobId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Job ID is required'),
  body('cron')
    .optional()
    .isString()
    .isLength({ min: 1 })
    .withMessage('Cron expression must be a non-empty string'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled must be a boolean'),
  body('timeout')
    .optional()
    .isInt({ min: 1, max: 1440 })
    .withMessage('Timeout must be between 1 and 1440 minutes'),
  handleValidationErrors,
];

router.put('/schedules/:jobId', validateUpdateSchedule, async (req: Request, res: Response) => {
  try {
    if (!backupScheduler) {
      return res.status(503).json({
        error: 'Backup scheduler not initialized',
        code: 'SCHEDULER_NOT_INITIALIZED'
      });
    }

    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID is required',
        code: 'MISSING_JOB_ID'
      });
    }
    const updates = req.body;

    const updated = await backupScheduler.updateSchedule(jobId, updates);

    if (!updated) {
      return res.status(404).json({
        error: 'Scheduled job not found',
        code: 'SCHEDULE_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        jobId,
        updated: true,
        message: 'Backup schedule updated successfully',
      },
    });

  } catch (error) {
    logger.error('Failed to update backup schedule:', error);
    res.status(400).json({
      error: 'Failed to update backup schedule',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'SCHEDULE_UPDATE_ERROR'
    });
  }
});

/**
 * DELETE /api/backup/schedules/:jobId
 * Remove backup schedule
 */
router.delete('/schedules/:jobId', async (req: Request, res: Response) => {
  try {
    if (!backupScheduler) {
      return res.status(503).json({
        error: 'Backup scheduler not initialized',
        code: 'SCHEDULER_NOT_INITIALIZED'
      });
    }

    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID is required',
        code: 'MISSING_JOB_ID'
      });
    }
    const removed = await backupScheduler.removeSchedule(jobId);

    if (!removed) {
      return res.status(404).json({
        error: 'Scheduled job not found',
        code: 'SCHEDULE_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        jobId,
        removed: true,
        message: 'Backup schedule removed successfully',
      },
    });

  } catch (error) {
    logger.error('Failed to remove backup schedule:', error);
    res.status(400).json({
      error: 'Failed to remove backup schedule',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'SCHEDULE_REMOVE_ERROR'
    });
  }
});

/**
 * POST /api/backup/schedules/:jobId/toggle
 * Enable/disable backup schedule
 */
router.post('/schedules/:jobId/toggle', async (req: Request, res: Response) => {
  try {
    if (!backupScheduler) {
      return res.status(503).json({
        error: 'Backup scheduler not initialized',
        code: 'SCHEDULER_NOT_INITIALIZED'
      });
    }

    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID is required',
        code: 'MISSING_JOB_ID'
      });
    }
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'enabled parameter must be a boolean',
        code: 'INVALID_PARAMETER'
      });
    }

    const toggled = await backupScheduler.toggleSchedule(jobId, enabled);

    if (!toggled) {
      return res.status(404).json({
        error: 'Scheduled job not found',
        code: 'SCHEDULE_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      data: {
        jobId,
        enabled,
        message: `Backup schedule ${enabled ? 'enabled' : 'disabled'} successfully`,
      },
    });

  } catch (error) {
    logger.error('Failed to toggle backup schedule:', error);
    res.status(400).json({
      error: 'Failed to toggle backup schedule',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'SCHEDULE_TOGGLE_ERROR'
    });
  }
});

/**
 * POST /api/backup/schedules/:jobId/run
 * Run scheduled job immediately
 */
router.post('/schedules/:jobId/run', async (req: Request, res: Response) => {
  try {
    if (!backupScheduler) {
      return res.status(503).json({
        error: 'Backup scheduler not initialized',
        code: 'SCHEDULER_NOT_INITIALIZED'
      });
    }

    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID is required',
        code: 'MISSING_JOB_ID'
      });
    }
    const result = await backupScheduler.runJobNow(jobId);

    res.json({
      success: true,
      data: {
        jobId: result.jobId,
        success: result.success,
        startTime: result.startTime,
        endTime: result.endTime,
        duration: result.duration,
        error: result.error?.message,
        message: result.success ? 'Scheduled job executed successfully' : 'Scheduled job execution failed',
      },
    });

  } catch (error) {
    logger.error('Failed to run scheduled job:', error);
    res.status(400).json({
      error: 'Failed to run scheduled job',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'SCHEDULE_RUN_ERROR'
    });
  }
});

export default router;