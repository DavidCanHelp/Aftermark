import type {
  Bookmark,
  InferenceRecord,
  Cluster,
  ActionArtifact,
} from "../models/types";

export interface InferenceProvider {
  summarizeBookmark(bookmark: Bookmark): Promise<InferenceRecord>;
  inferIntent(bookmark: Bookmark): Promise<InferenceRecord>;
  clusterBookmarks(bookmarks: Bookmark[]): Promise<Cluster[]>;
  generateArtifact(cluster: Cluster): Promise<ActionArtifact>;
}
