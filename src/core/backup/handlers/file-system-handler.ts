/**
 * File System Backup Handler
 *
 * Implements backup and restore operations for file system data.
 * Supports incremental backups, filtering, and various archive formats.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import { promisify } from 'util';
import { exec } from 'child_process';
import {
  StorageBackupConfig,
  BackupMetadata,
  RestoreOptions,
} from '../types.js';
import { BaseStorageBackupHandler } from './base-handler.js';
import { Logger } from '../../logger/logger.js';

const execAsync = promisify(exec);

/**
 * File info interface
 */
interface FileInfo {
  path: string;
  size: number;
  mtime: Date;
  isDirectory: boolean;
  mode: number;
}

/**
 * File System Backup Handler Implementation
 */
export class FileSystemBackupHandler extends BaseStorageBackupHandler {
  constructor(logger?: Logger) {
    super('file-system', logger);
  }

  /**
   * Check if file system storage is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if we can access the current working directory
      await fs.access(process.cwd(), fs.constants.R_OK);
      return true;
    } catch (error) {
      this.logger.warn('File system not available:', error);
      return false;
    }
  }

  /**
   * Get file system storage information
   */
  async getStorageInfo(): Promise<Record<string, any>> {
    try {
      const cwd = process.cwd();
      const stats = await fs.stat(cwd);

      // Get disk usage if available
      let diskUsage: any = {};
      try {
        if (process.platform !== 'win32') {
          const { stdout } = await execAsync(`df -h "${cwd}"`);
          const lines = stdout.trim().split('\n');
          if (lines.length > 1) {
            const parts = lines[1].split(/\s+/);
            diskUsage = {
              filesystem: parts[0],
              size: parts[1],
              used: parts[2],
              available: parts[3],
              usePercentage: parts[4],
              mountPoint: parts[5],
            };
          }
        } else {
          // Windows disk usage
          const drive = cwd.substring(0, 2);
          const { stdout } = await execAsync(`wmic logicaldisk where caption="${drive}" get Size,FreeSpace /format:csv`);
          const lines = stdout.trim().split('\n');
          if (lines.length > 2) {
            const parts = lines[2].split(',');
            if (parts.length >= 3) {
              const freeSpace = parseInt(parts[1], 10);
              const totalSize = parseInt(parts[2], 10);
              diskUsage = {
                drive,
                totalSize: Math.round(totalSize / (1024 * 1024 * 1024)) + ' GB',
                freeSpace: Math.round(freeSpace / (1024 * 1024 * 1024)) + ' GB',
                usedSpace: Math.round((totalSize - freeSpace) / (1024 * 1024 * 1024)) + ' GB',
              };
            }
          }
        }
      } catch (error) {
        this.logger.debug('Could not get disk usage:', error);
      }

      return {
        currentDirectory: cwd,
        platform: process.platform,
        lastModified: stats.mtime,
        diskUsage,
        pathSeparator: path.sep,
        permissions: {
          readable: true,
          writable: await this.isWritable(cwd),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get file system storage info:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get estimated backup size
   */
  async getEstimatedSize(): Promise<number> {
    try {
      // Default paths to estimate if none specified
      const defaultPaths = [
        './config',
        './data',
        './.env',
        './package.json',
      ];

      let totalSize = 0;

      for (const targetPath of defaultPaths) {
        try {
          const size = await this.getDirectorySize(targetPath);
          totalSize += size;
        } catch (error) {
          // Path might not exist, continue
        }
      }

      return totalSize;
    } catch (error) {
      this.logger.error('Failed to estimate file system backup size:', error);
      return 0;
    }
  }

  /**
   * Create file system backup
   */
  protected async doCreateBackup(config: StorageBackupConfig, destination: string): Promise<string[]> {
    const backupFiles: string[] = [];
    const backupConfig = config.config || {};

    try {
      // Get paths to backup
      const paths = backupConfig.paths || [
        './config',
        './data',
        './.env',
        './package.json',
      ];

      const excludePatterns = backupConfig.excludePatterns || [
        'node_modules/**',
        '.git/**',
        'dist/**',
        'build/**',
        '*.tmp',
        '*.log',
      ];

      // Determine backup method
      const method = backupConfig.method || 'archive';

      if (method === 'archive') {
        const archiveFile = await this.createArchiveBackup(
          paths,
          excludePatterns,
          destination,
          backupConfig
        );
        backupFiles.push(archiveFile);
      } else if (method === 'copy') {
        const copiedFiles = await this.createCopyBackup(
          paths,
          excludePatterns,
          destination,
          backupConfig
        );
        backupFiles.push(...copiedFiles);
      } else if (method === 'incremental') {
        const incrementalFiles = await this.createIncrementalBackup(
          paths,
          excludePatterns,
          destination,
          backupConfig
        );
        backupFiles.push(...incrementalFiles);
      }

      // Create file manifest
      const manifestFile = await this.createFileManifest(backupFiles, destination);
      backupFiles.push(manifestFile);

      this.logger.info(`File system backup created with ${backupFiles.length} files using method: ${method}`);
      return backupFiles;

    } catch (error) {
      this.logger.error('File system backup failed:', error);
      throw error;
    }
  }

  /**
   * Restore file system backup
   */
  protected async doRestoreBackup(
    files: string[],
    metadata: BackupMetadata,
    options: RestoreOptions
  ): Promise<boolean> {
    try {
      const targetPath = options.targetPath || process.cwd();

      // Find archive file or manifest
      const archiveFile = files.find(f =>
        f.endsWith('.tar') || f.endsWith('.tar.gz') || f.endsWith('.zip')
      );

      const manifestFile = files.find(f => f.includes('manifest'));

      if (archiveFile) {
        await this.restoreFromArchive(archiveFile, targetPath, options);
      } else if (manifestFile) {
        await this.restoreFromManifest(manifestFile, files, targetPath, options);
      } else {
        // Direct file restore
        await this.restoreFiles(files, targetPath, options);
      }

      this.logger.info(`File system restored to: ${targetPath}`);
      return true;

    } catch (error) {
      this.logger.error('File system restore failed:', error);
      return false;
    }
  }

  // Private helper methods

  /**
   * Check if directory is writable
   */
  private async isWritable(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get directory size recursively
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      const stat = await fs.stat(dirPath);

      if (stat.isFile()) {
        return stat.size;
      }

      if (stat.isDirectory()) {
        const entries = await fs.readdir(dirPath);
        let totalSize = 0;

        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry);
          totalSize += await this.getDirectorySize(entryPath);
        }

        return totalSize;
      }

      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Create archive backup using tar or zip
   */
  private async createArchiveBackup(
    paths: string[],
    excludePatterns: string[],
    destination: string,
    config: any
  ): Promise<string> {
    const archiveFormat = config.archiveFormat || 'tar.gz';
    const archivePath = path.join(destination, `backup.${archiveFormat}`);

    // Check available tools
    const hasTar = await this.isCommandAvailable('tar');
    const hasZip = await this.isCommandAvailable('zip');

    if (archiveFormat.includes('tar') && hasTar) {
      await this.createTarArchive(paths, excludePatterns, archivePath, config);
    } else if (archiveFormat === 'zip' && hasZip) {
      await this.createZipArchive(paths, excludePatterns, archivePath, config);
    } else {
      // Fallback to manual archive creation
      await this.createManualArchive(paths, excludePatterns, destination, config);
      return path.join(destination, 'manual_archive');
    }

    return archivePath;
  }

  /**
   * Create tar archive
   */
  private async createTarArchive(
    paths: string[],
    excludePatterns: string[],
    archivePath: string,
    config: any
  ): Promise<void> {
    const args = ['czf', archivePath];

    // Add exclude patterns
    for (const pattern of excludePatterns) {
      args.push('--exclude', pattern);
    }

    // Add follow symlinks option
    if (config.followSymlinks) {
      args.push('-h');
    }

    // Add paths
    args.push(...paths);

    await this.executeCommand('tar', args, { timeout: 1800000 });
  }

  /**
   * Create zip archive
   */
  private async createZipArchive(
    paths: string[],
    excludePatterns: string[],
    archivePath: string,
    config: any
  ): Promise<void> {
    const args = ['-r', archivePath];

    // Add paths
    args.push(...paths);

    // Add exclude patterns (zip uses -x)
    if (excludePatterns.length > 0) {
      args.push('-x');
      args.push(...excludePatterns);
    }

    await this.executeCommand('zip', args, { timeout: 1800000 });
  }

  /**
   * Create manual archive (fallback)
   */
  private async createManualArchive(
    paths: string[],
    excludePatterns: string[],
    destination: string,
    config: any
  ): Promise<void> {
    const archiveDir = path.join(destination, 'manual_archive');
    await fs.mkdir(archiveDir, { recursive: true });

    for (const srcPath of paths) {
      const files = await this.getFilesRecursive(srcPath, excludePatterns);

      for (const file of files) {
        const relativePath = path.relative(process.cwd(), file.path);
        const targetPath = path.join(archiveDir, relativePath);

        await this.ensureDir(path.dirname(targetPath));

        if (file.isDirectory) {
          await fs.mkdir(targetPath, { recursive: true });
        } else {
          await fs.copyFile(file.path, targetPath);
        }
      }
    }
  }

  /**
   * Create copy backup
   */
  private async createCopyBackup(
    paths: string[],
    excludePatterns: string[],
    destination: string,
    config: any
  ): Promise<string[]> {
    const backupFiles: string[] = [];
    const copyDir = path.join(destination, 'files');
    await fs.mkdir(copyDir, { recursive: true });

    for (const srcPath of paths) {
      const files = await this.getFilesRecursive(srcPath, excludePatterns);

      for (const file of files) {
        const relativePath = path.relative(process.cwd(), file.path);
        const targetPath = path.join(copyDir, relativePath);

        await this.ensureDir(path.dirname(targetPath));

        if (!file.isDirectory) {
          await fs.copyFile(file.path, targetPath);
          backupFiles.push(targetPath);
        }
      }
    }

    return backupFiles;
  }

  /**
   * Create incremental backup
   */
  private async createIncrementalBackup(
    paths: string[],
    excludePatterns: string[],
    destination: string,
    config: any
  ): Promise<string[]> {
    const backupFiles: string[] = [];
    const incrementalDir = path.join(destination, 'incremental');
    await fs.mkdir(incrementalDir, { recursive: true });

    // Load previous backup manifest if exists
    const lastBackupManifest = config.lastBackupManifest;
    const previousFiles = lastBackupManifest ? await this.loadManifest(lastBackupManifest) : new Map();

    const currentFiles = new Map<string, FileInfo>();

    for (const srcPath of paths) {
      const files = await this.getFilesRecursive(srcPath, excludePatterns);

      for (const file of files) {
        if (!file.isDirectory) {
          const relativePath = path.relative(process.cwd(), file.path);
          currentFiles.set(relativePath, file);

          // Check if file is new or modified
          const previousFile = previousFiles.get(relativePath);
          const isNew = !previousFile;
          const isModified = previousFile && previousFile.mtime.getTime() !== file.mtime.getTime();

          if (isNew || isModified) {
            const targetPath = path.join(incrementalDir, relativePath);
            await this.ensureDir(path.dirname(targetPath));
            await fs.copyFile(file.path, targetPath);
            backupFiles.push(targetPath);
          }
        }
      }
    }

    // Save current manifest
    const currentManifestPath = path.join(destination, 'current_manifest.json');
    await this.saveManifest(currentFiles, currentManifestPath);
    backupFiles.push(currentManifestPath);

    this.logger.info(`Incremental backup created with ${backupFiles.length} changed files`);
    return backupFiles;
  }

  /**
   * Get files recursively with exclusion patterns
   */
  private async getFilesRecursive(
    basePath: string,
    excludePatterns: string[]
  ): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    try {
      const stat = await fs.stat(basePath);

      if (stat.isFile()) {
        // Check if file matches exclude patterns
        if (!this.matchesExcludePattern(basePath, excludePatterns)) {
          files.push({
            path: basePath,
            size: stat.size,
            mtime: stat.mtime,
            isDirectory: false,
            mode: stat.mode,
          });
        }
        return files;
      }

      if (stat.isDirectory()) {
        // Check if directory matches exclude patterns
        if (this.matchesExcludePattern(basePath, excludePatterns)) {
          return files;
        }

        files.push({
          path: basePath,
          size: 0,
          mtime: stat.mtime,
          isDirectory: true,
          mode: stat.mode,
        });

        const entries = await fs.readdir(basePath);

        for (const entry of entries) {
          const entryPath = path.join(basePath, entry);
          const subFiles = await this.getFilesRecursive(entryPath, excludePatterns);
          files.push(...subFiles);
        }
      }
    } catch (error) {
      this.logger.debug(`Skipping path ${basePath}:`, error);
    }

    return files;
  }

  /**
   * Check if path matches exclude patterns
   */
  private matchesExcludePattern(filePath: string, excludePatterns: string[]): boolean {
    const relativePath = path.relative(process.cwd(), filePath);

    for (const pattern of excludePatterns) {
      if (this.matchGlob(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simple glob matching
   */
  private matchGlob(text: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*') // ** matches any path
      .replace(/\*/g, '[^/\\\\]*') // * matches any filename characters
      .replace(/\?/g, '[^/\\\\]'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text) || regex.test(text.replace(/\\/g, '/'));
  }

  /**
   * Create file manifest
   */
  private async createFileManifest(files: string[], destination: string): Promise<string> {
    const manifest = {
      timestamp: new Date().toISOString(),
      files: [] as Array<{
        path: string;
        size: number;
        mtime: Date;
        checksum: string;
      }>,
    };

    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        const relativePath = path.relative(destination, file);

        manifest.files.push({
          path: relativePath,
          size: stat.size,
          mtime: stat.mtime,
          checksum: await this.calculateFileChecksum(file),
        });
      } catch (error) {
        this.logger.warn(`Failed to get manifest info for ${file}:`, error);
      }
    }

    const manifestPath = path.join(destination, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return manifestPath;
  }

  /**
   * Load manifest from file
   */
  private async loadManifest(manifestPath: string): Promise<Map<string, FileInfo>> {
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      const fileMap = new Map<string, FileInfo>();

      for (const file of manifest.files || []) {
        fileMap.set(file.path, {
          path: file.path,
          size: file.size,
          mtime: new Date(file.mtime),
          isDirectory: false,
          mode: file.mode || 0,
        });
      }

      return fileMap;
    } catch {
      return new Map();
    }
  }

  /**
   * Save manifest to file
   */
  private async saveManifest(files: Map<string, FileInfo>, manifestPath: string): Promise<void> {
    const manifest = {
      timestamp: new Date().toISOString(),
      files: Array.from(files.entries()).map(([path, info]) => ({
        path,
        size: info.size,
        mtime: info.mtime,
        mode: info.mode,
      })),
    };

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Restore from archive
   */
  private async restoreFromArchive(
    archiveFile: string,
    targetPath: string,
    options: RestoreOptions
  ): Promise<void> {
    const hasTar = await this.isCommandAvailable('tar');
    const hasUnzip = await this.isCommandAvailable('unzip');

    if (archiveFile.includes('.tar') && hasTar) {
      const args = ['xzf', archiveFile, '-C', targetPath];
      if (options.overwrite) {
        args.push('--overwrite');
      }
      await this.executeCommand('tar', args, { timeout: 1800000 });
    } else if (archiveFile.endsWith('.zip') && hasUnzip) {
      const args = [archiveFile, '-d', targetPath];
      if (options.overwrite) {
        args.push('-o');
      }
      await this.executeCommand('unzip', args, { timeout: 1800000 });
    } else {
      throw new Error('No suitable extraction tool available');
    }
  }

  /**
   * Restore from manifest
   */
  private async restoreFromManifest(
    manifestFile: string,
    allFiles: string[],
    targetPath: string,
    options: RestoreOptions
  ): Promise<void> {
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf-8'));

    for (const fileInfo of manifest.files) {
      const sourceFile = allFiles.find(f => f.includes(fileInfo.path));
      if (sourceFile) {
        const targetFile = path.join(targetPath, fileInfo.path);

        // Check if we should overwrite
        if (!options.overwrite) {
          try {
            await fs.access(targetFile);
            continue; // Skip existing file
          } catch {
            // File doesn't exist, continue with restore
          }
        }

        await this.ensureDir(path.dirname(targetFile));
        await fs.copyFile(sourceFile, targetFile);
      }
    }
  }

  /**
   * Restore files directly
   */
  private async restoreFiles(
    files: string[],
    targetPath: string,
    options: RestoreOptions
  ): Promise<void> {
    for (const file of files) {
      if (file.includes('manifest')) {
        continue; // Skip manifest files
      }

      const fileName = path.basename(file);
      const targetFile = path.join(targetPath, fileName);

      // Check if we should overwrite
      if (!options.overwrite) {
        try {
          await fs.access(targetFile);
          continue; // Skip existing file
        } catch {
          // File doesn't exist, continue with restore
        }
      }

      await fs.copyFile(file, targetFile);
    }
  }
}