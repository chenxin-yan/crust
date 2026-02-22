// Vite resolves JSON imports at build time — works in both Node SSR and
// Cloudflare Workers without needing `node:fs`.
import configData from "../../content/roadmap/config.json" with {
  type: "json",
};
import snapshotData from "../../content/roadmap/issues.generated.json" with {
  type: "json",
};

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface RoadmapAssignee {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface RoadmapIssue {
  number: number;
  title: string;
  url: string;
  status: string;
  relatedModules: string[];
  assignees: RoadmapAssignee[];
  labels: string[];
  updatedAt: string;
  closedAt: string | null;
}

export interface RoadmapColumn {
  id: string;
  title: string;
  issues: RoadmapIssue[];
}

export interface RoadmapConfig {
  repo: string;
  doneCutoffDays: number;
  columns: Array<{ id: string; title: string }>;
  allowedStatuses: string[];
  moduleMap: Record<string, string>;
}

interface Snapshot {
  syncedAt: string;
  sourceRepo: string;
  count: number;
  issues: RoadmapIssue[];
}

export interface RoadmapData {
  columns: RoadmapColumn[];
  config: RoadmapConfig;
  syncedAt: string;
  count: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Data Loading
// ────────────────────────────────────────────────────────────────────────────

export function loadRoadmapData(): RoadmapData {
  const config = configData as RoadmapConfig;
  const snapshot = snapshotData as unknown as Snapshot;

  // Group issues by status into column buckets
  const columnMap = new Map<string, RoadmapIssue[]>();
  for (const col of config.columns) {
    columnMap.set(col.id, []);
  }

  for (const issue of snapshot.issues) {
    const bucket = columnMap.get(issue.status);
    if (bucket) {
      bucket.push(issue);
    }
  }

  // Sort: open columns by updatedAt desc, done column by closedAt desc
  const columns: RoadmapColumn[] = config.columns.map((col) => {
    const issues = columnMap.get(col.id) ?? [];

    if (col.id === "done") {
      issues.sort((a, b) => {
        const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return bTime - aTime;
      });
    } else {
      issues.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }

    return {
      id: col.id,
      title: col.title,
      issues,
    };
  });

  return {
    columns,
    config,
    syncedAt: snapshot.syncedAt,
    count: snapshot.count,
  };
}

/**
 * Resolve a module slug to its docs URL using the config module map.
 */
export function getModuleUrl(slug: string): string | null {
  const config = configData as RoadmapConfig;
  return config.moduleMap[slug] ?? null;
}
