$env:MCP_SERVER_MODE = "aggregator"
$env:AGGREGATOR_CONFLICT_RESOLUTION = "prefix"
$env:MCP_TRANSPORT_TYPE = "sse"
Set-Location "C:\DEV\cipher-project"
node dist/src/app/index.cjs --mode ui --port 3001 --ui-port 3000 --mcp-transport-type sse
