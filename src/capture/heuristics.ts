import type { Bookmark, ContentType } from "../models/types";

interface Classification {
  domain: string;
  contentType: ContentType;
  tags: string[];
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const domainPatterns: [RegExp, ContentType, string[]][] = [
  // Code
  [/^github\.com$/, "github-repo", ["code"]],
  [/^gitlab\.com$/, "github-repo", ["code"]],
  [/^bitbucket\.org$/, "github-repo", ["code"]],
  // Video
  [/^(youtube\.com|youtu\.be|vimeo\.com)$/, "video", ["video"]],
  // Music
  [/^(spotify\.com|soundcloud\.com|bandcamp\.com|music\.youtube\.com)$/, "music", ["music"]],
  // Shopping
  [/^(amazon\.(com|co\.\w+)|ebay\.com|etsy\.com)$/, "shopping", ["shopping"]],
  // Real estate
  [/^(craigslist\.org|zillow\.com|redfin\.com|trulia\.com|realtor\.com|apartments\.com)$/, "real-estate", ["real-estate"]],
  // Forum
  [/^(stackoverflow\.com|stackexchange\.com|reddit\.com|news\.ycombinator\.com)$/, "forum", ["community"]],
  // Article
  [/^(medium\.com|substack\.com|dev\.to|hashnode\.dev)$/, "article", ["article"]],
  [/^blog\./, "article", ["article"]],
  // News
  [/^(nytimes\.com|bbc\.com|bbc\.co\.uk|cnn\.com|reuters\.com|theguardian\.com|washingtonpost\.com|apnews\.com)$/, "news", ["news"]],
  // Academic
  [/^(arxiv\.org|scholar\.google\.com|pubmed\.ncbi\.nlm\.nih\.gov)$/, "academic", ["research"]],
  // Travel
  [/^(booking\.com|airbnb\.com|expedia\.com|tripadvisor\.com)$/, "travel", ["travel"]],
  // Social
  [/^(twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|mastodon\.\w+)$/, "social", ["social"]],
  // Events
  [/^(meetup\.com|eventbrite\.com)$/, "events", ["events"]],
  // Package registries
  [/^(npmjs\.com|crates\.io|pypi\.org|packagist\.org)$/, "package", ["package"]],
  // Reference
  [/^(en\.wikipedia\.org|wikipedia\.org|britannica\.com)$/, "reference", ["reference"]],
  // Google services
  [/^docs\.google\.com$/, "docs", ["google", "docs"]],
  [/^maps\.google\.com$/, "reference", ["google", "maps"]],
  [/^drive\.google\.com$/, "tool", ["google", "drive"]],
  [/^mail\.google\.com$/, "tool", ["google", "email"]],
  [/^calendar\.google\.com$/, "tool", ["google", "calendar"]],
];

const hostPrefixPatterns: [RegExp, ContentType, string[]][] = [
  [/^docs\./, "docs", ["documentation"]],
  [/^wiki\./, "docs", ["wiki"]],
  [/^documentation\./, "docs", ["documentation"]],
];

const pathPatterns: [RegExp, ContentType, string[]][] = [
  [/^\/[^/]+\/[^/]+\/?$/, "github-repo", ["repo"]],
];

const titlePatterns: [RegExp, string[]][] = [
  [/\btutorial\b/i, ["tutorial"]],
  [/\bguide\b/i, ["guide"]],
  [/\bapi\b/i, ["api"]],
  [/\bdocumentation\b/i, ["documentation"]],
  [/\brecipe\b/i, ["recipe", "cooking"]],
];

export function classifyBookmark(
  bookmark: Pick<Bookmark, "url" | "title" | "folderPath">
): Classification {
  const domain = extractDomain(bookmark.url);
  let contentType: ContentType = "unknown";
  const tags: string[] = [];

  for (const [pattern, type, domainTags] of domainPatterns) {
    if (pattern.test(domain)) {
      contentType = type;
      tags.push(...domainTags);
      break;
    }
  }

  if (contentType === "unknown") {
    for (const [pattern, type, prefixTags] of hostPrefixPatterns) {
      if (pattern.test(domain)) {
        contentType = type;
        tags.push(...prefixTags);
        break;
      }
    }
  }

  if (domain === "github.com") {
    try {
      const pathname = new URL(bookmark.url).pathname;
      for (const [pattern, type, pathTags] of pathPatterns) {
        if (pattern.test(pathname)) {
          contentType = type;
          tags.push(...pathTags);
          break;
        }
      }
    } catch { /* ignore */ }
  }

  for (const [pattern, titleTags] of titlePatterns) {
    if (pattern.test(bookmark.title)) {
      tags.push(...titleTags);
    }
  }

  if (bookmark.folderPath) {
    const folders = bookmark.folderPath.split("/").filter(Boolean);
    for (const folder of folders) {
      const normalized = folder.toLowerCase().trim();
      if (normalized && normalized.length > 1 && normalized.length < 30) {
        tags.push(normalized);
      }
    }
  }

  return { domain, contentType, tags: [...new Set(tags)] };
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.port = "";
    u.hash = "";
    if (u.search) {
      const params = new URLSearchParams(u.searchParams);
      const entries: [string, string][] = [];
      params.forEach((v, k) => entries.push([k, v]));
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      const sorted = new URLSearchParams(entries);
      u.search = sorted.toString();
    }
    if (u.pathname.endsWith("/") && u.pathname !== "/") {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url.toLowerCase().trim();
  }
}
