# Claude Code Integrace - Návod na použití

## Přehled

Claude Code Integration MCP Server umožňuje propojení mezi Cipher a Claude Code CLI, což vám poskytne přímý přístup k funkcím Claude Code z prostředí Cipher.

## Co je to MCP (Model Context Protocol)?

MCP je protokol, který umožňuje AI modelům komunikovat s externími nástroji a službami. Náš MCP server funguje jako most mezi Cipher a Claude Code.

## Prerekvizity

### 1. Nainstalovaný Claude Code CLI
```bash
# Ověřte, že máte Claude Code nainstalovaný
claude --version
```

Pokud není nainstalovaný, stáhněte si ho z [oficiálních stránek Claude Code](https://claude.ai/code).

### 2. Node.js (verze 20+)
```bash
node --version
npm --version
```

### 3. Cipher project
Ujistěte se, že máte stažený a nakonfigurovaný Cipher projekt.

## Instalace a Spuštění

### 1. Build MCP Serveru
```bash
# V root složce cipher-project
pnpm run build:no-ui
```

Po úspěšném buildu najdete server na:
```
dist/src/mcp-servers/claude-code-integration.cjs
```

### 2. Test funkčnosti
```bash
# Spustit základní test
node tests/test-mcp-simple.js

# Spustit kompletní test
node tests/test-complete-integration.js
```

## Dostupné nástroje (Tools)

MCP server poskytuje 5 hlavních nástrojů:

### 1. `claude_code_execute` - Spuštění Claude Code příkazů
**Použití:**
```json
{
  "name": "claude_code_execute",
  "arguments": {
    "command": "help me debug this code",
    "mode": "print",
    "options": {
      "timeout": 30000,
      "cwd": "/path/to/project"
    }
  }
}
```

**Parametry:**
- `command` (povinný): Příkaz pro Claude Code
- `mode`: `"print"` (jednorazový) nebo `"interactive"` (interaktivní)
- `options.timeout`: Timeout v milisekundách (výchozí: 30000)
- `options.cwd`: Pracovní adresář

**Příklady:**
```bash
# Získat verzi
"command": "--version"

# Získat nápovědu
"command": "--help"

# Analýza kódu
"command": "analyze this JavaScript function for potential bugs"
```

### 2. `claude_code_status` - Kontrola stavu
Ověří dostupnost Claude Code a vrátí informace o integraci.

```json
{
  "name": "claude_code_status",
  "arguments": {}
}
```

**Odpověď:**
```json
{
  "status": "Claude Code is available",
  "version_check": {...},
  "integration_active": true,
  "temp_dir": "C:\\Users\\...\\Temp\\cipher-claude-code-integration"
}
```

### 3. `claude_code_config` - Správa konfigurace
```json
{
  "name": "claude_code_config",
  "arguments": {
    "action": "get"  // nebo "set"
  }
}
```

Pro nastavení hodnoty:
```json
{
  "action": "set",
  "key": "theme",
  "value": "dark"
}
```

### 4. `claude_code_token_stats` - Statistiky tokenů
```json
{
  "name": "claude_code_token_stats",
  "arguments": {
    "reset": false  // true pro resetování
  }
}
```

### 5. `cipher_to_claude_code` - Předání dat z Cipher
Umožňuje poslat data z Cipher do Claude Code k zpracování.

```json
{
  "name": "cipher_to_claude_code",
  "arguments": {
    "data": {
      "code": "function hello() { console.log('Hello'); }",
      "language": "javascript"
    },
    "format": "json",
    "request_type": "analysis"
  }
}
```

**Parametry:**
- `data`: Data k zpracování (object)
- `format`: `"json"`, `"text"`, nebo `"code"`
- `request_type`: `"analysis"`, `"debugging"`, `"generation"`, nebo `"review"`

## Praktické použití

### Scénář 1: Kontrola dostupnosti
```javascript
// Před použitím ověřte, že Claude Code je dostupný
const statusRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "claude_code_status",
    arguments: {}
  }
};
```

### Scénář 2: Analýza kódu
```javascript
const analyzeRequest = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "cipher_to_claude_code",
    arguments: {
      data: {
        code: `
          function calculateTotal(items) {
            let total = 0;
            for (let i = 0; i < items.length; i++) {
              total += items[i].price;
            }
            return total;
          }
        `,
        language: "javascript",
        context: "E-commerce checkout calculation"
      },
      format: "json",
      request_type: "review"
    }
  }
};
```

### Scénář 3: Debugging pomoc
```javascript
const debugRequest = {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "claude_code_execute",
    arguments: {
      command: "help me debug this error: TypeError: Cannot read property 'length' of undefined",
      mode: "print"
    }
  }
};
```

## Integrace s Cipher

### 1. Přidání MCP serveru do Cipher konfigurace

V Cipher konfiguraci (obvykle `cipher.yml` nebo environment proměnné) přidejte:

```yaml
mcp_servers:
  claude_code_integration:
    command: "node"
    args: ["dist/src/mcp-servers/claude-code-integration.cjs"]
    env: {}
```

### 2. Použití v Cipher agentovi

```typescript
// V Cipher agentovi můžete volat MCP nástroje
const result = await mcpClient.callTool({
  name: "claude_code_execute",
  arguments: {
    command: "analyze this code for security issues",
    mode: "print"
  }
});
```

## Troubleshooting

### Problém: "Claude Code not available"
**Řešení:**
1. Ověřte instalaci: `claude --version`
2. Zkontrolujte PATH: `where claude` (Windows) nebo `which claude` (Unix)
3. Restartujte terminál po instalaci Claude Code

### Problém: Timeout při dlouhých operacích
**Řešení:**
```javascript
// Zvyšte timeout pro složitější operace
{
  "command": "complex analysis task",
  "options": {
    "timeout": 60000  // 1 minuta
  }
}
```

### Problém: Chyby při spuštění MCP serveru
**Řešení:**
1. Zkontrolujte build: `pnpm run build:no-ui`
2. Ověřte Node.js verzi: minimálně v20
3. Zkontrolujte log chyb v `stderr`

## Výkonnost a limity

### Očekávané časy odezvy:
- Jednoduché příkazy (--version, --help): 2-3 sekundy
- Analýza kódu: 10-30 sekund
- Komplexní operace: 30+ sekund

### Limity:
- Interaktivní příkazy mohou vyžadovat speciální zacházení
- Některé operace Claude Code mohou vyžadovat internetové připojení
- Velikost dat je omezena dostupnou pamětí

## Bezpečnost

- MCP server vytváří dočasné soubory v system temp adresáři
- Automatické čištění temp souborů každých 5 minut
- Validace všech vstupních parametrů
- Žádné citlivé informace nejsou logovány

## Podpora a další vývoj

Pro hlášení problémů nebo návrhy vylepšení:
1. Vytvořte issue v GitHub repository
2. Přiložte log výstupy a kroky k reprodukci
3. Uveďte verze Node.js, Claude Code a Cipher

## Licencia

Tento MCP server je součástí Cipher projektu a je licencován pod Elastic-2.0 licencí.