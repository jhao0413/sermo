import { expect, test } from 'claude-code/testing'
import type { PluginOptions } from 'claude-code'

const configurations: { name: string; options: PluginOptions; translateThinking: boolean }[] = [
  { name: 'thinking only', options: { translate: ['thinking'] }, translateThinking: true },
  { name: 'empty list', options: { translate: [] }, translateThinking: false },
  { name: 'legacy disabled', options: { outbound: false, translate_thinking: false }, translateThinking: false },
  { name: 'list overrides legacy', options: { translate: ['thinking'], translate_thinking: false }, translateThinking: true },
  { name: 'default', options: {}, translateThinking: true },
]

for (const { name, options, translateThinking } of configurations) {
  test(`translation selection: ${name}`, { options }, async ($, on) => {
    let requests = 0
    on('fs.write', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('http.fetch', () => {
      requests++
      return { value: {
        status: 200, ok: true, headers: {},
        text: JSON.stringify([{ detectedLanguage: { language: 'en' }, translations: [{ text: '我应该检查代码。' }] }]),
      } }
    })
    on('turn.step', async function* (_$, e) {
      yield { kind: 'thinking', index: 0, text: 'I should inspect ' }
      yield { kind: 'thinking', index: 0, text: 'the code.' }
      yield { kind: 'text', index: 1, text: 'Here is the answer.' }
      yield { kind: 'stop', stopReason: 'end_turn', usage: null }
      return { turnId: e.turnId, index: e.index, answer: 'Here is the answer.', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    const chunks = []
    const stream = $.turn.step({ turnId: 'test-turn', index: 0, model: 'test-model', messageCount: 0 })
    for await (const chunk of stream) chunks.push(chunk)
    expect(requests).toBe(translateThinking ? 1 : 0)
    const thinking = chunks.filter(c => c.kind === 'thinking').map(c => c.text).join('')
    expect(thinking).toBe(translateThinking ? 'I should inspect the code.\n\n> 我应该检查代码。' : 'I should inspect the code.')
    expect(chunks.filter(c => c.kind !== 'thinking')).toEqual([
      { kind: 'text', index: 1, text: 'Here is the answer.' },
      { kind: 'stop', stopReason: 'end_turn', usage: null },
    ])
  })
}
