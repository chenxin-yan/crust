import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "fumadocs-ui/components/ui/tabs";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useCallback, useState } from "react";
import HIGHLIGHTED from "virtual:landing-twoslash";

import { Code } from "@/components/landing/Code";
import Showcase from "@/components/landing/Showcase";
import { baseOptions, roadmapUrl } from "@/lib/layout.shared";
import { buildPageMeta } from "@/lib/seo";

// A head link, unlike a side-effect import, keeps the landing theme off docs pages.
import homeCss from "@/components/landing/home.css?url";

// Docs `npm` fences share this group id (source.config.ts), so one selection follows the reader everywhere.
const PACKAGE_MANAGER_GROUP_ID = "package-manager";

// Must match what remarkNpm expands the Quick Start scaffold fence to; site.test.ts checks it.
export const SCAFFOLD_COMMANDS = {
	npm: "npx create-crust@latest my-cli",
	pnpm: "pnpm dlx create-crust@latest my-cli",
	yarn: "yarn dlx create-crust@latest my-cli",
	bun: "bun x create-crust@latest my-cli",
};

const { meta: homeMeta, links: homeLinks } = buildPageMeta({
	description:
		"CrustJS is a TypeScript CLI framework with composable modules for humans and agents.",
	canonical: "/",
});

export const Route = createFileRoute("/")({
	component: FurnaceHome,
	head: () => ({
		meta: homeMeta,
		links: [...homeLinks, { rel: "stylesheet", href: homeCss }],
	}),
	loader: async () => {
		try {
			return { npmVersions: await getNpmVersions() };
		} catch (error) {
			console.error("[docs] Failed to load npm versions", error);
			return { npmVersions: {} };
		}
	},
});

type LandingModule =
	| { pkg: string; desc: string; doc: string; upcoming?: never }
	| { pkg: string; desc: string; doc?: never; upcoming: true };

// site.test.ts checks that every module page has a linked entry.
export const MODULES: readonly LandingModule[] = [
	{
		pkg: "@crustjs/core",
		desc: "Commands, Contexts, Extensions, execution",
		doc: "modules/core",
	},
	{
		pkg: "@crustjs/extensions",
		desc: "Official Crust Extensions",
		doc: "modules/extensions",
	},
	{
		pkg: "@crustjs/crust",
		desc: "CLI build and distribution tooling",
		doc: "modules/crust",
	},
	{
		pkg: "@crustjs/create",
		desc: "Scaffolding library for create-* tools",
		doc: "modules/create",
	},
	{
		pkg: "@crustjs/progress",
		desc: "Progress indicators",
		doc: "modules/progress",
	},
	{
		pkg: "@crustjs/tui",
		desc: "OpenTUI adapter",
		doc: "modules/tui",
	},
	{
		pkg: "@crustjs/effect",
		desc: "Effect.ts adaptor",
		doc: "modules/effect",
	},
	{
		pkg: "@crustjs/env",
		desc: "Typed, validated environment variables",
		doc: "modules/env",
	},
	{
		pkg: "@crustjs/prompts",
		desc: "Interactive prompts",
		doc: "modules/prompts",
	},
	{
		pkg: "@crustjs/style",
		desc: "Terminal styling and layout",
		doc: "modules/style",
	},
	{
		pkg: "@crustjs/store",
		desc: "Typed config, data, state, and cache persistence",
		doc: "modules/store",
	},
	{
		pkg: "@crustjs/skills",
		desc: "Package and install agent skills",
		doc: "modules/skills",
	},
	{
		pkg: "@crustjs/man",
		desc: "Generate mdoc(7) manual pages",
		doc: "modules/man",
	},
	{
		pkg: "@crustjs/testing",
		desc: "CLI testing helpers",
		doc: "modules/testing",
	},
	{
		pkg: "@crustjs/mcp",
		desc: "Serve commands as MCP tools over stdio",
		doc: "modules/mcp",
	},
	{
		pkg: "@crustjs/render",
		desc: "Terminal content rendering",
		upcoming: true,
	},
	{
		pkg: "@crustjs/log",
		desc: "Structured logging",
		upcoming: true,
	},
];

const PUBLISHED_PACKAGES = MODULES.flatMap((m) => (m.upcoming ? [] : [m.pkg]));

function hasVersion<Value>(value: Value): value is Value & { version: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"version" in value &&
		typeof value.version === "string"
	);
}

async function fetchNpmVersion(pkg: string): Promise<string | null> {
	try {
		const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return null;
		const data: unknown = await res.json();
		return hasVersion(data) ? data.version : null;
	} catch {
		return null;
	}
}

const getNpmVersions = createServerFn({ method: "GET" }).handler(async () => {
	const entries = await Promise.all(
		PUBLISHED_PACKAGES.map(async (pkg) => {
			const version = await fetchNpmVersion(pkg);
			return [pkg, version] as const;
		}),
	);
	return Object.fromEntries(entries);
});

