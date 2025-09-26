# Cipher Monitoring API Documentation

## Overview

The Cipher Monitoring API provides comprehensive real-time monitoring, metrics collection, alerting, and system health tracking capabilities. This API enables monitoring of system performance, LLM usage, WebSocket connections, memory operations, and more.

## Base URL

```
http://localhost:3001/api/monitoring
```

## Authentication

Currently, all monitoring endpoints are publicly accessible. In production, consider implementing appropriate authentication and authorization.

## Core Endpoints

### Health & Status

#### GET `/health`

Get comprehensive system health status with service information.

**Response:**
```json
{
  "status": "healthy|degraded|critical",
  "issues": ["issue1", "issue2"],
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "version": "0.3.0",
  "environment": "development",
  "services": {
    "api": {
      "status": "running",
      "port": 3001
    },
    "websocket": {
      "status": "running",
      "activeConnections": 5
    },
    "memory": {
      "status": "active",
      "knowledgeCount": 150
    },
    "llm": "configured|not_configured"
  }
}
```

**Status Codes:**
- `200` - Success
- `500` - Health check failed

#### GET `/ping`

Simple health check for load balancers.

**Response:**
- `200` - "OK" (system healthy)
- `503` - "Service Unavailable" (system critical)

#### GET `/health-check`

Detailed health check for load balancers with structured response.

**Response:**
```json
{
  "status": "healthy|degraded|critical",
  "uptime": 3600,
  "memory": {
    "usage": 45.2,
    "available": 4294967296
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET `/status`

Get service status summary using MonitoringIntegration.

**Response:**
```json
{
  "status": "healthy|degraded|critical",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "api": { "status": "running", "details": {} },
    "database": { "status": "connected", "details": {} },
    "llm": { "status": "available", "details": {} }
  },
  "issues": []
}
```

### Metrics Collection

#### GET `/metrics`

Get all system metrics in a comprehensive format.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "system": {
    "uptime": 3600,
    "memory": {
      "used": 4294967296,
      "free": 4294967296,
      "total": 8589934592,
      "percentage": 50,
      "external": 5242880,
      "arrayBuffers": 2097152
    },
    "cpu": {
      "percentage": 25.5,
      "loadAverage": [0.5, 0.7, 0.9]
    }
  },
  "api": {
    "totalRequests": 150,
    "requestsByEndpoint": {
      "/api/monitoring/health": 50,
      "/api/monitoring/metrics": 25
    },
    "averageResponseTime": {
      "/api/monitoring/health": 25,
      "/api/monitoring/metrics": 45
    },
    "errorsByEndpoint": {
      "/api/monitoring/health": 0,
      "/api/monitoring/metrics": 1
    },
    "popularEndpoints": [
      {
        "endpoint": "/api/monitoring/health",
        "count": 50,
        "averageTime": 25
      }
    ],
    "statusCodes": {
      "200": 148,
      "404": 1,
      "500": 1
    },
    "throughput": {
      "requestsPerSecond": 2.5,
      "averageResponseSize": 1024
    }
  },
  "llm": {
    "openai:gpt-4": {
      "totalRequests": 25,
      "successfulRequests": 24,
      "failedRequests": 1,
      "averageResponseTime": 1500,
      "totalTokensUsed": 50000,
      "averageTokensPerRequest": 2000,
      "errorRate": 0.04,
      "requestsPerMinute": 5.2
    }
  },
  "websocket": {
    "activeConnections": 5,
    "messagesReceived": 1000,
    "messagesSent": 950,
    "connectionErrors": 2,
    "averageLatency": 45,
    "peakConnections": 12,
    "bytesTransferred": 5242880
  },
  "memory": {
    "totalKnowledge": 150,
    "totalReflections": 25,
    "vectorStorageSize": 104857600,
    "averageSearchTime": 25,
    "totalSearches": 500,
    "memoryEfficiencyScore": 85,
    "topSearchPatterns": [
      {
        "pattern": "react component",
        "count": 25,
        "averageRelevance": 0.85
      }
    ],
    "vectorOperations": {
      "searches": 500,
      "insertions": 150,
      "updates": 25,
      "deletions": 5
    }
  },
  "sessions": {
    "active": 5,
    "total": 50,
    "averageDuration": 3600,
    "newSessions": 2,
    "expiredSessions": 1
  }
}
```

