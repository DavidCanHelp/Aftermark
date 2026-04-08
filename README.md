# Aftermark

**Your bookmarks are breadcrumbs.**

Aftermark is a Chrome extension that treats your bookmarks as compressed intentions, not passive links. Every bookmark you saved carried an unfinished thought — something to read, compare, learn, decide, or build. Aftermark recovers that intention and helps you act on it. Local-first, privacy-respecting, no cloud dependency.

## Status

v0.3.0 — Full tab UI with insights page, health scores, expanded heuristics, fuzzy duplicate detection, favicons, search upgrades, saved filters, and folder insights. All local analysis, no AI calls.

## Features

### Full Tab UI

Seven-view dark theme interface with sidebar navigation. Open via popup or browser action.

- **Dashboard** — stat cards (total, duplicates, dead, stale, average health score, clusters), top 10 domains, content type distribution, bookmarks per month, oldest/newest, bookmark rate
- **All Bookmarks** — searchable, sortable, filterable table with favicons, health dots, content type pills, and sort dropdown (date, domain, health, title). Saved filters for quick access
- **Clusters** — grouped by type with mini content-type distribution bars on each card. Click into detail view with export, rename, merge, bulk actions
- **Sessions** — reconstructed browsing sessions from bookmark timestamps. Expandable cards with favicons and health indicators
- **Review** — stale (>6 months), forgotten (>1 year), dead links, exact duplicates, fuzzy likely-duplicates, and folder insights with staleness/dead/dupe percentages
- **Timeline** — sparkline visualization per month (day-level bars with hover tooltips). Click to expand individual bookmarks
- **Insights** — bookmark personality analysis: collection health gauge, personality label (Developer/Researcher/Explorer/Shopper/Generalist), busiest month, longest drought, top domain, most-saved URL, hour-of-day histogram, day-of-week histogram, age distribution chart

### Bookmark CRUD

- **Add** — create bookmarks from the All Bookmarks view (URL, title, tags). Auto-classifies via heuristics and syncs to Chrome bookmarks
- **Edit** — inline edit title, tags, and status (active/excluded) on any bookmark row. Syncs title back to Chrome via `chrome.bookmarks.update()`
- **Delete** — single delete with confirmation, or batch delete via checkboxes. Removes from both IndexedDB and Chrome bookmarks
- **Bulk actions** — select multiple bookmarks with checkboxes (or select-all), then Delete Selected, Mark Excluded, or Export Selected. Available in both All Bookmarks and cluster detail views
- **Cluster management** — rename clusters, merge two clusters, remove bookmarks from a cluster. Empty clusters are auto-pruned after any delete or removal operation

### Analysis

- **Full bookmark import** — reads the entire Chrome bookmark tree into local IndexedDB (tested with 8,383 bookmarks)
- **Content type classification** — 17 types via heuristic matching: `github-repo`, `article`, `video`, `docs`, `forum`, `shopping`, `travel`, `academic`, `social`, `reference`, `tool`, `news`, `real-estate`, `events`, `package`, `music`, `unknown`
- **Expanded domain mappings** — NYT/BBC/CNN/Reuters (news), Zillow/Redfin/Craigslist (real-estate), Meetup/Eventbrite (events), npmjs/crates.io/PyPI (package), Spotify/SoundCloud/Bandcamp (music), Google Docs/Maps/Drive/Mail/Calendar
- **Exact duplicate detection** — smart URL normalization strips `www.`, protocol, trailing slashes, hash fragments, sorts query parameters
- **Fuzzy duplicate detection** — second pass using Jaccard word-token similarity >80% within the same domain. Flags as `likely-duplicate` with separate review section
- **Health score** — 0-100 per bookmark based on age (-1/month, max -30), never revisited (-20), dead link (-30), duplicate (-15), unclassified (-10). Color-coded dot on every row (green >70, yellow 40-70, red <40)
- **Dead link checker** — HEAD with GET fallback, batched (10 concurrent, 500ms between batches), progress bar
- **Deterministic clustering** — 6 strategies: domain (5+ threshold), folder structure, time sessions (30-minute windows), URL path threads, shopping/decision groups (2-hour windows), GitHub project detection
- **Session reconstruction** — walks bookmarks chronologically, groups within 30-minute windows, labels by dominant domain and content type
- **Folder insights** — per-folder breakdown of total bookmarks, stale %, dead %, duplicate %. Dead folders (100% stale+dead) highlighted

### Search & Filters

- **Sort** — date (newest/oldest), domain A-Z, health (best/worst), title A-Z
- **Content type filter pills** — click to filter, combinable with search text and sort
- **Saved filters** — save any search + type + sort combination with a name, stored in `chrome.storage.local`. Quick-access buttons with one-click delete

### Visual

- **Favicons** — 16x16 Google favicon service on every bookmark row
- **Health dots** — color-coded health indicator on every row
- **Sparkline timeline** — day-level bars per month with hover tooltips
- **Cluster mini-bars** — content type distribution visualization on each cluster card

### Export

- Cluster as markdown reading list
- Cluster as HTML bookmarks file (Netscape format)
- All bookmarks as CSV (title, url, domain, contentType, status, folderPath, dateAdded, tags)
- Shopping clusters as markdown comparison table
- Export selected bookmarks as CSV

## Roadmap

- **Milestone 4: AI enrichment** — BYOK Anthropic API integration for per-bookmark summary, intent inference, and topic labeling
- **Milestone 5: Semantic clustering** — LLM-assisted grouping into projects, decisions, and learning paths
- **Milestone 6: Artifact generation** — turn clusters into reading lists, comparison tables, checklists, and research briefs

## Architecture

Three-layer separation:

1. **Capture/Index** (local) — deterministic code handles structure, normalization, classification, clustering, health scoring
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
