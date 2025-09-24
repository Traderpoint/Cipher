# API Reference

Kompletní reference pro všechny REST API endpointy v Cipher projektu. API server běží standardně na portu 3001 (`http://localhost:3001`).

## Přehled

- **Celkem endpointů**: 47 HTTP + 1 WebSocket
- **Prefix**: `/api` (konfigurovatelný)
- **Formát**: JSON
- **Autentizace**: Momentálně není implementována

## Core Infrastructure

### Health & System

#### `GET /health`
Kontrola stavu systému s informacemi o uptime a WebSocket statistikách.

```bash
curl http://localhost:3001/health
```

**Odpověď:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "websocket": {
    "connections": 2,
    "active": 1
  }
}
```

#### `GET /ws/stats`
WebSocket statistiky připojení.

#### `GET /.well-known/agent.json`
Agent-to-Agent discovery endpoint.

#### `POST /api/reset`
Globální reset sessions (všech nebo konkrétní).

```bash
curl -X POST http://localhost:3001/api/reset \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "optional-session-id"}'
```

## Message Processing

### `POST /api/message`
Asynchronní zpracování zprávy (vrací 202).

```bash
curl -X POST http://localhost:3001/api/message \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello, world!",
    "sessionId": "test-session"
  }'
```

### `POST /api/message/sync`
Synchronní zpracování zprávy s plnou odpovědí.

```bash
curl -X POST http://localhost:3001/api/message/sync \
  -H "Content-Type: application/json" \
  -d '{
    "content": "What can you do?",
    "sessionId": "test-session"
  }'
```

### `POST /api/message/reset`
Reset konverzačního stavu pro session.

## Session Management

### `GET /api/sessions`
Seznam všech aktivních sessions s metadaty.

```bash
curl http://localhost:3001/api/sessions
```

**Odpověď:**
```json
{
  "sessions": [
    {
      "sessionId": "default",
      "messageCount": 5,
      "lastActivity": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-15T09:00:00Z"
    }
  ]
}
```

### `POST /api/sessions`
Vytvoření nové session.

```bash
curl -X POST http://localhost:3001/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "my-new-session"}'
```

### `GET /api/sessions/current`
Detail aktuální pracovní session.

### `GET /api/sessions/stats`
Statistiky výkonu sessions.

### `GET /api/sessions/:sessionId`
Detail konkrétní session.

### `POST /api/sessions/:sessionId/load`
Načtení session jako aktuální pracovní.

### `GET /api/sessions/:sessionId/history`
Historie konverzace v session (optimalizovaná).

```bash
curl http://localhost:3001/api/sessions/default/history
```

### `DELETE /api/sessions/:sessionId`
Smazání session.

```bash
curl -X DELETE http://localhost:3001/api/sessions/test-session
```

## Search & Discovery

### `GET /api/search/messages`
Vyhledávání zpráv napříč sessions s filtry.

```bash
curl "http://localhost:3001/api/search/messages?q=memory&limit=10&sessionId=default"
```

**Parametry:**
- `q` - vyhledávaný text
- `limit` - počet výsledků (výchozí 10)
- `sessionId` - omezit na konkrétní session
- `role` - filtr podle role (user, assistant, system)

### `GET /api/search/sessions`
Vyhledávání sessions obsahujících dotaz.

```bash
curl "http://localhost:3001/api/search/sessions?q=api&limit=5"
```

## Memory System

### `GET /api/memory`
Status paměťového systému a statistiky.

```bash
curl http://localhost:3001/api/memory
```

### `POST /api/memory/search`
Sémantické vyhledávání v paměti.

```bash
curl -X POST http://localhost:3001/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "REST API best practices",
    "limit": 5,
    "sessionId": "test-session"
  }'
```

### `POST /api/memory/store`
Uložení nové informace do paměti.

```bash
curl -X POST http://localhost:3001/api/memory/store \
  -H "Content-Type: application/json" \
  -d '{
    "content": "REST API should use proper HTTP status codes",
    "type": "knowledge",
    "sessionId": "test-session",
    "metadata": {
      "topic": "api-design"
    }
  }'
```

**Parametry:**
- `content` (povinné) - text k uložení
- `type` - typ znalosti (výchozí "knowledge")
- `sessionId` - ID session
- `metadata` - vlastní metadata
- `options` - volby pro similarity threshold apod.

### `POST /api/memory/reasoning`
Uložení reasoning traces do reflexní paměti.

### `POST /api/memory/reasoning/search`
Vyhledávání reasoning patterns v reflexní paměti.

### `GET /api/memory/tools`
Seznam dostupných memory tools a schopností.

## Vector Storage

### `GET /api/vector`
Status vector storage systému a statistiky.

```bash
curl http://localhost:3001/api/vector
```

### `POST /api/vector/embed`
Generování embeddings pro text.

```bash
curl -X POST http://localhost:3001/api/vector/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "Convert this text to embeddings"}'
```

### `POST /api/vector/search`
Similarity search ve vector storage.

```bash
curl -X POST http://localhost:3001/api/vector/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "API documentation",
    "limit": 5,
    "threshold": 0.7
  }'
```

### `POST /api/vector/store`
Uložení textu s metadaty do vector storage.

```bash
curl -X POST http://localhost:3001/api/vector/store \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This is important information to store",
    "metadata": {
      "source": "api-test",
      "type": "documentation"
    }
  }'