#### GET `/metrics/prometheus`

Export metrics in Prometheus format for integration with Prometheus monitoring.

**Response:** (Content-Type: text/plain)
```
# HELP cipher_system_uptime_seconds System uptime in seconds
# TYPE cipher_system_uptime_seconds counter
cipher_system_uptime_seconds 3600

# HELP cipher_memory_usage_bytes Memory usage in bytes
# TYPE cipher_memory_usage_bytes gauge
cipher_memory_usage_bytes{type="used"} 4294967296
cipher_memory_usage_bytes{type="free"} 4294967296
cipher_memory_usage_bytes{type="total"} 8589934592

# HELP cipher_api_requests_total Total API requests
# TYPE cipher_api_requests_total counter
cipher_api_requests_total{endpoint="/api/monitoring/health"} 50
```

### Specific Metrics Endpoints

#### GET `/metrics/system`

Get system-specific metrics (CPU, memory, uptime).

#### GET `/metrics/llm`

Get LLM performance metrics for all configured providers.

#### GET `/metrics/memory`

Get memory system metrics (vector operations, search patterns).

#### GET `/metrics/websocket`

Get WebSocket connection and messaging metrics.

#### GET `/metrics/api`

Get API endpoint performance metrics.

#### GET `/metrics/sessions`

Get user session metrics and statistics.

### Dashboard

#### GET `/dashboard`

Get comprehensive dashboard data with all metrics formatted for UI consumption.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "health": {
    "status": "healthy",
    "issues": [],
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "system": { /* system metrics */ },
  "postgresql": {
    "status": "connected",
    "totalConnections": 10,
    "activeConnections": 5,
    "idleConnections": 5,
    "maxConnections": 100,
    "totalQueries": 1000,
    "failedQueries": 5,
    "averageQueryTime": 25,
    "slowQueries": [],
    "connectionErrors": 0,
    "poolUtilization": 50,
    "replicationLag": 0,
    "databaseSize": "10MB",
    "tableStats": [
      {
        "table": "sessions",
        "rows": 7,
        "size": "1.2MB"
      }
    ]
  },
  "testing": {
    "totalTests": 45,
    "passedTests": 42,
    "failedTests": 3,
    "testSuites": [
      {
        "name": "Core Tests",
        "passed": 15,
        "failed": 0,
        "duration": 2500
      }
    ],
    "coverage": 78.5,
    "lastRun": "2024-01-01T00:00:00.000Z",
    "averageTestDuration": 185,
    "performanceTests": [
      {
        "name": "Response Time",
        "threshold": 100,
        "actual": 85,
        "status": "pass"
      }
    ]
  }
}
```

#### GET `/dashboard/historical`

Get historical metrics data for trending and analysis.

**Query Parameters:**
- `hours` (optional): Number of hours to retrieve (default: 24)
- `format` (optional): Response format - "json" or "csv" (default: "json")

**JSON Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "hours": 24,
  "dataPoints": 144,
  "data": [
    {
      "timestamp": "2024-01-01T00:00:00.000Z",
      "metrics": { /* metrics snapshot */ }
    }
  ]
}
```

**CSV Response:** (Content-Type: text/csv)
```csv
timestamp,system_uptime,memory_used,cpu_percentage,api_total_requests
2024-01-01T00:00:00.000Z,3600,4294967296,25.5,150
```

#### GET `/dashboard/stats`

