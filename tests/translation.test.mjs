import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(new URL('../pi/package.json', import.meta.url))
const ts = require('typescript')
const symbols = 'okRewrite, splitParas, chunkParagraph, ensureEnglishProse, translateProse, outboundBlock'

function load(runtime, options = {}) {
  const config = { provider: 'openai', toggle_key: '', ...options.config }
  const filename = new URL(runtime === 'pi' ? '../pi/sermo-translate.ts' : '../claude/sermo-translate/hooks/register.js', import.meta.url)
  const implementation = readFileSync(filename, 'utf8')
  // Pi helpers live inside the per-session extension closure; expose them only in this test sandbox.
  const source = runtime === 'pi'
    ? implementation.replace('\tloadConfig()', `\tObject.assign(exports, { cfg, ${symbols} });\n\tloadConfig()`)
    : implementation + `\nexport { ${symbols}, scheduleOne, translateBlock };`
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const calls = [], notices = [], logs = [], components = [], hooks = new Map(), commands = new Map()
  let transformer
  const answer = options.answer ?? ((text) => `译文：${text}`)
  const fetchMock = async (_url, init) => {
    const payload = JSON.parse(init.body)
    const text = Array.isArray(payload) ? payload[0] : payload.messages.at(-1).content
    if (init.signal?.aborted) throw init.signal.reason
    calls.push({ text, system: payload.messages?.[0].content, signal: init.signal })
    const result = await answer(text, calls.length, payload)
    return { ok: true, json: async () => Array.isArray(payload)
      ? [{ detectedLanguage: { language: result.from ?? 'en' }, translations: [{ text: result.out ?? result }] }]
      : { choices: [{ finish_reason: 'stop', message: { content: result.out ?? result } }] } }
  }
  const sandbox = {
    exports: {}, URLSearchParams, AbortSignal, AbortController, fetch: fetchMock,
    require: (id) => id === '@earendil-works/pi-coding-agent' ? { getAgentDir: () => '/test-agent' }
      : id === 'node:fs' ? { readFileSync: options.readConfig ?? (() => JSON.stringify(config)) }
      : id === 'node:fs/promises' ? { writeFile: async (_path, text) => logs.push(text) } : require(id),
  }
  vm.runInNewContext(code, sandbox, { filename: filename.pathname })
  const modelAnswer = async (system, prompt, signal) => {
    const response = await fetchMock('mock', {
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      signal,
    })
    return (await response.json()).choices[0].message.content
  }
  const ctx = {
    mode: 'tui', hasUI: true,
    modelRegistry: {
      getAvailable: () => [{ id: 'haiku', provider: 'mock', name: 'Haiku' }],
      complete: async (_model, request, options) => ({
        stopReason: 'stop', content: [{ type: 'text', text: await modelAnswer(request.systemPrompt, request.messages[0].content[0].text, options.signal) }],
      }),
    },
    sessionManager: { getBranch: () => options.branch ?? [] },
    ui: {
      notify: (message) => notices.push(message),
      setHiddenThinkingLabel: (label) => { for (const component of components) component.setHiddenThinkingLabel(label) },
    },
  }
  const $ = {
    model: { complete: async ({ system, prompt }) => ({ isAnswered: true, text: await modelAnswer(system, prompt) }) },
    fs: { write: async (_path, text) => logs.push(text) },
    ui: { toast: (message) => notices.push(message), invalidate() {} },
    process: { run: async (args) => {
      const body = args[args.indexOf('--data-binary') + 1]
      const response = await fetchMock('mock', { body })
      return { exitCode: 0, stdout: JSON.stringify(await response.json()) }
    } },
    http: { fetch: async (url, init) => {
      const response = await fetchMock(url, init)
      return { ok: response.ok, text: JSON.stringify(await response.json()) }
    } },
  }
  if (runtime === 'pi') sandbox.exports.default({
    registerShortcut() {}, registerCommand: (name, command) => commands.set(name, command),
    registerMarkdownTransformer: (fn) => { transformer = fn }, on: (name, handler) => hooks.set(name, handler),
  })
  else sandbox.exports.register((name, ...args) => hooks.set(name, args.at(-1)), config)
  return { ...sandbox.exports, hooks, commands, ctx, $, calls, notices, logs, components,
    transform: (text, messageType = 'assistant', isStreaming = false) => transformer(text, { messageType, isStreaming, availableWidth: 100 }),
  }
}

test('Pi: new config takes precedence and legacy config is read only for ENOENT', () => {
  for (const failure of [null, 'ENOENT', 'EACCES', 'malformed']) {
    const paths = []
    const h = load('pi', { readConfig: path => {
      paths.push(path)
      if (path.endsWith('/sermo-translate.json')) {
        if (failure === 'malformed') return '{'
        if (failure) throw Object.assign(new Error(failure), { code: failure })
        return JSON.stringify({ lang: 'ja' })
      }
      return JSON.stringify({ lang: 'fr' })
    } })
    assert.equal(h.cfg.lang, failure === null ? 'ja' : failure === 'ENOENT' ? 'fr' : 'zh-Hans')
    assert.deepEqual(paths, failure === 'ENOENT'
      ? ['/test-agent/sermo-translate.json', '/test-agent/parrot-translate.json']
      : ['/test-agent/sermo-translate.json'])
  }
})

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate) }
const context = (runtime, h) => runtime === 'pi' ? h.ctx : h.$
const noChangeCommentary = 'The prompt is already in natural, grammatically correct English. No changes are needed.'

