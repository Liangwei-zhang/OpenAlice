import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { loadConfig } from './core/config.js'
import type { BrainExportState } from './domain/brain/index.js'
import { Brain } from './domain/brain/index.js'
import { ToolCenter } from './core/tool-center.js'
import { AgentCenter } from './core/agent-center.js'
import { GenerateRouter } from './core/ai-provider-manager.js'
import { SessionStore } from './core/session.js'
import { VercelAIProvider } from './ai-providers/vercel-ai-sdk/vercel-provider.js'
import { AgentSdkProvider } from './ai-providers/agent-sdk/agent-sdk-provider.js'
import { CodexProvider } from './ai-providers/codex/index.js'
import { SymbolIndex } from './domain/market-data/equity/index.js'
import { CommodityCatalog } from './domain/market-data/commodity/index.js'
import { buildSDKCredentials } from './domain/market-data/credential-map.js'
import {
  getSDKExecutor,
  buildRouteMap,
  SDKEquityClient,
  SDKCryptoClient,
  SDKCurrencyClient,
  SDKCommodityClient,
} from './domain/market-data/client/typebb/index.js'
import { OpenBBEquityClient } from './domain/market-data/client/openbb-api/equity-client.js'
import { OpenBBCryptoClient } from './domain/market-data/client/openbb-api/crypto-client.js'
import { OpenBBCurrencyClient } from './domain/market-data/client/openbb-api/currency-client.js'
import { OpenBBCommodityClient } from './domain/market-data/client/openbb-api/commodity-client.js'
import type {
  EquityClientLike,
  CryptoClientLike,
  CurrencyClientLike,
  CommodityClientLike,
} from './domain/market-data/client/types.js'
import { createThinkingTools } from './tool/thinking.js'
import { createBrainTools } from './tool/brain.js'
import { createMarketSearchTools } from './tool/market.js'
import { createEquityTools } from './tool/equity.js'
import { createAnalysisTools } from './tool/analysis.js'
import { createNewsArchiveTools } from './tool/news.js'
import { NewsCollectorStore, NewsCollector } from './domain/news/index.js'
import { FOCUS_EQUITY_WATCHLIST, FOCUS_EQUITY_WATCHLIST_NAME } from './domain/analysis/focus-watchlist.js'

const BRAIN_FILE = resolve('data/brain/commit.json')
const FRONTAL_LOBE_FILE = resolve('data/brain/frontal-lobe.md')
const PERSONA_FILE = resolve('data/brain/persona.md')
const PERSONA_DEFAULT = resolve('default/persona.default.md')

async function readWithDefault(target: string, defaultFile: string): Promise<string> {
  try { return await readFile(target, 'utf-8') } catch { /* not found — copy default */ }
  try {
    const content = await readFile(defaultFile, 'utf-8')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    return content
  } catch { return '' }
}

function formatRelativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

async function executeTool(toolCenter: ToolCenter, name: string, input: unknown): Promise<unknown> {
  const selected = toolCenter.get(name)
  if (!selected) throw new Error(`Unknown tool: ${name}`)
  const exec = (selected as { execute?: (input: unknown, options?: unknown) => Promise<unknown> | unknown }).execute
  if (!exec) throw new Error(`Tool ${name} is not directly executable`)
  return await exec(input, { toolCallId: `research-${Date.now()}`, messages: [] })
}

