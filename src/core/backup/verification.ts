/**
 * Backup Verification System
 *
 * Comprehensive backup verification and integrity checking system.
 * Provides multiple verification methods to ensure backup reliability.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import {
  BackupMetadata,
  VerificationType,
  IStorageBackupHandler,
  RestoreOptions,
} from './types.js';
import { Logger } from '../logger/logger.js';

/**
 * Verification result interface
 */
export interface VerificationResult {
  type: VerificationType;
  passed: boolean;
  details: Record<string, any>;
  errors: string[];
  warnings: string[];
  duration: number;
  timestamp: Date;
}

/**
 * Verification configuration
 */
export interface VerificationConfig {
  /** Enable parallel verification */
  enableParallelChecks: boolean;
  /** Maximum number of parallel verification jobs */
  maxParallelJobs: number;
  /** Timeout for verification operations (seconds) */
  timeout: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** Custom verification scripts */
  customScripts: {
    [storageType: string]: string[];
  };
}

/**
 * File verification result
 */
interface FileVerificationResult {
  file: string;
  exists: boolean;
  size: number;
  checksumMatch: boolean;
  expectedChecksum: string;
  actualChecksum: string;
  readable: boolean;
  error?: string;
}

/**
 * Backup Verification Engine
 */
export class BackupVerificationEngine {
  private readonly logger: Logger;
  private readonly config: VerificationConfig;

  constructor(config: Partial<VerificationConfig> = {}, logger?: Logger) {
    this.logger = logger || new Logger({ level: 'info' });
    this.config = {
      enableParallelChecks: true,
      maxParallelJobs: 3,
      timeout: 300, // 5 minutes
      verbose: false,
      customScripts: {},
      ...config,
    };
  }

