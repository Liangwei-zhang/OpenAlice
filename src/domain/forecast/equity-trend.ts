/**
 * Equity Trend Forecast
 *
 * Lightweight, explainable short-horizon forecasting for equities.
 * This is NOT a trained ML model. It combines price trend, momentum,
 * mean-reversion, volatility, and data-quality signals into a bounded score.
 *
 * Intended use: research ranking / AI context, not automatic execution.
 */

import type { EquityClientLike } from '@/domain/market-data/client/types'

export type ForecastDirection = 'bullish' | 'bearish' | 'neutral'

export interface ForecastInput {
  symbol: string
  /** Trading-day horizon to describe, e.g. 5 for one week. */
  horizonDays?: number
  /** Calendar days of history to request. */
  lookbackDays?: number
  /** Market-data interval. Currently optimized for 1d. */
  interval?: string
}

export interface ForecastOutput {
  symbol: string
  horizonDays: number
  direction: ForecastDirection
  score: number
  confidence: number
  latestClose: number
  expectedMovePct: number
  riskLevel: 'low' | 'medium' | 'high'
  indicators: {
    close: number
    sma20?: number
    sma50?: number
    sma200?: number
    rsi14?: number
    momentum5dPct?: number
    momentum20dPct?: number
    momentum60dPct?: number
    volatility20dPct?: number
    atr14Pct?: number
  }
  reasons: string[]
  warnings: string[]
  dataRange: {
    from: string
    to: string
    bars: number
  }
  disclaimer: string
}

interface Bar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

const DEFAULT_HORIZON_DAYS = 5
const DEFAULT_LOOKBACK_DAYS = 420
const DISCLAIMER = 'Heuristic research forecast only; not investment advice and not a trained price-prediction model.'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits))
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDateString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return null
}

function normalizeBars(raw: Array<Record<string, unknown>>): Bar[] {
  const bars: Bar[] = []
  for (const row of raw) {
    const date = toDateString(row.date ?? row.timestamp)
    const open = toNumber(row.open)
    const high = toNumber(row.high)
    const low = toNumber(row.low)
    const close = toNumber(row.close)
    const volume = toNumber(row.volume)
    if (!date || open == null || high == null || low == null || close == null) continue
    bars.push({ date, open, high, low, close, ...(volume != null ? { volume } : {}) })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars
}

function sma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined
  const slice = values.slice(-period)
  return slice.reduce((sum, value) => sum + value, 0) / period
}

function pctChange(values: number[], period: number): number | undefined {
  if (values.length <= period) return undefined
  const prev = values[values.length - 1 - period]
  const last = values[values.length - 1]
  if (!prev) return undefined
  return ((last - prev) / prev) * 100
}

function rsi(values: number[], period = 14): number | undefined {
  if (values.length < period + 1) return undefined
  const changes: number[] = []
  for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1])

  const gains = changes.map((change) => (change > 0 ? change : 0))
  const losses = changes.map((change) => (change < 0 ? -change : 0))
  let avgGain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  let avgLoss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function logReturns(values: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) returns.push(Math.log(values[i] / values[i - 1]))
  }
  return returns
}

function stdev(values: number[]): number | undefined {
  if (values.length < 2) return undefined
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function volatility20dPct(values: number[]): number | undefined {
  const returns = logReturns(values).slice(-20)
  const sd = stdev(returns)
  if (sd == null) return undefined
  return sd * Math.sqrt(252) * 100
}

function atrPct(bars: Bar[], period = 14): number | undefined {
  if (bars.length < period + 1) return undefined
  const trueRanges: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const current = bars[i]
    const prev = bars[i - 1]
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    ))
  }
  const recent = trueRanges.slice(-period)
  const atr = recent.reduce((sum, value) => sum + value, 0) / period
  const close = bars[bars.length - 1].close
  return close > 0 ? (atr / close) * 100 : undefined
}

function scoreTrend(close: number, sma20?: number, sma50?: number, sma200?: number): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  if (sma20 != null) {
    const above = close > sma20
    score += above ? 0.16 : -0.16
    reasons.push(`${above ? 'above' : 'below'} 20-day SMA`)
  }
  if (sma50 != null) {
    const above = close > sma50
    score += above ? 0.18 : -0.18
    reasons.push(`${above ? 'above' : 'below'} 50-day SMA`)
  }
  if (sma200 != null) {
    const above = close > sma200
    score += above ? 0.12 : -0.12
    reasons.push(`${above ? 'above' : 'below'} 200-day SMA`)
  }
  if (sma20 != null && sma50 != null) {
    const aligned = sma20 > sma50
    score += aligned ? 0.1 : -0.1
    reasons.push(`${aligned ? 'positive' : 'negative'} short/medium trend alignment`)
  }
  return { score, reasons }
}

function scoreMomentum(momentum5?: number, momentum20?: number, momentum60?: number): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const components: Array<[string, number | undefined, number]> = [
    ['5d', momentum5, 0.12],
    ['20d', momentum20, 0.2],
    ['60d', momentum60, 0.12],
  ]
  for (const [label, momentum, weight] of components) {
    if (momentum == null) continue
    const normalized = clamp(momentum / 10, -1, 1)
    score += normalized * weight
    reasons.push(`${label} momentum ${momentum >= 0 ? '+' : ''}${round(momentum, 2)}%`)
  }
  return { score, reasons }
}

