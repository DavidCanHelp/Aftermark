# Aftermark

**Your bookmarks are breadcrumbs.**

Aftermark is a Chrome extension that treats your bookmarks as compressed intentions, not passive links. Every bookmark you saved carried an unfinished thought — something to read, compare, learn, decide, or build. Aftermark recovers that intention and helps you act on it. Local-first, privacy-respecting, no cloud dependency.

## Status

v0.1.0 — Milestone 2 complete. Local analysis, classification, and duplicate detection are working. No AI calls yet.

## Features

- **Full bookmark import** — reads the entire Chrome bookmark tree and stores it in local IndexedDB (tested with 8,383 bookmarks)
- **Content type classification** — heuristic-based classification into: `github-repo`, `article`, `video`, `docs`, `forum`, `shopping`, `travel`, `academic`, `social`, `reference`, `tool`
- **Duplicate detection** — smart URL normalization strips `www.`, protocol differences, trailing slashes, hash fragments, and sorts query parameters before comparing
- **Dead link checker** — HEAD request with GET fallback, batched (10 concurrent, 500ms between batches), with progress bar in the popup
- **Searchable popup** — filter bookmarks by title, URL, domain, tags, or content type
- **Dark theme UI** — color-coded content type badges, domain display, status indicators, stats dashboard with type breakdown

## Roadmap

- **Milestone 3: AI enrichment** — BYOK Anthropic API integration for per-bookmark summary, intent inference, and topic labeling
- **Milestone 4: Clustering** — group bookmarks into projects, decisions, learning paths, and topics
- **Milestone 5: Artifact generation** — turn clusters into reading lists, comparison tables, checklists, and research briefs

## Architecture

Three-layer separation:

1. **Capture/Index** (local) — deterministic code handles structure, normalization, classification
2. **Inference** (AI, selective) — LLM interprets meaning, summarizes, infers intent
3. **Action** (user-facing) — generates artifacts, surfaces recommendations

The LLM is never the source of truth. Local deterministic code owns structure, the LLM provides interpretation, and the user provides correction.

## Tech

Chrome MV3, TypeScript, esbuild, IndexedDB via [idb](https://github.com/jakearchibald/idb). No frameworks.

## Privacy

All data stays local in IndexedDB. No telemetry. No backend. No account required. Future AI features use your own API key (BYOK) — keys are stored in `chrome.storage.local` and never leave your machine.

## Build

```bash
npm install
npm run build
```

Then load the extension in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the repo root directory

## License

MIT
