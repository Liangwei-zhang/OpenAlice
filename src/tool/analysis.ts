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
import { buildEquityTrendScore } from '@/domain/analysis/equity-trend-predictor'

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

async function scoreEquitySymbols(
  equityClient: EquityClientLike,
  symbols: string[],
  interval: '1d',
  horizonDays: number,
) {
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
  return { results, errors }
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
        const { results, errors } = await scoreEquitySymbols(equityClient, symbols, interval, horizonDays)
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

    rankEquityCandidates: tool({
      description: `Rank US equity candidates by short-term trend score and return top bullish/bearish names.

Useful for Nasdaq watchlists and multi-stock screening. This tool uses the same transparent heuristic
model as predictEquityTrend, then applies topN and optional minimum score filters.`,
      inputSchema: z.object({
        symbols: z.array(z.string()).min(1).max(200).describe('Candidate ticker symbols to rank'),
        topN: z.number().int().min(1).max(50).default(10).describe('Number of top candidates to return'),
        minScore: z.number().int().min(0).max(100).default(0).describe('Minimum score filter for bullish candidates'),
        includeBearish: z.boolean().default(false).describe('Also return the lowest-scoring bearish candidates'),
        horizonDays: z.number().int().min(1).max(30).default(5).describe('Forecast horizon label'),
      }),
      execute: async ({ symbols, topN, minScore, includeBearish, horizonDays }) => {
        const { results, errors } = await scoreEquitySymbols(equityClient, symbols, '1d', horizonDays)
        const bullish = results
          .filter((item) => item.score >= minScore)
          .slice(0, topN)
        const bearish = includeBearish
          ? [...results].sort((a, b) => a.score - b.score).slice(0, topN)
          : undefined

        return {
          model: 'openalice-equity-trend-heuristic-v1',
          horizonDays,
          universeSize: symbols.length,
          scoredCount: results.length,
          topN,
          bullish,
          ...(bearish ? { bearish } : {}),
          errors,
          nextStep: 'Use equityGetProfile, equityGetEarningsCalendar, news archive, and trading guards before staging any trade.',
        }
      },
    }),
  }
}