async function submit(runtime, h, text) {
  if (runtime === 'pi') {
    const result = await h.hooks.get('input')({ source: 'interactive', text }, h.ctx)
    return result.action === 'transform' ? result.text : text
  }
  return h.hooks.get('prompt.submit')(h.$, { text, origin: { kind: 'composer' } }, event => event.text)
}

for (const runtime of ['pi', 'claude']) {
  test(`${runtime}: outbound file references never reach translation providers`, async () => {
    const refs = ['@src/登录.ts', '@"docs/使用 指南.md"', "@'docs/another file.md'", '@src/app.ts:12', '@src/登录.ts']
    for (const provider of ['openai', 'session', 'microsoft']) {
      const source = `请检查 ${refs.join(' 和 ')}。`
      const h = load(runtime, { config: { provider }, answer: text => {
        for (const ref of refs) assert.ok(!text.includes(ref), `provider saw ${ref}`)
        return { from: 'zh-Hans', out: text.replace('请检查', 'Please review').replaceAll(' 和 ', ' and ') }
      } })
      assert.equal(await submit(runtime, h, source), `Please review ${refs.join(' and ')}。`)
      assert.equal(h.calls.length, 1)
    }
  })

  test(`${runtime}: missing, changed, duplicated or reordered reference placeholders fall back safely`, async () => {
    const source = '请检查 @src/登录.ts 和 @src/app.ts'
    for (const corrupt of [
      text => text.replace(/`SERMO_FILE_REF_0`/, ''),
      text => text.replace('SERMO_FILE_REF_0', 'SERMO_FILE_REF_99'),
      text => text + ' `SERMO_FILE_REF_0`',
      text => text.replace('SERMO_FILE_REF_0', 'TEMP').replace('SERMO_FILE_REF_1', 'SERMO_FILE_REF_0').replace('TEMP', 'SERMO_FILE_REF_1'),
    ]) {
      const h = load(runtime, { answer: text => corrupt(text.replace('请检查', 'Please review').replace(' 和 ', ' and ')) })
      assert.equal(await submit(runtime, h, source), source)
    }
  })

  test(`${runtime}: reference masking avoids collisions and preserves punctuation and email text`, async () => {
    const source = '请检查 @src/app.ts. (contact user@example.com) SERMO_FILE_REF_0'
    const h = load(runtime, { answer: text => text.replace('请检查', 'Please review') })
    assert.equal(await submit(runtime, h, source), source.replace('请检查', 'Please review'))
    assert.ok(h.calls[0].text.includes('user@example.com'))
    assert.ok(h.calls[0].text.includes(runtime === 'pi' ? '`_SERMO_FILE_REF_0`' : '`_SERMO_FILE_REF_0`.'))
  })

  test(`${runtime}: references stay intact across long prompt chunks`, async () => {
    const source = '请检查 '.repeat(750) + '@src/登录.ts'
    const h = load(runtime, { answer: text => text.replaceAll('请检查', 'Please review') })
    assert.equal(await submit(runtime, h, source), source.replaceAll('请检查', 'Please review'))
    assert.ok(h.calls.length > 1)
    assert.ok(h.calls.every(call => call.text.length <= 3000 && !call.text.includes('@src/登录.ts')))
  })

  test(`${runtime}: accepts foreign translations and real English corrections`, () => {
    const h = load(runtime)
    const cases = [
      ['corrige cette erreur et explique la cause', 'fix this error and explain the cause', true],
      ['The file is in the folder and the folder is in the project.', 'The file is in the folder, and the folder is in the project.', true],
      ['fix bug', 'fix bugs', true],
      ['Please fix this bug.', 'Please fix this bug.', true],
      ['看一下现在的修改，主要是写pi的翻译插件', '查看当前的修改，主要是编写一个用于翻译 Pi 的插件。', false],
      ['看一下现在的修改，主要是写pi的翻译插件', 'Review the changes to the Pi translation plugin.', true],
      ['请检查 registerMarkdownTransformer 和 outboundBlock 的实现', '请审查 registerMarkdownTransformer 和 outboundBlock 的实现。', false],
      ['исправь ошибку', 'fix the error', true],
      ['Please fix 这个错误', 'Please fix this error', true],
      ['Fix 这个错误', 'Fix this error', true],
      ['Please fix 这个错误', 'Please fix 这个错误', false],
      ['fix bug', 'The provided text "fix bug" contains a typo.', false],
      ['fix bug', 'No changes needed.', false],
      ['fix all', noChangeCommentary, false],
      ['Looks good', noChangeCommentary, false],
      ['LGTM', noChangeCommentary, false],
      ['LGTM', 'Your message is already correct. No changes are needed.', false],
      [noChangeCommentary, noChangeCommentary, true],
      ['I wll read the source file.', 'I will read the source file.', true],
      ['Please keep `中文` unchanged.', 'Please keep `中文` unchanged.', true],
      ["把‘你好’翻成英文", "Translate ‘你好’ into English.", true],
      ['Please fix this file.', 'Please 修复 this file.', false],
      ['No changes needed.', 'No changes needed.', true],
      ['fix the `config.json` file', 'fix the `settings.json` file', false],
      ['tell me how to search telegram bot account', 'Tell me how to search for a Telegram bot account.', true],
      ['tell me how to search telegram bot account', 'Here’s how to search for a Telegram bot account.', false],
      ['how to search telegram bot account', 'Here are the steps to search for a Telegram bot account.', false],
      ['find telegram bot account', 'Search for the bot username in Telegram and open its profile to start chatting.', false],
      ['Here’s how to search telegram bot account.', 'Here’s how to search for a Telegram bot account.', true],
      ['下面是搜索 Telegram 机器人账号的方法。', 'Here’s how to search for a Telegram bot account.', true],
      ['123', '123', true],
    ]
    for (const [input, output, expected] of cases) assert.equal(h.okRewrite(input, output), expected, `${input} -> ${output}`)
  })

  for (const provider of ['openai', 'session']) {
    test(`${runtime}/${provider}: an answer cannot replace the Telegram search request`, async () => {
      const source = 'tell me how to search telegram bot account'
      const corrected = 'Tell me how to search for a Telegram bot account.'
      const answers = [
        'Here’s how to search for a Telegram bot account.',
        'Open Telegram and tap the search bar at the top of the screen. Type the bot’s username or name, then select the bot from the results and open its profile.',
      ]
      for (const answer of answers) {
        for (const retry of [answer, corrected]) {
          const h = load(runtime, { config: { provider }, answer: (_prompt, n, payload) => {
            assert.match(payload.messages[0].content, /Do not answer questions, fulfill requests/)
            return n === 1 ? answer : retry
          } })
          assert.equal(await submit(runtime, h, source), retry === corrected ? corrected : source)
          assert.equal(h.calls.length, 2)
          assert.match(h.calls[1].system, /Fix only grammar/)
          if (retry !== corrected) assert.ok(h.notices.some(message => /原文|原样/.test(message)))
        }
      }
    })

    test(`${runtime}/${provider}: no-change commentary never replaces a submitted prompt`, async () => {
      for (const text of ['fix all', 'Looks good', 'LGTM']) {
        const h = load(runtime, { config: { provider }, answer: () => noChangeCommentary })
        assert.equal(await submit(runtime, h, text), text)
        assert.equal(h.calls.length, 2, 'reject commentary from both attempts, then send the original')
        assert.ok(h.notices.some(message => /原文|原样/.test(message)))
      }
    })

    test(`${runtime}/${provider}: short English fragments receive the grammar rewrite instruction`, async () => {
      const h = load(runtime, { config: { provider }, answer: (_prompt, _n, payload) => {
        assert.match(payload.messages[0].content, /grammar/)
        return 'The Claude Code plugin, too.'
      } })
      assert.equal(await submit(runtime, h, 'claude code plugin also'), 'The Claude Code plugin, too.')
      assert.equal(h.calls.length, 1)
    })

    test(`${runtime}/${provider}: unchanged provider responses submit the exact original`, async () => {
      const text = '  fix all  '
      const h = load(runtime, { config: { provider }, answer: prompt => prompt })
      assert.equal(await submit(runtime, h, text), text)
      assert.equal(h.calls.length, 1)
      assert.ok(!h.notices.some(message => /失败/.test(message)))
    })

    test(`${runtime}/${provider}: commentary can retry into the original or a real correction`, async () => {
      for (const [text, corrected] of [['Looks good', 'Looks good'], ['I wll read the source file.', 'I will read the source file.']]) {
        const h = load(runtime, { config: { provider }, answer: (_prompt, n) => n === 1 ? noChangeCommentary : corrected })
        assert.equal(await submit(runtime, h, text), corrected)
        assert.equal(h.calls.length, 2)
      }
    })
  }

  test(`${runtime}: protects fenced and indented code and retains all source separators`, async () => {
    const h = load(runtime, { answer: () => 'Review this.' })
    const codeBlocks = [
      '~~~js\nconsole.log("你好")\n~~~',
      '````md\n```js\nconst x = "你好"\n```\n````',
      '```js\nconst x = "你好"',
      '    const x = "你好"\n    console.log(x)',
      '\tconst x = "你好"',
      '`const x = "你好"`',
      '~~~js\r\nconst x = "你好"\r\n~~~',
    ]
    for (const code of codeBlocks) {
      const source = `请检查\n\n\n${code}`
      const parts = h.splitParas(source)
      assert.equal(parts.map(p => p.code ?? p.separator ?? p.text).join(''), source)
      assert.ok(parts.some(p => p.code?.includes('你好')), code)
      const before = h.calls.length
      const result = await h.outboundBlock(context(runtime, h), source)
      assert.equal(result.text, `Review this.\n\n\n${code}`)
      assert.equal(h.calls.length - before, 1, 'code must never be requested')
    }
  })

  test(`${runtime}: mixed-language prompts accept faithful translations for every provider`, async () => {
    for (const provider of ['microsoft', 'openai', 'session']) {
      const h = load(runtime, { config: { provider }, answer: () => 'Please fix this error' })
      assert.equal(await submit(runtime, h, 'Please fix 这个错误'), 'Please fix this error')
      assert.equal(h.calls.length, 1)
    }
  })

  test(`${runtime}: Unicode prose is translated instead of classified as technical content`, async () => {
    const sources = [
      'Пожалуйста, исправь эту ошибку и объясни причину её появления.',
      'يرجى إصلاح هذا الخطأ وشرح سبب ظهوره وكيفية تجنبه في المستقبل.',
      'このもんだいをしらべてください。どうしておきたのか、どうやってなおせるのかをくわしくおしえてください。',
      'कृपया इस त्रुटि को ठीक करें और बताएं कि यह क्यों हुई और इसे कैसे रोका जा सकता है।',
    ]
    for (const source of sources) {
      const h = load(runtime, { answer: () => 'Please fix this error and explain its cause.' })
      assert.equal(await submit(runtime, h, source), 'Please fix this error and explain its cause.')
      assert.equal(h.calls.length, 1)
      assert.equal(await h.translateProse(context(runtime, h), source), 'Please fix this error and explain its cause.')
      assert.equal(h.calls.length, 2, 'the reply path must also recognize Unicode prose')
    }
    const h = load(runtime)
    for (const source of ['Error: connection reset', '{"a": 1, "b": 2}', '1234567890'.repeat(5)]) {
      assert.equal(await submit(runtime, h, source), source)
    }
    assert.equal(h.calls.length, 0, 'technical inputs must still be protected')
  })

  test(`${runtime}: list continuation paragraphs remain prose relative to their containers`, async () => {
    for (const source of [
      '- Review:\n\n    请检查这个修改',
      '1. Review:\n\n    请检查这个修改',
      '- Review:\n  - Details:\n\n      请检查这个修改',
      '> - Review:\n>\n>     请检查这个修改',
      'Review:\n    请检查这个修改',
    ]) {
      const h = load(runtime, { answer: text => text.replace('请检查这个修改', 'Please review these changes.') })
      const parts = h.splitParas(source)
      assert.equal(parts.map(p => p.code ?? p.separator ?? p.text).join(''), source)
      assert.ok(parts.some(p => p.text?.includes('请检查这个修改')), source)
      assert.equal(await submit(runtime, h, source), source.replace('请检查这个修改', 'Please review these changes.'))
    }
  })

  test(`${runtime}: container fences and indented code never reach either translation path`, async () => {
    const blocks = [
      '> ```js\n> const sentinel = "你好";\n> ```',
      '> > ~~~~js\n> > const sentinel = "你好";\n> > ~~~~',
      '- Example:\n\n    ```js\n    const sentinel = "你好";\n    ```',
      '- Example:\n\n      const sentinel = "你好";',
      '> - Example:\n>\n>     ~~~js\n>     const sentinel = "你好";\n>     ~~~',
      '- > - ```js\n  >   const sentinel = "你好";\n  >   ```',
      '> - > - ~~~~js\n>   >   const sentinel = "你好";\n>   >   ~~~~',
      '- > - ```md\n  >   > ```\n  >   const sentinel = "你好";\n  >   ```',
      '- > - ```js\r\n  >   const sentinel = "你好";\r\n  >   ```',
      '- > ```js\n  > const sentinel = "你好";\n  > ```',
      '> ```js\n> const sentinel = "你好";',
      '> ```js\r\n> const sentinel = "你好";\r\n> ```',
      '> ```md\n> > ```\n> const sentinel = "你好";\n> ```',
      '> - Example:\n>   ```md\n>   > ```\n>   const sentinel = "你好";\n>   ```',
      '```md\n> ```\nconst sentinel = "你好";\n```',
    ]
    for (const block of blocks) {
      const source = `请检查这个修改\n\n${block}`
      const h = load(runtime, { answer: text => text.replace('请检查这个修改', 'Please review these changes.') })
      const parts = h.splitParas(source)
      assert.equal(parts.map(p => p.code ?? p.separator ?? p.text).join(''), source)
      assert.ok(parts.some(p => p.code?.includes('const sentinel')), block)
      assert.equal(await submit(runtime, h, source), source.replace('请检查这个修改', 'Please review these changes.'))
      assert.ok(h.calls.every(call => !call.text.includes('const sentinel')), 'outbound code must not be requested')
      const reply = `Please review these changes.\n\n${block}`
      const replyHarness = load(runtime)
      let rendered
      if (runtime === 'pi') {
        await replyHarness.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: reply }] } }, replyHarness.ctx)
        await flush()
        rendered = replyHarness.transform(reply)
      } else {
        rendered = (await replyHarness.translateBlock(replyHarness.$, reply)).md
      }
      const protectedCode = parts.filter(p => p.code?.includes('const sentinel')).map(p => p.code).join('')
      assert.ok(rendered.includes(protectedCode), `rendered code must remain byte-for-byte intact: ${block}`)
      assert.ok(replyHarness.calls.every(call => !call.text.includes('const sentinel')), 'reply code must not be requested')
    }
  })

  test(`${runtime}: an unclosed container fence ends when its container ends`, async () => {
    const source = '> ```js\n> const sentinel = "你好";\n\n请检查这个修改'
    const h = load(runtime, { answer: text => text.replace('请检查这个修改', 'Please review these changes.') })
    assert.equal(await submit(runtime, h, source), source.replace('请检查这个修改', 'Please review these changes.'))
    assert.equal(h.calls.length, 1)
    assert.ok(!h.calls[0].text.includes('const sentinel'))
  })

  test(`${runtime}: chunks preserve source text and obey the request cap`, () => {
    const h = load(runtime)
    for (const source of ['x'.repeat(7001), 'Line of text. '.repeat(500) + '\n下一行', 'x'.repeat(2999) + '😀tail']) {
      const chunks = h.chunkParagraph(source)
      assert.equal(chunks.join(''), source)
      assert.ok(chunks.every(chunk => chunk.length <= 3000))
      assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)))
    }
  })

  test(`${runtime}: source-language polish retries with an explicit English instruction`, async () => {
    const source = '看一下现在的修改，主要是写pi的翻译插件'
    const h = load(runtime, { answer: (_text, n) => n === 1 ? '查看当前的修改，主要是编写一个用于翻译 Pi 的插件。' : 'Review the changes to the Pi translation plugin.' })
    assert.equal(await h.ensureEnglishProse(context(runtime, h), source), 'Review the changes to the Pi translation plugin.')
    assert.equal(h.calls.length, 2)
    assert.match(h.calls[1].system, /Translate.*English/)
  })

  test(`${runtime}: English first chunk cannot skip a Chinese suffix`, async () => {
    const h = load(runtime, { config: { provider: 'microsoft' }, answer: text => /请修复/.test(text)
      ? { from: 'zh-Hans', out: text.replace('请修复这个错误', 'Please fix this error.') }
      : { from: 'en', out: text } })
    const result = await h.ensureEnglishProse(context(runtime, h), 'Please review the implementation. '.repeat(100) + '\n请修复这个错误')
    assert.match(result, /Please fix this error/)
    assert.ok(h.calls.some(call => call.text.includes('请修复')))
    assert.ok(h.calls.every(call => call.text.length <= 3000))
  })

  test(`${runtime}: closing a CRLF fence must not swallow the following paragraph`, async () => {
    const h = load(runtime, { answer: () => 'Review this.' })
    const code = '~~~js\r\nconst x = "你好"\r\n~~~'
    const result = await h.outboundBlock(context(runtime, h), `请检查\r\n\r\n${code}\r\n\r\n请解释`)
    assert.equal(result.text, `Review this.\r\n\r\n${code}\r\n\r\nReview this.`)
    assert.equal(h.calls.length, 2)
  })

  test(`${runtime}: rejected retries are counted as failures while preserving original text`, async () => {
    const source = '请检查这个修改'
    const h = load(runtime, { answer: () => '仍然只是中文润色。' })
    const result = await h.outboundBlock(context(runtime, h), source)
    assert.equal(result.text, source)
    assert.equal(result.changed, false)
    assert.equal(result.errors, 1)
    assert.match(h.logs.at(-1), /outbound paragraph error/)
  })

  test(`${runtime}: a long reply never becomes an oversized translation request`, async () => {
    const h = load(runtime)
    const result = await h.translateProse(context(runtime, h), 'Here is a long explanation. '.repeat(300))
    assert.ok(result)
    assert.ok(h.calls.length >= 3)
    assert.ok(h.calls.every(call => call.text.length <= 3000))
  })
}