async function main() {
  const config = await loadConfig()

  // ==================== Brain / Persona ====================

  await readWithDefault(PERSONA_FILE, PERSONA_DEFAULT)
  const brainExport = await readFile(BRAIN_FILE, 'utf-8')
    .then((r) => JSON.parse(r) as BrainExportState)
    .catch(() => undefined)

  const brainDir = resolve('data/brain')
  const brainOnCommit = async (state: BrainExportState) => {
    await mkdir(brainDir, { recursive: true })
    await writeFile(BRAIN_FILE, JSON.stringify(state, null, 2))
    await writeFile(FRONTAL_LOBE_FILE, state.state.frontalLobe)
  }

  const brain = brainExport
    ? Brain.restore(brainExport, { onCommit: brainOnCommit })
    : new Brain({ onCommit: brainOnCommit })

  const getInstructions = async () => {
    const persona = await readFile(PERSONA_FILE, 'utf-8').catch(() => '')
    const { content, updatedAt } = brain.getFrontalLobeMeta()
    if (!content) return persona
    const age = updatedAt ? formatRelativeAge(updatedAt) : 'at some point'
    return [
      persona,
      '---',
      '## Notes you wrote to yourself',
      `_(written ${age})_`,
      '',
      content,
      '',
      '## Runtime mode',
      'You are running in Research Lite mode. You can research equities, calculate indicators, read news archives, and rank the focus watchlist. You cannot place trades or modify broker accounts.',
    ].join('\n')
  }

  // ==================== Market Data Clients ====================

  const { providers } = config.marketData
  let equityClient: EquityClientLike
  let cryptoClient: CryptoClientLike
  let currencyClient: CurrencyClientLike
  let commodityClient: CommodityClientLike

  if (config.marketData.backend === 'openbb-api') {
    const url = config.marketData.apiUrl
    const keys = config.marketData.providerKeys
    equityClient = new OpenBBEquityClient(url, providers.equity, keys)
    cryptoClient = new OpenBBCryptoClient(url, providers.crypto, keys)
    currencyClient = new OpenBBCurrencyClient(url, providers.currency, keys)
    commodityClient = new OpenBBCommodityClient(url, providers.commodity, keys)
  } else {
    const executor = getSDKExecutor()
    const routeMap = buildRouteMap()
    const credentials = buildSDKCredentials(config.marketData.providerKeys)
    equityClient = new SDKEquityClient(executor, 'equity', providers.equity, credentials, routeMap)
    cryptoClient = new SDKCryptoClient(executor, 'crypto', providers.crypto, credentials, routeMap)
    currencyClient = new SDKCurrencyClient(executor, 'currency', providers.currency, credentials, routeMap)
    commodityClient = new SDKCommodityClient(executor, 'commodity', providers.commodity, credentials, routeMap)
  }

  const symbolIndex = new SymbolIndex()
  await symbolIndex.load(equityClient)

  const commodityCatalog = new CommodityCatalog()
  commodityCatalog.load()

  const newsStore = new NewsCollectorStore({
    maxInMemory: config.news.maxInMemory,
    retentionDays: config.news.retentionDays,
  })
  await newsStore.init()

  let newsCollector: NewsCollector | null = null
  if (config.news.enabled && config.news.feeds.length > 0) {
    newsCollector = new NewsCollector({
      store: newsStore,
      feeds: config.news.feeds,
      intervalMs: config.news.intervalMinutes * 60 * 1000,
    })
    newsCollector.start()
  }

  // ==================== Research Tool Registry ====================

  const toolCenter = new ToolCenter()
  toolCenter.register(createThinkingTools(), 'thinking')
  toolCenter.register(createBrainTools(brain), 'brain')
  toolCenter.register(createMarketSearchTools({ symbolIndex, cryptoClient, currencyClient, commodityCatalog }), 'market-search')
  toolCenter.register(createEquityTools(equityClient), 'equity')
  toolCenter.register(createAnalysisTools(equityClient, cryptoClient, currencyClient, commodityClient), 'analysis')
  if (config.news.enabled) toolCenter.register(createNewsArchiveTools(newsStore), 'news')

  // ==================== AI Agent ====================

  const vercelProvider = new VercelAIProvider(
    () => toolCenter.getVercelTools(),
    getInstructions,
    config.agent.maxSteps,
  )
  const agentSdkProvider = new AgentSdkProvider(
    () => toolCenter.getVercelTools(),
    getInstructions,
  )
  const codexProvider = new CodexProvider(
    () => toolCenter.getVercelTools(),
    getInstructions,
  )
  const router = new GenerateRouter(vercelProvider, agentSdkProvider, codexProvider)
  const agentCenter = new AgentCenter({ router, compaction: config.compaction })

  // ==================== Minimal Research API ====================

  const app = new Hono()
  app.use('/api/*', cors())

  app.get('/api/health', (c) => c.json({
    ok: true,
    mode: 'research-lite',
    disabled: ['trading', 'brokers', 'guards', 'snapshots', 'cron', 'heartbeat', 'telegram', 'mcp'],
  }))

  app.get('/api/tools', (c) => c.json({ tools: toolCenter.getInventory() }))

  app.post('/api/tools/:name/execute', async (c) => {
    try {
      const name = c.req.param('name')
      const input = await c.req.json().catch(() => ({}))
      const result = await executeTool(toolCenter, name, input)
      return c.json({ result })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.get('/api/watchlist/focus', (c) => c.json({
    name: FOCUS_EQUITY_WATCHLIST_NAME,
    symbols: FOCUS_EQUITY_WATCHLIST,
  }))

  app.post('/api/watchlist/focus/rank', async (c) => {
    try {
      const input = await c.req.json().catch(() => ({}))
      const result = await executeTool(toolCenter, 'rankFocusWatchlist', input)
      return c.json({ result })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/api/chat', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as { message?: string; sessionId?: string; profileSlug?: string }
      if (!body.message) return c.json({ error: 'Body must include message' }, 400)
      const sessionId = body.sessionId?.replace(/[^a-zA-Z0-9-_]/g, '') || 'default'
      const session = new SessionStore(`research/${sessionId}`)
      await session.restore()
      const result = await agentCenter.askWithSession(body.message, session, { profileSlug: body.profileSlug })
      return c.json({ text: result.text, mediaUrls: result.mediaUrls ?? [] })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  const port = Number(process.env.RESEARCH_PORT ?? 3010)
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`research-lite: listening on http://localhost:${info.port}`)
    console.log(`research-lite: ${toolCenter.list().length} tools registered`)
  })

  const shutdown = async () => {
    newsCollector?.stop()
    await newsStore.close()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
