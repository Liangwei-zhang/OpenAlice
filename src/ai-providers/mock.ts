/**
 * MockAIProvider for testing.
 *
 * Implements the full AIProvider interface with configurable event sequences.
 * Captures all generate() and ask() calls for test assertions.
 *
 * Also exports event builder helpers for constructing ProviderEvent sequences.
 *
 * Usage:
 *   const provider = new MockAIProvider([
 *     toolUseEvent('t1', 'get_price', { symbol: 'AAPL' }),
 *     toolResultEvent('t1', '185'),
 *     textEvent('AAPL is at $185'),
 *     doneEvent('AAPL is at $185'),
 *   ])
 *   // ... exercise code ...
 *   expect(provider.generateCalls).toHaveLength(1)
 *   expect(provider.askCalls).toHaveLength(0)
 */

import type { AIProvider, ProviderEvent, ProviderResult, GenerateInput, GenerateOpts } from './types.js'
import type { MediaAttachment } from '../core/types.js'

// ==================== Call Records ====================

export interface MockAIProviderCall {
  input: GenerateInput
  opts?: GenerateOpts
}

// ==================== Options ====================

export interface MockAIProviderOpts {
  inputKind?: 'text' | 'messages'
  providerTag?: 'vercel-ai' | 'claude-code' | 'agent-sdk'
  /** Text returned by ask(). Default: 'mock-ask-result'. */
  askResult?: string
}

// ==================== MockAIProvider ====================

export class MockAIProvider implements AIProvider {
  readonly inputKind: 'text' | 'messages'
  readonly providerTag: 'vercel-ai' | 'claude-code' | 'agent-sdk'
  readonly generateCalls: MockAIProviderCall[] = []
  readonly askCalls: string[] = []
  private _askResult: string

  constructor(
    private events: ProviderEvent[],
    opts?: MockAIProviderOpts,
  ) {
    this.inputKind = opts?.inputKind ?? 'messages'
    this.providerTag = opts?.providerTag ?? 'vercel-ai'
    this._askResult = opts?.askResult ?? 'mock-ask-result'
  }

  async ask(prompt: string): Promise<ProviderResult> {
    this.askCalls.push(prompt)
    return { text: this._askResult, media: [] }
  }

  async *generate(input: GenerateInput, opts?: GenerateOpts): AsyncIterable<ProviderEvent> {
    this.generateCalls.push({ input, opts })
    for (const e of this.events) yield e
  }
}

// ==================== Event Builders ====================

export function textEvent(text: string): ProviderEvent {
  return { type: 'text', text }
}

export function toolUseEvent(id: string, name: string, input: unknown): ProviderEvent {
  return { type: 'tool_use', id, name, input }
}

export function toolResultEvent(toolUseId: string, content: string): ProviderEvent {
  return { type: 'tool_result', tool_use_id: toolUseId, content }
}

export function doneEvent(text: string, media: MediaAttachment[] = []): ProviderEvent {
  return { type: 'done', result: { text, media } }
}