test('Pi: a placeholder split at the request limit cannot escape into the submitted prompt', async () => {
  const source = '请'.repeat(2995) + '@src/登录.ts'
  const h = load('pi', { answer: text => text.replaceAll('请', 'Review ').replace('`SERM', 'BROKEN') })
  assert.ok(await submit('pi', h, source) === source, 'a damaged split marker must fall back to the original')
  assert.ok(h.calls.length > 1)
  assert.ok(h.calls.every(call => !call.text.includes('@src/登录.ts')))
  assert.ok(h.notices.some(message => /保留原文/.test(message)))
})

test('Pi: retries preserve masked references and restore them after a valid rewrite', async () => {
  const source = '请检查 @src/登录.ts'
  const h = load('pi', { answer: (text, n) => n === 1
    ? 'The prompt is already correct.'
    : text.slice(text.lastIndexOf('\n\n') + 2).replace('请检查', 'Please review') })
  assert.equal(await submit('pi', h, source), 'Please review @src/登录.ts')
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls.every(call => !call.text.includes('@src/登录.ts')))
})

test('Pi: reference placeholders cannot acquire quotes or leak extra markers', async () => {
  const source = '请检查 @src/登录.ts'
  for (const corrupt of [
    text => text.replace('`SERMO_FILE_REF_0`', '"`SERMO_FILE_REF_0`"'),
    text => text.replace('`SERMO_FILE_REF_0`', '``SERMO_FILE_REF_0``'),
    text => text + ' SERMO_FILE_REF_99',
  ]) {
    const h = load('pi', { answer: text => corrupt(text.replace('请检查', 'Please review')) })
    assert.equal(await submit('pi', h, source), source)
  }
})

