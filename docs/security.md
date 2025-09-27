# Security Guide

Cipher implementuje komplexní bezpečnostní systém navržený pro ochranu všech API endpointů a WebSocket připojení. Tento průvodce pokrývá všechny bezpečnostní funkce a nejlepší praktiky.

## Přehled bezpečnostních funkcí

### 1. Kompletní API validace
- Middleware pro validaci všech zranitelných endpointů
- Sanitizace vstupů proti XSS útokům
- Validace typů dat, délky a formátu
- Automatické zachytávání a logování neplatných požadavků

### 2. JWT autentizace pro WebSocket
- Plný JWT-based autentizační systém
- Podpora 3 metod autentizace
- Granulární systém oprávnění
- Automatické vypršení tokenů

### 3. Bezpečnostní kontroly
- Session ID validace
- File path security (ochrana proti path traversal)
- URL validation pro webhook endpointy
- Input sanitization pro všechny textové vstupy

## JWT WebSocket Authentication

### Konfigurace

```bash
# Environment variables (všechny volitelné)
CIPHER_JWT_SECRET=your-secure-secret-key-here
CIPHER_JWT_EXPIRY=24h
CIPHER_JWT_ISSUER=cipher-websocket
```

### Generování tokenů

```bash
# Základní token
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "userId": "user-123"
  }'

# Token s oprávněními a custom expirací
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "admin-session",
    "userId": "admin-001",
    "permissions": ["read", "write", "admin", "monitor"],
    "expiresIn": "7d"
  }'
```

### Metody autentizace

#### 1. Query Parameter
```bash
# WebSocket připojení s tokenem v URL
wscat -c "ws://localhost:3001?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# JavaScript example
const ws = new WebSocket('ws://localhost:3001?token=' + jwt_token);
```

#### 2. Authorization Header
```bash
# WebSocket připojení s tokenem v header
wscat -c ws://localhost:3001 -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# JavaScript example
const ws = new WebSocket('ws://localhost:3001', [], {
  headers: {
    'Authorization': 'Bearer ' + jwt_token
  }
});
```

#### 3. WebSocket Subprotocol
```bash
# WebSocket připojení s tokenem jako subprotocol
wscat -c ws://localhost:3001 -s "cipher-jwt-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# JavaScript example
const ws = new WebSocket('ws://localhost:3001', ['cipher-jwt-' + jwt_token]);
```

### Permissions systém

| Permission | Popis | WebSocket Access |
|------------|-------|------------------|
| `read` | Čtení WebSocket zpráv a eventů | ✅ Přijímání zpráv |
| `write` | Odesílání zpráv přes WebSocket | ✅ Odesílání zpráv |
| `admin` | Administrativní přístup | ✅ Správa připojení |
| `monitor` | Přístup k monitoring eventům | ✅ Metrics a diagnostika |

**Příklady kombinací oprávnění:**
- `["read"]` - pouze čtení (read-only klient)
- `["read", "write"]` - standardní uživatel
- `["read", "write", "monitor"]` - uživatel s monitoring přístupem
- `["read", "write", "admin", "monitor"]` - plný přístup

## API Validation System

### Chráněné endpointy

Všechny následující endpointy jsou chráněny validačním middleware:

#### Vector API
```
POST /api/vector/embed
POST /api/vector/search
POST /api/vector/store
GET /api/vector/:id
DELETE /api/vector/:id
```

#### Memory API
```
POST /api/memory/search
POST /api/memory/store
POST /api/memory/reasoning
```

#### Search API
```
GET /api/search/messages
GET /api/search/sessions
```

#### Webhook API
```
POST /api/webhook
GET /api/webhook
PUT /api/webhook/:webhookId
DELETE /api/webhook/:webhookId
```

#### Config API
```
GET /api/config/:sessionId
POST /api/config/:sessionId
```

#### Monitoring API
```
POST /api/monitoring/alert/rules
GET /api/monitoring/alert/rules
PUT /api/monitoring/alert/rules/:ruleId
DELETE /api/monitoring/alert/rules/:ruleId
POST /api/monitoring/alert/rules/:ruleId/toggle
```

### Validační kontroly

