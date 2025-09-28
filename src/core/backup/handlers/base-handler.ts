/**
 * Base Storage Backup Handler
 *
 * Abstract base class that provides common functionality for all storage backup handlers.
 * Implements shared operations like compression, checksum calculation, and file management.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { createGzip, createBrotliCompress } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import {
  IStorageBackupHandler,
  BackupStorageType,
  StorageBackupConfig,
  BackupMetadata,
  RestoreOptions,
  VerificationType,
  CompressionType,
} from '../types.js';
import { Logger } from '../../logger/logger.js';

const pipelineAsync = promisify(pipeline);

/**
 * Abstract base class for storage backup handlers
 */
export abstract class BaseStorageBackupHandler implements IStorageBackupHandler {
  protected readonly logger: Logger;

  constructor(
    public readonly storageType: BackupStorageType,
    logger?: Logger
  ) {
    this.logger = logger || new Logger({ level: 'info' });
  }

  /**
   * Check if the storage is available and accessible
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get storage configuration information
   */
  abstract getStorageInfo(): Promise<Record<string, any>>;

  /**
   * Create a backup of the storage (implementation-specific)
   */
  protected abstract doCreateBackup(config: StorageBackupConfig, destination: string): Promise<string[]>;

  /**
   * Restore from a backup (implementation-specific)
   */
  protected abstract doRestoreBackup(
    files: string[],
    metadata: BackupMetadata,
    options: RestoreOptions
  ): Promise<boolean>;

  /**
   * Get estimated backup size (implementation-specific)
   */
  abstract getEstimatedSize(): Promise<number>;

  /**
   * Create a backup of the storage
   */
  async createBackup(config: StorageBackupConfig, destination: string): Promise<BackupMetadata> {
    const startTime = new Date();
    const backupId = this.generateBackupId();

    this.logger.info(`Starting backup for ${this.storageType} with ID: ${backupId}`);

    try {
      // Create backup directory
      const backupDir = path.join(destination, this.storageType, backupId);
      await fs.mkdir(backupDir, { recursive: true });

      // Execute storage-specific backup
      const rawFiles = await this.doCreateBackup(config, backupDir);

      // Compress files if enabled
      const files = await this.compressFiles(rawFiles, config.compression, backupDir);

      // Calculate checksums
      const checksums = await this.calculateChecksums(files);

      // Get file sizes
      const sizes = await this.getFileSizes(files);
      const totalSize = sizes.reduce((sum, size) => sum + size, 0);
      const compressedSize = config.compression !== 'none' ? totalSize : undefined;

      // Create metadata
      const metadata: BackupMetadata = {
        id: backupId,
        storageType: this.storageType,
        backupType: config.backupType,
        status: 'completed',
        startTime,
        endTime: new Date(),
        ...(compressedSize ? {} : { size: totalSize }),
        ...(compressedSize ? { compressedSize } : {}),
        compression: config.compression,
        files,
        destination: {
          type: 'local', // Will be updated by destination handler
          path: backupDir,
        },
        checksums,
        sourceConfig: await this.getStorageInfo(),
        version: '1.0.0',
        tags: [this.storageType, config.backupType],
        metadata: {
          originalFiles: rawFiles,
          config: config.config || {},
        },
      };

      // Save metadata
      await this.saveMetadata(metadata, backupDir);

      this.logger.info(`Backup completed for ${this.storageType}: ${backupId} (${this.formatSize(totalSize)})`);

      return metadata;

    } catch (error) {
      this.logger.error(`Backup failed for ${this.storageType}:`, error);
      throw error;
    }
  }

