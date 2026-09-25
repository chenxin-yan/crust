import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

import { toolingTasks, upstreamBuild } from "../../vite.shared.ts";

export default defineConfig(({ mode }) => ({
	server: {
		port: 3000,
	},
	resolve: {
		tsconfigPaths: true,
	},
	// `vp test` (mode "test") imports site modules directly; the MDX, Cloudflare
	// and TanStack Start plugins serve only dev and build.
	plugins:
		mode === "test"
			? []
			: lazyPlugins(async () => [
					mdx(await import("./source.config.ts")),
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
