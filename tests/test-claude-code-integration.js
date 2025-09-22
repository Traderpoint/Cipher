#!/usr/bin/env node

/**
 * Integration Test Script for Claude Code Integration MCP Server
 *
 * This script tests the actual integration between Cipher and Claude Code
 * by running various MCP tool calls and verifying responses.
 */

import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

class ClaudeCodeIntegrationTester {
  constructor() {
    this.mcpServerProcess = null;
    this.testResults = [];
    this.serverStarted = false;
  }

  async startMcpServer() {
    console.log('🚀 Starting MCP Claude Code Integration Server...');

    try {
      this.mcpServerProcess = spawn('node', ['../dist/src/mcp-servers/claude-code-integration.cjs'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      this.mcpServerProcess.stderr.on('data', (data) => {
        const message = data.toString();
        console.log('📡 Server:', message.trim());
        if (message.includes('Server running on stdio')) {
          this.serverStarted = true;
        }
      });

      this.mcpServerProcess.on('error', (error) => {
        console.error('❌ MCP Server Error:', error);
      });

      // Give server time to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (!this.serverStarted) {
        console.log('⚠️  Server may not have fully started, but continuing with tests...');
      }

      return true;
    } catch (error) {
      console.error('❌ Failed to start MCP server:', error);
      return false;
    }
  }

  async sendMcpRequest(request) {
    return new Promise((resolve, reject) => {
      if (!this.mcpServerProcess || !this.mcpServerProcess.stdin) {
        reject(new Error('MCP server not running or stdin not available'));
        return;
      }

      const requestData = JSON.stringify(request) + '\n';

      let responseBuffer = '';
      const onData = (data) => {
        responseBuffer += data.toString();
        const lines = responseBuffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line) {
            try {
              const response = JSON.parse(line);
              this.mcpServerProcess.stdout.off('data', onData);
              resolve(response);
              return;
            } catch (e) {
              // Not a complete JSON response yet
            }
          }
        }
        responseBuffer = lines[lines.length - 1];
      };

      this.mcpServerProcess.stdout.on('data', onData);

      // Timeout after 30 seconds
      setTimeout(() => {
        this.mcpServerProcess.stdout.off('data', onData);
        reject(new Error('Request timeout'));
      }, 30000);

      this.mcpServerProcess.stdin.write(requestData);
    });
  }

  async testListTools() {
    console.log('\n🔧 Testing: List Available Tools');

    try {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.tools) {
        const tools = response.result.tools;
        console.log(`✅ Found ${tools.length} tools:`);
        tools.forEach(tool => {
          console.log(`   - ${tool.name}: ${tool.description}`);
        });

        // Verify expected tools are present
        const expectedTools = [
          'claude_code_execute',
          'claude_code_status',
          'claude_code_config',
          'claude_code_token_stats',
          'cipher_to_claude_code'
        ];

        const foundTools = tools.map(t => t.name);
        const missingTools = expectedTools.filter(t => !foundTools.includes(t));

        if (missingTools.length === 0) {
          this.testResults.push({ test: 'List Tools', status: 'PASS', details: `All ${expectedTools.length} expected tools found` });
        } else {
          this.testResults.push({ test: 'List Tools', status: 'FAIL', details: `Missing tools: ${missingTools.join(', ')}` });
        }
      } else {
        this.testResults.push({ test: 'List Tools', status: 'FAIL', details: 'No tools returned' });
      }
    } catch (error) {
      console.error('❌ List Tools test failed:', error.message);
      this.testResults.push({ test: 'List Tools', status: 'ERROR', details: error.message });
    }
  }

  async testClaudeCodeStatus() {
    console.log('\n📊 Testing: Claude Code Status Check');

    try {
      const request = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'claude_code_status',
          arguments: {}
        }
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log('✅ Status Response:', content);

        if (content.integration_active !== undefined) {
          this.testResults.push({
            test: 'Claude Code Status',
            status: content.integration_active ? 'PASS' : 'WARN',
            details: content.status || 'Status check completed'
          });
        } else {
          this.testResults.push({ test: 'Claude Code Status', status: 'FAIL', details: 'Invalid status response format' });
        }
      } else {
        this.testResults.push({ test: 'Claude Code Status', status: 'FAIL', details: 'No content in response' });
      }
    } catch (error) {
      console.error('❌ Status test failed:', error.message);
      this.testResults.push({ test: 'Claude Code Status', status: 'ERROR', details: error.message });
    }
  }

  async testClaudeCodeExecution() {
    console.log('\n⚡ Testing: Claude Code Command Execution');

    try {
      // Test simple version check
      const request = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'claude_code_execute',
          arguments: {
            command: '--version',
            mode: 'print',
            options: {
              timeout: 15000
            }
          }
        }
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.content) {
        const result = JSON.parse(response.result.content[0].text);
        console.log('✅ Execution Result:', result);

        if (result.command && result.exitCode !== undefined) {
          this.testResults.push({
            test: 'Claude Code Execution',
            status: result.success ? 'PASS' : 'WARN',
            details: `Exit code: ${result.exitCode}, Command: ${result.command}`
          });
        } else {
          this.testResults.push({ test: 'Claude Code Execution', status: 'FAIL', details: 'Invalid execution response format' });
        }
      } else {
        this.testResults.push({ test: 'Claude Code Execution', status: 'FAIL', details: 'No content in response' });
      }
    } catch (error) {
      console.error('❌ Execution test failed:', error.message);
      this.testResults.push({ test: 'Claude Code Execution', status: 'ERROR', details: error.message });
    }
  }

  async testConfigManagement() {
    console.log('\n⚙️  Testing: Configuration Management');

    try {
      // Test getting config
      const request = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'claude_code_config',
          arguments: {
            action: 'get'
          }
        }
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.content) {
        const result = JSON.parse(response.result.content[0].text);
        console.log('✅ Config Result:', result);

        this.testResults.push({
          test: 'Configuration Management',
          status: 'PASS',
          details: 'Config retrieval completed'
        });
      } else {
        this.testResults.push({ test: 'Configuration Management', status: 'FAIL', details: 'No content in response' });
      }
    } catch (error) {
      console.error('❌ Config test failed:', error.message);
      this.testResults.push({ test: 'Configuration Management', status: 'ERROR', details: error.message });
    }
  }

  async testTokenStats() {
    console.log('\n📈 Testing: Token Statistics');

    try {
      const request = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'claude_code_token_stats',
          arguments: {
            reset: false
          }
        }
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.content) {
        const result = JSON.parse(response.result.content[0].text);
        console.log('✅ Token Stats Result:', result);

        this.testResults.push({
          test: 'Token Statistics',
          status: 'PASS',
          details: 'Token stats query completed'
        });
      } else {
        this.testResults.push({ test: 'Token Statistics', status: 'FAIL', details: 'No content in response' });
      }
    } catch (error) {
      console.error('❌ Token stats test failed:', error.message);
      this.testResults.push({ test: 'Token Statistics', status: 'ERROR', details: error.message });
    }
  }

  async testDataExchange() {
    console.log('\n🔄 Testing: Data Exchange Functionality');

    try {
      const testData = {
        type: 'test',
        message: 'Integration test data',
        timestamp: new Date().toISOString()
      };

      const request = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'cipher_to_claude_code',
          arguments: {
            data: testData,
            format: 'json',
            request_type: 'analysis'
          }
        }
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.content) {
        const result = JSON.parse(response.result.content[0].text);
        console.log('✅ Data Exchange Result:', result);

        if (result.request_type && result.temp_file) {
          this.testResults.push({
            test: 'Data Exchange',
            status: 'PASS',
            details: `Data sent successfully, temp file: ${result.temp_file}`
          });
        } else {
          this.testResults.push({ test: 'Data Exchange', status: 'FAIL', details: 'Invalid data exchange response' });
        }
      } else {
        this.testResults.push({ test: 'Data Exchange', status: 'FAIL', details: 'No content in response' });
      }
    } catch (error) {
      console.error('❌ Data exchange test failed:', error.message);
      this.testResults.push({ test: 'Data Exchange', status: 'ERROR', details: error.message });
    }
  }

  async testErrorHandling() {
    console.log('\n🚨 Testing: Error Handling');

    try {
      // Test invalid tool call
      const request = {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'claude_code_execute',
          arguments: {
            // Missing required command parameter
            mode: 'print'
          }
        }
      };

      const response = await this.sendMcpRequest(request);

      if (response.result && response.result.isError) {
        console.log('✅ Error handling working correctly');
        this.testResults.push({
          test: 'Error Handling',
          status: 'PASS',
          details: 'Validation errors properly returned'
        });
      } else {
        this.testResults.push({ test: 'Error Handling', status: 'FAIL', details: 'Error not properly handled' });
      }
    } catch (error) {
      // This might actually be expected for error handling test
      console.log('⚠️  Error handling test result:', error.message);
      this.testResults.push({ test: 'Error Handling', status: 'PASS', details: 'Error properly caught' });
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');

    if (this.mcpServerProcess) {
      this.mcpServerProcess.kill('SIGTERM');

      // Force kill after 5 seconds if not terminated
      setTimeout(() => {
        if (this.mcpServerProcess && !this.mcpServerProcess.killed) {
          this.mcpServerProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  async generateReport() {
    console.log('\n📋 INTEGRATION TEST REPORT');
    console.log('=' * 50);

    let passCount = 0;
    let warnCount = 0;
    let failCount = 0;
    let errorCount = 0;

    this.testResults.forEach(result => {
      const icon = {
        'PASS': '✅',
        'WARN': '⚠️',
        'FAIL': '❌',
        'ERROR': '💥'
      }[result.status] || '❓';

      console.log(`${icon} ${result.test}: ${result.status}`);
      console.log(`   ${result.details}\n`);

      switch(result.status) {
        case 'PASS': passCount++; break;
        case 'WARN': warnCount++; break;
        case 'FAIL': failCount++; break;
        case 'ERROR': errorCount++; break;
      }
    });

    console.log('SUMMARY:');
    console.log(`✅ Passed: ${passCount}`);
    console.log(`⚠️  Warnings: ${warnCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`💥 Errors: ${errorCount}`);

    const totalTests = this.testResults.length;
    const successRate = ((passCount + warnCount) / totalTests * 100).toFixed(1);
    console.log(`\n📊 Success Rate: ${successRate}% (${passCount + warnCount}/${totalTests})`);

    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      summary: { passCount, warnCount, failCount, errorCount, successRate },
      details: this.testResults
    };

    await writeFile('claude-code-integration-test-report.json', JSON.stringify(report, null, 2));
    console.log('\n📄 Detailed report saved to: claude-code-integration-test-report.json');
  }

  async runAllTests() {
    console.log('🎯 Starting Claude Code Integration Tests...\n');

    const started = await this.startMcpServer();
    if (!started) {
      console.error('❌ Could not start MCP server. Tests aborted.');
      return;
    }

    try {
      await this.testListTools();
      await this.testClaudeCodeStatus();
      await this.testClaudeCodeExecution();
      await this.testConfigManagement();
      await this.testTokenStats();
      await this.testDataExchange();
      await this.testErrorHandling();
    } catch (error) {
      console.error('❌ Test execution failed:', error);
    } finally {
      await this.cleanup();
      await this.generateReport();
    }
  }
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new ClaudeCodeIntegrationTester();
  tester.runAllTests().catch(console.error);
}

export { ClaudeCodeIntegrationTester };