test('Pi: existing quote and code wrappers around mentions remain intact', async () => {
  for (const ref of ['`@src/登录.ts`', '"@src/app.ts"', '@"docs/使用 指南.md"']) {
    const source = `请检查 ${ref}`
    const h = load('pi', { answer: text => text.replace('请检查', 'Please review') })
    assert.equal(await submit('pi', h, source), `Please review ${ref}`)
  }
})

test('Pi: file references adjoining Chinese prose and paths with punctuation are protected', async () => {
  for (const source of ['请检查@src/登录.ts', '请检查 @src/组件(旧版).tsx', '请检查 @src/a,b.ts', '请检查 @src/[id].ts']) {
    const h = load('pi', { answer: text => {
      assert.ok(!text.includes('@src/'), 'the complete mention must be hidden')
      assert.ok(!/登录|组件|旧版|\[id\]|a,b/.test(text), 'path suffixes must also be hidden')
      return text.replace('请检查', 'Please review')
    } })
    assert.equal(await submit('pi', h, source), source.replace('请检查', 'Please review'))
  }
})

test('Pi: intermediate text and thinking render before final message_end', async () => {
  const h = load('pi')
  const { initTheme } = await import('../pi/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js')
  initTheme('dark', false)
  const { AssistantMessageComponent } = await import('../pi/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js')
  const message = { role: 'assistant', stopReason: 'toolUse', content: [
    { type: 'thinking', thinking: 'I will inspect the source first.' },
    { type: 'thinking', thinking: 'Then I will verify the behavior.' },
    { type: 'text', text: 'I will check the implementation.' },
    { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'file.ts' } },
  ] }
  const before = structuredClone(message)
  const component = new AssistantMessageComponent(message, false, undefined, undefined, 1, [(md, ctx) => h.transform(md, ctx.messageType, ctx.isStreaming)])
  component.updateContent(message, true)
  h.components.push(component)
  await h.hooks.get('message_update')({ message, assistantMessageEvent: { type: 'text_end' } }, h.ctx)
  await flush()
  assert.match(h.transform(message.content[2].text, 'assistant', true), /译文/)
  assert.match(h.transform(message.content.slice(0, 2).map(c => c.thinking).join('\n\n'), 'assistant-thinking', true), /译文/)
  assert.match(component.render(100).join('\n'), /译文/)
  assert.deepEqual(message, before, 'translations must not mutate model/session content')
  const count = h.calls.length
  await h.hooks.get('message_end')({ message }, h.ctx)
  await flush()
  assert.equal(h.calls.length, count, 'message_end must deduplicate completed block requests')
})

