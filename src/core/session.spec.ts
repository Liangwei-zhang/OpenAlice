import { describe, it, expect } from 'vitest'
import { toModelMessages, toTextHistory, toChatHistory, type SessionEntry, type ContentBlock } from './session.js'

// ==================== Helpers ====================

function makeEntry(overrides: Partial<SessionEntry> & Pick<SessionEntry, 'type' | 'message'>): SessionEntry {
  return {
    uuid: 'u1',
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function userText(content: string): SessionEntry {
  return makeEntry({ type: 'user', message: { role: 'user', content } })
}

function assistantText(content: string): SessionEntry {
  return makeEntry({ type: 'assistant', message: { role: 'assistant', content } })
}

function assistantBlocks(blocks: ContentBlock[]): SessionEntry {
  return makeEntry({ type: 'assistant', message: { role: 'assistant', content: blocks } })
}

function userBlocks(blocks: ContentBlock[]): SessionEntry {
  return makeEntry({ type: 'user', message: { role: 'user', content: blocks } })
}

function compactBoundary(): SessionEntry {
  return makeEntry({
    type: 'system',
    subtype: 'compact_boundary',
    message: { role: 'system', content: 'Conversation compacted' },
  })
}

// ==================== toModelMessages ====================

describe('toModelMessages', () => {
  it('should return empty for empty input', () => {
    expect(toModelMessages([])).toEqual([])
  })

  it('should convert user text to SDK user message', () => {
    const msgs = toModelMessages([userText('hello')])
    expect(msgs).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('should convert assistant text to SDK assistant message', () => {
    const msgs = toModelMessages([assistantText('hi there')])
    expect(msgs).toEqual([{ role: 'assistant', content: 'hi there' }])
  })

  it('should skip compact_boundary entries', () => {
    const msgs = toModelMessages([
      userText('before'),
      compactBoundary(),
      assistantText('after'),
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({ role: 'user', content: 'before' })
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'after' })
  })

  it('should convert assistant content blocks with tool_use', () => {
    const msgs = toModelMessages([
      assistantBlocks([
        { type: 'text', text: 'thinking...' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp' } },
      ]),
    ])
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    const content = (msgs[0] as { content: unknown[] }).content
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: 'thinking...' })
    expect(content[1]).toEqual({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'Read',
      input: { path: '/tmp' },
    })
  })

  it('should convert user content blocks with tool_result to SDK tool message', () => {
    const msgs = toModelMessages([
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'file contents' },
      ]),
    ])
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    const content = (msgs[0] as { content: unknown[] }).content
    expect(content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 't1',
      toolName: 'unknown',
    })
  })

  it('should convert user content blocks with only text to user message', () => {
    const msgs = toModelMessages([
      userBlocks([
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ]),
    ])
    expect(msgs).toEqual([{ role: 'user', content: 'line 1\nline 2' }])
  })

  it('should skip user blocks with only empty text', () => {
    const msgs = toModelMessages([
      userBlocks([{ type: 'text', text: '' }]),
    ])
    expect(msgs).toEqual([])
  })

  it('should skip empty assistant block arrays', () => {
    const msgs = toModelMessages([assistantBlocks([])])
    expect(msgs).toEqual([])
  })

  it('should handle a full conversation round-trip', () => {
    const msgs = toModelMessages([
      userText('What is the weather?'),
      assistantBlocks([
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'w1', name: 'WeatherLookup', input: { city: 'NYC' } },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 'w1', content: '72°F sunny' },
      ]),
      assistantText('It is 72°F and sunny in NYC.'),
    ])
    expect(msgs).toHaveLength(4)
    expect(msgs[0].role).toBe('user')
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[2].role).toBe('tool')
    expect(msgs[3].role).toBe('assistant')
  })
})

// ==================== toTextHistory ====================