#### 1. Input Validation
```typescript
// Příklad validace pro message endpoint
{
  message: {
    type: 'string',
    minLength: 1,
    maxLength: 50000,
    required: true
  },
  sessionId: {
    type: 'string',
    format: 'session-id', // custom validator
    optional: true
  }
}
```

#### 2. Sanitization
```typescript
// Automatická sanitizace textových vstupů
const sanitizedMessage = sanitizeInput(userInput);
// Odstraní/escapuje nebezpečné HTML a script tagy
```

#### 3. Session ID Validation
```typescript
// Kontrola formátu session ID
function isValidSessionId(sessionId: string): boolean {
  // Povolené znaky: a-z, A-Z, 0-9, dash, underscore
  return /^[a-zA-Z0-9_-]+$/.test(sessionId) &&
         sessionId.length >= 1 &&
         sessionId.length <= 100;
}
```

## Bezpečnostní best practices

### 1. JWT Token Management

**Doporučení:**
- Používejte silný, náhodný `CIPHER_JWT_SECRET` (min. 64 znaků)
- Nastavte rozumnou dobu platnosti tokenů (24h pro dev, kratší pro produkci)
- Implementujte token refresh mechanismus pro dlouhodobé sessions
- Pravidelně rotujte JWT secret v produkci

**Příklad generování bezpečného secretu:**
```bash
# Linux/macOS
openssl rand -hex 64

# Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Python
python -c "import secrets; print(secrets.token_hex(64))"
```

### 2. Environment Variables

```bash
# Produkční .env konfigurace
CIPHER_JWT_SECRET=a1b2c3d4e5f6...64-character-hex-string...
CIPHER_JWT_EXPIRY=2h
CIPHER_JWT_ISSUER=cipher-production
CIPHER_LOG_LEVEL=warn
REDACT_SECRETS=true
```

### 3. Monitoring a Logging

Cipher automaticky loguje všechny bezpečnostní eventy:

```typescript
// Příklady bezpečnostních logů
logger.warn('Invalid session ID format', { sessionId, requestId });
logger.error('JWT token expired', { userId, sessionId });
logger.info('WebSocket connection authenticated', {
  sessionId, userId, permissions
});
```

### 4. Error Handling

Všechny validační chyby vracejí strukturovanou odpověď:

```json
{
  "status": "error",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "message",
        "message": "Message must be between 1 and 50000 characters"
      }
    ]
  },
  "requestId": "req_123456789"
}
```

## Troubleshooting

### Běžné problémy

#### 1. JWT Token neplatný
```json
{
  "status": "error",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```
**Řešení:** Vygenerujte nový token pomocí `/api/auth/websocket/token`

#### 2. WebSocket autentizace selhala
```
WebSocket connection failed: authentication failed
```
**Řešení:**
- Zkontrolujte formát tokenu
- Ověřte, že token není expirovaný
- Ujistěte se, že používáte správnou metodu autentizace

#### 3. Validační chyby
```json
{
  "status": "error",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid session ID format"
  }
}
```
**Řešení:** Zkontrolujte formát vstupních dat podle API dokumentace

### Debug režim

Pro detailní logování nastavte:
```bash
CIPHER_LOG_LEVEL=debug
```

Tento režim poskytuje podrobné informace o:
- JWT token validaci
- Validačních kontrolách
- WebSocket handshake procesu
- API request/response cyklech

## Migration Guide

### Upgrade z verze bez autentizace

1. **Update environment variables:**
```bash
# Přidejte do .env
CIPHER_JWT_SECRET=your-new-secret-key
CIPHER_JWT_EXPIRY=24h
```

2. **Update WebSocket klientů:**
```javascript
// Starý způsob
const ws = new WebSocket('ws://localhost:3001');

// Nový způsob - vygenerujte token
const tokenResponse = await fetch('/api/auth/websocket/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'my-session' })
});
const { token } = await tokenResponse.json();

// Připojte se s tokenem
const ws = new WebSocket(`ws://localhost:3001?token=${token}`);
```

3. **Update API klientů:**
API endpointy zůstávají zpětně kompatibilní, ale nyní provádějí validaci vstupů.

## Související dokumentace

- [API Reference](./api-reference.md) - Kompletní API dokumentace
- [Configuration Guide](./configuration.md) - Konfigurační možnosti
- [WebSocket API](./websocket-api.md) - WebSocket komunikace (pokud existuje)