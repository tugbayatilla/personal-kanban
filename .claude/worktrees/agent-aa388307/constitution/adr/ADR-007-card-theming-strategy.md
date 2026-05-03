# ADR-007: Card theming strategy

## Status

Accepted

## Context

Users requested the ability to change card appearance without writing code. The question is what mechanism to use.

Options considered:
- **Microsoft Adaptive Cards** — Rejected: 200KB dependency, complex schema, designed for Microsoft surfaces (Teams, Outlook), overkill for a local kanban tool
- **Handlebars/Mustache templates** — Rejected: requires HTML knowledge, XSS risk with user-supplied templates
- **Named built-in themes + optional custom CSS path** — Chosen: zero new dependencies, no new format to learn, backward compatible

## Decision

The manifest gains a single optional `"theme"` field. Its value is either:
- A built-in theme name: `"default"` | `"compact"` | `"minimal"`
- A relative path to a CSS file: `"./my-theme.css"` (resolved from `.personal-kanban/`)

If absent, `"default"` is used. Fully backward compatible.

Built-in themes:
- **default** — current look
- **compact** — reduced padding, smaller font, more cards visible per column
- **minimal** — no card borders, no background, title-only unless hovered

## Consequences

- `manifest.json` schema gains one optional field: `"theme": string`
- Board webview reads `manifest.theme` from setState payload and applies `class="theme-compact"` to body, or injects custom CSS as inline `<style>` block
- Built-in theme CSS lives in `media/themes/`
- `io.ts` Manifest type gains `theme?: string`
- No changes to card file format — theming is purely a rendering concern