test('Pi: Mermaid transformation preserves translated prose and rendered diagram', async () => {
  const { createMermaidMarkdownTransformer } = await import('../pi/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/mermaid.js')
  for (const gap of ['\n\n', '\n']) {
    const h = load('pi')
    const source = `Here is the architecture.${gap}\`\`\`mermaid\ngraph LR\n A --> B\n\`\`\`${gap}Here is the summary.`
    await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: source }] } }, h.ctx)
    await flush()
    const mermaid = createMermaidMarkdownTransformer({ getMode: () => 'streaming' })
    const rendered = mermaid(source, { messageType: 'assistant', isStreaming: false, availableWidth: 100 })
    assert.notEqual(rendered, source)
    const translated = h.transform(rendered)
    assert.match(translated, /译文：Here is the architecture/)
    assert.match(translated, /译文：Here is the summary/)
    const diagramRow = rendered.split('\n').find(line => line.includes('┌'))
    assert.ok(diagramRow && translated.includes(diagramRow), 'keep Pi diagram output')
    assert.equal(h.calls.length, 2, 'diagram code must not be translated')
  }
})

test('Pi: code-only replies retain indentation before scheduling', async () => {
  for (const source of ['    const sentinel = "你好";', '\tconst sentinel = "你好";']) {
    const h = load('pi')
    await h.hooks.get('message_end')({ message: { role: 'assistant', content: [
      { type: 'thinking', thinking: source }, { type: 'text', text: source },
    ] } }, h.ctx)
    await flush()
    assert.equal(h.calls.length, 0, 'structural whitespace must not be trimmed before identifying code')
    assert.equal(h.transform(source), source)
  }
})

