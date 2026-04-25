/**
 * Analysis Kit — 统一量化因子计算工具
 *
 * 通过 asset 参数区分资产类别（equity/crypto/currency），
 * 公式语法完全一样：CLOSE('AAPL', '1d')、SMA(...)、RSI(...) 等。
 * 数据按需从 OpenBB API 拉取 OHLCV，不缓存。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike, CryptoClientLike, CurrencyClientLike, CommodityClientLike } from '@/domain/market-data/client/types'
import { IndicatorCalculator } from '@/domain/analysis/indicator/calculator'
import type { IndicatorContext, OhlcvData, HistoricalDataResult, DataSourceMeta } from '@/domain/analysis/indicator/types'

/** 根据 interval 决定拉取的日历天数（约 1 倍冗余） */
function getCalendarDays(interval: string): number {
  const match = interval.match(/^(\d+)([dwhm])$/)
  if (!match) return 365 // fallback: 1 年

  const n = parseInt(match[1])
  const unit = match[2]

  switch (unit) {
    case 'd': return n * 730   // 日线：2 年
    case 'w': return n * 1825  // 周线：5 年
    case 'h': return n * 90    // 小时线：90 天
    case 'm': return n * 30    // 分钟线：30 天
    default:  return 365
  }
}

function buildStartDate(interval: string): string {
  const calendarDays = getCalendarDays(interval)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - calendarDays)
  return startDate.toISOString().slice(0, 10)
}

