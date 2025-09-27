# WebSocket Authentication Guide

This guide covers the comprehensive JWT-based authentication system for WebSocket connections in the Cipher Project.

## Overview

The Cipher Project implements a robust JWT-based authentication system for WebSocket connections that provides:

- **Secure Token Generation**: JWT tokens with configurable permissions and expiration
- **Multiple Authentication Methods**: Support for query parameters, headers, and subprotocols
- **Permission System**: Granular permission control (read, write, admin, monitor)
- **Session Binding**: Optional session and user ID binding
- **Rate Limiting**: Connection and message rate limiting
- **Token Verification**: Real-time token validation and claims extraction

## Quick Start

### 1. Generate a JWT Token

```bash
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "permissions": ["read", "write"],
    "expiresIn": "24h"
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2024-01-16T10:30:00.000Z",
    "permissions": ["read", "write"],
    "sessionId": "my-session",
    "usage": {
      "websocketUrl": "ws://localhost:3001?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "authHeader": "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "subprotocol": "cipher-jwt-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
}
```

### 2. Connect Using the Token

Choose one of three authentication methods:

#### Method 1: Query Parameter (Recommended)
```javascript
const ws = new WebSocket('ws://localhost:3001?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
```

#### Method 2: Authorization Header
```javascript
const ws = new WebSocket('ws://localhost:3001', [], {
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});
```

#### Method 3: WebSocket Subprotocol
```javascript
const ws = new WebSocket('ws://localhost:3001', 'cipher-jwt-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
```

## Authentication Endpoints

### Generate WebSocket Token

**Endpoint:** `POST /api/auth/websocket/token`

Generate a JWT token for WebSocket authentication with optional session binding and permissions.

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | No | Session ID to bind token to (1-100 chars) |
| `userId` | string | No | User ID for identification (1-100 chars) |
| `permissions` | array | No | Array of permissions: read, write, admin, monitor |
| `expiresIn` | string | No | Token expiration (1h, 30m, 7d) |

#### Examples

**Basic Token:**
```bash
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Session-Bound Token:**
```bash
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "prod-session-001",
    "permissions": ["read", "write", "monitor"],
    "expiresIn": "8h"
  }'
```

**Administrative Token:**
```bash
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "admin-user",
    "permissions": ["read", "write", "admin", "monitor"],
    "expiresIn": "1h"
  }'
```

### Verify Token

**Endpoint:** `POST /api/auth/websocket/verify`

Verify the validity of a JWT token and retrieve its claims.

```bash
curl -X POST http://localhost:3001/api/auth/websocket/verify \
  -H "Content-Type: application/json" \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "valid": true,
    "expired": false,
    "claims": {
      "sessionId": "my-session",
      "permissions": ["read", "write"],
      "iat": 1642320600,
      "exp": 1642407000
    },
    "expiresAt": "2024-01-16T10:30:00.000Z"
  }
}
```

### Get Authentication Info

**Endpoint:** `GET /api/auth/websocket/info`

Get information about available authentication methods and configuration.

```bash
curl http://localhost:3001/api/auth/websocket/info
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "authMethods": ["query", "header", "subprotocol"],
    "supportedPermissions": ["read", "write", "admin", "monitor"],
    "defaultExpiration": "1h",
    "endpoints": {
      "token": "/api/auth/websocket/token",
      "verify": "/api/auth/websocket/verify"
    },
    "examples": {
      "queryAuth": "ws://localhost:3001?token=TOKEN",
      "headerAuth": "Authorization: Bearer TOKEN",
      "subprotocolAuth": "cipher-jwt-TOKEN"
    }
  }
}
```

## Permission System

The WebSocket authentication system supports four permission levels:

### Permission Levels

| Permission | Description | Capabilities |
|------------|-------------|--------------|
| `read` | Read-only access | View messages, session data |
| `write` | Read-write access | Send messages, modify session |
| `admin` | Administrative access | Manage sessions, configurations |
| `monitor` | Monitoring access | View metrics, system status |

### Permission Examples

```javascript
// Read-only connection
const readOnlyToken = await fetch('/api/auth/websocket/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    permissions: ['read']
  })
});

// Full administrative access
const adminToken = await fetch('/api/auth/websocket/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    permissions: ['read', 'write', 'admin', 'monitor']
  })
});
```

## Connection Examples

### JavaScript/Browser

```javascript
class CipherWebSocket {
  constructor(token, sessionId) {
    this.token = token;
    this.sessionId = sessionId;
    this.ws = null;
  }