test('Pi: failed translation logs its cause, can retry, and does not claim readiness', async () => {
  let offline = true
  const h = load('pi', { answer: () => { if (offline) throw new Error('provider offline'); return '这是说明。' } })
  const message = { role: 'assistant', content: [{ type: 'text', text: 'Here is the explanation.' }] }
  await h.hooks.get('message_end')({ message }, h.ctx)
  await flush()
  assert.ok(h.notices.some(message => message.includes('翻译失败')))
  assert.ok(!h.notices.includes('译文就绪'))
  assert.match(h.logs.at(-1), /provider offline/)
  offline = false
  await h.commands.get('translate').handler('', h.ctx)
  await h.commands.get('translate').handler('', h.ctx)
  await flush()
  assert.match(h.transform(message.content[0].text), /这是说明/)
})

test('Pi: technical/target-language skips never announce translation readiness', async () => {
  const h = load('pi')
  for (const text of ['这已经是中文。', 'Error: connection reset']) {
    await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text }] } }, h.ctx)
  }
  await flush()
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.notices, [])
})

test('Pi: failed outbound remains original and explicitly reports fallback', async () => {
  const h = load('pi', { answer: () => '仍然只是中文润色。' })
  const result = await h.hooks.get('input')({ source: 'interactive', text: '请检查这个修改' }, h.ctx)
  assert.equal(result.action, 'continue')
  assert.equal(h.calls.length, 2)
  assert.ok(h.notices.some(message => message.includes('保留原文')))
  assert.match(h.logs.at(-1), /outbound paragraph error/)
})

