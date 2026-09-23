import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import { toolingTasks, upstreamBuild } from "../../vite.shared.ts";
import { landingTwoslash } from "./vite/landing-twoslash.ts";

export default defineConfig(({ mode }) => ({
	server: {
		port: 3000,
	},
	resolve: {
		tsconfigPaths: true,
	},
	environments: {
		ssr: {
			optimizeDeps: {
				// The Cloudflare plugin crawls SSR deps from the worker entry, so modules first imported by
				// lazily loaded routes (MDX components, Twoslash popups) are only found on first render. That
				// mid-session re-optimization loads a second React copy ("Invalid hook call" / null `use`).
				include: [
					"fumadocs-ui/components/callout",
					"fumadocs-ui/components/card",
					"fumadocs-ui/components/files",
					"fumadocs-ui/components/steps",
					"fumadocs-ui/components/tabs",
					"fumadocs-twoslash/ui",
				],
			},
		},
	},
	// `vp test` (mode "test") imports site modules directly; the MDX, Cloudflare
	// and TanStack Start plugins serve only dev and build.
	plugins:
		mode === "test"
			? []
			: lazyPlugins(async () => [
					mdx(await import("./source.config.ts")),
					landingTwoslash(),
					tailwindcss(),
					cloudflare({ viteEnvironment: { name: "ssr" } }),
					tanstackStart({
						prerender: {
							enabled: true,
						},
					}),
					react(),
				]),
	run: {
		tasks: {
			...toolingTasks,
			// The site build (prerender) and dev server always run fresh.
			"build:task": {
				command: "pnpm run build",
				dependsOn: [upstreamBuild],
				cache: false,
			},
			"dev:task": {
				command: "pnpm run dev",
				dependsOn: [upstreamBuild],
				cache: false,
			},
		},
	},
}));
