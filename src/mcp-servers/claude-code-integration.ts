#!/usr/bin/env node

/**
 * Claude Code Integration MCP Server
 *
 * This MCP server provides integration between Cipher and Claude Code,
 * allowing Cipher to access Claude Code's capabilities and vice versa.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, unlink, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

class ClaudeCodeIntegrationServer {
  private server: Server;
  private claudeCodeProcess: ChildProcess | null = null;
  private tempDir: string;
  private tempFiles: Set<string> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private processCounter: number = 0;

  constructor() {
    this.server = new Server(
      {
        name: 'claude-code-integration',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Setup temp directory for communication
    this.tempDir = path.join(os.tmpdir(), 'cipher-claude-code-integration');
    if (!existsSync(this.tempDir)) {
      mkdir(this.tempDir, { recursive: true });
    }

    this.setupToolHandlers();
    this.setupErrorHandling();
    this.startCleanupTimer();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Claude Code Integration] Server error:', error);
    };

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup(): Promise<void> {
    if (this.claudeCodeProcess) {
      this.claudeCodeProcess.kill();
      this.claudeCodeProcess = null;
    }

    // Kill all running processes
    for (const [processId, process] of Array.from(this.runningProcesses)) {
      try {
        process.kill('SIGTERM');
        setTimeout(() => {
          if (!process.killed) {
            process.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        console.error(`[MCP Claude Code Integration] Error killing process ${processId}:`, error);
      }
    }
    this.runningProcesses.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    await this.cleanupTempFiles();
  }

  private startCleanupTimer(): void {
    // Clean up temp files every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTempFiles().catch(error => {
        console.error('[MCP Claude Code Integration] Error during periodic cleanup:', error);
      });
    }, 5 * 60 * 1000);
  }

  private async cleanupTempFiles(): Promise<void> {
    try {
      for (const filePath of Array.from(this.tempFiles)) {
        try {
          await unlink(filePath);
        } catch {
          // Ignore errors for files that may have already been deleted
        }
      }
      this.tempFiles.clear();
    } catch (error) {
      console.error('[MCP Claude Code Integration] Error cleaning up temp files:', error);
    }
  }

  private async cleanupOldTempFiles(): Promise<void> {
    try {
      if (!existsSync(this.tempDir)) return;

      const files = await readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const match = file.match(/cipher-data-(\d+)\./);
        if (match) {
          const timestamp = parseInt(match[1]);
          if (now - timestamp > maxAge) {
            try {
              await unlink(filePath);
              this.tempFiles.delete(filePath);
            } catch {
              // Ignore errors for files that may have already been deleted
            }
          }
        }
      }
    } catch (error) {
      console.error('[MCP Claude Code Integration] Error during periodic cleanup:', error);
    }
  }

  private validateArgs(args: any, requiredFields: string[], toolName: string): void {
    if (!args || typeof args !== 'object') {
      throw new Error(`${toolName}: Arguments must be an object`);
    }

    for (const field of requiredFields) {
      if (!(field in args) || args[field] === undefined || args[field] === null) {
        throw new Error(`${toolName}: Missing required field '${field}'`);
      }
    }
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'claude_code_execute',
            description: 'Execute a command using Claude Code CLI',
            inputSchema: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'Command to execute through Claude Code (e.g., "help me debug this code")',
                },
                mode: {
                  type: 'string',
                  enum: ['interactive', 'print'],
                  default: 'print',
                  description: 'Execution mode: interactive or print (for one-shot commands)',
                },
                options: {
                  type: 'object',
                  properties: {
                    timeout: {
                      type: 'number',
                      default: 30000,
                      description: 'Timeout in milliseconds',
                    },
                    cwd: {
                      type: 'string',
                      description: 'Working directory for the command',
                    },
                  },
                },
              },
              required: ['command'],
            },
          },
          {
            name: 'claude_code_status',
            description: 'Get Claude Code status and capabilities',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'claude_code_config',
            description: 'Get or set Claude Code configuration',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['get', 'set'],
                  description: 'Whether to get or set configuration',
                },
                key: {
                  type: 'string',
                  description: 'Configuration key (for get/set operations)',
                },
                value: {
                  type: 'string',
                  description: 'Configuration value (for set operations)',
                },
              },
              required: ['action'],
            },
          },
          {
            name: 'claude_code_token_stats',
            description: 'Get token usage statistics from Claude Code session',
            inputSchema: {
              type: 'object',
              properties: {
                reset: {
                  type: 'boolean',
                  default: false,
                  description: 'Whether to reset token statistics',
                },
              },
            },
          },
          {
            name: 'cipher_to_claude_code',
            description: 'Send data from Cipher to Claude Code for processing',
            inputSchema: {
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  description: 'Data to send to Claude Code',
                },
                format: {
                  type: 'string',
                  enum: ['json', 'text', 'code'],
                  default: 'json',
                  description: 'Format of the data being sent',
                },
                request_type: {
                  type: 'string',
                  enum: ['analysis', 'debugging', 'generation', 'review'],
                  description: 'Type of processing requested',
                },
              },
              required: ['data', 'request_type'],
            },
          },
        ] as Tool[],
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'claude_code_execute':
            return await this.executeClaudeCode(args);

          case 'claude_code_status':
            return await this.getClaudeCodeStatus();

          case 'claude_code_config':
            return await this.handleClaudeCodeConfig(args);

          case 'claude_code_token_stats':
            return await this.getTokenStats(args);

          case 'cipher_to_claude_code':
            return await this.sendDataToClaudeCode(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async executeClaudeCode(args: any): Promise<any> {
    this.validateArgs(args, ['command'], 'claude_code_execute');

    const { command, mode = 'print', options = {} } = args;

    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('claude_code_execute: Command must be a non-empty string');
    }

    if (mode && !['interactive', 'print'].includes(mode)) {
      throw new Error('claude_code_execute: Mode must be either "interactive" or "print"');
    }

    const { timeout = 30000, cwd } = options;

    return new Promise((resolve, reject) => {
      const processId = `claude_${++this.processCounter}_${Date.now()}`;
      const claudeArgs = mode === 'print' ? ['--print', command] : [command];

      // Try different ways to find Claude Code CLI
      const claudeCommand = process.platform === 'win32' ? 'claude.cmd' : 'claude';

      const claudeProcess = spawn(claudeCommand, claudeArgs, {
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32', // Use shell on Windows to resolve PATH
      });

      this.runningProcesses.set(processId, claudeProcess);

      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        this.runningProcesses.delete(processId);
      };

      claudeProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      claudeProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      claudeProcess.on('close', (code) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: code === 0,
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  exitCode: code,
                  command: `claude ${claudeArgs.join(' ')}`,
                  processId,
                }, null, 2),
              },
            ],
          });
        }
      });

      claudeProcess.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error(`Claude Code process error: ${error.message}`));
        }
      });

      // Set timeout with proper cleanup
      timeoutHandle = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          claudeProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!claudeProcess.killed) {
              claudeProcess.kill('SIGKILL');
            }
          }, 5000);
          cleanup();
          reject(new Error(`Claude Code command timed out after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  private async getClaudeCodeStatus() {
    try {
      const result = await this.executeClaudeCode({
        command: '--version',
        mode: 'print',
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'Claude Code is available',
              version_check: result,
              integration_active: true,
              temp_dir: this.tempDir,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'Claude Code not available',
              error: error instanceof Error ? error.message : String(error),
              integration_active: false,
            }, null, 2),
          },
        ],
      };
    }
  }

  private async handleClaudeCodeConfig(args: any) {
    this.validateArgs(args, ['action'], 'claude_code_config');

    const { action, key, value } = args;

    if (!['get', 'set'].includes(action)) {
      throw new Error('claude_code_config: Action must be either "get" or "set"');
    }

    if (action === 'get') {
      return await this.executeClaudeCode({
        command: 'config list',
        mode: 'print',
      });
    } else if (action === 'set') {
      if (!key || typeof key !== 'string') {
        throw new Error('claude_code_config: Key is required for set action and must be a string');
      }
      if (value === undefined || value === null) {
        throw new Error('claude_code_config: Value is required for set action');
      }

      return await this.executeClaudeCode({
        command: `config set ${key} ${value}`,
        mode: 'print',
      });
    } else {
      throw new Error('Invalid config action or missing parameters');
    }
  }

  private async getTokenStats(args: any) {
    const { reset = false } = args;

    try {
      // Try to get token stats from Claude Code
      const statsResult = await this.executeClaudeCode({
        command: 'stats',
        mode: 'print',
      });

      if (reset) {
        // Reset stats if requested
        const resetResult = await this.executeClaudeCode({
          command: 'stats --reset',
          mode: 'print',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                action: 'reset',
                previous_stats: statsResult,
                reset_result: resetResult,
                timestamp: new Date().toISOString(),
              }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              action: 'get',
              stats: statsResult,
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Token statistics not available',
              message: error instanceof Error ? error.message : String(error),
              note: 'Claude Code may not support stats command or is not accessible',
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }

  private async sendDataToClaudeCode(args: any) {
    this.validateArgs(args, ['data', 'request_type'], 'cipher_to_claude_code');

    const { data, format = 'json', request_type } = args;

    if (!['json', 'text', 'code'].includes(format)) {
      throw new Error('cipher_to_claude_code: Format must be one of: json, text, code');
    }

    if (!['analysis', 'debugging', 'generation', 'review'].includes(request_type)) {
      throw new Error('cipher_to_claude_code: Request type must be one of: analysis, debugging, generation, review');
    }

    // Create a temporary file with the data
    const fileName = `cipher-data-${Date.now()}.${format}`;
    const filePath = path.join(this.tempDir, fileName);

    try {
      let fileContent: string;

      if (format === 'json') {
        fileContent = JSON.stringify(data, null, 2);
      } else {
        fileContent = String(data);
      }

      await writeFile(filePath, fileContent, 'utf8');
      this.tempFiles.add(filePath);

      // Construct prompt based on request type
      let prompt = '';
      switch (request_type) {
        case 'analysis':
          prompt = `Please analyze the data in this file: ${filePath}`;
          break;
        case 'debugging':
          prompt = `Please help debug the code in this file: ${filePath}`;
          break;
        case 'generation':
          prompt = `Please generate code based on the requirements in this file: ${filePath}`;
          break;
        case 'review':
          prompt = `Please review the code in this file: ${filePath}`;
          break;
        default:
          prompt = `Please process the data in this file: ${filePath}`;
      }

      // Execute Claude Code with the prompt
      const result = await this.executeClaudeCode({
        command: prompt,
        mode: 'print',
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              request_type,
              data_format: format,
              temp_file: filePath,
              claude_code_result: result,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error processing data: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Claude Code Integration] Server running on stdio');
  }
}

// Start the server
if (require.main === module) {
  const server = new ClaudeCodeIntegrationServer();
  server.run().catch((error) => {
    console.error('[MCP Claude Code Integration] Failed to start server:', error);
    process.exit(1);
  });
}

export { ClaudeCodeIntegrationServer };