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
  [/^github\.com$/, "github-repo", ["code"]],
  [/^gitlab\.com$/, "github-repo", ["code"]],
  [/^bitbucket\.org$/, "github-repo", ["code"]],
  [/^(youtube\.com|youtu\.be|vimeo\.com)$/, "video", ["video"]],
  [/^(amazon\.(com|co\.\w+)|ebay\.com|etsy\.com)$/, "shopping", ["shopping"]],
  [/^(stackoverflow\.com|stackexchange\.com|reddit\.com|news\.ycombinator\.com)$/, "forum", ["community"]],
  [/^(medium\.com|substack\.com|dev\.to|hashnode\.dev|blog\.)/, "article", ["article"]],
  [/^(arxiv\.org|scholar\.google\.com|pubmed\.ncbi\.nlm\.nih\.gov)$/, "academic", ["research"]],
  [/^(booking\.com|airbnb\.com|expedia\.com|tripadvisor\.com)$/, "travel", ["travel"]],
  [/^(twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|mastodon\.\w+)$/, "social", ["social"]],
  [/^(wikipedia\.org|en\.wikipedia\.org)$/, "reference", ["reference"]],
];

const hostPrefixPatterns: [RegExp, ContentType, string[]][] = [
  [/^docs\./, "docs", ["documentation"]],
  [/^wiki\./, "docs", ["wiki"]],
  [/^documentation\./, "docs", ["documentation"]],
];

const pathPatterns: [RegExp, ContentType, string[]][] = [
  [/^\/[^/]+\/[^/]+\/?$/, "github-repo", ["repo"]], // github.com/user/repo
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

  // Check domain patterns
  for (const [pattern, type, domainTags] of domainPatterns) {
    if (pattern.test(domain)) {
      contentType = type;
      tags.push(...domainTags);
      break;
    }
  }

  // Check host prefix patterns (docs.*, wiki.*)
  if (contentType === "unknown") {
    for (const [pattern, type, prefixTags] of hostPrefixPatterns) {
      if (pattern.test(domain)) {
        contentType = type;
        tags.push(...prefixTags);
        break;
      }
    }
  }

  // Check path patterns (only for github.com)
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
    } catch {
      // ignore malformed URLs
    }
  }

  // Extract tags from title
  for (const [pattern, titleTags] of titlePatterns) {
    if (pattern.test(bookmark.title)) {
      tags.push(...titleTags);
    }
  }

  // Extract tags from folder path
  if (bookmark.folderPath) {
    const folders = bookmark.folderPath.split("/").filter(Boolean);
    for (const folder of folders) {
      const normalized = folder.toLowerCase().trim();
      if (normalized && normalized.length > 1 && normalized.length < 30) {
        tags.push(normalized);
      }
    }
  }

  // Deduplicate tags
  const uniqueTags = [...new Set(tags)];

  return { domain, contentType, tags: uniqueTags };
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Normalize protocol to https
    u.protocol = "https:";
    // Remove www. prefix
    u.hostname = u.hostname.replace(/^www\./, "");
    // Remove default ports
    u.port = "";
    // Remove hash fragment
    u.hash = "";
    // Sort query parameters for consistent comparison
    if (u.search) {
      const params = new URLSearchParams(u.searchParams);
      const entries: [string, string][] = [];
      params.forEach((v, k) => entries.push([k, v]));
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      const sorted = new URLSearchParams(entries);
      u.search = sorted.toString();
    }
    // Remove trailing slash from path
    if (u.pathname.endsWith("/") && u.pathname !== "/") {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url.toLowerCase().trim();
  }
}
