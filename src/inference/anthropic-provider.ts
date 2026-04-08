import type { InferenceProvider } from "./provider";
import type {
  Bookmark,
  InferenceRecord,
  Cluster,
  ActionArtifact,
} from "../models/types";

async function getApiKey(): Promise<string> {
  const result = await chrome.storage.local.get("anthropicApiKey");
  if (!result.anthropicApiKey) {
    throw new Error("Anthropic API key not configured. Set it in Options.");
  }
  return result.anthropicApiKey as string;
}

const MODEL = "claude-sonnet-4-20250514";

export class AnthropicProvider implements InferenceProvider {
  async summarizeBookmark(bookmark: Bookmark): Promise<InferenceRecord> {
    const _apiKey = await getApiKey();
    // TODO: call Anthropic Messages API
    return {
      bookmarkId: bookmark.id,
      topic: "",
      intent: "",
      summary: `Stub summary for ${bookmark.title}`,
      confidence: 0,
      model: MODEL,
      createdAt: Date.now(),
    };
  }

  async inferIntent(bookmark: Bookmark): Promise<InferenceRecord> {
    const _apiKey = await getApiKey();
    // TODO: call Anthropic Messages API
    return {
      bookmarkId: bookmark.id,
      topic: "",
      intent: "Stub intent",
      summary: "",
      confidence: 0,
      model: MODEL,
      createdAt: Date.now(),
    };
  }

  async clusterBookmarks(_bookmarks: Bookmark[]): Promise<Cluster[]> {
    const _apiKey = await getApiKey();
    // TODO: call Anthropic Messages API
    return [];
  }

  async generateArtifact(cluster: Cluster): Promise<ActionArtifact> {
    const _apiKey = await getApiKey();
    // TODO: call Anthropic Messages API
    return {
      clusterId: cluster.id,
      type: "brief",
      content: `Stub artifact for cluster ${cluster.name}`,
    };
  }
}