test('Pi: conflicting originals never overwrite an earlier message label or cross sessions', async () => {
  const h = load('pi', { answer: () => 'Hello' })
  await h.hooks.get('input')({ source: 'interactive', text: '你好' }, h.ctx)
  assert.match(h.transform('Hello', 'user'), /你好/)
  await h.hooks.get('input')({ source: 'interactive', text: '您好' }, h.ctx)
  assert.equal(h.transform('Hello', 'user'), 'Hello')
  await h.hooks.get('session_shutdown')({}, h.ctx)
  await h.hooks.get('session_start')({}, h.ctx)
  assert.equal(h.transform('Hello', 'user'), 'Hello')
})

test('Pi: resume translates existing intermediate text and thinking', async () => {
  const message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'I should inspect the code.' }, { type: 'text', text: 'I will review this first.' }] }
  const h = load('pi', { branch: [{ type: 'message', message }] })
  await h.hooks.get('session_start')({}, h.ctx)
  await flush()
  assert.match(h.transform(message.content[0].thinking, 'assistant-thinking'), /译文/)
  assert.match(h.transform(message.content[1].text), /译文/)
})

test('Pi: tree navigation rebuilds history, protects raw English, and cancels abandoned work', async () => {
  let release
  const options = { branch: [], answer: text => text === 'An abandoned response.'
    ? new Promise(resolve => { release = resolve })
    : text === '你好' ? 'Hello' : `译文：${text}` }
  const h = load('pi', options)
  await h.hooks.get('session_start')({}, h.ctx)
  assert.equal(await submit('pi', h, '你好'), 'Hello')
  assert.match(h.transform('Hello', 'user'), /你好/)
  await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'An abandoned response.' }] } }, h.ctx)
  const abandoned = h.calls.find(call => call.text === 'An abandoned response.')
  options.branch = [
    { type: 'message', message: { role: 'user', content: 'Hello' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'I will inspect branch B.' }, { type: 'text', text: 'Here is branch B.' }] } },
  ]
  await h.hooks.get('session_tree')({ oldLeafId: 'A', newLeafId: 'B' }, h.ctx)
  assert.equal(abandoned.signal.aborted, true)
  assert.equal(h.transform('Hello', 'user'), 'Hello')
  await flush()
  assert.match(h.transform('Here is branch B.'), /译文/)
  assert.match(h.transform('I will inspect branch B.', 'assistant-thinking'), /译文/)
  assert.equal(await submit('pi', h, '你好'), 'Hello')
  assert.equal(h.transform('Hello', 'user'), 'Hello', 'the existing English message cannot acquire a new original')
  const noticesBefore = h.notices.length
  release('旧分支译文')
  await flush()
  assert.equal(h.transform('An abandoned response.'), 'An abandoned response.')
  assert.equal(h.notices.length, noticesBefore, 'abandoned work cannot notify or repaint the new branch')
})

test('Pi: tree navigation reuses completed translations and guards an in-flight submission', async () => {
  let release
  const message = { role: 'assistant', content: [{ type: 'text', text: 'A shared response.' }] }
  const options = { branch: [{ type: 'message', message }], answer: text => text === '请检查'
    ? new Promise(resolve => { release = resolve }) : `译文：${text}` }
  const h = load('pi', options)
  await h.hooks.get('session_start')({}, h.ctx)
  await flush()
  const callsBefore = h.calls.length
  const pending = h.hooks.get('input')({ source: 'interactive', text: '请检查' }, h.ctx)
  const outbound = h.calls.at(-1)
  await h.hooks.get('session_tree')({ oldLeafId: 'A', newLeafId: 'B' }, h.ctx)
  await flush()
  assert.equal(outbound.signal.aborted, true)
  assert.equal(h.calls.length, callsBefore + 1, 'completed history translations must be reused')
  assert.match(h.transform('A shared response.'), /译文/)
  release('Please review.')
  assert.equal((await pending).action, 'handled', 'the abandoned prompt must not be submitted to the new branch')
  assert.equal(h.transform('Please review.', 'user'), 'Please review.')
})

test('Pi: tree navigation discards queued work without overwriting a fresh matching paragraph', async () => {
  const releases = []
  let switched = false
  const options = { branch: [], answer: text => switched ? `新译文：${text}` : new Promise(resolve => releases.push(resolve)) }
  const h = load('pi', options)
  await h.hooks.get('session_start')({}, h.ctx)
  for (let i = 0; i < 8; i++) {
    await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: `Response ${i}.` }] } }, h.ctx)
  }
  assert.equal(h.calls.length, 4)
  options.branch = [{ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Response 0.' }] } }]
  switched = true
  await h.hooks.get('session_tree')({ oldLeafId: 'A', newLeafId: 'B' }, h.ctx)
  for (const release of releases) release('旧译文')
  await flush()
  assert.equal(h.calls.length, 5, 'only the new branch may fetch after queued old work is cancelled')
  assert.match(h.transform('Response 0.'), /新译文/)
  assert.ok(!h.transform('Response 0.').includes('旧译文'))
  assert.equal(h.notices.filter(message => message === '译文就绪').length, 0)
})

test('Pi: old chunk and retry loops cannot issue requests after tree navigation', async () => {
  const releases = []
  const h = load('pi', { answer: () => new Promise(resolve => releases.push(resolve)) })
  await h.hooks.get('session_start')({}, h.ctx)
  await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'A long abandoned explanation. '.repeat(240) }] } }, h.ctx)
  const pending = h.hooks.get('input')({ source: 'interactive', text: 'Looks good' }, h.ctx)
  assert.equal(h.calls.length, 2)
  await h.hooks.get('session_tree')({ oldLeafId: 'A', newLeafId: 'B' }, h.ctx)
  for (const release of releases) release(noChangeCommentary)
  assert.equal((await pending).action, 'handled')
  await flush()
  assert.equal(h.calls.length, 2, 'neither the next reply chunk nor the outbound retry may start')
  assert.deepEqual(h.notices, [])
})

