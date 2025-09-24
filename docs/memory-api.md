# Memory REST API

Tato kapitola popisuje REST rozhraní pro práci s pamětí v Ciphru. Všechny koncové body jsou dostupné na API portu (výchozí http://localhost:3001/api).

## POST /memory/store
Uloží jeden fragment znalosti a předá ho internímu nástroji cipher_extract_and_operate_memory.

### Tělo požadavku
`json
{
  "content": "text znalosti, který má být uložen",
  "type": "knowledge",
  "sessionId": "session-123",
  "metadata": {
    "topic": "api-test"
  },
  "options": {
    "similarityThreshold": 0.7,
    "maxSimilarResults": 5,
    "useLLMDecisions": true
  },
  "knowledgeInfo": {
    "domain": "backend",
    "codePattern": "api_call_handling"
  }
}
`

| Pole | Typ | Povinné | Popis |
|------|-----|---------|-------|
| content | string | ano | Surový text interakce, který se předá nástroji jako interaction. |
| 	ype | string | ne (výchozí knowledge) | Typ znalosti – propisuje se do memoryMetadata.memoryType. |
| sessionId | string | ne | Pokud existuje, naplní také memoryMetadata.sourceSessionId a předá se v kontextu nástroje. |
| metadata | object | ne | Vlastní metadata, která se doplní do memoryMetadata (např. 	opic, projectId, source). | 
| options | object | ne | Volby, které se mapují do rgs.options nástroje (thresholdy, chování LLM atd.). |
| knowledgeInfo | object | ne | Explicitní informace o znalosti; přepíše hodnoty, které by jinak byly odvozeny extrakcí. |

Hodnoty metadata, options a knowledgeInfo musí být obyčejné objekty (žádná pole). Server doplní chybějící metadata.source (pi) a volitelně metadata.memoryType podle pole 	ype.

### Příklad odpovědi
`json
{
  "success": true,
  "data": {
    "stored": true,
    "content": "API store test: ...",
    "result": {
      "success": true,
      "extraction": { "extracted": 1, ... },
      "memory": [ { "id": 1758723831000, "event": "ADD", ... } ]
    }
  }
}
`

## Další koncové body
- POST /memory/search – semantické vyhledávání ve znalostech. Požadavek { "query": "dotaz", "limit": 5 }.
- POST /memory/reasoning / POST /memory/reasoning/search – vyžadují povolenou reflexní paměť (standardně vypnutá).
- GET /memory – souhrn stavu vektorového úložiště, dostupných nástrojů a stavu embeddingů.

Podrobnosti o interních nástrojích najdete v [docs/builtin-tools.md](./builtin-tools.md).