Get dashboard and WebSocket notification statistics.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dashboard": {
    "totalViews": 1500,
    "uniqueViewers": 45,
    "averageSessionDuration": 1800,
    "configsLoaded": 5,
    "exportsGenerated": 12
  },
  "websocket": {
    "connectedClients": 5,
    "totalNotificationsSent": 2500,
    "averageNotificationLatency": 15,
    "failedNotifications": 3
  }
}
```

### Dashboard Configuration

#### GET `/dashboard/configs`

List all available dashboard configurations.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "configs": [
    {
      "id": "default",
      "name": "Default Dashboard",
      "description": "Standard monitoring dashboard",
      "version": "1.0.0",
      "created": "2024-01-01T00:00:00.000Z",
      "modified": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### GET `/dashboard/configs/:configId`

Get specific dashboard configuration.

#### POST `/dashboard/configs`

Import a new dashboard configuration.

**Request Body:**
```json
{
  "id": "custom-dashboard",
  "name": "Custom Dashboard",
  "description": "Custom monitoring setup",
  "version": "1.0.0",
  "panels": [
    {
      "id": "system-metrics",
      "type": "line-chart",
      "title": "System Metrics",
      "metrics": ["system.cpu.percentage", "system.memory.percentage"]
    }
  ]
}
```

#### GET `/dashboard/configs/:configId/export`

Export dashboard configuration as downloadable JSON file.

### Error Tracking

#### GET `/errors`

Get error statistics and recent errors.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "stats": {
    "totalErrors": 25,
    "errorsByType": {
      "TypeError": 10,
      "NetworkError": 8,
      "ValidationError": 7
    },
    "errorsByEndpoint": {
      "/api/llm/query": 15,
      "/api/memory/search": 10
    },
    "recentErrorRate": 0.05,
    "resolvedErrors": 20,
    "unresolvedErrors": 5
  },
  "recentErrors": [
    {
      "id": "error-123",
      "type": "TypeError",
      "message": "Cannot read property 'data' of undefined",
      "stack": "Error stack trace...",
      "endpoint": "/api/llm/query",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "resolved": false,
      "severity": "high",
      "occurrences": 3
    }
  ]
}
```

#### POST `/errors/:errorId/resolve`

Resolve a specific error by ID.

**Request Body:**
```json
{
  "resolution": "Fixed null check in LLM query handler"
}
```

**Response:**
```json
{
  "message": "Error resolved successfully",
  "errorId": "error-123",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Alerting System

#### GET `/alerts`

Get alert rules, active alerts, and alert history.

**Response:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "rules": [
    {
      "id": "high-cpu",
      "name": "High CPU Usage",
      "description": "Alert when CPU usage exceeds threshold",
      "condition": "system.cpu.percentage",
      "operator": ">",
      "threshold": 80,
      "severity": "warning",
      "enabled": true,
      "cooldownMinutes": 5,
      "created": "2024-01-01T00:00:00.000Z"
    }
  ],
  "activeAlerts": [
    {
      "id": "alert-456",
      "ruleId": "high-cpu",
      "ruleName": "High CPU Usage",
      "severity": "warning",
      "message": "CPU usage is 85.2%",
      "value": 85.2,
      "threshold": 80,
      "timestamp": "2024-01-01T00:00:00.000Z",
      "acknowledged": false
    }
  ],
  "history": [
    {
      "id": "alert-455",
      "ruleId": "high-memory",
      "severity": "critical",
      "message": "Memory usage critical",
      "triggered": "2024-01-01T00:00:00.000Z",
      "resolved": "2024-01-01T00:05:00.000Z",
      "duration": 300
    }
  ],
  "stats": {
    "totalAlerts": 50,
    "activeAlerts": 2,
    "resolvedAlerts": 48,
    "averageResolutionTime": 180,
    "alertsByRule": {
      "high-cpu": 15,
      "high-memory": 10,
      "api-errors": 25
    }
  }
}
```

#### POST `/alerts/rules`

Create or update an alert rule.

**Request Body:**
```json
{
  "id": "api-error-rate",
  "name": "High API Error Rate",
  "description": "Alert when API error rate exceeds 5%",
  "condition": "api.errorRate",
  "operator": ">",
  "threshold": 0.05,
  "severity": "critical",
  "enabled": true,
  "cooldownMinutes": 10,
  "notificationChannels": ["email", "slack"]
}
```

