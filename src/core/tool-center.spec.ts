import { describe, it, expect } from 'vitest'
import { ToolCenter } from './tool-center.js'
import type { Tool } from 'ai'

// ==================== Helpers ====================

function makeTool(description = 'A test tool'): Tool {
  return { description } as Tool
}

// ==================== ToolCenter ====================

describe('ToolCenter', () => {
  describe('register + list', () => {
    it('should register and list tool names', () => {
      const tc = new ToolCenter()
      tc.register({ alpha: makeTool(), beta: makeTool() }, 'group1')
      expect(tc.list().sort()).toEqual(['alpha', 'beta'])
    })

    it('should overwrite same-name tool on re-register', () => {
      const tc = new ToolCenter()
      tc.register({ alpha: makeTool('v1') }, 'group1')
      tc.register({ alpha: makeTool('v2') }, 'group2')
      expect(tc.list()).toEqual(['alpha'])
      const inv = tc.getInventory()
      expect(inv[0].group).toBe('group2')
      expect(inv[0].description).toBe('v2')
    })

    it('should handle multiple groups', () => {
      const tc = new ToolCenter()
      tc.register({ a: makeTool() }, 'g1')
      tc.register({ b: makeTool() }, 'g2')
      expect(tc.list().sort()).toEqual(['a', 'b'])
    })

    it('should return empty list when nothing registered', () => {
      const tc = new ToolCenter()
      expect(tc.list()).toEqual([])
    })
  })

  describe('getInventory', () => {
    it('should return name, group, and description', () => {
      const tc = new ToolCenter()
      tc.register({ myTool: makeTool('Does something') }, 'analysis')
      const inv = tc.getInventory()
      expect(inv).toEqual([
        { name: 'myTool', group: 'analysis', description: 'Does something' },
      ])
    })

    it('should truncate long descriptions to 200 chars', () => {
      const tc = new ToolCenter()
      const longDesc = 'x'.repeat(300)
      tc.register({ tool: makeTool(longDesc) }, 'g')
      const inv = tc.getInventory()
      expect(inv[0].description).toHaveLength(200)
    })

    it('should handle tools with no description', () => {
      const tc = new ToolCenter()
      tc.register({ tool: {} as Tool }, 'g')
      const inv = tc.getInventory()
      expect(inv[0].description).toBe('')
    })
  })

  describe('getVercelTools', () => {
    it('should return all tools when disabled list is empty (reads from disk)', async () => {
      // readToolsConfig reads tools.json — if missing, returns { disabled: [] }
      const tc = new ToolCenter()
      tc.register({ a: makeTool(), b: makeTool() }, 'g')
      const tools = await tc.getVercelTools()
      expect(Object.keys(tools).sort()).toEqual(['a', 'b'])
    })
  })
})