  /**
   * Verify backup using specified method
   */
  async verifyBackup(
    metadata: BackupMetadata,
    verificationType: VerificationType,
    handler?: IStorageBackupHandler
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const result: VerificationResult = {
      type: verificationType,
      passed: false,
      details: {},
      errors: [],
      warnings: [],
      duration: 0,
      timestamp: new Date(),
    };

    try {
      this.logger.info(`Starting ${verificationType} verification for backup ${metadata.id}`);

      switch (verificationType) {
        case 'checksum':
          await this.verifyChecksums(metadata, result);
          break;

        case 'size-validation':
          await this.verifySizes(metadata, result);
          break;

        case 'integrity-check':
          await this.verifyIntegrity(metadata, result, handler);
          break;

        case 'restore-test':
          await this.verifyRestoreTest(metadata, result, handler);
          break;

        default:
          throw new Error(`Unsupported verification type: ${verificationType}`);
      }

      result.duration = Date.now() - startTime;

      if (result.errors.length === 0) {
        result.passed = true;
        this.logger.info(`${verificationType} verification passed for backup ${metadata.id} (${result.duration}ms)`);
      } else {
        this.logger.warn(`${verificationType} verification failed for backup ${metadata.id}: ${result.errors.join(', ')}`);
      }

      return result;

    } catch (error) {
      result.duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);
      this.logger.error(`${verificationType} verification error for backup ${metadata.id}:`, error);
      return result;
    }
  }

  /**
   * Verify multiple backup aspects
   */
  async verifyBackupComprehensive(
    metadata: BackupMetadata,
    verificationTypes: VerificationType[],
    handler?: IStorageBackupHandler
  ): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    if (this.config.enableParallelChecks) {
      // Run verifications in parallel (limited concurrency)
      const chunks = this.chunkArray(verificationTypes, this.config.maxParallelJobs);

      for (const chunk of chunks) {
        const chunkResults = await Promise.all(
          chunk.map(type => this.verifyBackup(metadata, type, handler))
        );
        results.push(...chunkResults);
      }
    } else {
      // Run verifications sequentially
      for (const type of verificationTypes) {
        const result = await this.verifyBackup(metadata, type, handler);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Create verification report
   */
  createVerificationReport(
    metadata: BackupMetadata,
    results: VerificationResult[]
  ): Record<string, any> {
    const totalDuration = results.reduce((sum, result) => sum + result.duration, 0);
    const passedCount = results.filter(result => result.passed).length;
    const overallPassed = passedCount === results.length;

    return {
      backupId: metadata.id,
      storageType: metadata.storageType,
      backupType: metadata.backupType,
      backupSize: metadata.size,
      verificationTimestamp: new Date().toISOString(),
      overallResult: {
        passed: overallPassed,
        successRate: (passedCount / results.length) * 100,
        totalDuration,
        totalChecks: results.length,
        passedChecks: passedCount,
        failedChecks: results.length - passedCount,
      },
      verifications: results.map(result => ({
        type: result.type,
        passed: result.passed,
        duration: result.duration,
        errors: result.errors,
        warnings: result.warnings,
        details: result.details,
      })),
      metadata: {
        backupCreated: metadata.startTime,
        backupCompleted: metadata.endTime,
        files: metadata.files.length,
        compression: metadata.compression,
        version: metadata.version,
      },
    };
  }

  /**
   * Save verification report
   */
  async saveVerificationReport(
    report: Record<string, any>,
    outputPath?: string
  ): Promise<string> {
    const reportPath = outputPath || path.join(
      process.cwd(),
      'backup-reports',
      `verification-${report.backupId}-${Date.now()}.json`
    );

    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    this.logger.info(`Verification report saved: ${reportPath}`);
    return reportPath;
  }

  // Private verification methods

  /**
   * Verify file checksums
   */
  private async verifyChecksums(
    metadata: BackupMetadata,
    result: VerificationResult
  ): Promise<void> {
    const fileResults: FileVerificationResult[] = [];

    if (this.config.enableParallelChecks) {
      // Verify checksums in parallel
      const fileChunks = this.chunkArray(metadata.files, this.config.maxParallelJobs);

      for (const chunk of fileChunks) {
        const chunkResults = await Promise.all(
          chunk.map(file => this.verifyFileChecksum(file, metadata.checksums[file]))
        );
        fileResults.push(...chunkResults);
      }
    } else {
      // Verify checksums sequentially
      for (const file of metadata.files) {
        const fileResult = await this.verifyFileChecksum(file, metadata.checksums[file]);
        fileResults.push(fileResult);
      }
    }

    // Analyze results
    const validFiles = fileResults.filter(r => r.checksumMatch && r.exists);
    const invalidFiles = fileResults.filter(r => !r.checksumMatch || !r.exists);

    result.details = {
      totalFiles: fileResults.length,
      validFiles: validFiles.length,
      invalidFiles: invalidFiles.length,
      filesChecked: fileResults.map(r => ({
        file: path.basename(r.file),
        valid: r.checksumMatch && r.exists,
        error: r.error,
      })),
    };

    // Add errors for invalid files
    for (const invalid of invalidFiles) {
      if (!invalid.exists) {
        result.errors.push(`File not found: ${path.basename(invalid.file)}`);
      } else if (!invalid.checksumMatch) {
        result.errors.push(`Checksum mismatch: ${path.basename(invalid.file)}`);
      }
    }

    if (this.config.verbose) {
      this.logger.debug(`Checksum verification: ${validFiles.length}/${fileResults.length} files valid`);
    }
  }

  /**
   * Verify individual file checksum
   */
  private async verifyFileChecksum(
    filePath: string,
    expectedChecksum: string
  ): Promise<FileVerificationResult> {
    const result: FileVerificationResult = {
      file: filePath,
      exists: false,
      size: 0,
      checksumMatch: false,
      expectedChecksum,
      actualChecksum: '',
      readable: false,
    };

    try {
      // Check if file exists
      const stats = await fs.stat(filePath);
      result.exists = true;
      result.size = stats.size;

      // Check if file is readable
      await fs.access(filePath, fs.constants.R_OK);
      result.readable = true;

      // Calculate actual checksum
      result.actualChecksum = await this.calculateFileChecksum(filePath);

      // Compare checksums
      result.checksumMatch = result.actualChecksum === expectedChecksum;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * Calculate file checksum
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (data) => {
        hash.update(data);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', reject);
    });
  }

  /**
   * Verify file sizes
   */
  private async verifySizes(
    metadata: BackupMetadata,
    result: VerificationResult
  ): Promise<void> {
    const fileSizes: Array<{ file: string; size: number; exists: boolean; error?: string }> = [];

    for (const file of metadata.files) {
      try {
        const stats = await fs.stat(file);
        fileSizes.push({
          file,
          size: stats.size,
          exists: true,
        });
      } catch (error) {
        fileSizes.push({
          file,
          size: 0,
          exists: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const existingFiles = fileSizes.filter(f => f.exists);
    const missingFiles = fileSizes.filter(f => !f.exists);
    const emptyFiles = existingFiles.filter(f => f.size === 0);
    const totalSize = existingFiles.reduce((sum, f) => sum + f.size, 0);

    result.details = {
      totalFiles: fileSizes.length,
      existingFiles: existingFiles.length,
      missingFiles: missingFiles.length,
      emptyFiles: emptyFiles.length,
      totalSize,
      expectedSize: metadata.size || metadata.compressedSize || 0,
      averageFileSize: existingFiles.length > 0 ? totalSize / existingFiles.length : 0,
    };

    // Add errors for problematic files
    for (const missing of missingFiles) {
      result.errors.push(`Missing file: ${path.basename(missing.file)}`);
    }

    if (emptyFiles.length > 0) {
      result.warnings.push(`${emptyFiles.length} empty files found`);
    }

    if (this.config.verbose) {
      this.logger.debug(`Size verification: ${existingFiles.length}/${fileSizes.length} files exist, total size: ${this.formatBytes(totalSize)}`);
    }
  }

  /**
   * Verify backup integrity using storage-specific methods
   */
  private async verifyIntegrity(
    metadata: BackupMetadata,
    result: VerificationResult,
    handler?: IStorageBackupHandler
  ): Promise<void> {
    if (!handler) {
      result.errors.push('No storage handler provided for integrity check');
      return;
    }

    try {
      // Use storage-specific integrity verification
      const isValid = await handler.verifyBackup(metadata, 'integrity-check');

      result.details = {
        storageType: metadata.storageType,
        integrityCheckPassed: isValid,
        method: 'storage-specific',
      };

      if (!isValid) {
        result.errors.push('Storage-specific integrity check failed');
      }

      // Run custom verification scripts if configured
      const customScripts = this.config.customScripts[metadata.storageType];
      if (customScripts && customScripts.length > 0) {
        const scriptResults = await this.runCustomVerificationScripts(
          customScripts,
          metadata
        );

        result.details.customScripts = scriptResults;

        const failedScripts = scriptResults.filter(r => !r.success);
        if (failedScripts.length > 0) {
          result.errors.push(`${failedScripts.length} custom verification scripts failed`);
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Integrity check error: ${errorMessage}`);
    }
  }

  /**
   * Verify backup by performing a test restore
   */
  private async verifyRestoreTest(
    metadata: BackupMetadata,
    result: VerificationResult,
    handler?: IStorageBackupHandler
  ): Promise<void> {
    if (!handler) {
      result.errors.push('No storage handler provided for restore test');
      return;
    }

    const testDir = path.join(process.cwd(), 'temp', 'restore-test', metadata.id);

    try {
      // Create test directory
      await fs.mkdir(testDir, { recursive: true });

      // Perform test restore
      const restoreOptions: RestoreOptions = {
        backupId: metadata.id,
        targetPath: testDir,
        overwrite: true,
        verify: false, // Avoid recursion
      };

      const restoreSuccess = await handler.restoreBackup(metadata, restoreOptions);

      result.details = {
        restoreSuccess,
        testDirectory: testDir,
        method: 'test-restore',
      };

      if (!restoreSuccess) {
        result.errors.push('Test restore failed');
      } else {
        // Verify restored files
        const restoredFiles = await this.getRestoredFiles(testDir);
        result.details.restoredFiles = restoredFiles.length;

        if (restoredFiles.length === 0) {
          result.warnings.push('No files found after restore');
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Restore test error: ${errorMessage}`);
    } finally {
      // Cleanup test directory
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        result.warnings.push(`Failed to cleanup test directory: ${cleanupMessage}`);
      }
    }
  }

  /**
   * Run custom verification scripts
   */
  private async runCustomVerificationScripts(
    scripts: string[],
    metadata: BackupMetadata
  ): Promise<Array<{ script: string; success: boolean; output: string; error?: string }>> {
    const results = [];

    for (const script of scripts) {
      try {
        const { spawn } = await import('child_process');

        const result = await new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
          const child = spawn(script, [metadata.id, metadata.destination.path], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: this.config.timeout * 1000,
          });

          let stdout = '';
          let stderr = '';

          child.stdout?.on('data', (data) => {
            stdout += data.toString();
          });

          child.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          child.on('close', (code) => {
            resolve({
              success: code === 0,
              output: stdout,
              error: code !== 0 ? stderr : undefined,
            });
          });

          child.on('error', (error) => {
            resolve({
              success: false,
              output: '',
              error: error.message,
            });
          });
        });

        results.push({
          script,
          ...result,
        });

      } catch (error) {
        results.push({
          script,
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Get list of restored files
   */
  private async getRestoredFiles(directory: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isFile()) {
          files.push(fullPath);
        } else if (entry.isDirectory()) {
          const subFiles = await this.getRestoredFiles(fullPath);
          files.push(...subFiles);
        }
      }
    } catch (error) {
      // Directory might not exist or be accessible
    }

    return files;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

/**
 * Quick verification utility function
 */
export async function quickVerifyBackup(
  metadata: BackupMetadata,
  handler?: IStorageBackupHandler
): Promise<boolean> {
  const verifier = new BackupVerificationEngine();

  try {
    // Run basic verification checks
    const results = await verifier.verifyBackupComprehensive(
      metadata,
      ['checksum', 'size-validation'],
      handler
    );

    return results.every(result => result.passed);

  } catch (error) {
    return false;
  }
}

/**
 * Comprehensive verification utility function
 */
export async function comprehensiveVerifyBackup(
  metadata: BackupMetadata,
  handler?: IStorageBackupHandler,
  config?: Partial<VerificationConfig>
): Promise<{
  passed: boolean;
  report: Record<string, any>;
  reportPath?: string;
}> {
  const verifier = new BackupVerificationEngine(config);

  try {
    // Run all verification checks
    const results = await verifier.verifyBackupComprehensive(
      metadata,
      ['checksum', 'size-validation', 'integrity-check'],
      handler
    );

    const report = verifier.createVerificationReport(metadata, results);
    const passed = results.every(result => result.passed);

    // Save report if verification failed
    let reportPath: string | undefined;
    if (!passed) {
      reportPath = await verifier.saveVerificationReport(report);
    }

    return {
      passed,
      report,
      reportPath,
    };

  } catch (error) {
    return {
      passed: false,
      report: {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
    };
  }
}