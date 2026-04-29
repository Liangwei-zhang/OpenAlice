import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { newsCollectorSchema } from '../domain/news/config.js'

const CONFIG_DIR = resolve('data/config')

// ==================== AI Provider ====================

export type AIBackend = 'agent-sdk' | 'codex' | 'vercel-ai-sdk'

const baseProfileFields = {
  preset: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
}

export const agentSdkProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('agent-sdk'),
  model: z.string().default('claude-opus-4-7'),
  loginMethod: z.enum(['api-key', 'claudeai']).default('api-key'),
})

export const codexProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('codex'),
  model: z.string().default('gpt-5.4'),
  loginMethod: z.enum(['api-key', 'codex-oauth']).default('codex-oauth'),
})

export const vercelProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('vercel-ai-sdk'),
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o-mini'),
})

export const profileSchema = z.discriminatedUnion('backend', [
  agentSdkProfileSchema,
  codexProfileSchema,
  vercelProfileSchema,
])

export type Profile = z.infer<typeof profileSchema>

const defaultOpenAICompatibleProfile = {
  backend: 'vercel-ai-sdk' as const,
  provider: 'openai',
  model: process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || 'gpt-4o-mini',
  baseUrl: process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || undefined,
}

export const aiProviderSchema = z.object({
  profiles: z.record(
    z.string(),
    profileSchema,
  ).default({
    default: defaultOpenAICompatibleProfile,
  }),
  activeProfile: z.string().default('default'),
})

export type AIProviderConfig = z.infer<typeof aiProviderSchema>

// ==================== Agent / Runtime ====================

const agentSchema = z.object({
  maxSteps: z.number().int().positive().default(20),
  evolutionMode: z.boolean().default(false),
  claudeCode: z.object({
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).default([
      'Task', 'TaskOutput',
      'AskUserQuestion', 'TodoWrite',
      'NotebookEdit', 'Skill',
      'EnterPlanMode', 'ExitPlanMode',
      'mcp__claude_ai_Figma__*',
    ]),
    maxTurns: z.number().int().positive().default(20),
  }).default({
    disallowedTools: [
      'Task', 'TaskOutput',
      'AskUserQuestion', 'TodoWrite',
      'NotebookEdit', 'Skill',
      'EnterPlanMode', 'ExitPlanMode',
      'mcp__claude_ai_Figma__*',
    ],
    maxTurns: 20,
  }),
})

const marketDataSchema = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().default('http://localhost:6900'),
  providers: z.object({
    equity: z.string().default('yfinance'),
    crypto: z.string().default('yfinance'),
    currency: z.string().default('yfinance'),
    commodity: z.string().default('yfinance'),
  }).default({
    equity: 'yfinance',
    crypto: 'yfinance',
    currency: 'yfinance',
    commodity: 'yfinance',
  }),
  providerKeys: z.object({
    fred: z.string().optional(),
    fmp: z.string().optional(),
    eia: z.string().optional(),
    bls: z.string().optional(),
    nasdaq: z.string().optional(),
    tradingeconomics: z.string().optional(),
    econdb: z.string().optional(),
    intrinio: z.string().optional(),
    benzinga: z.string().optional(),
    tiingo: z.string().optional(),
    biztoc: z.string().optional(),
  }).default({}),
  backend: z.enum(['typebb-sdk', 'openbb-api']).default('typebb-sdk'),
})

const compactionSchema = z.object({
  maxContextTokens: z.number().default(200_000),
  maxOutputTokens: z.number().default(20_000),
  autoCompactBuffer: z.number().default(13_000),
  microcompactKeepRecent: z.number().default(3),
})

export const toolsSchema = z.object({
  disabled: z.array(z.string()).default([]),
})

// ==================== Optional Web Chat Channels ====================

export const webSubchannelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-_]+$/, 'id must be lowercase alphanumeric with hyphens/underscores'),
  label: z.string().min(1),
  systemPrompt: z.string().optional(),
  profile: z.string().optional(),
  disabledTools: z.array(z.string()).optional(),
})

export const webSubchannelsSchema = z.array(webSubchannelSchema)
export type WebChannel = z.infer<typeof webSubchannelSchema>

// ==================== Unified Config Type ====================

export type Config = {
  agent: z.infer<typeof agentSchema>
  marketData: z.infer<typeof marketDataSchema>
  compaction: z.infer<typeof compactionSchema>
  aiProvider: z.infer<typeof aiProviderSchema>
  news: z.infer<typeof newsCollectorSchema>
  tools: z.infer<typeof toolsSchema>
}

// ==================== Loader Helpers ====================

async function loadJsonFile(filename: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(resolve(CONFIG_DIR, filename), 'utf-8'))
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

async function writeJsonFile(filename: string, data: unknown): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, filename), JSON.stringify(data, null, 2) + '\n')
}

async function parseAndSeed<T>(filename: string, schema: z.ZodType<T>, raw: unknown | undefined): Promise<T> {
  const parsed = schema.parse(raw ?? {})
  if (raw === undefined) await writeJsonFile(filename, parsed)
  return parsed
}

function withEnvApiKey(config: AIProviderConfig): AIProviderConfig {
  const updated: AIProviderConfig = JSON.parse(JSON.stringify(config))
  for (const profile of Object.values(updated.profiles)) {
    if (profile.backend !== 'vercel-ai-sdk') continue
    if (!profile.apiKey) {
      if (profile.provider === 'openai') profile.apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY
      if (profile.provider === 'anthropic') profile.apiKey = process.env.ANTHROPIC_API_KEY
      if (profile.provider === 'google') profile.apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
    }
    if (!profile.baseUrl && profile.provider === 'openai') {
      profile.baseUrl = process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL
    }
  }
  return updated
}