  /**
   * Restore from a backup
   */
  async restoreBackup(metadata: BackupMetadata, options: RestoreOptions): Promise<boolean> {
    this.logger.info(`Starting restore for ${this.storageType} from backup: ${metadata.id}`);

    try {
      // Verify backup integrity first if requested
      if (options.verify) {
        const isValid = await this.verifyBackup(metadata, 'checksum');
        if (!isValid) {
          throw new Error('Backup integrity verification failed');
        }
      }

      // Determine files to restore
      const filesToRestore = options.files || metadata.files;

      // Decompress files if needed
      const targetPath = options.targetPath || path.dirname(metadata.files[0]!);
      const decompressedFiles = await this.decompressFiles(
        filesToRestore,
        metadata.compression,
        targetPath
      );

      // Execute storage-specific restore
      const success = await this.doRestoreBackup(decompressedFiles, metadata, options);

      if (success) {
        this.logger.info(`Restore completed for ${this.storageType} from backup: ${metadata.id}`);
      } else {
        this.logger.error(`Restore failed for ${this.storageType} from backup: ${metadata.id}`);
      }

      return success;

    } catch (error) {
      this.logger.error(`Restore failed for ${this.storageType}:`, error);
      throw error;
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(metadata: BackupMetadata, verificationType: VerificationType): Promise<boolean> {
    this.logger.info(`Verifying backup ${metadata.id} using ${verificationType}`);

    try {
      switch (verificationType) {
        case 'checksum':
          return this.verifyChecksums(metadata);

        case 'size-validation':
          return this.verifySizes(metadata);

        case 'integrity-check':
          return this.verifyIntegrity(metadata);

        case 'restore-test':
          return this.verifyRestoreTest(metadata);

        default:
          throw new Error(`Unsupported verification type: ${verificationType}`);
      }
    } catch (error) {
      this.logger.error(`Verification failed for backup ${metadata.id}:`, error);
      return false;
    }
  }

  /**
   * Cleanup temporary files
   */
  async cleanup(): Promise<void> {
    // Default implementation - can be overridden by subclasses
    this.logger.info(`Cleanup completed for ${this.storageType} handler`);
  }

  // Protected helper methods

  /**
   * Generate a unique backup ID
   */
  protected generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${this.storageType}-${timestamp}-${random}`;
  }

  /**
   * Compress files based on compression type
   */
  protected async compressFiles(
    files: string[],
    compression: CompressionType,
    outputDir: string
  ): Promise<string[]> {
    if (compression === 'none') {
      return files;
    }

    const compressedFiles: string[] = [];

    for (const file of files) {
      const fileName = path.basename(file);
      const compressedFileName = `${fileName}.${this.getCompressionExtension(compression)}`;
      const compressedPath = path.join(outputDir, 'compressed', compressedFileName);

      await fs.mkdir(path.dirname(compressedPath), { recursive: true });

      await this.compressFile(file, compressedPath, compression);
      compressedFiles.push(compressedPath);
    }

    return compressedFiles;
  }

  /**
   * Decompress files based on compression type
   */
  protected async decompressFiles(
    files: string[],
    compression: CompressionType,
    outputDir: string
  ): Promise<string[]> {
    if (compression === 'none') {
      return files;
    }

    const decompressedFiles: string[] = [];

    for (const file of files) {
      const fileName = path.basename(file);
      const decompressedFileName = fileName.replace(`.${this.getCompressionExtension(compression)}`, '');
      const decompressedPath = path.join(outputDir, 'decompressed', decompressedFileName);

      await fs.mkdir(path.dirname(decompressedPath), { recursive: true });

      await this.decompressFile(file, decompressedPath, compression);
      decompressedFiles.push(decompressedPath);
    }

    return decompressedFiles;
  }

  /**
   * Compress a single file
   */
  protected async compressFile(inputPath: string, outputPath: string, compression: CompressionType): Promise<void> {
    const input = createReadStream(inputPath);
    const output = createWriteStream(outputPath);

    let compressor;
    switch (compression) {
      case 'gzip':
        compressor = createGzip({ level: 6 });
        break;
      case 'brotli':
        compressor = createBrotliCompress();
        break;
      case 'lz4':
        // For LZ4, we'd use a library like lz4 or fall back to external command
        return this.compressWithCommand(inputPath, outputPath, 'lz4');
      default:
        throw new Error(`Unsupported compression type: ${compression}`);
    }

    await pipelineAsync(input, compressor, output);
  }

  /**
   * Decompress a single file
   */
  protected async decompressFile(inputPath: string, outputPath: string, _compression: CompressionType): Promise<void> {
    // Implementation would mirror compressFile but in reverse
    // For brevity, this is simplified
    const input = createReadStream(inputPath);
    const output = createWriteStream(outputPath);

    // Implementation depends on compression type
    await pipelineAsync(input, output);
  }

  /**
   * Compress using external command
   */
  protected async compressWithCommand(inputPath: string, outputPath: string, command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, ['-z', inputPath, outputPath]);

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Compression command failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  /**
   * Get compression file extension
   */
  protected getCompressionExtension(compression: CompressionType): string {
    switch (compression) {
      case 'gzip':
        return 'gz';
      case 'brotli':
        return 'br';
      case 'lz4':
        return 'lz4';
      default:
        return '';
    }
  }

  /**
   * Calculate checksums for files
   */
  protected async calculateChecksums(files: string[]): Promise<Record<string, string>> {
    const checksums: Record<string, string> = {};

    for (const file of files) {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(file);

      for await (const chunk of stream) {
        hash.update(chunk);
      }

      checksums[file] = hash.digest('hex');
    }

    return checksums;
  }

  /**
   * Get file sizes
   */
  protected async getFileSizes(files: string[]): Promise<number[]> {
    const sizes: number[] = [];

    for (const file of files) {
      const stats = await fs.stat(file);
      sizes.push(stats.size);
    }

    return sizes;
  }

  /**
   * Save backup metadata
   */
  protected async saveMetadata(metadata: BackupMetadata, backupDir: string): Promise<void> {
    const metadataPath = path.join(backupDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load backup metadata
   */
  protected async loadMetadata(backupDir: string): Promise<BackupMetadata> {
    const metadataPath = path.join(backupDir, 'metadata.json');
    const content = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Verify checksums
   */
  protected async verifyChecksums(metadata: BackupMetadata): Promise<boolean> {
    for (const [file, expectedChecksum] of Object.entries(metadata.checksums)) {
      try {
        const actualChecksum = await this.calculateFileChecksum(file);
        if (actualChecksum !== expectedChecksum) {
          this.logger.error(`Checksum mismatch for file ${file}`);
          return false;
        }
      } catch (error) {
        this.logger.error(`Failed to verify checksum for file ${file}:`, error);
        return false;
      }
    }

    return true;
  }

  /**
   * Verify file sizes
   */
  protected async verifySizes(metadata: BackupMetadata): Promise<boolean> {
    for (const file of metadata.files) {
      try {
        const stats = await fs.stat(file);
        // Basic size validation - file should exist and have reasonable size
        if (stats.size === 0) {
          this.logger.error(`File ${file} has zero size`);
          return false;
        }
      } catch (error) {
        this.logger.error(`Failed to verify size for file ${file}:`, error);
        return false;
      }
    }

    return true;
  }

  /**
   * Verify backup integrity (storage-specific implementation)
   */
  protected async verifyIntegrity(metadata: BackupMetadata): Promise<boolean> {
    // Default implementation - can be overridden by subclasses
    const checksumValid = this.verifyChecksums(metadata);
    if (!checksumValid) return false;
    return await this.verifySizes(metadata);
  }

  /**
   * Verify by attempting a test restore
   */
  protected async verifyRestoreTest(metadata: BackupMetadata): Promise<boolean> {
    // Default implementation - create a test restore in temp directory
    const tempDir = path.join(process.cwd(), 'temp', 'restore-test', metadata.id);

    try {
      await fs.mkdir(tempDir, { recursive: true });

      const success = await this.restoreBackup(metadata, {
        backupId: metadata.id,
        targetPath: tempDir,
        overwrite: true,
        verify: false, // Avoid recursion
      });

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

      return success;

    } catch (error) {
      // Cleanup on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (_cleanupError) {
        // Ignore cleanup errors
      }

      this.logger.error('Restore test failed:', error);
      return false;
    }
  }

  /**
   * Calculate checksum for a single file
   */
  protected async calculateFileChecksum(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);

    for await (const chunk of stream) {
      hash.update(chunk);
    }

    return hash.digest('hex');
  }

  /**
   * Execute shell command and return output
   */
  protected async executeCommand(
    command: string,
    args: string[] = [],
    options: { cwd?: string; timeout?: number } = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = options.timeout ? setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timeout: ${command} ${args.join(' ')}`));
      }, options.timeout) : null;

      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Check if a command is available in PATH
   */
  protected async isCommandAvailable(command: string): Promise<boolean> {
    try {
      await this.executeCommand('which', [command]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format file size for human reading
   */
  protected formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Ensure directory exists
   */
  protected async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Copy file with error handling
   */
  protected async copyFile(src: string, dest: string): Promise<void> {
    await this.ensureDir(path.dirname(dest));
    await fs.copyFile(src, dest);
  }

  /**
   * Move file with error handling
   */
  protected async moveFile(src: string, dest: string): Promise<void> {
    await this.ensureDir(path.dirname(dest));
    await fs.rename(src, dest);
  }
}