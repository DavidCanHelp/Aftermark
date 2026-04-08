import type { Bookmark, Cluster } from "../models/types";

function escapeCSV(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportClusterAsMarkdown(cluster: Cluster, bookmarks: Bookmark[]): string {
  const lines: string[] = [];
  lines.push(`# ${cluster.name}`);
  lines.push("");
  lines.push(`Type: ${cluster.type} | ${bookmarks.length} bookmarks`);
  lines.push("");

  for (const bm of bookmarks) {
    lines.push(`- [${bm.title || bm.url}](${bm.url})`);
    if (bm.domain) {
      lines.push(`  ${bm.domain} · ${bm.contentType}`);
    }
  }

  return lines.join("\n");
}

export function exportClusterAsHTML(cluster: Cluster, bookmarks: Bookmark[]): string {
  const lines: string[] = [];
  lines.push("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
  lines.push("<TITLE>Bookmarks</TITLE>");
  lines.push("<H1>Bookmarks</H1>");
  lines.push("<DL><p>");
  lines.push(`  <DT><H3>${escapeHTML(cluster.name)}</H3>`);
  lines.push("  <DL><p>");
  for (const bm of bookmarks) {
    const date = Math.floor(bm.dateAdded / 1000);
    lines.push(`    <DT><A HREF="${escapeHTML(bm.url)}" ADD_DATE="${date}">${escapeHTML(bm.title || bm.url)}</A>`);
  }
  lines.push("  </DL><p>");
  lines.push("</DL><p>");
  return lines.join("\n");
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function exportAllAsCSV(bookmarks: Bookmark[]): string {
  const header = "title,url,domain,contentType,status,folderPath,dateAdded,tags";
  const rows = bookmarks.map((bm) =>
    [
      escapeCSV(bm.title),
      escapeCSV(bm.url),
      escapeCSV(bm.domain),
      bm.contentType,
      bm.status,
      escapeCSV(bm.folderPath),
      new Date(bm.dateAdded).toISOString(),
      escapeCSV(bm.tags.join("; ")),
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

export function exportComparisonTable(cluster: Cluster, bookmarks: Bookmark[]): string {
  const lines: string[] = [];
  lines.push(`# ${cluster.name} — Comparison`);
  lines.push("");
  lines.push("| Item | Domain | Price/Status | Link |");
  lines.push("|------|--------|-------------|------|");
  for (const bm of bookmarks) {
    lines.push(`| ${bm.title || "—"} | ${bm.domain} | — | [link](${bm.url}) |`);
  }
  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
