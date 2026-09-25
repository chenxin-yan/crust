import type { UserConfig } from "vite-plus";

// Settings every workspace package's vite.config.ts spreads. Task names carry a
// `:task` suffix because a name cannot be both a package.json script and a
// vite.config.ts task; each task delegates to the same-named script, which
// stays the single definition of the command.

type RunTasks = NonNullable<NonNullable<UserConfig["run"]>["tasks"]>;

/** tsdown options shared by every published library; packages add `entry`. */
export const pack = {
	fixedExtension: false,
	publint: "ci-only",
	attw: {
		enabled: "ci-only",
		profile: "esm-only",
		level: "error",
	},
} satisfies UserConfig["pack"];

/** Builds each workspace package this package depends on first. */
export const upstreamBuild = {
	task: "build:task",
	from: ["dependencies", "devDependencies"],
} satisfies { task: string; from: Array<"dependencies" | "devDependencies"> };

/** `mise.toml` pins the Node and Bun every task runs on; file tracking cannot see that. */
export const runtimeInput = [
	{ auto: true },
	{ pattern: "mise.toml", base: "workspace" },
] satisfies Array<{ auto: boolean } | { pattern: string; base: "workspace" }>;

/** Type check and test after the workspace packages they import are built. */
export const toolingTasks = {
	"check:types:task": {
		command: "pnpm run check:types",
		dependsOn: [upstreamBuild],
		input: runtimeInput,
		output: [],
	},
	"test:task": {
		command: "pnpm run test",
		dependsOn: [upstreamBuild],
		cache: false,
	},
} satisfies RunTasks;

/** Library packages build `dist` (and `.crust` for Crust-built CLIs); their tests also need their own build. */
export const libraryTasks = {
	...toolingTasks,
	"build:task": {
		command: "pnpm run build",
		dependsOn: [upstreamBuild],
		// publint and ATTW run only when CI is set.
		env: ["CI"],
		// The builders read their previous output; a cache hit restores it instead.
		input: [...runtimeInput, "!dist/**", "!.crust/**"],
		output: ["dist/**", ".crust/**"],
	},
	"test:task": {
		...toolingTasks["test:task"],
		dependsOn: ["build:task", upstreamBuild],
	},
} satisfies RunTasks;
