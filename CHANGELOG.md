# Changelog

## 0.1.5

- Add a single `translate` list to Pi and Claude Code to choose `prompts`, `replies`, and/or `thinking`; all are enabled by default. An empty list translates nothing.
- Support translating thinking alone with `"translate": ["thinking"]`. When the list is omitted, existing `outbound`, `translate_replies`, and `translate_thinking` settings remain effective; legacy switches are hidden from Claude's config panel.
- Add Claude Code live thinking translation through `turn.step`, preserving the model's signed thinking in the transcript. Thinking blocks appear after translation completes; previously displayed and restored thinking cannot be translated or toggled through Claude's current plugin API.

Validation: 178 shared tests and 6 Claude host tests pass; Pi and Claude TypeScript checks, Claude plugin validation, and npm package inspection pass.

## 0.1.4

- Remember `/translate on/off` across new sessions and reloads in Pi and Claude Code.
- Remember reply translation visibility changed with Ctrl+Y or `/translate`.
- Preserve other configuration when saving preferences and report save failures without interrupting the current session.

Validation: 164 tests pass; Pi TypeScript check and Claude plugin validation pass.

## 0.1.3

- Add a `translation_only` setting for Pi and Claude Code to show translated replies without the source paragraphs; Pi also applies it to thinking content. Code and untranslated paragraphs remain visible.
- Add `/translate only` and `/translate bilingual` to switch display modes using cached translations. The default remains bilingual display.
- Retry failed translation requests up to four attempts. If outgoing translation ultimately fails, cancel the entire submission and its remaining translation work instead of sending a partial rewrite.

Validation: 158 tests pass; TypeScript checks pass.

## 0.1.2

- Fix the Claude Code translation plugin failing to load because cancellation code wrapped and reassigned the special `$` hook API object.
- Pass cancellation state separately through translation chunks and retries, preserving cancellation when translation is disabled and re-enabled.
- Add regression coverage for outgoing translation and cancellation across Microsoft, session, and OpenAI-compatible providers, and include it in the test command.

Validation: 101 tests pass; TypeScript checks pass; the plugin loads successfully in Claude Code 2.1.309.
