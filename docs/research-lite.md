# Research Lite Mode

Research Lite is the default runtime for this fork. It keeps the equity research workflow and disables the trading stack.

## What it keeps

- AI Agent chat and tool calling
- US equity market data
- Technical indicators: RSI, MACD, moving averages, Bollinger Bands, ATR, and formula-based calculations
- Fundamental research: company profile, financial statements, ratios, earnings calendar, insider trading, and market movers
- News archive tools when RSS collection is enabled
- Focus-watchlist short-term scoring and ranking

## Focus watchlist

The built-in focus watchlist is defined in:

```text
src/domain/analysis/focus-watchlist.ts
```

Current symbols:

```text
SNOW, MSTR, IBM, SPOT, SHOP, HOOD, QCOM, ARM, PLTR, RKLB, INTC,
AVGO, META, AMD, MU, TSM, NVDA, ORCL, TSLA, AMZN, GOOGL, MSFT, AAPL
```

## What it disables

Research Lite does not initialize or expose:

- Broker accounts
- CCXT, Alpaca, or IBKR trading
- Trading-as-Git stage / commit / push execution
- Trading guards
- Account snapshots
- Cron jobs
- Heartbeat automation
- Telegram connector
- MCP server

## Run

Development:

```bash
pnpm dev
```

or explicitly:

```bash
pnpm dev:research
```

Production build:

```bash
pnpm build
pnpm start
```

or explicitly:

```bash
pnpm build:research
pnpm start:research
```

Default port:

```text
http://localhost:3010
```

Override the port:

```bash
RESEARCH_PORT=3020 pnpm dev:research
```

## API

Health check:

```http
GET /api/health
```

List tools:

```http
GET /api/tools
```

Execute a tool:

```http
POST /api/tools/:name/execute
```

Rank the focus watchlist:

```http
POST /api/watchlist/focus/rank
Content-Type: application/json

{
  "topN": 10,
  "includeBearish": true,
  "horizonDays": 5
}
```

Chat:

```http
POST /api/chat
Content-Type: application/json

{
  "message": "Rank my focus watchlist for the next week.",
  "sessionId": "default"
}
```

## Full trading runtime

The original full trading runtime is still available for reference and rollback:

```bash
pnpm dev:full
pnpm build:full
pnpm start:full
```

Do not use the full runtime unless you intentionally want broker/trading functionality.
