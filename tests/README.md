# Claude Code Integration - Testy

Tato složka obsahuje všechny testy pro Claude Code Integration MCP Server.

## Spuštění testů

### Předpoklady
1. Claude Code CLI nainstalovaný a dostupný v PATH
2. Projekt je úspěšně buildnutý: `pnpm run build:no-ui`

### Jednotlivé testy

#### 1. Jednoduchý test (`test-mcp-simple.js`)
Základní test komunikace s MCP serverem:
```bash
cd tests
node test-mcp-simple.js
```

**Co testuje:**
- Spuštění MCP serveru
- Výpis dostupných nástrojů
- Status check Claude Code
- Spuštění základního příkazu
- Data exchange funkcionalita

#### 2. Kompletní test (`test-complete-integration.js`)
Detailní test všech funkcí:
```bash
cd tests
node test-complete-integration.js
```

**Co testuje:**
- Configuration management
- Token statistics
- Data exchange s komplexními daty
- Input validation
- Help command

#### 3. Komprehensivní test (`test-claude-code-integration.js`)
Pokročilý test framework s detailním reportingem:
```bash
cd tests
node test-claude-code-integration.js
```

**Funkce:**
- Automatický start/stop MCP serveru
- Timeout handling
- Detailní error reporting
- JSON report generování

## Výsledky testů

### Očekávané výsledky
- ✅ Tool discovery: Všech 5 nástrojů dostupných
- ✅ Status check: Claude Code detekovaný
- ✅ Basic execution: Příkazy jako `--version`, `--help` fungují
- ✅ Input validation: Neplatné parametry odmítnuty
- ⚠️ Complex operations: Mohou trvat 30+ sekund

### Troubleshooting

#### "Claude Code not available"
```bash
# Ověřte Claude Code CLI
claude --version

# Na Windows zkontrolujte cestu
where claude
```

#### Timeout chyby
Některé Claude Code operace jsou časově náročné. To je normální chování.

#### MCP server se nespustí
```bash
# Ověřte build
pnpm run build:no-ui

# Zkontrolujte že existuje
ls ../dist/src/mcp-servers/claude-code-integration.cjs
```

## Test reports

Detailní report posledního testu najdete v:
- `INTEGRATION-TEST-REPORT.md` - Kompletní analýza všech testů
- `claude-code-integration-test-report.json` - JSON data (generuje se při spuštění)

## Přidání nových testů

Pro přidání nového testu:

1. Vytvořte nový soubor `test-nazev.js`
2. Použijte existing test jako template
3. Ujistěte se, že používáte správnou cestu: `../dist/src/mcp-servers/claude-code-integration.cjs`
4. Přidejte popis do tohoto README

### Template pro nový test:
```javascript
import { spawn } from 'child_process';

async function testNewFeature() {
  const mcpProcess = spawn('node', ['../dist/src/mcp-servers/claude-code-integration.cjs'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Your test code here

  mcpProcess.kill('SIGTERM');
}

testNewFeature().catch(console.error);
```