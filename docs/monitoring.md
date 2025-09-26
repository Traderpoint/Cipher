# Monitoring & Observability

Cipher obsahuje komplexní monitorovací systém pro sledování výkonu, chyb a zdraví systému v reálném čase.

## Funkce

### 🔍 **Metriky systému**
- System uptime a resource usage (CPU, paměť, disk)
- **Správné měření systémové paměti**: Používá os.totalmem() místo process.memoryUsage()
- WebSocket connection tracking
- API endpoint performance
- Session management statistiky
- **Connection Pool Monitoring**: PostgreSQL a vector storage connection pools
- **Performance Thresholds**: Real-time performance alerts and warnings

### 🤖 **LLM Performance Monitoring**
- Response time tracking pro všechny LLM providery
- Token usage analytics
- Error rate monitoring
- Provider comparison analytics

### 🧠 **Memory Analytics**
- Vector storage performance
- Search pattern analytics
- Memory efficiency scoring
- Knowledge base growth tracking

### 🚨 **Error Tracking**
- Automatic error categorization (API, LLM, WebSocket, Memory, System)
- Severity level classification
- Error rate monitoring
- Resolution tracking

## API Endpoints

### Health Check
```bash
GET /api/monitoring/health
```

**Odpověď:**
```json
{
  "status": "healthy|warning|critical",
  "issues": ["seznam problémů"],
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 12345,
  "services": {
    "api": { "status": "running", "port": 3001 },
    "websocket": { "status": "running", "activeConnections": 5 },
    "memory": { "status": "active", "knowledgeCount": 1250 },
    "llm": "configured"
  }
}
```

### Kompletní metriky
```bash
GET /api/monitoring/metrics
```

### Dashboard data
```bash
GET /api/monitoring/dashboard
```

**Kompletní dashboard data obsahující:**
- System health status
- Performance summary
- Charts data pro UI komponenty
- Error statistics

### Specifické metriky
```bash
GET /api/monitoring/metrics/system    # System metrics
GET /api/monitoring/metrics/llm       # LLM performance
GET /api/monitoring/metrics/memory    # Memory analytics
GET /api/monitoring/metrics/websocket # WebSocket stats
GET /api/monitoring/metrics/api       # API endpoint stats
GET /api/monitoring/metrics/sessions  # Session metrics
```

### System status
```bash
GET /api/monitoring/status
```

Poskytuje přehled všech služeb a jejich stavu.

## React Dashboard

### Import a použití
```tsx
import { AdvancedMonitoringDashboard } from '@/components/advanced-monitoring-dashboard';

function AdminPanel() {
  return (
    <div>
      <h1>Systémová administrace</h1>
      <AdvancedMonitoringDashboard />
    </div>
  );
}
```

### Funkce advanced dashboard
- **Real-time data**: Automatické obnovování každých 30 sekund
- **Advanced health status**: Pokročilé vizuální indikátory stavu systému
- **Comprehensive metrics**: Detailní metriky pro PostgreSQL, API, WebSocket, LLM a Memory
- **Performance charts**: Interaktivní grafy s real-time daty
- **Error tracking**: Pokročilé sledování chyb s kategorizací podle severity
- **System alerts**: Real-time notifikace o kritických stavech
- **Connection monitoring**: Sledování databázových poolů a aktivních spojení

## Programmatic Usage

### MetricsCollector
```typescript
import { metricsCollector } from '@core/monitoring';

// Track custom metrics
metricsCollector.trackAPIRequest('/my-endpoint', 250, true);
metricsCollector.trackLLMRequest('openai', 'gpt-4', 1200, true, 500);
metricsCollector.trackMemorySearch(150, 'user query', 0.85);

// Get current metrics
const metrics = metricsCollector.getMetrics();
const health = metricsCollector.getHealthStatus();
```

### LLM Performance Tracking
```typescript
import { LLMPerformanceTracker } from '@core/monitoring';

// Decorator pro automatické tracking
const trackedLLMCall = LLMPerformanceTracker.trackLLMCall(
  'openai',
  'gpt-4',
  originalLLMFunction
);

// Manual tracking
const tracker = LLMPerformanceTracker.getInstance();
const result = await tracker.trackManualRequest(
  { provider: 'openai', model: 'gpt-4' },
  () => callLLMService()
);
```

### Error Tracking
```typescript
import { errorTracker } from '@core/monitoring';

// Track různé typy chyb
errorTracker.trackAPIError(error, '/api/sessions', { userId: 'user123' });
errorTracker.trackLLMError(error, 'openai', 'gpt-4', { requestId: 'req_456' });
errorTracker.trackMemoryError(error, { searchQuery: 'complex query' });

// Resolve chyby
errorTracker.resolveError('error-id', 'Fixed by restarting service');

// Get error statistics
const stats = errorTracker.getErrorStats();
const healthStatus = errorTracker.getHealthStatus();
```

### WebSocket Tracking
```typescript
import { WebSocketTracker } from '@core/monitoring';

// V WebSocket event handleru
const tracker = new WebSocketTracker(connectionId);

ws.on('message', (data) => {
  tracker.trackMessage(true); // incoming message
  // process message...
  tracker.trackMessage(false); // outgoing response
});

ws.on('error', () => {
  tracker.trackError();
});

ws.on('close', () => {
  tracker.trackDisconnection();
});
```

## Middleware Integration

### Express Middleware
```typescript
import { integrateMetrics, initializeMetricsCollection } from '@core/monitoring';

const app = express();

// Initialize monitoring system
initializeMetricsCollection();

// Integrate with Express app
integrateMetrics(app);

// Your routes...
```