  async connect() {
    // Method 1: Query parameter (recommended for browsers)
    this.ws = new WebSocket(`ws://localhost:3001?token=${this.token}`);

    this.ws.onopen = () => {
      console.log('Connected to Cipher WebSocket');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('Received:', message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = (event) => {
      console.log('Connection closed:', event.code, event.reason);
    };
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}

// Usage
async function connectToCipher() {
  // Get token
  const response = await fetch('/api/auth/websocket/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'browser-session',
      permissions: ['read', 'write']
    })
  });

  const { data } = await response.json();

  // Connect with token
  const client = new CipherWebSocket(data.token, 'browser-session');
  await client.connect();

  return client;
}
```

### Node.js

```javascript
const WebSocket = require('ws');
const fetch = require('node-fetch');

class CipherClient {
  constructor(baseUrl = 'localhost:3001') {
    this.baseUrl = baseUrl;
    this.token = null;
    this.ws = null;
  }

  async authenticate(options = {}) {
    const response = await fetch(`http://${this.baseUrl}/api/auth/websocket/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    const result = await response.json();
    this.token = result.data.token;
    return result.data;
  }

  async connect() {
    if (!this.token) {
      throw new Error('Must authenticate before connecting');
    }

    // Method 2: Authorization header (works well in Node.js)
    this.ws = new WebSocket(`ws://${this.baseUrl}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    return new Promise((resolve, reject) => {
      this.ws.on('open', () => {
        console.log('Connected to Cipher');
        resolve();
      });

      this.ws.on('error', reject);

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      });
    });
  }

  handleMessage(message) {
    console.log('Received:', message);
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}

// Usage
async function main() {
  const client = new CipherClient();

  await client.authenticate({
    sessionId: 'node-client',
    permissions: ['read', 'write', 'monitor'],
    expiresIn: '2h'
  });

  await client.connect();

  client.send({
    type: 'chat',
    content: 'Hello from Node.js client!'
  });
}
```

### Python

```python
import asyncio
import websockets
import json
import requests

class CipherClient:
    def __init__(self, base_url="localhost:3001"):
        self.base_url = base_url
        self.token = None
        self.ws = None

    def authenticate(self, **options):
        response = requests.post(
            f"http://{self.base_url}/api/auth/websocket/token",
            json=options
        )
        result = response.json()
        self.token = result["data"]["token"]
        return result["data"]

    async def connect(self):
        if not self.token:
            raise ValueError("Must authenticate before connecting")

        # Method 3: Subprotocol
        uri = f"ws://{self.base_url}"
        subprotocol = f"cipher-jwt-{self.token}"

        self.ws = await websockets.connect(uri, subprotocols=[subprotocol])
        return self.ws

    async def send(self, message):
        if self.ws:
            await self.ws.send(json.dumps(message))

    async def listen(self):
        if self.ws:
            async for message in self.ws:
                data = json.loads(message)
                print(f"Received: {data}")

# Usage
async def main():
    client = CipherClient()

    # Authenticate
    auth_data = client.authenticate(
        sessionId="python-client",
        permissions=["read", "write"],
        expiresIn="1h"
    )
    print(f"Authenticated with token expiring at: {auth_data['expiresAt']}")

    # Connect
    await client.connect()
    print("Connected to Cipher WebSocket")

    # Send a message
    await client.send({
        "type": "chat",
        "content": "Hello from Python client!"
    })

    # Listen for messages
    await client.listen()

if __name__ == "__main__":
    asyncio.run(main())