function FurnaceHome() {
	const { npmVersions } = Route.useLoaderData();
	const coreVersion = npmVersions["@crustjs/core"];
	const [copied, setCopied] = useState<string | null>(null);

	const handleCopy = useCallback((command: string) => {
		void navigator.clipboard.writeText(command);
		setCopied(command);
		setTimeout(() => setCopied(null), 2000);
	}, []);

	return (
		<HomeLayout {...baseOptions}>
			<div className="furnace-home">
				{/* Hero */}
				<section className="fn-hero-section">
					<a
						href={roadmapUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="fn-mono fn-dev-badge"
					>
						{/* The same npm lookup the module list uses; omitted when the registry was unreachable. */}
						{coreVersion && (
							<>
								<span className="fn-dev-badge-status">@crustjs/core v{coreVersion}</span>
								<span className="fn-dev-badge-sep" />
							</>
						)}
						<span className="fn-dev-badge-cta">
							Roadmap
							<span className="fn-dev-badge-arrow" aria-hidden="true">
								→
							</span>
						</span>
					</a>

					<div className="fn-hero-grid">
						{/* Left — text content */}
						<div>
							<h1
								className="fn-condensed"
								style={{
									fontSize: "clamp(42px, 6vw, 76px)",
									fontWeight: 800,
									lineHeight: 0.95,
									margin: 0,
									letterSpacing: "-0.01em",
									textTransform: "uppercase",
								}}
							>
								Build CLIs
								<br />
								<span style={{ color: "var(--fn-molten)", whiteSpace: "nowrap" }}>
									agents can use.
								</span>
							</h1>

							<p
								style={{
									fontSize: 16,
									lineHeight: 1.7,
									color: "var(--fn-dim)",
									maxWidth: 460,
									marginTop: 20,
									fontWeight: 400,
								}}
							>
								A TypeScript CLI framework with composable modules for humans and agents.
							</p>

							{/* Install — pick a package manager, click the command to copy */}
							<Tabs
								className="fn-install"
								groupId={PACKAGE_MANAGER_GROUP_ID}
								persist
								defaultValue="npm"
							>
								<TabsList className="fn-mono fn-install-tabs" aria-label="Package manager">
									{Object.keys(SCAFFOLD_COMMANDS).map((manager) => (
										<TabsTrigger key={manager} value={manager} className="fn-install-tab">
											{manager}
										</TabsTrigger>
									))}
								</TabsList>
								{Object.entries(SCAFFOLD_COMMANDS).map(([manager, command]) => (
									<TabsContent key={manager} value={manager} className="fn-install-panel">
										<button
											type="button"
											className="fn-mono fn-install-cmd"
											onClick={() => handleCopy(command)}
										>
											<span style={{ color: "var(--fn-molten)" }}>{">"}</span>
											<span>{command}</span>
											<span
												className="fn-mono"
												style={{
													fontSize: 10,
													color: copied === command ? "var(--fn-molten)" : "var(--fn-dim)",
													marginLeft: 8,
													transition: "color 0.2s",
													letterSpacing: 1,
												}}
											>
												{copied === command ? "COPIED!" : "COPY"}
											</span>
										</button>
									</TabsContent>
								))}
							</Tabs>

							<div
								style={{
									marginTop: 20,
									display: "flex",
									gap: 8,
									flexWrap: "wrap",
								}}
							>
								<Link to="/docs/$" params={{ _splat: "quick-start" }} className="fn-btn-primary">
									Quick Start
								</Link>
								<a
									href="https://discord.gg/sQF8hdN6Ht"
									target="_blank"
									rel="noopener noreferrer"
									className="fn-btn-ghost"
								>
									Join Discord
								</a>
							</div>
						</div>

						{/* Right — code sample */}
						<div className="fn-code">
							<div className="fn-code-header">
								<span>src/cli.ts</span>
								<span>TypeScript</span>
							</div>
							<div className="fn-code-body fn-shiki-container">
								<Code code={HIGHLIGHTED.greet} />
							</div>
						</div>
					</div>
				</section>

				{/* Showcase: eight features, real code and real output, driven by scroll */}
				<Showcase />

				{/* Modules */}
				<section className="fn-content-section">
					<p className="fn-eyebrow">Modules</p>

					{MODULES.map((m) => {
						if (m.upcoming) {
							return (
								<div key={m.pkg} className="fn-module-upcoming">
									<div className="fn-module-info">
										<code
											className="fn-mono"
											style={{
												fontSize: 14,
												color: "var(--fn-dim)",
											}}
										>
											{m.pkg}
										</code>
										<span style={{ fontSize: 13, color: "var(--fn-dim)" }}>{m.desc}</span>
									</div>
									<span className="fn-badge-soon">Coming Soon</span>
								</div>
							);
						}

						const version = npmVersions[m.pkg];

						return (
							<Link key={m.pkg} to="/docs/$" params={{ _splat: m.doc }} className="fn-module-row">
								<div className="fn-module-info">
									<code
										className="fn-mono fn-module-name"
										style={{
											fontSize: 14,
											color: "var(--fn-molten)",
											transition: "color 0.2s",
										}}
									>
										{m.pkg}
									</code>
									{version && <span className="fn-badge-version fn-mono">v{version}</span>}
									<span style={{ fontSize: 13, color: "var(--fn-dim)" }}>{m.desc}</span>
								</div>
								<span className="fn-module-arrow">→</span>
							</Link>
						);
					})}
				</section>

				{/* Footer */}
				<footer className="fn-footer">
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span className="fn-dot" />
						<span
							className="fn-condensed"
							style={{
								fontSize: 12,
								fontWeight: 700,
								letterSpacing: 3,
								textTransform: "uppercase",
							}}
						>
							Crust
						</span>
					</div>
					<span
						style={{
							fontSize: 11,
							color: "var(--fn-dim)",
							letterSpacing: 1,
						}}
					>
						MIT
					</span>
				</footer>
			</div>
		</HomeLayout>
	);
}
