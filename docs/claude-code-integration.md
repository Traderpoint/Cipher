# Claude Code Integration MCP Server

## Overview

The Claude Code Integration MCP Server provides seamless bidirectional communication between Cipher and Claude Code CLI, enabling Cipher to leverage Claude Code's capabilities and vice versa.

## Quick Start

### Prerequisites
- Claude Code CLI installed (`claude --version`)
- Node.js 20+
- Built Cipher project (`pnpm run build:no-ui`)

### Available Tools

1. **claude_code_execute** - Execute Claude Code commands
2. **claude_code_status** - Check Claude Code availability
3. **claude_code_config** - Manage Claude Code configuration
4. **claude_code_token_stats** - Get token usage statistics
5. **cipher_to_claude_code** - Send data from Cipher to Claude Code

### MCP Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "claude_code_integration": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/src/mcp-servers/claude-code-integration.cjs"],
      "env": {}
    }
  }
}
```

### Testing

```bash
# Run basic tests
cd tests
node test-mcp-simple.js

# Run comprehensive tests
node test-complete-integration.js
```

## Documentation

- **Czech Guide**: [claude-code-integration-navod.md](./claude-code-integration-navod.md) - Complete usage guide in Czech
- **Test Documentation**: [tests/README.md](../tests/README.md) - Testing instructions
- **Integration Report**: [tests/INTEGRATION-TEST-REPORT.md](../tests/INTEGRATION-TEST-REPORT.md) - Detailed test results

## Features

✅ Full Claude Code CLI integration
✅ Robust error handling and input validation
✅ Automatic temp file cleanup
✅ Process management with timeouts
✅ Windows compatibility
✅ Comprehensive test suite

## Architecture

The MCP server acts as a bridge between Cipher and Claude Code, handling:
- Command execution with proper process management
- Data exchange through temporary files
- Configuration management
- Status monitoring and health checks