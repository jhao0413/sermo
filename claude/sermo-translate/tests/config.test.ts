import { expect, test } from 'claude-code/testing'

test('config panel hides compatibility switches and shows the translate list', async ($, on) => {
  on('config.describe', (_$, e) => ({ label: e.label, description: e.description, isHidden: e.isHidden }))
  for (const field of ['outbound', 'translate_replies', 'translate_thinking', 'translate']) {
    const result = await $.config.describe({
      key: `sermo-translate.${field}`, label: field, isHidden: false,
      provider: { plugin: 'sermo-translate', tier: 'user' },
    })
    expect(result.isHidden).toBe(field !== 'translate')
  }
})