function buildContext(
  asset: 'equity' | 'crypto' | 'currency' | 'commodity',
  equityClient: EquityClientLike,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
  commodityClient: CommodityClientLike,
): IndicatorContext {
  return {
    getHistoricalData: async (symbol, interval): Promise<HistoricalDataResult> => {
      const start_date = buildStartDate(interval)

      let raw: Array<Record<string, unknown>>
      switch (asset) {
        case 'equity':
          raw = await equityClient.getHistorical({ symbol, start_date, interval })
          break
        case 'crypto':
          raw = await cryptoClient.getHistorical({ symbol, start_date, interval })
          break
        case 'currency':
          raw = await currencyClient.getHistorical({ symbol, start_date, interval })
          break
        case 'commodity':
          raw = await commodityClient.getSpotPrices({ symbol, start_date })
          break
      }

      // Filter out bars with null OHLC (yfinance returns null for incomplete/missing data)
      const data = raw.filter(
        (d): d is Record<string, unknown> & OhlcvData =>
          d.close != null && d.open != null && d.high != null && d.low != null,
      ) as OhlcvData[]

      data.sort((a, b) => a.date.localeCompare(b.date))

      const meta: DataSourceMeta = {
        symbol,
        from: data.length > 0 ? data[0].date : '',
        to: data.length > 0 ? data[data.length - 1].date : '',
        bars: data.length,
      }

      return { data, meta }
    },
  }
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

function buildEquityTrendScore(symbol: string, data: OhlcvData[]) {
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
  const realizedVol20 = stdev(
    closes.slice(-21).slice(1).map((close, i) => pctChange(closes.slice(-21)[i], close)),
  )

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

export function createAnalysisTools(
  equityClient: EquityClientLike,
  cryptoClient: CryptoClientLike,
  currencyClient: CurrencyClientLike,
  commodityClient: CommodityClientLike,
) {
  return {
    calculateIndicator: tool({
      description: `Calculate technical indicators for any asset using formula expressions.

Asset classes: "equity" for stocks, "crypto" for cryptocurrencies, "currency" for forex pairs, "commodity" for commodities (use canonical names: gold, crude_oil, copper, etc.).

Data access (returns array — use [-1] for latest value):
  CLOSE('AAPL', '1d'), HIGH, LOW, OPEN, VOLUME — args: symbol, interval (e.g. '1d', '1w', '1h').
  CLOSE('AAPL', '1d')[-1] → latest close price as a single number.

Statistics (returns a single number — do NOT use [-1]):
  SMA(data, period), EMA, STDEV, MAX, MIN, SUM, AVERAGE.

Technical (returns a single number or object — do NOT use [-1]):
  RSI(data, 14) → number.  BBANDS(data, 20, 2) → {upper, middle, lower}.
  MACD(data, 12, 26, 9) → {macd, signal, histogram}.  ATR(highs, lows, closes, 14) → number.

Arithmetic: +, -, *, / operators between numbers. E.g. CLOSE(...)[-1] - SMA(..., 50).

Examples:
  SMA(CLOSE('AAPL', '1d'), 50)              → equity 50-day moving average
  RSI(CLOSE('BTCUSD', '1d'), 14)            → crypto RSI (single number, no [-1])
  CLOSE('EURUSD', '1d')[-1]                 → latest forex close (needs [-1])
  CLOSE('gold', '1d')[-1]                   → latest gold price (canonical name)

Returns { value, dataRange } where dataRange shows the actual date span of the data used.
Use marketSearchForResearch to find the correct symbol first.`,
      inputSchema: z.object({
        asset: z.enum(['equity', 'crypto', 'currency', 'commodity']).describe('Asset class'),
        formula: z.string().describe("Formula expression, e.g. SMA(CLOSE('AAPL', '1d'), 50)"),
        precision: z.number().int().min(0).max(10).optional().describe('Decimal places (default: 4)'),
      }),
      execute: async ({ asset, formula, precision }) => {
        const context = buildContext(asset, equityClient, cryptoClient, currencyClient, commodityClient)
        const calculator = new IndicatorCalculator(context)
        return await calculator.calculate(formula, precision)
      },
    }),

    predictEquityTrend: tool({
      description: `Score short-term trend outlook for one or more US equities, including Nasdaq stocks.

This is a transparent heuristic model, not a trained ML forecast. It uses recent daily OHLCV data,
trend, momentum, RSI mean-reversion, ATR volatility, and realized volatility to produce a 0-100 score.
Use it to rank candidates before deeper fundamental/news review, not as a guaranteed price forecast.`,
      inputSchema: z.object({
        symbols: z.array(z.string()).min(1).max(50).describe('Ticker symbols, e.g. ["NVDA", "AMD", "AAPL"]'),
        interval: z.literal('1d').default('1d').describe('Daily bars only for this predictor'),
        horizonDays: z.number().int().min(1).max(30).default(5).describe('Forecast horizon label; current heuristic is calibrated for roughly 5 trading days'),
      }),
      execute: async ({ symbols, interval, horizonDays }) => {
        const start_date = buildStartDate(interval)
        const results = []
        const errors = []

        for (const rawSymbol of symbols) {
          const symbol = rawSymbol.trim().toUpperCase()
          if (!symbol) continue
          try {
            const raw = await equityClient.getHistorical({ symbol, start_date, interval })
            const data = raw.filter(
              (d): d is Record<string, unknown> & OhlcvData =>
                d.close != null && d.open != null && d.high != null && d.low != null,
            ) as OhlcvData[]
            data.sort((a, b) => a.date.localeCompare(b.date))
            const prediction = buildEquityTrendScore(symbol, data)
            results.push({
              ...prediction,
              horizonDays,
              dataRange: {
                from: data[0]?.date ?? '',
                to: data[data.length - 1]?.date ?? '',
                bars: data.length,
              },
            })
          } catch (err) {
            errors.push({ symbol, error: err instanceof Error ? err.message : String(err) })
          }
        }

        results.sort((a, b) => b.score - a.score)

        return {
          model: 'openalice-equity-trend-heuristic-v1',
          horizonDays,
          interpretation: {
            score: '0-100; >66 bullish, 35-65 neutral, <35 bearish',
            expectedMovePct: 'rough directional score-derived move estimate, not a calibrated price target',
          },
          results,
          errors,
        }
      },
    }),
  }
}
