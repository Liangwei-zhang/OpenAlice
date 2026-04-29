import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname, extname } from 'path'
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
import { resolveMediaPath } from './core/media-store.js'
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

function mediaContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'application/octet-stream'
  }
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OpenAlice Research Lite</title>
  <style>
    :root { color-scheme: light dark; --bg:#f7f7f4; --card:#fff; --fg:#202124; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb; }
    @media (prefers-color-scheme: dark) { :root { --bg:#101114; --card:#181a20; --fg:#f4f4f5; --muted:#a1a1aa; --line:#2a2d35; --accent:#60a5fa; } }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
    main { max-width:1120px; margin:0 auto; padding:28px 18px 60px; }
    h1 { font-size:28px; margin:0 0 8px; }
    h2 { font-size:18px; margin:0 0 14px; }
    .sub { color:var(--muted); margin-bottom:22px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
    .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    button { border:0; background:var(--accent); color:#fff; border-radius:10px; padding:10px 14px; cursor:pointer; font-weight:650; }
    button.secondary { background:transparent; color:var(--fg); border:1px solid var(--line); }
    input, textarea { width:100%; border:1px solid var(--line); border-radius:10px; background:transparent; color:var(--fg); padding:10px 12px; }
    textarea { min-height:88px; resize:vertical; }
    label { display:block; color:var(--muted); font-size:13px; margin:10px 0 6px; }
    code, pre { background:rgba(125,125,125,.12); border-radius:8px; }
    pre { padding:12px; overflow:auto; max-height:440px; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; }
    .chip { border:1px solid var(--line); border-radius:999px; padding:5px 9px; color:var(--muted); font-size:13px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { padding:9px 8px; border-bottom:1px solid var(--line); text-align:left; }
    th { color:var(--muted); font-weight:650; }
    .ok { color:#16a34a; } .bad { color:#dc2626; } .muted { color:var(--muted); }
  </style>
</head>
<body>
<main>
  <h1>OpenAlice Research Lite</h1>
  <div class="sub">AI 股票投研 · 技术分析 · 基本面 · 新闻归档 · 重点股票池短线评分</div>

  <div class="grid">
    <section class="card">
      <h2>运行状态</h2>
      <div id="health" class="muted">加载中...</div>
      <div class="row" style="margin-top:14px"><button class="secondary" onclick="loadHealth()">刷新状态</button><button class="secondary" onclick="loadTools()">查看工具</button></div>
    </section>

    <section class="card">
      <h2>重点股票池</h2>
      <div id="watchlist" class="chips"></div>
    </section>
  </div>

  <section class="card" style="margin-top:16px">
    <h2>一键排名</h2>
    <div class="row">
      <div><label>Top N</label><input id="topN" type="number" value="10" min="1" max="23" style="width:110px"></div>
      <div><label>周期/天</label><input id="horizonDays" type="number" value="5" min="1" max="30" style="width:110px"></div>
      <div style="padding-top:26px"><label><input id="includeBearish" type="checkbox" checked style="width:auto"> 包含弱势榜</label></div>
      <div style="padding-top:24px"><button onclick="rankFocus()">运行重点股票池排名</button></div>
    </div>
    <div id="rankStatus" class="muted" style="margin-top:12px"></div>
    <div id="rankResult" style="margin-top:12px"></div>
  </section>

  <section class="card" style="margin-top:16px">
    <h2>AI 投研聊天</h2>
    <label>问题</label>
    <textarea id="chatMessage">我的重点股票池未来一周谁最强？请给出排名和原因。</textarea>
    <div class="row" style="margin-top:10px"><button onclick="chat()">发送</button><button class="secondary" onclick="document.getElementById('chatResult').textContent=''">清空</button></div>
    <pre id="chatResult"></pre>
  </section>

  <section class="card" style="margin-top:16px">
    <h2>工具/API 输出</h2>
    <pre id="raw"></pre>
  </section>
</main>
<script>
async function api(path, options) {
  const r = await fetch(path, options);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}
function setRaw(x) { document.getElementById('raw').textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2); }
async function loadHealth() {
  const data = await api('/api/health');
  document.getElementById('health').innerHTML = data.ok ? '<span class="ok">● 运行中</span><br>模式：' + data.mode + '<br>工具数：' + data.toolsCount : '<span class="bad">异常</span>';
  setRaw(data);
}
async function loadTools() { setRaw(await api('/api/tools')); }
async function loadWatchlist() {
  const data = await api('/api/watchlist/focus');
  document.getElementById('watchlist').innerHTML = data.symbols.map(s => '<span class="chip">' + s + '</span>').join('');
}
function renderTable(items) {
  if (!items || items.length === 0) return '<div class="muted">无结果</div>';
  return '<table><thead><tr><th>#</th><th>代码</th><th>评分</th><th>方向</th><th>信心</th><th>预期%</th><th>RSI</th><th>5日%</th><th>20日%</th></tr></thead><tbody>' +
    items.map((x, i) => '<tr><td>' + (i+1) + '</td><td><b>' + x.symbol + '</b></td><td>' + x.score + '</td><td>' + x.direction + '</td><td>' + x.confidence + '</td><td>' + x.expectedMovePct + '</td><td>' + (x.factors?.rsi14 ?? '') + '</td><td>' + (x.factors?.ret5d ?? '') + '</td><td>' + (x.factors?.ret20d ?? '') + '</td></tr>').join('') +
    '</tbody></table>';
}
async function rankFocus() {
  const input = {
    topN: Number(document.getElementById('topN').value || 10),
    horizonDays: Number(document.getElementById('horizonDays').value || 5),
    includeBearish: document.getElementById('includeBearish').checked
  };
  document.getElementById('rankStatus').textContent = '运行中，正在拉取行情并评分...';
  const data = await api('/api/watchlist/focus/rank', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(input) });
  setRaw(data);
  const result = data.result || data;
  document.getElementById('rankStatus').textContent = '完成：成功评分 ' + (result.scoredCount ?? 0) + ' / ' + (result.universeSize ?? 0);
  document.getElementById('rankResult').innerHTML = '<h3>强势候选</h3>' + renderTable(result.bullish) + (result.bearish ? '<h3>弱势/风险候选</h3>' + renderTable(result.bearish) : '');
}
async function chat() {
  const message = document.getElementById('chatMessage').value;
  document.getElementById('chatResult').textContent = '生成中...';
  const data = await api('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message, sessionId:'dashboard' }) });
  document.getElementById('chatResult').textContent = data.text || JSON.stringify(data, null, 2);
  setRaw(data);
}
loadHealth(); loadWatchlist();
</script>
</body>
</html>`
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
    if (!content) return [
      persona,
      '',
      '## Runtime mode',
      'You are running in Research Lite mode. You can research equities, calculate indicators, read news archives, and rank the focus watchlist. You cannot place trades or modify broker accounts.',
    ].join('\n')
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

  app.get('/', (c) => c.html(dashboardHtml()))

  app.get('/api/health', (c) => c.json({
    ok: true,
    mode: 'research-lite',
    toolsCount: toolCenter.list().length,
    watchlistName: FOCUS_EQUITY_WATCHLIST_NAME,
    watchlistSize: FOCUS_EQUITY_WATCHLIST.length,
    newsEnabled: config.news.enabled,
    marketDataBackend: config.marketData.backend,
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

  app.get('/api/media/*', async (c) => {
    const name = c.req.path.replace(/^\/api\/media\//, '')
    if (!name || name.includes('..')) return c.text('Invalid media path', 400)
    try {
      const abs = resolveMediaPath(name)
      const bytes = await readFile(abs)
      return c.body(bytes, 200, { 'Content-Type': mediaContentType(abs), 'Cache-Control': 'public, max-age=31536000, immutable' })
    } catch {
      return c.text('Not found', 404)
    }
  })

  const port = Number(process.env.RESEARCH_PORT ?? 3010)
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`research-lite: dashboard http://localhost:${info.port}`)
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
