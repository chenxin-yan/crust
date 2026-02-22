/**
 * Build-time sync script: fetches GitHub issues labeled "roadmap" and writes
 * a normalized snapshot to content/roadmap/issues.generated.json.
 *
 * Usage:
 *   bun run scripts/syncRoadmapIssues.ts
 *
 * Env:
 *   GITHUB_TOKEN (optional) — raises rate limit from 60 to 5 000 req/hr.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface RoadmapConfig {
  repo: string;
  doneCutoffDays: number;
  columns: Array<{ id: string; title: string }>;
  allowedStatuses: string[];
  moduleMap: Record<string, string>;
}

interface GitHubLabel {
  name: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  updated_at: string;
  closed_at: string | null;
}

interface NormalizedIssue {
  number: number;
  title: string;
  url: string;
  status: string;
  relatedModules: string[];
  assignees: Array<{ login: string; avatarUrl: string; url: string }>;
  labels: string[];
  updatedAt: string;
  closedAt: string | null;
}

interface Snapshot {
  syncedAt: string;
  sourceRepo: string;
  count: number;
  issues: NormalizedIssue[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const CONTENT_DIR = resolve(import.meta.dirname ?? ".", "../content/roadmap");
const CONFIG_PATH = resolve(CONTENT_DIR, "config.json");
const OUTPUT_PATH = resolve(CONTENT_DIR, "issues.generated.json");

function loadConfig(): RoadmapConfig {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as RoadmapConfig;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchPage(
  url: string,
  headers: Record<string, string>,
): Promise<{ issues: GitHubIssue[]; next: string | null }> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `GitHub API error: ${res.status} ${res.statusText} — ${await res.text()}`,
    );
  }
  const issues = (await res.json()) as GitHubIssue[];

  // Parse Link header for pagination
  let next: string | null = null;
  const link = res.headers.get("link");
  if (link) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      next = match[1] ?? null;
    }
  }

  return { issues, next };
}

async function fetchAllPages(url: string): Promise<GitHubIssue[]> {
  const headers = buildHeaders();
  const all: GitHubIssue[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const result = await fetchPage(nextUrl, headers);
    all.push(...result.issues);
    nextUrl = result.next;
  }

  return all;
}

async function fetchRoadmapIssues(
  repo: string,
  doneCutoffDays: number,
): Promise<GitHubIssue[]> {
  const base = `https://api.github.com/repos/${repo}/issues`;
  const perPage = 100;

  // Fetch open roadmap issues
  const openUrl = `${base}?labels=roadmap&state=open&per_page=${perPage}`;
  const openIssues = await fetchAllPages(openUrl);

  // Fetch closed roadmap issues (filter by cutoff date)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - doneCutoffDays);
  const since = cutoff.toISOString();
  const closedUrl = `${base}?labels=roadmap&state=closed&since=${since}&per_page=${perPage}`;
  const closedIssues = await fetchAllPages(closedUrl);

  // Filter closed issues: only include those actually closed within cutoff
  const filteredClosed = closedIssues.filter((issue) => {
    if (!issue.closed_at) return false;
    return new Date(issue.closed_at) >= cutoff;
  });

  return [...openIssues, ...filteredClosed];
}

// ────────────────────────────────────────────────────────────────────────────
// Validation & Normalization
// ────────────────────────────────────────────────────────────────────────────

function extractPrefixedLabels(
  labels: GitHubLabel[],
  prefix: string,
): string[] {
  return labels
    .map((l) => l.name)
    .filter((name) => name.startsWith(`${prefix}:`))
    .map((name) => name.slice(prefix.length + 1));
}

function normalizeIssue(
  issue: GitHubIssue,
  config: RoadmapConfig,
  errors: string[],
): NormalizedIssue | null {
  const isClosed = issue.state === "closed";
  const statusLabels = extractPrefixedLabels(issue.labels, "status");
  const moduleLabels = extractPrefixedLabels(issue.labels, "module");

  // Determine status
  let status: string;
  if (isClosed) {
    status = "done";
  } else {
    if (statusLabels.length === 0) {
      errors.push(`#${issue.number} "${issue.title}": missing status label`);
      return null;
    }
    if (statusLabels.length > 1) {
      errors.push(
        `#${issue.number} "${issue.title}": multiple status labels: ${statusLabels.join(", ")}`,
      );
      return null;
    }
    const labelStatus = statusLabels[0];
    if (!labelStatus || !config.allowedStatuses.includes(labelStatus)) {
      errors.push(
        `#${issue.number} "${issue.title}": unknown status "${labelStatus}"`,
      );
      return null;
    }
    status = labelStatus;
  }

  // Validate modules
  for (const mod of moduleLabels) {
    if (!(mod in config.moduleMap)) {
      errors.push(`#${issue.number} "${issue.title}": unknown module "${mod}"`);
      return null;
    }
  }

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    status,
    relatedModules: moduleLabels,
    assignees: issue.assignees.map((a) => ({
      login: a.login,
      avatarUrl: a.avatar_url,
      url: a.html_url,
    })),
    labels: issue.labels.map((l) => l.name),
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();

  console.log(`[roadmap-sync] Fetching issues from ${config.repo}...`);

  let issues: GitHubIssue[];
  try {
    issues = await fetchRoadmapIssues(config.repo, config.doneCutoffDays);
  } catch (err) {
    console.warn(
      `[roadmap-sync] Failed to fetch from GitHub: ${err instanceof Error ? err.message : err}`,
    );
    console.warn(
      "[roadmap-sync] Keeping existing snapshot (stale data warning).",
    );
    return;
  }

  console.log(`[roadmap-sync] Fetched ${issues.length} roadmap issues.`);

  const errors: string[] = [];
  const normalized: NormalizedIssue[] = [];

  for (const issue of issues) {
    const result = normalizeIssue(issue, config, errors);
    if (result) {
      normalized.push(result);
    }
  }

  if (errors.length > 0) {
    console.error("[roadmap-sync] Validation errors:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const snapshot: Snapshot = {
    syncedAt: new Date().toISOString(),
    sourceRepo: config.repo,
    count: normalized.length,
    issues: normalized,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `[roadmap-sync] Wrote ${normalized.length} issues to issues.generated.json`,
  );
}

main();
