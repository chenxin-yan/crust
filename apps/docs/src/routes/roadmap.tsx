import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useState } from "react";
import { baseOptions } from "@/lib/layout.shared";
import type { RoadmapColumn, RoadmapData, RoadmapIssue } from "@/lib/roadmap";
import { getModuleUrl, loadRoadmapData } from "@/lib/roadmap";

export const Route = createFileRoute("/roadmap")({
  component: RoadmapPage,
  loader: (): RoadmapData => {
    return loadRoadmapData();
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Status → accent color mapping
// ────────────────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  planned: "var(--fn-dim)",
  "in-progress": "var(--fn-molten)",
  blocked: "#b84040",
  done: "var(--fn-cool)",
};

function statusColor(id: string): string {
  return STATUS_COLORS[id] ?? "var(--fn-dim)";
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

function ModuleChip({ slug }: { slug: string }) {
  const url = getModuleUrl(slug);
  const inner = <span className="fp-module-chip">{slug}</span>;
  if (url) {
    return (
      <Link to={url} className="fp-module-link">
        {inner}
      </Link>
    );
  }
  return inner;
}

function AvatarStack({ assignees }: { assignees: RoadmapIssue["assignees"] }) {
  if (assignees.length === 0) return null;
  return (
    <div className="fp-avatar-stack">
      {assignees.slice(0, 3).map((a) => (
        <a
          key={a.login}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          title={a.login}
        >
          <img src={a.avatarUrl} alt={a.login} className="fp-avatar" />
        </a>
      ))}
      {assignees.length > 3 && (
        <span className="fp-avatar-overflow">+{assignees.length - 3}</span>
      )}
    </div>
  );
}

function IssueCard({ issue, accent }: { issue: RoadmapIssue; accent: string }) {
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className="fp-card"
      style={{ "--card-accent": accent } as React.CSSProperties}
    >
      {/* ── Top accent line ── */}
      <div className="fp-card-accent" />

      {/* ── Content ── */}
      <div className="fp-card-content">
        {/* Header: issue number + avatars */}
        <div className="fp-card-header">
          <span className="fp-issue-num">#{issue.number}</span>
          <AvatarStack assignees={issue.assignees} />
        </div>

        {/* Title */}
        <p className="fp-card-title">{issue.title}</p>

        {/* Module chips */}
        {issue.relatedModules.length > 0 && (
          <div className="fp-card-modules">
            {issue.relatedModules.map((m) => (
              <ModuleChip key={m} slug={m} />
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

function PipeConnector() {
  return (
    <div className="fp-pipe">
      <div className="fp-pipe-line" />
      <div className="fp-pipe-arrow">›</div>
    </div>
  );
}

function StationColumn({ column }: { column: RoadmapColumn }) {
  const [collapsed, setCollapsed] = useState(false);
  const accent = statusColor(column.id);

  return (
    <div className="fp-station">
      {/* Gauge header */}
      <button
        type="button"
        className="fp-station-header"
        style={{ borderTopColor: accent }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="fp-gauge">
          <span
            className="fp-gauge-dot"
            style={{
              background: accent,
              boxShadow: `0 0 8px ${accent}`,
            }}
          />
          <span className="fp-gauge-label">{column.title}</span>
        </div>
        <span className="fp-gauge-count" style={{ color: accent }}>
          {column.issues.length}
        </span>
      </button>

      {/* Issue list */}
      {!collapsed && (
        <div className="fp-station-body">
          {column.issues.length === 0 ? (
            <p className="fp-empty">No items</p>
          ) : (
            column.issues.map((issue) => (
              <IssueCard key={issue.number} issue={issue} accent={accent} />
            ))
          )}
        </div>
      )}

      {collapsed && (
        <div className="fp-station-collapsed">
          <span className="fp-collapsed-label">
            {column.issues.length} item
            {column.issues.length !== 1 ? "s" : ""} — click to expand
          </span>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────────────────

function RoadmapPage() {
  const data = Route.useLoaderData();

  return (
    <>
      <style>{`
				/* ── Forge Pipeline ──────────────────────────────────────── */
				.fp-container {
					padding: 48px 40px 32px;
					max-width: 1200px;
					margin: 0 auto;
					position: relative;
					z-index: 2;
				}
				.fp-header {
					margin-bottom: 40px;
				}
				.fp-header h1 {
					font-family: 'Saira Condensed', sans-serif;
					font-weight: 800;
					font-size: clamp(32px, 5vw, 56px);
					text-transform: uppercase;
					letter-spacing: -0.01em;
					line-height: 1;
					margin: 0 0 8px;
					color: var(--fn-primary);
				}
				.fp-header h1 span {
					color: var(--fn-molten);
				}
				.fp-subtitle {
					font-size: 13px;
					color: var(--fn-dim);
					margin: 0;
					font-family: 'Fira Code', monospace;
					letter-spacing: 1px;
				}

				/* Pipeline — 4-column grid, no horizontal scroll */
				.fp-pipeline {
					display: grid;
					grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
					align-items: start;
					gap: 0;
				}

				/* Station (column) */
				.fp-station {
					min-width: 0;
				}

				/* Pipe connector between stations */
				.fp-pipe {
					display: flex;
					align-items: center;
					justify-content: center;
					width: 20px;
					margin: 0 8px;
					flex-shrink: 0;
					padding-top: 20px;
					position: relative;
				}
				.fp-pipe-line {
					width: 100%;
					height: 1px;
					background: var(--fn-border);
				}
				.fp-pipe-arrow {
					position: absolute;
					inset: 0;
					display: flex;
					align-items: center;
					justify-content: center;
					padding-top: 28px;
					color: var(--fn-dim);
					font-size: 14px;
					font-family: 'Fira Code', monospace;
				}

				/* Station header (gauge) */
				.fp-station-header {
					background: #ebe5de;
					border: 1px solid #d4ccc2;
					border-top: 3px solid;
					padding: 14px 16px;
					display: flex;
					justify-content: space-between;
					align-items: center;
					cursor: pointer;
					width: 100%;
					text-align: left;
					transition: background 0.2s;
					font-family: inherit;
					color: inherit;
				}
				.dark .fp-station-header {
					background: #1e1a16;
					border-color: #2e2824;
				}
				.fp-station-header:hover {
					background: #e2dbd3;
				}
				.dark .fp-station-header:hover {
					background: #252018;
				}
				.fp-gauge {
					display: flex;
					align-items: center;
					gap: 10px;
				}
				.fp-gauge-dot {
					width: 8px;
					height: 8px;
					border-radius: 50%;
					flex-shrink: 0;
				}
				.fp-gauge-label {
					font-family: 'Saira Condensed', sans-serif;
					font-weight: 700;
					font-size: 14px;
					letter-spacing: 2px;
					text-transform: uppercase;
					color: var(--fn-primary);
				}
				.fp-gauge-count {
					font-family: 'Fira Code', monospace;
					font-size: 12px;
					font-weight: 500;
				}

				/* Station body — hidden scrollbar */
				.fp-station-body {
					display: flex;
					flex-direction: column;
					gap: 10px;
					padding-top: 10px;
					max-height: 70vh;
					overflow-y: auto;
					scrollbar-width: none;
					-ms-overflow-style: none;
				}
				.fp-station-body::-webkit-scrollbar {
					display: none;
				}

				/* Collapsed state */
				.fp-station-collapsed {
					padding: 20px 16px;
					text-align: center;
				}
				.fp-collapsed-label {
					font-size: 11px;
					color: var(--fn-dim);
					letter-spacing: 0.5px;
				}

				/* ── Issue Card ─────────────────────────────────────────── */
				.fp-card {
					display: flex;
					flex-direction: column;
					background: #ebe5de;
					border: 1px solid #d4ccc2;
					text-decoration: none;
					color: var(--fn-primary);
					transition: border-color 0.2s, box-shadow 0.2s;
					overflow: hidden;
					position: relative;
				}
				.dark .fp-card {
					background: #1e1a16;
					border-color: #2e2824;
				}
				.fp-card:hover {
					border-color: #b8aea2;
				}
				.dark .fp-card:hover {
					border-color: #3e3630;
				}

				/* Top accent line — colored per status */
				.fp-card-accent {
					height: 2px;
					background: var(--card-accent);
					flex-shrink: 0;
				}

				/* Card content area */
				.fp-card-content {
					padding: 12px 14px;
					display: flex;
					flex-direction: column;
					gap: 8px;
					flex: 1;
				}

				/* Card header — issue # and avatars */
				.fp-card-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.fp-issue-num {
					font-family: 'Fira Code', monospace;
					font-size: 11px;
					color: var(--card-accent);
					letter-spacing: 0.5px;
				}

				/* Card title */
				.fp-card-title {
					font-size: 13px;
					line-height: 1.55;
					margin: 0;
					font-weight: 500;
					letter-spacing: 0.01em;
				}

				/* Card modules area */
				.fp-card-modules {
					display: flex;
					flex-wrap: wrap;
					gap: 4px;
					margin-top: 2px;
				}

				/* Module chips */
				.fp-module-chip {
					font-family: 'Fira Code', monospace;
					font-size: 10px;
					padding: 2px 7px;
					background: rgba(0, 0, 0, 0.03);
					border: 1px solid rgba(0, 0, 0, 0.08);
					color: var(--fn-dim);
					transition: border-color 0.15s, color 0.15s;
					line-height: 1.4;
				}
				.dark .fp-module-chip {
					background: rgba(255, 255, 255, 0.04);
					border-color: rgba(255, 255, 255, 0.07);
				}
				.fp-module-link {
					text-decoration: none;
				}
				.fp-module-link:hover .fp-module-chip {
					border-color: var(--fn-molten);
					color: var(--fn-molten);
				}

				/* Avatars */
				.fp-avatar-stack {
					display: flex;
					align-items: center;
				}
				.fp-avatar-stack a {
					margin-left: -4px;
					display: block;
				}
				.fp-avatar-stack a:first-child {
					margin-left: 0;
				}
				.fp-avatar {
					width: 20px;
					height: 20px;
					border-radius: 50%;
					border: 2px solid #ebe5de;
					object-fit: cover;
					transition: transform 0.15s;
				}
				.dark .fp-avatar {
					border-color: #1e1a16;
				}
				.fp-avatar-stack a:hover .fp-avatar {
					transform: scale(1.1);
				}
				.fp-avatar-overflow {
					font-size: 10px;
					color: var(--fn-dim);
					margin-left: 4px;
					font-family: 'Fira Code', monospace;
				}

				.fp-empty {
					font-size: 12px;
					color: var(--fn-dim);
					text-align: center;
					padding: 32px 0;
					margin: 0;
					font-style: italic;
				}

				/* Footer */
				.fp-footer {
					margin-top: 32px;
					padding-top: 16px;
					border-top: 1px solid var(--fn-border);
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.fp-synced {
					font-family: 'Fira Code', monospace;
					font-size: 11px;
					color: var(--fn-dim);
					letter-spacing: 0.5px;
				}
				.fp-count {
					font-family: 'Saira Condensed', sans-serif;
					font-size: 12px;
					font-weight: 600;
					letter-spacing: 1.5px;
					text-transform: uppercase;
					color: var(--fn-dim);
				}

				/* ── Responsive ─────────────────────────────────────────── */
				@media (max-width: 960px) {
					.fp-pipeline {
						grid-template-columns: 1fr auto 1fr;
						gap: 16px 0;
					}
					/* Hide 2nd and 3rd pipe connectors in 2-col layout */
					.fp-pipe:nth-child(4) {
						display: none;
					}
					.fp-pipe:nth-child(6) {
						display: none;
					}
				}
				@media (max-width: 640px) {
					.fp-pipeline {
						display: flex;
						flex-direction: column;
						gap: 16px;
					}
					.fp-pipe {
						display: none;
					}
					.fp-station {
						width: 100%;
					}
					.fp-container {
						padding: 32px 16px 24px;
					}
				}
			`}</style>

      <HomeLayout {...baseOptions()}>
        <div className="furnace-home">
          <div className="fp-container">
            <div className="fp-header">
              <h1>
                Road<span>map</span>
              </h1>
            </div>

            <div className="fp-pipeline">
              {data.columns.map((col, i) => (
                <>
                  {i > 0 && <PipeConnector key={`pipe-${col.id}`} />}
                  <StationColumn key={col.id} column={col} />
                </>
              ))}
            </div>

            <div className="fp-footer">
              <span className="fp-synced">
                Synced{" "}
                {data.syncedAt
                  ? new Date(data.syncedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "never"}
              </span>
              <span className="fp-count">
                {data.count} total issue
                {data.count !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      </HomeLayout>
    </>
  );
}
