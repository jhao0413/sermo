import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../claude/sermo-translate/hooks/register.js', import.meta.url), 'utf8')
let instance = 0

async function load(provider, answer) {
  // Import separate module instances, as Claude does for separate hook environments.
  const { register } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${instance++}`)
  const hooks = new Map()
  const calls = []
  const request = async text => {
    calls.push(text)
    return answer(text)
  }
  const $ = {
    ui: { toast() {}, status() {}, invalidate() {} },
    fs: { write: async () => {} },
    model: { complete: async ({ prompt }, { signal }) => ({ isAnswered: true, text: await request(prompt), signal }) },
    process: { run: async args => {
      const payload = JSON.parse(args[args.indexOf('--data-binary') + 1])
      return { exitCode: 0, stdout: JSON.stringify({ choices: [{ message: { content: await request(payload.messages.at(-1).content) } }] }) }
    } },
    http: { fetch: async (_url, init) => ({ ok: true, text: [{ detectedLanguage: { language: 'zh' }, translations: [{ text: await request(JSON.parse(init.body)[0]) }] }] }) },
  }
  register((name, ...args) => {
    hooks.set(name === 'ui.render' ? `${name}:${args[0].component}` : name, args.at(-1))
  }, { provider })
  return {
    calls,
    command: args => hooks.get('command.run')($, { args }),
    submit: text => hooks.get('prompt.submit')($, { text }, e => e.text),
  }
}

for (const provider of ['session', 'openai', 'microsoft']) {
  test(`${provider}: translates outgoing prose`, async () => {
    const h = await load(provider, () => 'Please review this change.')
    assert.equal(await h.submit('请检查这个修改。'), 'Please review this change.')
    assert.equal(h.calls.length, 1)
  })

  test(`${provider}: off/on prevents stale work from starting another chunk or retry`, async () => {
    let release
    const h = await load(provider, () => new Promise(resolve => { release = resolve }))
    const original = '请检查这个修改。'.repeat(500)
    const pending = h.submit(original)
    assert.equal(h.calls.length, 1)
    await h.command('off')
    await h.command('on')
    release('仍然只是中文。')
    assert.equal(await pending, original)
    assert.equal(h.calls.length, 1, 'the previous generation must not start a second request')
  })
}

test('session: off aborts the model request signal', async () => {
  const { register } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${instance++}`)
  const hooks = new Map()
  let signal, release
  const $ = {
    ui: { toast() {}, status() {}, invalidate() {} },
    fs: { write: async () => {} },
    model: { complete: (_request, options) => {
      signal = options.signal
      return new Promise(resolve => { release = resolve })
    } },
  }
  register((name, ...args) => hooks.set(name, args.at(-1)), { provider: 'session' })
  const pending = hooks.get('prompt.submit')($, { text: '请检查。' }, e => e.text)
  assert.equal(signal.aborted, false)
  await hooks.get('command.run')($, { args: 'off' })
  assert.equal(signal.aborted, true)
  release({ isAnswered: true, text: 'Please review.' })
  assert.equal(await pending, '请检查。')
})