#### DELETE `/alerts/rules/:ruleId`

Delete an alert rule.

#### PUT `/alerts/rules/:ruleId/toggle`

Enable or disable an alert rule.

**Request Body:**
```json
{
  "enabled": false
}
```

#### POST `/alerts/:alertId/resolve`

Manually resolve an active alert.

### Utility Endpoints

#### POST `/reset`

Reset all metrics (useful for testing and development).

**Response:**
```json
{
  "message": "Metrics reset successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET `/ws`

WebSocket endpoint information for real-time monitoring.

**Response:**
```json
{
  "message": "WebSocket monitoring endpoint",
  "instructions": "Connect to WebSocket at /ws with monitoring=true query parameter",
  "example": "ws://localhost:3001/ws?monitoring=true"
}
```

## WebSocket Real-time Updates

Connect to the WebSocket endpoint for real-time monitoring updates:

```
ws://localhost:3001/ws?monitoring=true
```

### WebSocket Message Types

1. **Metrics Update**
```json
{
  "type": "metrics",
  "data": { /* current metrics */ },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

2. **Alert Triggered**
```json
{
  "type": "alert",
  "alert": {
    "id": "alert-123",
    "ruleId": "high-cpu",
    "severity": "warning",
    "message": "CPU usage exceeded threshold"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

3. **Health Status Change**
```json
{
  "type": "health",
  "status": "degraded",
  "previousStatus": "healthy",
  "issues": ["High memory usage"],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

4. **Error Occurred**
```json
{
  "type": "error",
  "error": {
    "id": "error-789",
    "type": "NetworkError",
    "message": "Connection timeout",
    "endpoint": "/api/llm/query"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Rate Limiting

The monitoring API implements rate limiting for WebSocket connections and messages:

- **Connection Rate Limit**: Max 50 connections per IP per minute
- **Message Rate Limit**: Max 1000 messages per connection per minute
- **Failure Rate Limit**: Max 20 failed requests per connection per minute

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the rate limit resets

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "message": "Detailed error message",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "endpoint": "/api/monitoring/endpoint"
}
```

## HTTP Status Codes

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (resource doesn't exist)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error
- `503` - Service Unavailable (system critical)

## Integration Examples

### Prometheus Integration

Add this job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'cipher-monitoring'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/monitoring/metrics/prometheus'
    scrape_interval: 15s
```

### Grafana Dashboard

Import metrics using the `/api/monitoring/dashboard/historical` endpoint with CSV format for time-series visualization.

### Health Check for Load Balancers

Use `/api/monitoring/ping` or `/api/monitoring/health-check` for load balancer health checks.

### Custom Alert Integration

Create custom alert rules via the API and receive notifications through WebSocket or webhook integrations.

## Environment Variables

- `NODE_ENV`: Environment (development/production)
- `PORT`: API server port (default: 3001)
- `MONITORING_ENABLED`: Enable/disable monitoring (default: true)
- `WS_ENABLED`: Enable/disable WebSocket monitoring (default: true)
- `RATE_LIMIT_ENABLED`: Enable/disable rate limiting (default: true)

## Security Considerations

1. **Authentication**: Implement proper authentication for production use
2. **Rate Limiting**: Configure appropriate rate limits for your use case
3. **CORS**: Configure CORS headers for cross-origin requests
4. **Data Sensitivity**: Be cautious about exposing sensitive metrics
5. **WebSocket Security**: Validate WebSocket connections and messages

## Performance Notes

- Metrics collection has minimal performance impact (< 1ms per request)
- WebSocket updates are throttled to prevent overwhelming clients
- Historical data is automatically purged after 7 days by default
- Dashboard caching reduces response time for repeated requests
- Rate limiting prevents abuse and protects system resources

## Support

For issues, questions, or feature requests related to the monitoring API, please refer to the project documentation or contact the development team.