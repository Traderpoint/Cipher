# Byterover Cipher

<div align="center">

<img src="./assets/cipher-logo.png" alt="Cipher Agent Logo" width="400" />

<p align="center">
<em>Framework AI agentů s pamětí a MCP integrací</em>
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Elastic%202.0-blue.svg" alt="License" /></a>
<img src="https://img.shields.io/badge/Status-Beta-orange.svg" alt="Beta" />
<a href="https://docs.byterover.dev/cipher/overview"><img src="https://img.shields.io/badge/Docs-Dokumentace-green.svg" alt="Dokumentace" /></a>
<a href="https://discord.com/invite/UMRrpNjh5W"><img src="https://img.shields.io/badge/Discord-Připojit%20se-7289da" alt="Discord" /></a>
</p>

</div>

<div align="center">
  <a href="https://www.producthunt.com/products/byterover?embed=true&utm_source=badge-top-post-badge&utm_medium=badge&utm_source=badge-cipher&#0045;by&#0045;byterover" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=1000588&theme=light&period=daily&t=1754744170741" alt="Cipher&#0032;by&#0032;Byterover - Open&#0045;source&#0044;&#0032;shared&#0032;memory&#0032;for&#0032;coding&#0032;agents | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
  </a>
</div>

## Přehled

Byterover Cipher je open-source paměťová vrstva speciálně navržená pro kódovací agenty. Kompatibilní s **Cursor, Windsurf, Claude Code, Cline, Claude Desktop, Gemini CLI, AWS Kiro, VS Code, Roo Code, Trae, Amp Code a Warp** prostřednictvím MCP, a kódovacími agenty jako **Kimi K2**. (více v [examples](./examples))

