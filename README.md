# Aftermark

**Your bookmarks are breadcrumbs.**

Aftermark is a Chrome extension that treats your bookmarks as compressed intentions, not passive links. Every bookmark you saved carried an unfinished thought — something to read, compare, learn, decide, or build. Aftermark recovers that intention and helps you act on it. Local-first, privacy-respecting, no cloud dependency.

## Status

v0.2.0 — Full tab UI, deterministic clustering, session reconstruction, timeline, review dashboard, and export. All local analysis, no AI calls yet.

## Features

### Full Tab UI

Six-view dark theme interface with sidebar navigation. Open via popup or browser action.

- **Dashboard** — stat cards (total, duplicates, dead, stale, clusters, sessions), top 10 domains, content type distribution, bookmarks per month, oldest/newest, bookmark rate
- **All Bookmarks** — searchable, filterable table with content type filter pills, color-coded badges, date column. Click to open in new tab
- **Clusters** — grouped by type (domain, folder, session, path, project, decision). Click into detail view with export options
- **Sessions** — reconstructed browsing sessions from bookmark timestamps. Expandable cards showing bookmarks within each session
- **Review** — stale bookmarks (>6 months), forgotten (>1 year), dead links with recheck/remove, duplicates grouped with "keep this one" selector
- **Timeline** — month-by-month bar chart. Click any month to expand and see individual bookmarks

### Analysis

- **Full bookmark import** — reads the entire Chrome bookmark tree into local IndexedDB (tested with 8,383 bookmarks)
- **Content type classification** — heuristic-based: `github-repo`, `article`, `video`, `docs`, `forum`, `shopping`, `travel`, `academic`, `social`, `reference`, `tool`
- **Duplicate detection** — smart URL normalization strips `www.`, protocol, trailing slashes, hash fragments, sorts query parameters
- **Dead link checker** — HEAD with GET fallback, batched (10 concurrent, 500ms between batches), progress bar
- **Deterministic clustering** — 6 strategies: domain (5+ threshold), folder structure, time sessions (30-minute windows), URL path threads, shopping/decision groups (2-hour windows), GitHub project detection (org/repo + issues/PRs/docs)
- **Session reconstruction** — walks bookmarks chronologically, groups within 30-minute windows, labels by dominant domain and content type

### Export

- Cluster as markdown reading list
- Cluster as HTML bookmarks file (Netscape format)
- All bookmarks as CSV (title, url, domain, contentType, status, folderPath, dateAdded, tags)
- Shopping clusters as markdown comparison table

## Roadmap

- **Milestone 3: AI enrichment** — BYOK Anthropic API integration for per-bookmark summary, intent inference, and topic labeling
- **Milestone 4: Semantic clustering** — LLM-assisted grouping into projects, decisions, and learning paths
- **Milestone 5: Artifact generation** — turn clusters into reading lists, comparison tables, checklists, and research briefs

## Architecture

Three-layer separation:

1. **Capture/Index** (local) — deterministic code handles structure, normalization, classification, clustering
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