function scoreMeanReversion(rsi14?: number): { score: number; reasons: string[] } {
  if (rsi14 == null) return { score: 0, reasons: [] }
  if (rsi14 < 30) return { score: 0.12, reasons: [`RSI14 oversold at ${round(rsi14, 1)}`] }
  if (rsi14 > 75) return { score: -0.12, reasons: [`RSI14 very overbought at ${round(rsi14, 1)}`] }
  if (rsi14 > 65) return { score: -0.05, reasons: [`RSI14 elevated at ${round(rsi14, 1)}`] }
  if (rsi14 > 45 && rsi14 < 60) return { score: 0.04, reasons: [`RSI14 constructive at ${round(rsi14, 1)}`] }
  return { score: 0, reasons: [`RSI14 neutral at ${round(rsi14, 1)}`] }
}

function riskLevel(vol20?: number, atr14?: number): 'low' | 'medium' | 'high' {
  const vol = vol20 ?? 0
  const atr = atr14 ?? 0
  if (vol >= 60 || atr >= 5) return 'high'
  if (vol >= 35 || atr >= 3) return 'medium'
  return 'low'
}

function directionFromScore(score: number): ForecastDirection {
  if (score >= 0.2) return 'bullish'
  if (score <= -0.2) return 'bearish'
  return 'neutral'
}

function buildStartDate(lookbackDays: number): string {
  const start = new Date()
  start.setDate(start.getDate() - lookbackDays)
  return start.toISOString().slice(0, 10)
}

export async function forecastEquityTrend(
  equityClient: EquityClientLike,
  input: ForecastInput,
): Promise<ForecastOutput> {
  const symbol = input.symbol.trim().toUpperCase()
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const interval = input.interval ?? '1d'

  const raw = await equityClient.getHistorical({
    symbol,
    start_date: buildStartDate(lookbackDays),
    interval,
  }) as Array<Record<string, unknown>>

  const bars = normalizeBars(raw)
  if (bars.length < 30) {
    throw new Error(`Forecast requires at least 30 usable bars for ${symbol}, got ${bars.length}`)
  }

  const closes = bars.map((bar) => bar.close)
  const latestClose = closes[closes.length - 1]
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  const rsi14 = rsi(closes, 14)
  const momentum5 = pctChange(closes, 5)
  const momentum20 = pctChange(closes, 20)
  const momentum60 = pctChange(closes, 60)
  const vol20 = volatility20dPct(closes)
  const atr14 = atrPct(bars, 14)

  const trend = scoreTrend(latestClose, sma20, sma50, sma200)
  const momentum = scoreMomentum(momentum5, momentum20, momentum60)
  const meanReversion = scoreMeanReversion(rsi14)

  let score = trend.score + momentum.score + meanReversion.score
  const warnings: string[] = []

  if (vol20 != null && vol20 > 70) {
    score *= 0.85
    warnings.push(`Very high annualized 20d volatility (${round(vol20, 1)}%) lowers reliability.`)
  }
  if (bars.length < 200) warnings.push('Less than 200 bars available; long-term trend component is incomplete.')

  score = clamp(score, -1, 1)
  const risk = riskLevel(vol20, atr14)
  const dataQuality = bars.length >= 200 ? 1 : bars.length >= 100 ? 0.85 : 0.7
  const riskPenalty = risk === 'high' ? 0.18 : risk === 'medium' ? 0.08 : 0
  const confidence = clamp(0.35 + Math.abs(score) * 0.45 + (dataQuality - 0.7) * 0.2 - riskPenalty, 0.2, 0.82)
  const expectedMovePct = clamp(score * Math.sqrt(Math.max(horizonDays, 1)) * 2.2, -12, 12)

  return {
    symbol,
    horizonDays,
    direction: directionFromScore(score),
    score: round(score, 4),
    confidence: round(confidence, 4),
    latestClose: round(latestClose, 4),
    expectedMovePct: round(expectedMovePct, 2),
    riskLevel: risk,
    indicators: {
      close: round(latestClose, 4),
      ...(sma20 != null ? { sma20: round(sma20, 4) } : {}),
      ...(sma50 != null ? { sma50: round(sma50, 4) } : {}),
      ...(sma200 != null ? { sma200: round(sma200, 4) } : {}),
      ...(rsi14 != null ? { rsi14: round(rsi14, 2) } : {}),
      ...(momentum5 != null ? { momentum5dPct: round(momentum5, 2) } : {}),
      ...(momentum20 != null ? { momentum20dPct: round(momentum20, 2) } : {}),
      ...(momentum60 != null ? { momentum60dPct: round(momentum60, 2) } : {}),
      ...(vol20 != null ? { volatility20dPct: round(vol20, 2) } : {}),
      ...(atr14 != null ? { atr14Pct: round(atr14, 2) } : {}),
    },
    reasons: [...trend.reasons, ...momentum.reasons, ...meanReversion.reasons].slice(0, 10),
    warnings,
    dataRange: { from: bars[0].date, to: bars[bars.length - 1].date, bars: bars.length },
    disclaimer: DISCLAIMER,
  }
}

export async function rankEquityForecasts(
  equityClient: EquityClientLike,
  symbols: string[],
  options: Omit<ForecastInput, 'symbol'> = {},
): Promise<{ results: ForecastOutput[]; failures: Array<{ symbol: string; error: string }> }> {
  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)))
  const results: ForecastOutput[] = []
  const failures: Array<{ symbol: string; error: string }> = []

  for (const symbol of uniqueSymbols) {
    try {
      results.push(await forecastEquityTrend(equityClient, { ...options, symbol }))
    } catch (err) {
      failures.push({ symbol, error: err instanceof Error ? err.message : String(err) })
    }
  }

  results.sort((a, b) => {
    const aRank = a.score * a.confidence
    const bRank = b.score * b.confidence
    return bRank - aRank
  })

  return { results, failures }
}
