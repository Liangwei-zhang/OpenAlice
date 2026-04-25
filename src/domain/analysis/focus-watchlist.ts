export const FOCUS_EQUITY_WATCHLIST_NAME = 'nico-focus-equity-watchlist-v1'

/**
 * User's high-conviction US equity watchlist.
 *
 * Mixed mega-cap AI/semis, cloud/software, fintech, space, e-commerce,
 * crypto proxy, and selected legacy tech. Used by rankFocusWatchlist.
 */
export const FOCUS_EQUITY_WATCHLIST = [
  'SNOW',
  'MSTR',
  'IBM',
  'SPOT',
  'SHOP',
  'HOOD',
  'QCOM',
  'ARM',
  'PLTR',
  'RKLB',
  'INTC',
  'AVGO',
  'META',
  'AMD',
  'MU',
  'TSM',
  'NVDA',
  'ORCL',
  'TSLA',
  'AMZN',
  'GOOGL',
  'MSFT',
  'AAPL',
] as const

export type FocusEquitySymbol = typeof FOCUS_EQUITY_WATCHLIST[number]