```

### `DELETE /api/vector/:id`
Smazání vektoru podle ID.

### `GET /api/vector/collections`
Seznam dostupných vector kolekcí.

## MCP (Model Context Protocol)

### `GET /api/mcp/tools`
Seznam všech tools ze všech připojených MCP serverů.

```bash
curl http://localhost:3001/api/mcp/tools
```

### `GET /api/mcp/servers`
Seznam všech připojených a neúspěšných MCP serverů.

```bash
curl http://localhost:3001/api/mcp/servers
```

### `POST /api/mcp/servers`
Připojení nového MCP serveru.

```bash
curl -X POST http://localhost:3001/api/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "filesystem",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }'
```

### `DELETE /api/mcp/servers/:serverId`
Odpojení MCP serveru.

### `GET /api/mcp/servers/:serverId/tools`
Seznam tools pro konkrétní MCP server.

### `POST /api/mcp/servers/:serverId/tools/:toolName/execute`
Spuštění tool na konkrétním MCP serveru.

```bash
curl -X POST "http://localhost:3001/api/mcp/servers/filesystem/tools/read_file/execute" \
  -H "Content-Type: application/json" \
  -d '{
    "arguments": {
      "path": "/path/to/file.txt"
    }
  }'
```

### `GET /api/mcp/sse`
Ustanovení SSE připojení pro MCP klienta.

### `POST /api/mcp`
Zpracování MCP zpráv přes HTTP (s sessionId parametrem).

## LLM Configuration

### `GET /api/llm/config`
Aktuální LLM konfigurace.

```bash
curl http://localhost:3001/api/llm/config
```

### `PUT /api/llm/config`
Update LLM konfigurace.

```bash
curl -X PUT http://localhost:3001/api/llm/config \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-4",
    "apiKey": "sk-..."
  }'
```

### `GET /api/llm/current`
Současná LLM konfigurace.

### `GET /api/llm/providers`
Seznam dostupných LLM providerů a modelů.

```bash
curl http://localhost:3001/api/llm/providers
```

### `POST /api/llm/switch`
Přepnutí LLM konfigurace.

### `GET /api/llm/status`
LLM connection status a health check.

## Configuration Management

### `GET /api/config`
Současná konfigurace jako JSON (s redakcí citlivých údajů).

```bash
curl http://localhost:3001/api/config
```

### `GET /api/config/yaml`
Export konfigurace jako YAML soubor.

```bash
curl http://localhost:3001/api/config/yaml > cipher-config.yml
```

### `GET /api/config/session/:sessionId`
Session-specific konfigurace.

## Webhook System

### `POST /api/webhooks`
Registrace nového webhook endpointu.

```bash
curl -X POST http://localhost:3001/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://my-app.com/webhook",
    "events": ["message", "session.created"],
    "secret": "webhook-secret"
  }'
```

### `GET /api/webhooks`
Seznam registrovaných webhooks.

### `GET /api/webhooks/:webhookId`
Detail konkrétního webhook.

### `DELETE /api/webhooks/:webhookId`
Odstranění webhook.

### `POST /api/webhooks/:webhookId/test`
Test webhook endpointu.

## WebSocket Communication

### `WebSocket /ws`
Real-time obousměrná komunikace.

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'message',
    content: 'Hello via WebSocket!',
    sessionId: 'default'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

**WebSocket Message Types:**
- `message` - odeslání zprávy
- `reset` - reset session
- `thinking` - AI "přemýšlí"
- `chunk` - část streamované odpovědi
- `response` - kompletní odpověď
- `toolCall` - volání nástroje
- `toolResult` - výsledek nástroje
- `error` - chybová zpráva

## Error Handling

### HTTP Status Codes
- `200` - OK
- `201` - Created
- `202` - Accepted (asynchronní operace)
- `400` - Bad Request
- `404` - Not Found
- `500` - Internal Server Error

### Error Response Format
```json
{
  "error": "Error message",
  "details": "Additional error details",
  "code": "ERROR_CODE"
}
```

## Rate Limiting

API má implementované rate limiting:
- **Message endpoints**: 60 požadavků/minutu
- **Search endpoints**: 30 požadavků/minutu
- **Ostatní endpoints**: 100 požadavků/minutu

## Examples

### Kompletní workflow session
```bash
# 1. Vytvořit session
curl -X POST http://localhost:3001/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "example-session"}'

# 2. Odeslat zprávu
curl -X POST http://localhost:3001/api/message/sync \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Store this: REST APIs should use proper HTTP methods",
    "sessionId": "example-session"
  }'

# 3. Vyhledat v paměti
curl -X POST http://localhost:3001/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "HTTP methods",
    "sessionId": "example-session"
  }'

# 4. Získat historii
curl http://localhost:3001/api/sessions/example-session/history
```

### MCP Integration
```bash
# Připojit filesystem server
curl -X POST http://localhost:3001/api/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "filesystem",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }'

# Použít filesystem tool
curl -X POST http://localhost:3001/api/mcp/servers/filesystem/tools/list_directory/execute \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"path": "."}}'
```

## SDK a Klientské knihovny

Pro snadnější použití API doporučujeme:

### JavaScript/TypeScript
```javascript
// WebSocket klient
import { CipherWebSocket } from '@byterover/cipher-client';

const client = new CipherWebSocket('ws://localhost:3001/ws');
await client.connect();
await client.sendMessage('Hello!', 'my-session');
```

### cURL scripty
V `examples/` složce najdete prepared cURL skripty pro běžné operace.

## Poznámky

1. **Konfigurace portů**: API server běží na portu 3001, UI na 3000, MCP na 3002
2. **CORS**: Povoleno pro localhost během vývoje
3. **Streaming**: WebSocket podporuje streaming odpovědí
4. **Session persistence**: Sessions se ukládají do PostgreSQL nebo SQLite
5. **Vector storage**: Podporuje Qdrant, Milvus, nebo in-memory storage

Pro detailnější informace o konfiguraci viz [configuration.md](./configuration.md).