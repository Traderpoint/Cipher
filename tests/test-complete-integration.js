#!/usr/bin/env node

/**
 * Complete Integration Test for Claude Code Integration
 */

import { spawn } from 'child_process';

async function runCompleteTests() {
  console.log('🎯 Complete Claude Code Integration Tests\n');

  const mcpProcess = spawn('node', ['../dist/src/mcp-servers/claude-code-integration.cjs'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const testResults = [];

  mcpProcess.stderr.on('data', (data) => {
    console.log('🔧 Server:', data.toString().trim());
  });

  function sendRequest(request) {
    return new Promise((resolve) => {
      let responseReceived = false;

      const onData = (data) => {
        const text = data.toString().trim();
        if (text && !responseReceived) {
          try {
            const response = JSON.parse(text);
            if (response.id === request.id) {
              responseReceived = true;
              mcpProcess.stdout.off('data', onData);
              resolve(response);
            }
          } catch (e) {
            // Not valid JSON or not our response
          }
        }
      };

      mcpProcess.stdout.on('data', onData);
      mcpProcess.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!responseReceived) {
          mcpProcess.stdout.off('data', onData);
          resolve({ error: 'timeout' });
        }
      }, 10000);
    });
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 1: Configuration Management
  console.log('⚙️  Test: Configuration Management');
  const configResponse = await sendRequest({
    jsonrpc: '2.0',
    id: 'config-test',
    method: 'tools/call',
    params: {
      name: 'claude_code_config',
      arguments: { action: 'get' }
    }
  });

  if (configResponse.result) {
    console.log('✅ Config test passed');
    testResults.push({ test: 'Configuration', status: 'PASS' });
  } else {
    console.log('❌ Config test failed:', configResponse);
    testResults.push({ test: 'Configuration', status: 'FAIL' });
  }

  // Test 2: Token Statistics
  console.log('\n📊 Test: Token Statistics');
  const tokenResponse = await sendRequest({
    jsonrpc: '2.0',
    id: 'token-test',
    method: 'tools/call',
    params: {
      name: 'claude_code_token_stats',
      arguments: { reset: false }
    }
  });

  if (tokenResponse.result) {
    console.log('✅ Token stats test passed');
    testResults.push({ test: 'Token Stats', status: 'PASS' });
  } else {
    console.log('❌ Token stats test failed:', tokenResponse);
    testResults.push({ test: 'Token Stats', status: 'FAIL' });
  }

  // Test 3: Data Exchange with Analysis
  console.log('\n🔄 Test: Data Exchange');
  const dataResponse = await sendRequest({
    jsonrpc: '2.0',
    id: 'data-test',
    method: 'tools/call',
    params: {
      name: 'cipher_to_claude_code',
      arguments: {
        data: {
          code: 'function hello() { console.log("Hello World"); }',
          language: 'javascript',
          purpose: 'test function'
        },
        format: 'json',
        request_type: 'analysis'
      }
    }
  });

  if (dataResponse.result && !dataResponse.result.isError) {
    console.log('✅ Data exchange test passed');
    testResults.push({ test: 'Data Exchange', status: 'PASS' });
  } else {
    console.log('❌ Data exchange test failed:', dataResponse);
    testResults.push({ test: 'Data Exchange', status: 'FAIL' });
  }

  // Test 4: Input Validation
  console.log('\n🛡️  Test: Input Validation');
  const validationResponse = await sendRequest({
    jsonrpc: '2.0',
    id: 'validation-test',
    method: 'tools/call',
    params: {
      name: 'claude_code_execute',
      arguments: {
        // Missing required 'command' parameter
        mode: 'print'
      }
    }
  });

  if (validationResponse.result && validationResponse.result.isError) {
    console.log('✅ Input validation working correctly');
    testResults.push({ test: 'Input Validation', status: 'PASS' });
  } else {
    console.log('❌ Input validation failed');
    testResults.push({ test: 'Input Validation', status: 'FAIL' });
  }

  // Test 5: Help Command
  console.log('\n❓ Test: Help Command');
  const helpResponse = await sendRequest({
    jsonrpc: '2.0',
    id: 'help-test',
    method: 'tools/call',
    params: {
      name: 'claude_code_execute',
      arguments: {
        command: '--help',
        mode: 'print'
      }
    }
  });

  if (helpResponse.result && !helpResponse.result.isError) {
    console.log('✅ Help command test passed');
    testResults.push({ test: 'Help Command', status: 'PASS' });
  } else {
    console.log('❌ Help command test failed');
    testResults.push({ test: 'Help Command', status: 'FAIL' });
  }

  // Clean up
  mcpProcess.kill('SIGTERM');

  // Results Summary
  console.log('\n' + '='.repeat(50));
  console.log('📈 INTEGRATION TEST RESULTS');
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;

  testResults.forEach(result => {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${result.test}: ${result.status}`);
    if (result.status === 'PASS') passed++;
    else failed++;
  });

  console.log('\n📊 Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / testResults.length) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Claude Code Integration is fully functional!');
  } else {
    console.log('\n⚠️  Some tests failed. Review the output above.');
  }
}

runCompleteTests().catch(console.error);