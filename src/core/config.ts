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
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-opus-4-7'),
})

export const profileSchema = z.discriminatedUnion('backend', [
  agentSdkProfileSchema,
  codexProfileSchema,
  vercelProfileSchema,
])

export type Profile = z.infer<typeof profileSchema>

export const aiProviderSchema = z.object({
  profiles: z.record(
    z.string(),
    profileSchema,
  ).default({
    default: { backend: 'agent-sdk', model: 'claude-opus-4-7', loginMethod: 'claudeai' },
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

async function parseAndSeed<T>(filename: string, schema: z.ZodType<T>, raw: unknown | undefined): Promise<T> {
  const parsed = schema.parse(raw ?? {})
  if (raw === undefined) {
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, filename), JSON.stringify(parsed, null, 2) + '\n')
  }
  return parsed
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

  return {
    agent:      await parseAndSeed(files[0], agentSchema, raws[0]),
    marketData: await parseAndSeed(files[1], marketDataSchema, raws[1]),
    compaction: await parseAndSeed(files[2], compactionSchema, raws[2]),
    aiProvider: await parseAndSeed(files[3], aiProviderSchema, raws[3]),
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
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), 'utf-8'))
    return aiProviderSchema.parse(raw)
  } catch {
    return aiProviderSchema.parse({})
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
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(updated, null, 2) + '\n')
}

export async function writeProfile(slug: string, profile: Profile): Promise<void> {
  const config = await readAIProviderConfig()
  config.profiles[slug] = profile
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
}

export async function deleteProfile(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  if (config.activeProfile === slug) throw new Error('Cannot delete the active profile')
  delete config.profiles[slug]
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
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
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, sectionFiles[section]), JSON.stringify(validated, null, 2) + '\n')
  return validated
}

export async function readWebSubchannels(): Promise<WebChannel[]> {
  const raw = await loadJsonFile('web-subchannels.json')
  return webSubchannelsSchema.parse(raw ?? [])
}

export async function writeWebSubchannels(channels: WebChannel[]): Promise<void> {
  const validated = webSubchannelsSchema.parse(channels)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'web-subchannels.json'), JSON.stringify(validated, null, 2) + '\n')
}