### Manual Middleware
```typescript
import {
  requestMetricsMiddleware,
  errorTrackingMiddleware
} from '@core/monitoring';

app.use(requestMetricsMiddleware);
// ... other middleware
app.use(errorTrackingMiddleware); // Should be last
```

## Prometheus Integration

### Metrics Export
```bash
GET /api/monitoring/metrics/prometheus
```

Exportuje metriky ve formátu kompatibilním s Prometheus:

```
# HELP cipher_uptime_seconds System uptime in seconds
# TYPE cipher_uptime_seconds gauge
cipher_uptime_seconds 12345

# HELP cipher_memory_usage_percent Memory usage percentage
# TYPE cipher_memory_usage_percent gauge
cipher_memory_usage_percent 45.2

# HELP cipher_llm_requests_total Total LLM requests
# TYPE cipher_llm_requests_total counter
cipher_llm_requests_total{provider="openai",model="gpt-4"} 1250
```

### Grafana Dashboard
Pro pokročilé vizualizace můžete využít Prometheus + Grafana:

1. Nakonfigurujte Prometheus na scraping `/api/monitoring/metrics/prometheus`
2. Importujte Grafana dashboard template (viz `examples/grafana-dashboard.json`)
3. Nastavte alerting pravidla podle potřeby

## Health Checks

### Load Balancer Health Check
```bash
GET /ping
GET /health-check
```

Rychlé health check endpointy pro load balancery, vrací:
- `200` - systém je zdravý
- `503` - kritické problémy detekované

### Detailed Health Status
```bash
GET /api/monitoring/health
```

Detailní health informace včetně:
- Specific service status
- Active issues list
- Resource usage warnings
- Error rate alerts

## Configuration

### Environment Variables
```bash
# Monitoring Configuration
CIPHER_ENABLE_MONITORING=true
CIPHER_METRICS_INTERVAL=30000
CIPHER_MAX_ERRORS_STORED=1000

# External Monitoring Integration
SENTRY_DSN=https://your-sentry-dsn
PROMETHEUS_METRICS_ENABLED=true
```

### Programmatic Configuration
```typescript
import { MonitoringIntegration } from '@core/monitoring';

// Initialize with custom settings
MonitoringIntegration.initialize();

// Get comprehensive status
const status = MonitoringIntegration.getSystemStatus();

// Shutdown cleanly
MonitoringIntegration.shutdown();
```

## Alerting Rules

### Critical Alerts
- Memory usage > 90%
- Error rate > 10%
- LLM response time > 30s
- WebSocket connection errors > 10%
- Critical errors detected

### Warning Alerts
- Memory usage > 75%
- Error rate > 5%
- LLM response time > 10s
- Elevated error patterns

## Best Practices

### 1. **Error Classification**
```typescript
// Správně kategorizujte chyby podle typu a severity
errorTracker.trackLLMError(error, provider, model, {
  requestId,
  userId,
  endpoint,
  // Přidat relevantní context
});
```

### 2. **Performance Tracking**
```typescript
// Použijte decorator pattern pro konzistentní tracking
const monitoredFunction = LLMPerformanceTracker.trackLLMCall(
  provider,
  model,
  originalFunction
);
```

### 3. **Custom Metrics**
```typescript
// Trackujte business-specific metriky
metricsCollector.trackCustomMetric('user_signups', 1);
metricsCollector.trackCustomMetric('successful_searches', searchResults.length);
```

### 4. **Dashboard Integration**
- Integrujte monitoring dashboard do admin rozhraní
- Nastavte real-time alerts pro operations team
- Používejte health check endpointy pro automatické monitoring

## Troubleshooting

### Critical Status - Falešné alarmy
Pokud monitoring systém hlásí "Critical" status kvůli vysoké paměti (>90%), nejprve zkontrolujte:

1. **Typ paměti**: Systém nyní správně měří systémovou paměť místo Node.js heap paměti
2. **Duplicitní procesy**: Ujistěte se, že neběží více instancí API/UI serverů současně
3. **Normální hodnoty**: 60-70% využití systémové paměti je normální pro vývojové prostředí

```bash
# Zkontrolujte aktuální status
curl -s http://localhost:3001/api/monitoring/health

# Zkontrolujte běžící procesy na portech
netstat -ano | findstr :3001
netstat -ano | findstr :3000
```

### High Memory Usage
```typescript
// Check detailed memory metrics (nyní používá systémovou paměť)
const metrics = metricsCollector.getMetrics();
if (metrics.system.memory.percentage > 80) {
  console.log('High system memory usage detected:', {
    used: metrics.system.memory.used,
    total: metrics.system.memory.total,
    percentage: metrics.system.memory.percentage,
    activeConnections: metrics.websocket.activeConnections
  });
}
```

### Performance Issues
```typescript
// Analyze LLM performance patterns
const stats = llmPerformanceTracker.getPerformanceStats();
Object.entries(stats.averageResponseTime).forEach(([provider, avgTime]) => {
  if (avgTime > 5000) {
    console.warn(`Slow LLM responses detected for ${provider}: ${avgTime}ms`);
  }
});
```

### Error Investigation
```typescript
// Get recent errors for analysis
const recentErrors = errorTracker.getRecentErrors(50, 'llm', 'high');
const errorPatterns = errorTracker.getErrorStats().topErrors;

console.log('Top error patterns:', errorPatterns);
```

## Rozšíření

Monitoring systém je navržen pro snadné rozšíření:

1. **Custom Metrics**: Přidejte vlastní metriky do `MetricsCollector`
2. **External Integrations**: Integrujte s Datadog, New Relic, atd.
3. **Custom Dashboards**: Vytvořte vlastní React komponenty používající monitoring API
4. **Alerting**: Implementujte vlastní alerting logiku based na metrics data

Pro detailní implementační příklady viz složka `examples/monitoring/`.