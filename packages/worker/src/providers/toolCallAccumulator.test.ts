import { describe, expect, it } from 'vitest'
import { ToolCallAccumulator } from './toolCallAccumulator'

describe('streamed tool call validation', () => {
  it('joins split arguments and retains the order of parallel calls', () => {
    const calls = new ToolCallAccumulator()
    calls.append([{ index: 1, id: 'b', function: { name: 'read_file', arguments: '{"file' } }])
    calls.append([
      { index: 0, id: 'a', function: { name: 'search_files', arguments: '{"query":"release"}' } }
    ])
    calls.append([{ index: 1, function: { arguments: 'Id":"f1","startLine":1}' } }])
    expect(calls.finish()).toEqual([
      { id: 'a', name: 'search_files', arguments: { query: 'release' } },
      { id: 'b', name: 'read_file', arguments: { fileId: 'f1', startLine: 1 } }
    ])
  })
  it.each([2, -1, 0.5, '0'])('rejects invalid or excessive call index %s', (index) => {
    expect(() => new ToolCallAccumulator().append([{ index }])).toThrow()
  })
  it.each(['[]', 'null', '"text"', '{"broken":'])(
    'rejects non-object or incomplete arguments %s',
    (args) => {
      const calls = new ToolCallAccumulator()
      calls.append([{ index: 0, id: 'a', function: { name: 'read_file', arguments: args } }])
      expect(() => calls.finish()).toThrow()
    }
  )
  it('rejects duplicate identities and excessive argument data', () => {
    const calls = new ToolCallAccumulator()
    calls.append(
      [0, 1].map((index) => ({
        index,
        id: 'same',
        function: { name: 'read_file', arguments: '{}' }
      }))
    )
    expect(() => calls.finish()).toThrow()
    expect(() =>
      new ToolCallAccumulator().append([{ index: 0, function: { arguments: 'x'.repeat(8001) } }])
    ).toThrow()
  })
})
