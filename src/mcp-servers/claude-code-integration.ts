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
import { promisify } from 'util';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

class ClaudeCodeIntegrationServer {
  private server: Server;
  private claudeCodeProcess: ChildProcess | null = null;
  private tempDir: string;

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
    const { command, mode = 'print', options = {} } = args;
    const { timeout = 30000, cwd } = options;

    return new Promise((resolve, reject) => {
      const claudeArgs = mode === 'print' ? ['--print', command] : [command];
      const claudeProcess = spawn('claude', claudeArgs, {
        cwd: cwd || process.cwd(),
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      claudeProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      claudeProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      claudeProcess.on('close', (code) => {
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
              }, null, 2),
            },
          ],
        });
      });

      claudeProcess.on('error', (error) => {
        reject(error);
      });

      // Set timeout
      setTimeout(() => {
        claudeProcess.kill();
        reject(new Error(`Claude Code command timed out after ${timeout}ms`));
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
    const { action, key, value } = args;

    if (action === 'get') {
      return await this.executeClaudeCode({
        command: 'config list',
        mode: 'print',
      });
    } else if (action === 'set' && key && value) {
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

    // Note: This would need to be implemented based on Claude Code's actual API
    // For now, returning a placeholder
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Token statistics feature would be implemented here',
            reset_requested: reset,
            note: 'Requires Claude Code API extension for token tracking',
          }, null, 2),
        },
      ],
    };
  }

  private async sendDataToClaudeCode(args: any) {
    const { data, format = 'json', request_type } = args;

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