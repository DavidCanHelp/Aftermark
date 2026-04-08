# Aftermark Privacy Policy

**Last updated:** April 2026

## What data does Aftermark collect?

Aftermark reads your Chrome bookmarks to analyze, classify, and organize them. All processing happens entirely within your browser.

## Where is the data stored?

All bookmark data, classifications, clusters, tags, health scores, and settings are stored locally in your browser using IndexedDB and `chrome.storage.local`. No data leaves your device.

## What data is sent to external servers?

None. Aftermark makes no network requests to any server. The only external requests are:

- **Favicon loading**: Bookmark list displays use Google's public favicon service (`google.com/s2/favicons`) to show site icons. This is a standard browser request and does not transmit your bookmark data.
- **Dead link checking**: When you manually trigger a dead link scan, Aftermark sends HEAD/GET requests directly from your browser to the bookmarked URLs to check if they're still reachable. No intermediary server is involved.

## Analytics and telemetry

There is no analytics, telemetry, tracking, or usage data collection of any kind.

## Accounts

No account is required. There is no sign-in, no registration, and no user identification.

## Future AI features

Optional AI enrichment features (planned) will use your own API key (bring-your-own-key model). API requests will go directly from your browser to the AI provider (e.g., Anthropic). Aftermark will never proxy these requests through our own servers. Your API key is stored locally in `chrome.storage.local` and is never transmitted to us.

## Data sharing

Your data is never sold, shared, or transmitted to any third party.

## Deleting your data

You can delete all Aftermark data at any time by:

1. Removing the Aftermark extension from Chrome
2. Or clearing the extension's storage via `chrome://extensions` > Aftermark > Details > Clear data

## Permissions explained

- **bookmarks**: Read and write Chrome bookmarks (core functionality)
- **storage**: Store settings and API keys locally
- **activeTab**: Access the current tab for context capture when bookmarking
- **tabs**: Read tab titles for enriching bookmark metadata
- **host_permissions (\<all\_urls\>)**: Required for dead link checking (HEAD requests to bookmarked URLs)

## Contact

For questions or concerns about privacy, please open an issue at:
https://github.com/DavidCanHelp/Aftermark/issues
