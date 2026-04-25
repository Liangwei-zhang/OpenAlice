/**
 * Forecast AI Tools
 *
 * Research-only equity trend forecast tools. These tools do not stage,
 * commit, or execute trades. They provide explainable ranking signals for
 * short-horizon stock analysis.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike } from '@/domain/market-data/client/types'
import { forecastEquityTrend, rankEquityForecasts } from '@/domain/forecast/equity-trend'

export function createForecastTools(equityClient: EquityClientLike) {
  return {
    forecastEquityTrend: tool({
      description: `Forecast the short-horizon trend for a single equity symbol.

This is a research-only, explainable heuristic forecast. It combines trend,
momentum, RSI mean-reversion, volatility, and data-quality signals. It does NOT
use a trained ML model and must not be treated as guaranteed price prediction.

Use this for questions like:
- "Analyze NVDA's likely next-week direction"
- "Is AMD short-term trend bullish or bearish?"
- "Give me a 5-day technical forecast for AAPL"`,
      inputSchema: z.object({
        symbol: z.string().describe('Equity ticker symbol, e.g. AAPL, NVDA, AMD'),
        horizonDays: z.number().int().positive().max(30).optional().describe('Forecast horizon in trading days, default 5'),
        lookbackDays: z.number().int().positive().max(1500).optional().describe('Calendar days of history to request, default 420'),
        interval: z.string().optional().describe('Market-data interval, default 1d'),
      }),
      execute: async (input) => forecastEquityTrend(equityClient, input),
    }),

    rankEquityForecasts: tool({
      description: `Rank multiple equity symbols by short-horizon forecast strength.

This is useful for Nasdaq stock screening, e.g. ranking NVDA, AMD, AVGO, META,
NFLX, GOOGL, AMAT, LRCX, NET, and ORCL by next-week technical setup.

The ranking sorts by score * confidence. It is research-only and does not place
or stage trades.`,
      inputSchema: z.object({
        symbols: z.array(z.string()).min(1).max(100).describe('Equity ticker symbols to rank'),
        horizonDays: z.number().int().positive().max(30).optional().describe('Forecast horizon in trading days, default 5'),
        lookbackDays: z.number().int().positive().max(1500).optional().describe('Calendar days of history to request, default 420'),
        interval: z.string().optional().describe('Market-data interval, default 1d'),
      }),
      execute: async ({ symbols, ...options }) => rankEquityForecasts(equityClient, symbols, options),
    }),
  }
}