test('Pi: session shutdown aborts work and stale results cannot repaint the next session', async () => {
  let resolve
  const h = load('pi', { answer: () => new Promise(r => { resolve = r }) })
  await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'An old response.' }] } }, h.ctx)
  await h.hooks.get('session_shutdown')({}, h.ctx)
  assert.equal(h.calls[0].signal.aborted, true)
  await h.hooks.get('session_start')({}, h.ctx)
  resolve('旧会话译文')
  await flush()
  assert.equal(h.transform('An old response.'), 'An old response.')
  assert.deepEqual(h.notices, [])
})

test('Pi: raw English submissions cannot inherit an older translated original', async () => {
  const h = load('pi', { answer: () => 'Hello' })
  await h.hooks.get('input')({ source: 'interactive', text: '你好' }, h.ctx)
  await h.hooks.get('message_start')({ message: { role: 'user', content: 'Hello' } }, h.ctx)
  assert.match(h.transform('Hello', 'user'), /你好/)
  await h.hooks.get('input')({ source: 'interactive', text: 'Hello' }, h.ctx)
  assert.equal(h.transform('Hello', 'user'), 'Hello')
})

test('Pi: prior raw English in history prevents a later translation from relabeling it', async () => {
  const h = load('pi', { answer: () => 'Hello', branch: [{ type: 'message', message: { role: 'user', content: 'Hello' } }] })
  await h.hooks.get('session_start')({}, h.ctx)
  await h.hooks.get('input')({ source: 'interactive', text: '你好' }, h.ctx)
  assert.equal(h.transform('Hello', 'user'), 'Hello')
})

test('Pi: another session cannot clear parent caches or abort parent translations', async () => {
  let release
  const parent = load('pi', { answer: text => text === 'A pending parent reply.'
    ? new Promise(resolve => { release = resolve })
    : text === '你好' ? 'Hello' : `译文：${text}` })
  await parent.hooks.get('session_start')({}, parent.ctx)
  await submit('pi', parent, '你好')
  await parent.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'A completed parent reply.' }] } }, parent.ctx)
  await flush()
  await parent.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'A pending parent reply.' }] } }, parent.ctx)
  const pendingSignal = parent.calls.at(-1).signal

  // The host can reuse one imported module when loading a child session.
  const childHooks = new Map()
  parent.default({
    registerShortcut() {}, registerCommand() {}, registerMarkdownTransformer() {},
    on: (name, handler) => childHooks.set(name, handler),
  })
  await childHooks.get('session_start')({}, parent.ctx)
  assert.match(parent.transform('Hello', 'user'), /你好/)
  assert.match(parent.transform('A completed parent reply.'), /译文/)
  await childHooks.get('session_shutdown')({}, parent.ctx)
  assert.equal(pendingSignal.aborted, false, 'child shutdown must not cancel parent work')
  release('父会话译文')
  await flush()
  assert.match(parent.transform('A pending parent reply.'), /父会话译文/)

  await parent.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: 'A new parent reply.' }] } }, parent.ctx)
  await flush()
  assert.match(parent.transform('A new parent reply.'), /译文/)
  assert.equal(parent.calls.at(-1).signal.aborted, false)
  assert.equal(await submit('pi', parent, '你好'), 'Hello')
  assert.ok(!parent.notices.some(message => /失败/.test(message)))
})

test('Pi: source and command guards do not issue translation requests', async () => {
  const h = load('pi')
  for (const event of [{ source: 'extension', text: '请检查' }, { source: 'rpc', text: '请检查' }, { source: 'interactive', text: '/translate' }]) {
    assert.equal((await h.hooks.get('input')(event, h.ctx)).action, 'continue')
  }
  assert.equal(h.calls.length, 0)
})

test('Pi: concurrent intermediate replies share a four-request translation limit', async () => {
  let active = 0, peak = 0
  const releases = []
  const h = load('pi', { answer: text => new Promise(resolve => {
    active++; peak = Math.max(active, peak)
    releases.push(() => { active--; resolve(`译文：${text}`) })
  }) })
  for (let i = 0; i < 12; i++) {
    await h.hooks.get('message_end')({ message: { role: 'assistant', content: [{ type: 'text', text: `Response number ${i}.` }] } }, h.ctx)
  }
  assert.equal(peak, 4)
  while (releases.length) { for (const release of releases.splice(0)) release(); await flush() }
  assert.equal(h.calls.length, 12)
  assert.equal(peak, 4)
})

test('Claude: a failed reply records error rather than skip/readiness', async () => {
  const h = load('claude', { answer: () => { throw new Error('provider offline') } })
  h.scheduleOne(h.$, 'Here is the explanation.')
  await flush()
  assert.ok(h.notices.some(message => message.includes('翻译失败')))
  assert.ok(!h.notices.includes('译文就绪'))
  assert.match(h.logs.at(-1), /state=error/)
  assert.match(h.logs.at(-1), /provider offline/)
})