```

## Security Features

### Rate Limiting

The system implements multiple layers of rate limiting:

- **Connection Rate Limiting**: Limits new connections per IP
- **Message Rate Limiting**: Limits messages per connection
- **Failure Rate Limiting**: Temporarily blocks IPs with failed attempts

### Token Security

- **JWT Signing**: All tokens are cryptographically signed
- **Expiration**: Configurable token expiration (default: 1 hour)
- **Permission Scope**: Tokens include only requested permissions
- **Session Binding**: Optional binding to specific sessions

### Connection Security

- **Authentication Required**: All connections must provide valid tokens
- **Real-time Validation**: Tokens are validated on each connection
- **Automatic Cleanup**: Invalid connections are automatically closed

## Error Handling

### Authentication Errors

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `INVALID_TOKEN` | 401 | Token is malformed or invalid |
| `EXPIRED_TOKEN` | 401 | Token has expired |
| `INSUFFICIENT_PERMISSIONS` | 403 | Token lacks required permissions |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many connection attempts |

### Example Error Response

```json
{
  "status": "error",
  "error": "Authentication failed",
  "code": "INVALID_TOKEN",
  "message": "The provided token is invalid or malformed"
}
```

### Handling Connection Errors

```javascript
ws.onclose = (event) => {
  switch (event.code) {
    case 1008: // Policy Violation
      console.error('Authentication failed:', event.reason);
      // Get new token and retry
      break;
    case 1013: // Try Again Later
      console.error('Server overloaded:', event.reason);
      // Implement exponential backoff
      break;
    default:
      console.log('Connection closed:', event.code, event.reason);
  }
};
```

## Best Practices

### Token Management

1. **Store Tokens Securely**: Never expose tokens in URLs or logs
2. **Refresh Before Expiry**: Implement token refresh logic
3. **Use Appropriate Permissions**: Request only needed permissions
4. **Handle Expiration**: Gracefully handle token expiration

```javascript
class TokenManager {
  constructor() {
    this.token = null;
    this.expiresAt = null;
  }

  async getValidToken() {
    if (!this.token || this.isExpiringSoon()) {
      await this.refreshToken();
    }
    return this.token;
  }

  isExpiringSoon() {
    const fiveMinutes = 5 * 60 * 1000;
    return new Date(this.expiresAt).getTime() - Date.now() < fiveMinutes;
  }

  async refreshToken() {
    // Request new token
    const response = await fetch('/api/auth/websocket/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        permissions: this.permissions
      })
    });

    const data = await response.json();
    this.token = data.data.token;
    this.expiresAt = data.data.expiresAt;
  }
}
```

### Connection Management

1. **Implement Reconnection**: Handle disconnections gracefully
2. **Use Heartbeat**: Implement ping/pong for connection health
3. **Handle Rate Limits**: Implement backoff strategies
4. **Monitor Connection State**: Track connection status

```javascript
class ReliableWebSocket {
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    try {
      const token = await this.tokenManager.getValidToken();
      this.ws = new WebSocket(`ws://localhost:3001?token=${token}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        if (event.code !== 1000) { // Not normal closure
          this.reconnect();
        }
      };

    } catch (error) {
      console.error('Connection failed:', error);
      this.reconnect();
    }
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff
      setTimeout(() => this.connect(), delay);
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}
```

## Integration Examples

### React Hook

```jsx
import { useState, useEffect, useRef } from 'react';

export function useWebSocket(sessionId, permissions = ['read', 'write']) {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const tokenRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        // Get token
        const response = await fetch('/api/auth/websocket/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, permissions })
        });

        const { data } = await response.json();
        tokenRef.current = data.token;

        // Connect WebSocket
        const ws = new WebSocket(`ws://localhost:3001?token=${data.token}`);

        ws.onopen = () => {
          if (mounted) {
            setIsConnected(true);
            wsRef.current = ws;
          }
        };

        ws.onmessage = (event) => {
          if (mounted) {
            const message = JSON.parse(event.data);
            setMessages(prev => [...prev, message]);
          }
        };

        ws.onclose = () => {
          if (mounted) {
            setIsConnected(false);
            wsRef.current = null;
          }
        };

      } catch (error) {
        console.error('WebSocket connection failed:', error);
      }
    }

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId, permissions]);

  const sendMessage = (message) => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  return { isConnected, messages, sendMessage };
}
```

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check if server is running on correct port
2. **Authentication Failed**: Verify token format and expiration
3. **Permission Denied**: Check if token has required permissions
4. **Rate Limited**: Implement backoff and retry logic

### Debug Mode

Enable debug logging to troubleshoot connection issues:

```javascript
const ws = new WebSocket('ws://localhost:3001?token=TOKEN&debug=true');
```

### Monitoring Connections

Use the monitoring endpoints to check WebSocket status:

```bash
# Check WebSocket metrics
curl http://localhost:3001/api/monitoring/metrics/websocket

# Check connection manager status
curl http://localhost:3001/ws/stats
```