describe('toTextHistory', () => {
  it('should return empty for empty input', () => {
    expect(toTextHistory([])).toEqual([])
  })

  it('should convert string content', () => {
    const history = toTextHistory([
      userText('hi'),
      assistantText('hello'),
    ])
    expect(history).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ])
  })

  it('should skip system entries', () => {
    const history = toTextHistory([
      userText('hi'),
      compactBoundary(),
      assistantText('hello'),
    ])
    expect(history).toHaveLength(2)
  })

  it('should summarize tool_use blocks', () => {
    const history = toTextHistory([
      assistantBlocks([
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp/a.txt' } },
      ]),
    ])
    expect(history).toHaveLength(1)
    expect(history[0].text).toContain('checking')
    expect(history[0].text).toContain('[Tool: Read')
  })

  it('should summarize tool_result blocks', () => {
    const history = toTextHistory([
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'the file contents here' },
      ]),
    ])
    expect(history).toHaveLength(1)
    expect(history[0].text).toContain('[Result:')
  })

  it('should skip entries with only whitespace text', () => {
    const history = toTextHistory([
      userBlocks([{ type: 'text', text: '   ' }]),
    ])
    expect(history).toEqual([])
  })
})

// ==================== toChatHistory ====================

describe('toChatHistory', () => {
  it('should return empty for empty input', () => {
    expect(toChatHistory([])).toEqual([])
  })

  it('should convert simple text messages', () => {
    const items = toChatHistory([
      userText('hi'),
      assistantText('hello'),
    ])
    expect(items).toEqual([
      { kind: 'text', role: 'user', text: 'hi', timestamp: '2026-01-01T00:00:00Z', metadata: undefined },
      { kind: 'text', role: 'assistant', text: 'hello', timestamp: '2026-01-01T00:00:00Z', metadata: undefined },
    ])
  })

  it('should skip system entries', () => {
    const items = toChatHistory([
      userText('hi'),
      compactBoundary(),
      assistantText('hello'),
    ])
    expect(items).toHaveLength(2)
  })

  it('should pair tool_use with tool_result from next entry', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'tool_use', id: 't1', name: 'mcp__open-alice__Read', input: { path: '/tmp' } },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'file contents here' },
      ]),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tool_calls')
    if (items[0].kind === 'tool_calls') {
      expect(items[0].calls).toHaveLength(1)
      expect(items[0].calls[0].name).toBe('Read') // MCP prefix stripped
      expect(items[0].calls[0].result).toContain('file contents')
    }
  })

  it('should not duplicate consumed tool_result entries', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'result' },
      ]),
      assistantText('done'),
    ])
    // tool_calls + text = 2 items (tool_result consumed, not separate)
    expect(items).toHaveLength(2)
    expect(items[0].kind).toBe('tool_calls')
    expect(items[1].kind).toBe('text')
  })

  it('should emit text blocks alongside tool_use in same entry', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'text', text: 'Let me check' },
        { type: 'tool_use', id: 't1', name: 'Search', input: { q: 'test' } },
      ]),
    ])
    // Should produce both a tool_calls item and a text item
    expect(items).toHaveLength(2)
    expect(items[0].kind).toBe('tool_calls')
    expect(items[1].kind).toBe('text')
    if (items[1].kind === 'text') {
      expect(items[1].text).toBe('Let me check')
    }
  })

  it('should skip standalone tool_result entries (orphaned)', () => {
    const items = toChatHistory([
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'orphaned' },
      ]),
    ])
    expect(items).toEqual([])
  })

  it('should handle image blocks', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'text', text: 'here is the image' },
        { type: 'image', url: 'http://example.com/img.png' },
      ]),
    ])
    expect(items).toHaveLength(1)
    if (items[0].kind === 'text') {
      expect(items[0].media).toEqual([{ type: 'image', url: 'http://example.com/img.png' }])
    }
  })

  it('should skip entries with only whitespace text', () => {
    const items = toChatHistory([
      makeEntry({ type: 'user', message: { role: 'user', content: '   ' } }),
    ])
    expect(items).toEqual([])
  })
})