Vyvinuto týmem [Byterover](https://byterover.dev/)

**Klíčové vlastnosti:**

- MCP integrace s jakýmkoliv IDE dle vašeho výběru
- Automatické generování AI kódovacích vzpomínek škálujících s vaší kódovou základnou
- Bezproblémový přechod mezi IDE bez ztráty paměti a kontextu
- Snadné sdílení kódovacích vzpomínek napříč vývojovým týmem v reálném čase
- Duální paměťová vrstva zachycující Systém 1 (programovací koncepty, obchodní logiku a minulé interakce) a Systém 2 (kroky uvažování modelu při generování kódu)
- Instalace do vašeho IDE s nulovou konfigurací
- **Pokročilé zabezpečení** s komplexní API validací a JWT autentizací pro WebSocket připojení

## Rychlý start

### NPM balíček (doporučeno pro většinu uživatelů)

```bash
# Instalace globálně
npm install -g @byterover/cipher

# Nebo lokální instalace v projektu
npm install @byterover/cipher
```

### Docker

<details>
<summary>Zobrazit Docker konfiguraci</summary>

```bash
# Klonování a nastavení
git clone https://github.com/campfirein/cipher.git
cd cipher

# Konfigurace prostředí
cp .env.example .env
# Upravte .env s vašimi API klíči

# Spuštění s Dockerem
docker-compose up --build -d

# Test
curl http://localhost:3000/health
```

> **Poznámka:** Docker buildy automaticky přeskakují krok buildování UI pro zabránění kompatibilním problémům s lightningcss na ARM64. UI není ve výchozím nastavení zahrnuto do Docker obrazu.
>
> Pro zahrnutí UI do Docker buildu použijte: `docker build --build-arg BUILD_UI=true .`

</details>

### Ze zdrojového kódu

```bash
pnpm i && pnpm run build && npm link
```

### Lokální spuštění API serveru

```bash
# Build distribučních artefaktů
pnpm run build

# Pouze Windows: zachování standalone UI assetů při buildování
FORCE_STANDALONE=true pnpm run build-ui

# Spuštění API serveru na portu 3001
node dist/src/app/index.cjs --mode api --port 3001
```

> **Poznámka:** Na Windows spouštějte build/start příkazy z elevated PowerShell nebo povolte Developer Mode, aby PNPM mohl vytvořit symlinky očekávané Next.js.

Ověření nasazení:

```powershell
# Kontrola zdraví API serveru
curl http://localhost:3001/api/sessions

# Vytvoření relace (uložení do PostgreSQL pokud je nakonfigurováno)
curl -X POST http://localhost:3001/api/sessions -H "Content-Type: application/json" -d '{"sessionId":"api-test"}'

# Přímá kontrola PostgreSQL (inline heslo zabrání výzvam)
"C:/Program Files/PostgreSQL/17/bin/psql.exe" "postgresql://postgres:<password>@localhost:5432/cipher_db" -c "SELECT NOW();"
```

Pokud se API nemůže připojit k PostgreSQL, log serveru zobrazí `Failed to connect to database backend`. Opravte údaje pro přihlášení/službu a spusťte příkazy znovu.

### Konfigurace portů a Standalone UI

Ve výchozím nastavení používá Cipher následující porty:
- **API Server**: Port 3001 (backend služby)
- **UI rozhraní**: Port 3000 (webové rozhraní)
- **MCP Server**: Port 3002 (Model Context Protocol)

#### Spuštění Standalone UI rozhraní

Pro spuštění samostatného UI rozhraní, které se připojuje k API serveru:

```bash
# Spuštění API serveru na portu 3001
node dist/src/app/index.cjs --mode api --port 3001

# V dalším terminálu spuštění standalone UI na portu 3000
cd src/app/ui
PORT=3000 API_URL=http://localhost:3001 pnpm dev
```

Přístup k rozhraní: http://localhost:3000

UI obsahuje klikatelné logo v záhlaví, které vrátí uživatele na úvodbí obrazovku kdykoli. Úvodní obrazovka poskytuje rychlý přístup k základním funkcím a umožňuje přepínání mezi různými relacemi.

#### Spuštění MCP serveru

```bash
# Spuštění MCP serveru s SSE transportem na portu 3002 (výchozí)
node dist/src/app/index.cjs --mode mcp --mcp-transport-type sse --mcp-port 3002
```

#### Všechny služby spuštěné

Pro kompletní lokální vývoj se všemi službami:

```bash
# Terminál 1: API Server
node dist/src/app/index.cjs --mode api --port 3001

# Terminál 2: Standalone UI
cd src/app/ui && PORT=3000 API_URL=http://localhost:3001 pnpm dev

# Terminál 3: MCP Server
node dist/src/app/index.cjs --mode mcp --mcp-transport-type sse --mcp-port 3002
```

#### Řešení problémů se Standalone UI

**Pokud se Standalone UI nepodaří spustit:**

```bash
# 1. Zastavte všechny procesy na portu 3000
wmic process where ProcessId=XXXX delete

# 2. Smažte Next.js cache
cd src/app/ui && rm -rf .next

# 3. Znovu spusťte s čerstvou cache
PORT=3000 API_URL=http://localhost:3001 pnpm dev
```

**Kontrola portů:**
```bash
# Zkontrolujte, které porty jsou obsazené
netstat -ano | findstr :3000
netstat -ano | findstr :3001
```

**Sestavení před spuštěním:**
```bash
# Sestavte projekt před spuštěním serverů
npx tsup
```
### Používání CLI

<details>
<summary>Zobrazit CLI příkazy</summary>

```bash
# Interaktivní režim
cipher

# Jednorázový příkaz
cipher "Přidej toto do paměti jako běžné příčiny 'CORS error' v lokálním vývoji s Vite + Express."

# Režim API serveru
cipher --mode api

# Režim MCP serveru
cipher --mode mcp

# Režim webového UI
cipher --mode ui
```

> **Poznámka:** Při spouštění MCP režimu v terminálu/shellu exportujte všechny environment proměnné, protože Cipher nebude číst ze souboru `.env`.
>
> **Tip:** CLI režim automaticky pokračuje nebo vytváří "default" relaci. Použijte `/session new <session-name>` pro spuštění nové relace.

</details>

![Cipher Web UI](./assets/cipher_webUI.png)

_Cipher Web UI poskytuje intuitivní rozhraní pro interakci s AI agenty s pamětí, obsahující správu relací, integraci nástrojů a real-time chatovací schopnosti._

## Konfigurace

Cipher podporuje více možností konfigurace pro různé scénáře nasazení. Hlavní konfigurační soubor se nachází v `memAgent/cipher.yml`.

### Základní konfigurace

<details>
<summary>Zobrazit YAML příklad</summary>

```yaml
# Konfigurace LLM
llm:
  provider: openai # openai, anthropic, openrouter, ollama, qwen
  model: gpt-4-turbo
  apiKey: $OPENAI_API_KEY

# Systémový prompt
systemPrompt: 'Jsi užitečný AI asistent s paměťovými schopnostmi.'

# MCP servery (volitelné)
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
```

</details>

 **Viz [Konfigurační průvodce](./docs/configuration.md)** pro kompletní detaily.

### Environment proměnné

Vytvořte soubor `.env` v root adresáři vašeho projektu s těmito základními proměnnými:

<details>
<summary>Zobrazit .env šablonu</summary>

```bash
# ====================
# API klíče (alespoň jeden je povinný)
# ====================
OPENAI_API_KEY=sk-your-openai-api-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
GEMINI_API_KEY=your-gemini-api-key
QWEN_API_KEY=your-qwen-api-key

# ====================
# Vector Store (volitelné - výchozí in-memory)
# ====================
VECTOR_STORE_TYPE=qdrant  # qdrant, milvus, nebo in-memory
VECTOR_STORE_URL=https://your-cluster.qdrant.io
VECTOR_STORE_API_KEY=your-qdrant-api-key

# ====================
# Historie chatu (volitelné - výchozí SQLite)
# ====================
CIPHER_PG_URL=postgresql://user:pass@localhost:5432/cipher_db

# ====================
# Workspace paměť (volitelné)
# ====================
USE_WORKSPACE_MEMORY=true
WORKSPACE_VECTOR_STORE_COLLECTION=workspace_memory

# ====================
# AWS Bedrock (volitelné)
# ====================
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_DEFAULT_REGION=us-east-1

# ====================
# Pokročilé možnosti (volitelné)
# ====================
# Logování a ladění
CIPHER_LOG_LEVEL=info  # error, warn, info, debug, silly
REDACT_SECRETS=true

# Konfigurace vector store
VECTOR_STORE_DIMENSION=1536
VECTOR_STORE_DISTANCE=Cosine  # Cosine, Euclidean, Dot, Manhattan
VECTOR_STORE_MAX_VECTORS=10000

# Konfigurace vyhledávání v paměti
SEARCH_MEMORY_TYPE=knowledge  # knowledge, reflection, both (výchozí: knowledge)
DISABLE_REFLECTION_MEMORY=true  # výchozí: true
```

> **Tip:** Zkopírujte `.env.example` do `.env` a vyplňte své hodnoty:
>
> ```bash
> cp .env.example .env
> ```

</details>

## Použití MCP serveru

Cipher může fungovat jako MCP (Model Context Protocol) server, umožňující integraci s MCP-kompatibilními klienty jako Claude Desktop, Cursor, Windsurf a další AI kódovací asistenti.

### Instalace přes Smithery

Pro automatickou instalaci cipher pro Claude Desktop přes [Smithery](https://smithery.ai/server/@campfirein/cipher):

```bash
npx -y @smithery/cli install @campfirein/cipher --client claude
```

### Rychlé nastavení

Pro použití Cipher jako MCP server ve vaší MCP klientské konfiguraci:

```json
{
	"mcpServers": {
		"cipher": {
			"type": "stdio",
			"command": "cipher",
			"args": ["--mode", "mcp"],
			"env": {
				"MCP_SERVER_MODE": "aggregator",
				"OPENAI_API_KEY": "your_openai_api_key",
				"ANTHROPIC_API_KEY": "your_anthropic_api_key"
			}
		}
	}
}
```

 **Viz [Průvodce MCP integrace](./docs/mcp-integration.md)** pro kompletní MCP nastavení a pokročilé funkce.

 **Přehled vestavěných nástrojů** - rozbalte dropdown níže pro rychlý náhled. Pro kompletní detaily viz [`docs/builtin-tools.md`](./docs/builtin-tools.md).

<details>
<summary>Vestavěné nástroje (přehled)</summary>

- Paměť
  - `cipher_extract_and_operate_memory`: Extrahuje znalosti a aplikuje ADD/UPDATE/DELETE v jednom kroku
  - `cipher_memory_search`: Sémantické vyhledávání v uložených znalostech
  - `cipher_store_reasoning_memory`: Ukládání vysoce kvalitních stop uvažování
- Uvažování (Reflexe)
  - `cipher_extract_reasoning_steps` (interní): Extrakce strukturovaných kroků uvažování
  - `cipher_evaluate_reasoning` (interní): Hodnocení kvality uvažování a návrhy vylepšení
  - `cipher_search_reasoning_patterns`: Vyhledávání vzorů v paměti reflexe
- Workspace paměť (tým)
  - `cipher_workspace_search`: Vyhledávání v týmové/projektové workspace paměti
  - `cipher_workspace_store`: Zachycování týmových/projektových signálů na pozadí
- Knowledge Graf
  - `cipher_add_node`, `cipher_update_node`, `cipher_delete_node`, `cipher_add_edge`
  - `cipher_search_graph`, `cipher_enhanced_search`, `cipher_get_neighbors`
  - `cipher_extract_entities`, `cipher_query_graph`, `cipher_relationship_manager`
- Systém
  - `cipher_bash`: Spouštění bash příkazů (jednorázové nebo trvalé)

</details>

## Návodné video: Claude Code s Cipher MCP

Sledujte naš komplexní tutoárial o integraci Cipher s Claude Code přes MCP pro vylepšenou pomoc s kódováním s perzistentní pamětí:

[![Cipher + Claude Code Tutořál](https://img.youtube.com/vi/AZh9Py6g07Y/maxresdefault.jpg)](https://www.youtube.com/watch?v=AZh9Py6g07Y)

> **Klikněte na obrázek výše pro sledování tutoriálu na YouTube.**

Pro podrobné instrukce konfigurace viz [průvodce CLI kódovacích agentů](./examples/02-cli-coding-agents/README.md).

## Zabezpečení

Cipher implementuje komplexní bezpečnostní systém pro ochranu všech API endpointů a WebSocket připojení.

### Nové bezpečnostní funkce

**1. Kompletní API validace**
- Middleware pro validaci všech zranitelných endpointů (vector, memory, search, webhook, config, monitoring)
- Sanitizace všech textových vstupů proti XSS útokům
- Validace typu dat, délky a formátu pro všechny parametry
- Automatické zachytávání a logování neplatných požadavků

**2. JWT autentizace pro WebSocket**
- Plný JWT-based autentizační systém pro WebSocket připojení
- Podpora 3 metod autentizace:
  - Query parameter: `ws://localhost:3001?token=JWT_TOKEN`
  - Authorization header: `Authorization: Bearer JWT_TOKEN`
  - WebSocket subprotocol: `Sec-WebSocket-Protocol: cipher-jwt-JWT_TOKEN`
- Nové REST API endpointy pro správu tokenů:
  - `POST /api/auth/websocket/token` - Generování JWT tokenů
  - `POST /api/auth/websocket/verify` - Ověření platnosti tokenů
  - `GET /api/auth/websocket/info` - Informace o autentizačním systému

**3. Oprávnění a role**
- Granulární systém oprávnění: `read`, `write`, `admin`, `monitor`
- Session-based izolace pro různé uživatele/klienty
- Automatické vypršení tokenů s konfigurovatelnou platností

### Používání JWT autentizace

```bash
# 1. Vygenerování JWT tokenu
curl -X POST http://localhost:3001/api/auth/websocket/token \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "userId": "user-123",
    "permissions": ["read", "write"],
    "expiresIn": "24h"
  }'

# 2. Připojení k WebSocket s tokenem
# Metoda 1: Query parameter
wscat -c "ws://localhost:3001?token=YOUR_JWT_TOKEN"

# Metoda 2: Authorization header
wscat -c ws://localhost:3001 -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Metoda 3: Subprotocol
wscat -c ws://localhost:3001 -s "cipher-jwt-YOUR_JWT_TOKEN"
```

### Environment proměnné pro zabezpečení

```bash
# JWT konfigurace (volitelné)
CIPHER_JWT_SECRET=your-secure-secret-key
CIPHER_JWT_EXPIRY=24h
CIPHER_JWT_ISSUER=cipher-websocket
```

**Poznámka:** Pokud není nastaven `CIPHER_JWT_SECRET`, Cipher automaticky vygeneruje bezpečný klíč. Pro produkční použití doporučujeme nastavit vlastní klíč.

## Dokumentace

###  Kompletní dokumentace

| Téma                                                        | Popis                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [API Reference](./docs/api-reference.md)                     | Kompletní REST API dokumentace pro všech 50 endpointů a WebSocket komunikaci |
| [Security Guide](./docs/security.md)                       | Komprehensivní průvodce zabezpečením, JWT autentizace a API validace |
| [Monitoring & Analytics](./docs/monitoring.md)               | Systémové monitorování, výkonnostní analytika, sledování chyb a health dashboardy |
| [Konfigurace](./docs/configuration.md)                     | Kompletní průvodce konfiguraci včetně nastavení agentů, embeddingů a vector stores |
| [LLM Poskytovatelé](./docs/llm-providers.md)                     | Detailní nastavení pro OpenAI, Anthropic, AWS, Azure, Qwen, Ollama, LM Studio         |
| [Konfigurace embeddingů](./docs/embedding-configuration.md) | Poskytovatelé embeddingů, záložní logika a řešení problémů                          |
| [Vector Stores](./docs/vector-stores.md)                     | Qdrant, Milvus, In-Memory konfigurace vektorových databází                          |
| [Historie chatu](./docs/chat-history.md)                       | PostgreSQL, SQLite úložiště relací a správa                                 |
| [CLI Reference](./docs/cli-reference.md)                     | Kompletní dokumentace příkazového řádku                                     |
| [MCP Integrace](./docs/mcp-integration.md)                 | Pokročilé nastavení MCP serveru, aggregator režim a IDE integrace                  |
| [Claude Code Integrace](./docs/claude-code-integration-navod.md) | Kompletní návod na propojení Cipher s Claude Code přes MCP |
| [Workspace paměť](./docs/workspace-memory.md)               | Týmově orientovaný paměťový systém pro kolaborativní vývoj                            |
| [Optimalizace výkonu](./docs/performance-optimization.md) | Pooling připojení, správa paměti a průvodce laděním výkonu              |
| [Příklady](./docs/examples.md)                               | Reálné integrační příklady a případy užití                                     |

###  Další kroky

Pro podrobnou dokumentaci navštivte:

- [Průvodce rychlým startem](https://docs.byterover.dev/cipher/quickstart)
- [Konfigurační průvodce](https://docs.byterover.dev/cipher/configuration)
- [Kompletní dokumentace](https://docs.byterover.dev/cipher/overview)

## Přispěvání

Vítame příspěvky! Viz naš [Průvodce pro přispěvatele](./CONTRIBUTING.md) pro více detailů.

## Komunita a podpora

**cipher** je open-source verze agentické paměti od [byterover](https://byterover.dev/), která je vyvíjena a udržována byterover týmem.

- Připojte se k našemu [Discord](https://discord.com/invite/UMRrpNjh5W) pro sdílení projektů, kladnání otázek nebo jen pozdrav!
- Pokud se vám cipher líbí, prosím dějte nám hvězdičku na GitHub - moc to pomůže!
- Sledujte [@kevinnguyendn](https://x.com/kevinnguyendn) na X

## Přispěvatelé

Děkujeme všem těmto újemným lidem za přispěvání do cipher!

[![Přispěvatelé](https://contrib.rocks/image?repo=campfirein/cipher&max=40&columns=10)](https://github.com/campfirein/cipher/graphs/contributors)

## MseeP.ai bezpečnostní hodnocení

[![MseeP.ai bezpečnostní hodnocení](https://mseep.net/pr/campfirein-cipher-badge.png)](https://mseep.ai/app/campfirein-cipher)

## Historie hvězdiček

<a href="https://star-history.com/#campfirein/cipher&Date">
  <img width="500" alt="Graf historie hvězdiček" src="https://api.star-history.com/svg?repos=campfirein/cipher&type=Date&v=2">
</a>

## Licence

Elastic License 2.0. Viz [LICENCE](LICENSE) pro plné podmínky.


