export type BookmarkStatus = "active" | "dead" | "duplicate" | "excluded";
export type AnalysisMode = "metadata-only" | "full-page";
export type ClusterType = "project" | "topic" | "decision" | "learning";
export type ArtifactType =
  | "reading-list"
  | "comparison-table"
  | "checklist"
  | "brief";
export type ContentType =
  | "github-repo"
  | "docs"
  | "article"
  | "video"
  | "shopping"
  | "travel"
  | "academic"
  | "social"
  | "forum"
  | "tool"
  | "reference"
  | "unknown";

export interface Bookmark {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  folderPath: string;
  domain: string;
  contentType: ContentType;
  dateAdded: number;
  dateLastUsed?: number;
  tags: string[];
  status: BookmarkStatus;
  canonicalId?: string;
}

export interface DocumentSnapshot {
  bookmarkId: string;
  title: string;
  domain: string;
  excerpt: string;
  contentHash: string;
  lastAnalyzedAt: number;
  analysisMode: AnalysisMode;
}

export interface InferenceRecord {
  bookmarkId: string;
  topic: string;
  intent: string;
  summary: string;
  confidence: number;
  model: string;
  createdAt: number;
}

export interface Cluster {
  id: string;
  name: string;
  type: ClusterType;
  bookmarkIds: string[];
}

export interface ActionArtifact {
  clusterId: string;
  type: ArtifactType;
  content: string;
}
