/**
 * sermo-grammar — 检查输入框里的英文，并给出更自然的写法。
 *
 * 手动触发：/grammar 命令，或把键位绑到 command:grammar（见 README）。
 *
 * 为什么能读输入框：mods API 的 $.prompt.read() 读当前草稿、
 * $.prompt.fill() 写回；$.model.complete() 走本会话自己的模型凭证，
 * 不需要额外的 API key，也不占用对话上下文。
 */

const PANE = 'sermo-grammar'
const MODEL = 'haiku' // 便宜、快；够做语法判断
const MAX_TOKENS = 2000
const TIMEOUT_MS = 30_000

// 最后一次非斜杠命令的草稿。prompt.read() 在命令已提交后可能拿到空串，
// 用它兜底。
let lastDraft = ''

// 面板状态，一次检查一份
let state = null // { phase: 'checking' | 'done' | 'error', draft, result, error }

const SYSTEM = `You are a writing assistant inside a coding agent's prompt box.
The user writes prompts to an AI coding agent, usually in English, and is a Chinese speaker.
Rewrite the draft into natural, correct English, and report what was wrong.

Return STRICT JSON only, no markdown fence, no prose, exactly this shape:
{
  "ok": boolean,          // true when the English is already correct and natural
  "corrected": string,    // the whole draft in natural English
  "issues": [{ "wrong": string, "right": string, "why": string }],   // "why" in English, one short clause
  "terms":  [{ "zh": string, "en": string[], "note": string }]      // one entry per Chinese fragment in the draft; "note" in English
}

Rules:
- Keep code, identifiers, file paths, commands, flags, URLs and numbers byte-for-byte unchanged.
- Preserve the request's meaning, scope and tone. Do not add or drop requests.
- If the draft contains Chinese, render it as natural English inside "corrected", and list each Chinese fragment in "terms" with the English the user most likely wants.
- A Chinese fragment is NOT a grammar issue: list it only in "terms", never in "issues".
- "corrected" is the full draft, ready to send, not a diff.
- Explain every "why" and "note" in plain English, not Chinese.
- Keep every explanation under 15 words, no jargon, no grammar terminology.`

/** 从模型回复里抠出 JSON，容忍 ``` 围栏和前后废话。 */
function parseResult(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('the model did not return JSON')
  const raw = JSON.parse(body.slice(start, end + 1))
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    ok: raw?.ok === true,
    corrected: typeof raw?.corrected === 'string' ? raw.corrected : '',
    issues: arr(raw?.issues).map((i) => ({ wrong: String(i?.wrong ?? ''), right: String(i?.right ?? ''), why: String(i?.why ?? '') })),
    terms: arr(raw?.terms).map((t) => ({ zh: String(t?.zh ?? ''), en: arr(t?.en).map(String), note: String(t?.note ?? '') })),
  }
}

async function check($, draft) {
  const r = await $.model.complete({
    model: MODEL,
    system: SYSTEM,
    prompt: draft,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
  })
  if (!r.isAnswered) throw new Error(`the model did not answer (${r.reason ?? 'unknown'})`)
  const result = parseResult(r.text)
  // 模型没给出改写稿时退回原文，"替换"永远不把输入框清空
  if (!result.corrected.trim()) result.corrected = draft
  return result
}

/** 没有面板可用时（-p、SDK、Desktop 不支持 pane）退回纯文本报告。 */
function formatReport(draft, result) {
  const { ok, corrected, issues = [], terms = [] } = result
  const lines = ['sermo-grammar']
  if (ok && issues.length === 0 && terms.length === 0) lines.push('✓ No grammar issues.')
  for (const it of issues) lines.push(`- ${it.wrong} → ${it.right}  (${it.why})`)
  for (const t of terms) lines.push(`- ${t.zh} → ${t.en.join(' / ')}${t.note ? '  ' + t.note : ''}`)
  lines.push('', 'Rewritten:', corrected)
  return lines.join('\n')
}