function migrateAgentSdkDefault(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const config = raw as { profiles?: Record<string, unknown>; activeProfile?: string }
  const active = config.activeProfile ?? 'default'
  const profile = config.profiles?.[active] as { backend?: string } | undefined
  if (profile?.backend !== 'agent-sdk') return raw

  // Research Lite should not default to the local Claude Code process. Keep the
  // legacy profile for manual use, but switch active chat to OpenAI-compatible API.
  return {
    ...config,
    profiles: {
      ...config.profiles,
      legacy_agent_sdk: profile,
      default: defaultOpenAICompatibleProfile,
    },
    activeProfile: 'default',
  }
}

export async function loadConfig(): Promise<Config> {
  const files = [
    'agent.json',
    'market-data.json',
    'compaction.json',
    'ai-provider-manager.json',
    'news.json',
    'tools.json',
  ] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))
  raws[3] = migrateAgentSdkDefault(raws[3])

  const aiProvider = withEnvApiKey(await parseAndSeed(files[3], aiProviderSchema, raws[3]))
  if (raws[3] !== undefined) await writeJsonFile(files[3], aiProvider)

  return {
    agent:      await parseAndSeed(files[0], agentSchema, raws[0]),
    marketData: await parseAndSeed(files[1], marketDataSchema, raws[1]),
    compaction: await parseAndSeed(files[2], compactionSchema, raws[2]),
    aiProvider,
    news:       await parseAndSeed(files[4], newsCollectorSchema, raws[4]),
    tools:      await parseAndSeed(files[5], toolsSchema, raws[5]),
  }
}

// ==================== Hot-read helpers ====================

export async function readAgentConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'agent.json'), 'utf-8'))
    return agentSchema.parse(raw)
  } catch {
    return agentSchema.parse({})
  }
}

export async function readAIProviderConfig() {
  try {
    const raw = migrateAgentSdkDefault(JSON.parse(await readFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), 'utf-8')))
    return withEnvApiKey(aiProviderSchema.parse(raw))
  } catch {
    return withEnvApiKey(aiProviderSchema.parse({}))
  }
}

export async function readMarketDataConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'market-data.json'), 'utf-8'))
    return marketDataSchema.parse(raw)
  } catch {
    return marketDataSchema.parse({})
  }
}

export async function readToolsConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'tools.json'), 'utf-8'))
    return toolsSchema.parse(raw)
  } catch {
    return toolsSchema.parse({})
  }
}

// ==================== Profile Helpers ====================

export interface ResolvedProfile {
  backend: AIBackend
  model: string
  preset?: string
  apiKey?: string
  baseUrl?: string
  loginMethod?: string
  provider?: string
}

export async function resolveProfile(slug?: string): Promise<ResolvedProfile> {
  const config = await readAIProviderConfig()
  const key = slug ?? config.activeProfile
  const profile = config.profiles[key]
  if (!profile) throw new Error(`Unknown AI provider profile: "${key}"`)
  return { ...profile }
}

export async function getActiveProfileSlug(): Promise<string> {
  const config = await readAIProviderConfig()
  return config.activeProfile
}

export async function setActiveProfile(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  if (!config.profiles[slug]) throw new Error(`Unknown profile: "${slug}"`)
  const updated = { ...config, activeProfile: slug }
  await writeJsonFile('ai-provider-manager.json', updated)
}

export async function writeProfile(slug: string, profile: Profile): Promise<void> {
  const config = await readAIProviderConfig()
  config.profiles[slug] = profile
  await writeJsonFile('ai-provider-manager.json', config)
}

export async function deleteProfile(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  if (config.activeProfile === slug) throw new Error('Cannot delete the active profile')
  delete config.profiles[slug]
  await writeJsonFile('ai-provider-manager.json', config)
}

// ==================== Config Writer ====================

export type ConfigSection = keyof Config

const sectionSchemas: Record<ConfigSection, z.ZodTypeAny> = {
  agent: agentSchema,
  marketData: marketDataSchema,
  compaction: compactionSchema,
  aiProvider: aiProviderSchema,
  news: newsCollectorSchema,
  tools: toolsSchema,
}

const sectionFiles: Record<ConfigSection, string> = {
  agent: 'agent.json',
  marketData: 'market-data.json',
  compaction: 'compaction.json',
  aiProvider: 'ai-provider-manager.json',
  news: 'news.json',
  tools: 'tools.json',
}

export const validSections = Object.keys(sectionSchemas) as ConfigSection[]

export async function writeConfigSection(section: ConfigSection, data: unknown): Promise<unknown> {
  const schema = sectionSchemas[section]
  const validated = schema.parse(data)
  await writeJsonFile(sectionFiles[section], validated)
  return validated
}

export async function readWebSubchannels(): Promise<WebChannel[]> {
  const raw = await loadJsonFile('web-subchannels.json')
  return webSubchannelsSchema.parse(raw ?? [])
}

export async function writeWebSubchannels(channels: WebChannel[]): Promise<void> {
  const validated = webSubchannelsSchema.parse(channels)
  await writeJsonFile('web-subchannels.json', validated)
}
