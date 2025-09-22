#!/usr/bin/env node

/**
 * Simple MCP Integration Test
 * Tests the Claude Code Integration MCP Server directly
 */

import { spawn } from 'child_process';

async function testMcpServer() {
  console.log('🚀 Starting MCP Claude Code Integration Test...');

  const mcpProcess = spawn('node', ['../dist/src/mcp-servers/claude-code-integration.cjs'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let responses = [];

  mcpProcess.stderr.on('data', (data) => {
    console.log('Server:', data.toString().trim());
  });

  mcpProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      try {
        const response = JSON.parse(text);
        responses.push(response);
        console.log('Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        console.log('Raw output:', text);
      }
    }
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\n📋 Test 1: List Tools');
  const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  };
  mcpProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n📊 Test 2: Claude Code Status');
  const statusRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'claude_code_status',
      arguments: {}
    }
  };
  mcpProcess.stdin.write(JSON.stringify(statusRequest) + '\n');

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('\n⚡ Test 3: Claude Code Execution (version check)');
  const executeRequest = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'claude_code_execute',
      arguments: {
        command: '--version',
        mode: 'print'
      }
    }
  };
  mcpProcess.stdin.write(JSON.stringify(executeRequest) + '\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n🔄 Test 4: Data Exchange');
  const dataRequest = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'cipher_to_claude_code',
      arguments: {
        data: { test: 'integration', timestamp: new Date().toISOString() },
        format: 'json',
        request_type: 'analysis'
      }
    }
  };
  mcpProcess.stdin.write(JSON.stringify(dataRequest) + '\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('\n🧹 Cleaning up...');
  mcpProcess.kill('SIGTERM');

  console.log(`\n📈 Test completed. Received ${responses.length} responses.`);
}

testMcpServer().catch(console.error);