/** 触发检查：读草稿 → 开面板 → 调模型。 */
async function run($, e) {
  const read = (await $.prompt.read()).text
  const draft = (e.args || '').trim() || (read && !read.startsWith('/') ? read : '') || lastDraft
  if (!draft.trim()) {
    $.ui.toast('sermo-grammar: the prompt box is empty — write something first')
    return {}
  }

  const headless = (await $.session.surfaces()).length === 0
  let focused = false

  state = { phase: 'checking', draft, focused: false }
  if (!headless) {
    // A pane only gets the keyboard while the composer is empty, so move the
    // draft out of the box first. state.draft keeps it until we put it back.
    await $.prompt.fill({ text: '', mode: 'replace' })
    await $.ui.open({ id: PANE, title: 'Sermo · English check', focus: true, closeOnEscape: true })
    focused = (await $.ui.panes()).some((p) => p.id === PANE && p.isFocused)
    // No focus (narrow terminal, or the pane was refused): never leave the box empty.
    if (!focused) await $.prompt.fill({ text: draft, mode: 'replace' })
    state = { phase: 'checking', draft, focused }
    $.ui.invalidate('ui.render')
  }

  let result, error
  try {
    result = await check($, draft)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  state = error ? { phase: 'error', draft, error, focused } : { phase: 'done', draft, result, focused }

  // 没有可视界面（-p / SDK）：把报告当文本返回，让 headless 也能用
  if (headless) {
    return { text: error ? `sermo-grammar: ${error}` : formatReport(draft, result) }
  }

  $.ui.invalidate('ui.render')
  return {}
}

function renderPane($, e) {
  const { Box, Text, Button, Markdown } = $.ui.resolve(e)
  const close = () => $.ui.close({ id: PANE })

  if (!state) {
    return Box({ flexDirection: 'column', children: [Text({ children: ['Run /grammar to check the prompt box.'] })] })
  }

  const header = Text({
    bold: true,
    children: [state.phase === 'checking' ? 'Checking…' : state.phase === 'error' ? 'Check failed' : 'English check'],
  })

  if (state.phase === 'checking') {
    return Box({ flexDirection: 'column', children: [header, Text({ dimColor: true, children: ['Reading the prompt box and asking the model…'] })] })
  }

  if (state.phase === 'error') {
    return Box({
      flexDirection: 'column',
      children: [header, Text({ color: 'red', children: [state.error] }), Button({ key: 'close', label: 'Close', hotkey: 'q', plain: true, onPress: close })],
    })
  }

  const { ok, corrected, issues = [], terms = [] } = state.result
  const children = [header]

  if (ok && issues.length === 0 && terms.length === 0) {
    children.push(Text({ color: 'green', children: ['✓ No grammar issues — send it.'] }))
  }

  if (issues.length > 0) {
    children.push(Text({ children: [' '] }))
    for (const [i, it] of issues.entries()) {
      children.push(
        Box({
          key: 'issue-' + i,
          flexDirection: 'column',
          children: [
            Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [Text({ color: 'red', children: [it.wrong] }), Text({ dimColor: true, children: ['→'] }), Text({ color: 'green', children: [it.right] })],
            }),
            Text({ dimColor: true, children: ['  ' + it.why] }),
          ],
        }),
      )
    }
  }

  if (terms.length > 0) {
    children.push(Text({ children: [' '] }))
    children.push(Text({ bold: true, children: ['Chinese → English'] }))
    for (const [i, t] of terms.entries()) {
      children.push(
        Text({
          key: 'term-' + i,
          children: [t.zh + ' → ' + t.en.join(' / ') + (t.note ? '  ' + t.note : '')],
        }),
      )
    }
  }

  children.push(Text({ children: [' '] }))
  children.push(Text({ dimColor: true, children: ['Rewritten prompt:'] }))
  children.push(Markdown({ key: 'corrected', text: corrected }))
  children.push(Text({ children: [' '] }))
  if (!state.focused) {
    children.push(Text({ dimColor: true, children: ['This panel has no keyboard focus — press Ctrl+X Tab to focus it, then a / c / o / q.'] }))
    children.push(Text({ children: [' '] }))
  }
  children.push(
    Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Button({
          key: 'apply',
          label: 'Replace prompt',
          hotkey: 'a',
          autoFocus: true,
          onPress: async () => {
            const filled = await $.prompt.fill({ text: corrected, mode: 'replace' })
            await close()
            $.ui.toast(filled.isFilled ? 'Prompt replaced — press Enter to send' : 'No prompt box to write to')
          },
        }),
        Button({
          key: 'copy',
          label: 'Copy',
          hotkey: 'c',
          plain: true,
          onPress: async () => {
            await $.ui.copy({ text: corrected, surface: e.surface })
            $.ui.toast('Rewritten prompt copied')
          },
        }),
        Button({
          key: 'restore',
          label: 'Revert',
          hotkey: 'o',
          plain: true,
          onPress: async () => {
            const filled = await $.prompt.fill({ text: state.draft, mode: 'replace' })
            await close()
            $.ui.toast(filled.isFilled ? 'Original restored' : 'No prompt box to write to')
          },
        }),
        Button({ key: 'close', label: 'Close', hotkey: 'q', plain: true, onPress: close }),
      ],
    }),
  )

  return Box({ flexDirection: 'column', children })
}

export function register(on) {
  // 记住草稿，供命令触发时兜底
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    const text = (r && r.text) ?? e.text ?? ''
    if (text && !text.trimStart().startsWith('/')) lastDraft = text
    return r
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'grammar', description: 'Check the English in the prompt box and offer a better phrasing', argumentHint: '[optional text to check]' })
    return next(e)
  })

  on('command.run', { command: 'grammar' }, async ($, e) => {
    try {
      return await run($, e)
    } catch (err) {
      // 不让错误静默：命令 hook 抛错会被跳过，什么都看不到
      return { text: 'sermo-grammar error: ' + (err instanceof Error ? err.message : String(err)) }
    }
  })

  // 面板关闭时，如果输入框还是空的（用户按了 Esc / 点了 ✕），把原文还回去
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const original = state?.draft
    if (original && !(await $.prompt.read()).text.trim()) {
      await $.prompt.fill({ text: original, mode: 'replace' })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return renderPane($, e)
  })
}
