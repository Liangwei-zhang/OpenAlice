import type { OhlcvData } from '@/domain/analysis/indicator/types'

export interface EquityTrendPrediction {
  symbol: string
  score: number
  direction: 'bullish' | 'neutral' | 'bearish'
  confidence: number
  expectedMovePct: number
  latestClose: number
  factors: {
    ret5d: number
    ret20d: number
    sma20: number
    sma50: number
    rsi14: number
    atrPct: number
    realizedVol20: number
    slope20Pct: number
  }
  rationale: string[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)))
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0
  const n = values.length
  const xAvg = (n - 1) / 2
  const yAvg = mean(values)
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    numerator += (i - xAvg) * (values[i] - yAvg)
    denominator += (i - xAvg) ** 2
  }
  return denominator === 0 ? 0 : numerator / denominator
}

function simpleMovingAverage(values: number[], period: number): number {
  if (values.length < period) throw new Error(`SMA requires at least ${period} data points, got ${values.length}`)
  return mean(values.slice(-period))
}

function relativeStrengthIndex(values: number[], period = 14): number {
  if (values.length < period + 1) throw new Error(`RSI requires at least ${period + 1} data points, got ${values.length}`)
  const changes: number[] = []
  for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1])
  const gains = changes.map((c) => (c > 0 ? c : 0))
  const losses = changes.map((c) => (c < 0 ? -c : 0))
  let avgGain = mean(gains.slice(0, period))
  let avgLoss = mean(losses.slice(0, period))
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function trueRange(high: number, low: number, previousClose: number): number {
  return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose))
}

function averageTrueRange(data: OhlcvData[], period = 14): number {
  if (data.length < period + 1) throw new Error(`ATR requires at least ${period + 1} data points, got ${data.length}`)
  const ranges: number[] = []
  for (let i = 1; i < data.length; i++) {
    ranges.push(trueRange(Number(data[i].high), Number(data[i].low), Number(data[i - 1].close)))
  }
  let atr = mean(ranges.slice(0, period))
  for (let i = period; i < ranges.length; i++) {
    atr = (atr * (period - 1) + ranges[i]) / period
  }
  return atr
}

function pctChange(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0) return 0
  return (to / from - 1) * 100
}

/**
 * Transparent short-term equity trend scorer.
 *
 * This is intentionally heuristic and explainable. It is designed as a safe
 * baseline that can later be replaced or blended with a trained/backtested
 * alpha model without changing the AI tool contract.
 */
export function buildEquityTrendScore(symbol: string, data: OhlcvData[]): EquityTrendPrediction {
  const closes = data.map((bar) => Number(bar.close)).filter(Number.isFinite)
  if (closes.length < 60) {
    throw new Error(`Need at least 60 valid daily bars for ${symbol}, got ${closes.length}`)
  }

  const latestClose = closes[closes.length - 1]
  const sma20 = simpleMovingAverage(closes, 20)
  const sma50 = simpleMovingAverage(closes, 50)
  const rsi14 = relativeStrengthIndex(closes, 14)
  const atr14 = averageTrueRange(data, 14)
  const atrPct = latestClose > 0 ? (atr14 / latestClose) * 100 : 0
  const ret5d = pctChange(closes[Math.max(0, closes.length - 6)], latestClose)
  const ret20d = pctChange(closes[Math.max(0, closes.length - 21)], latestClose)
  const slope20Pct = latestClose > 0 ? (linearSlope(closes.slice(-20)) / latestClose) * 100 * 5 : 0
  const last21 = closes.slice(-21)
  const realizedVol20 = stdev(last21.slice(1).map((close, i) => pctChange(last21[i], close)))

  const trendComponent = clamp((latestClose / sma20 - 1) * 220 + (sma20 / sma50 - 1) * 180 + slope20Pct * 4, -35, 35)
  const momentumComponent = clamp(ret5d * 2.3 + ret20d * 0.7, -25, 25)
  const meanReversionComponent = rsi14 < 32 ? clamp((32 - rsi14) * 1.2, 0, 14)
    : rsi14 > 72 ? -clamp((rsi14 - 72) * 1.2, 0, 14)
      : 0
  const riskPenalty = clamp(Math.max(0, atrPct - 4) * 3 + Math.max(0, realizedVol20 - 3) * 2, 0, 18)
  const rawScore = 50 + trendComponent + momentumComponent + meanReversionComponent - riskPenalty
  const score = Math.round(clamp(rawScore, 0, 100))

  const direction = score >= 66 ? 'bullish'
    : score <= 34 ? 'bearish'
      : 'neutral'
  const confidence = Math.round(clamp(Math.abs(score - 50) * 2, 0, 100))
  const expectedMovePct = Number(clamp((score - 50) / 8, -6, 6).toFixed(2))

  return {
    symbol,
    score,
    direction,
    confidence,
    expectedMovePct,
    latestClose: Number(latestClose.toFixed(4)),
    factors: {
      ret5d: Number(ret5d.toFixed(2)),
      ret20d: Number(ret20d.toFixed(2)),
      sma20: Number(sma20.toFixed(4)),
      sma50: Number(sma50.toFixed(4)),
      rsi14: Number(rsi14.toFixed(2)),
      atrPct: Number(atrPct.toFixed(2)),
      realizedVol20: Number(realizedVol20.toFixed(2)),
      slope20Pct: Number(slope20Pct.toFixed(2)),
    },
    rationale: [
      latestClose >= sma20 ? 'price_above_sma20' : 'price_below_sma20',
      sma20 >= sma50 ? 'sma20_above_sma50' : 'sma20_below_sma50',
      rsi14 < 35 ? 'oversold_rebound_setup' : rsi14 > 70 ? 'overbought_risk' : 'rsi_neutral',
      atrPct > 5 ? 'high_volatility_penalty' : 'volatility_normal',
    ],
  }
}
