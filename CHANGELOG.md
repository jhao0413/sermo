# Changelog

## Unreleased

- Add a `translation_only` setting for Pi and Claude Code to show translated replies without the source paragraphs; Pi also applies it to thinking content. Code and untranslated paragraphs remain visible.
- Add `/translate only` and `/translate bilingual` to switch display modes using cached translations. The default remains bilingual display.

## 0.1.2

- Fix the Claude Code translation plugin failing to load because cancellation code wrapped and reassigned the special `$` hook API object.
- Pass cancellation state separately through translation chunks and retries, preserving cancellation when translation is disabled and re-enabled.
- Add regression coverage for outgoing translation and cancellation across Microsoft, session, and OpenAI-compatible providers, and include it in the test command.

Validation: 101 tests pass; TypeScript checks pass; the plugin loads successfully in Claude Code 2.1.309.
