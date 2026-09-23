// oxlint-disable-next-line import/default -- see above
import appSource from "../../../examples/landing/app.ts?raw";
// oxlint-disable-next-line import/default -- see above
import contextsSource from "../../../examples/landing/contexts.ts?raw";
// oxlint-disable-next-line import/default -- see above
import extensionSource from "../../../examples/landing/extension.ts?raw";
// oxlint-disable-next-line import/default -- Vite's ?raw loader exports the file text; the TypeScript source needs no default export.
import inputsSource from "../../../examples/landing/inputs.ts?raw";
// oxlint-disable-next-line import/default -- see above
import schemaSource from "../../../examples/landing/schema.ts?raw";
// oxlint-disable-next-line import/default -- see above
import testingSource from "../../../examples/landing/testing.ts?raw";

/** Raw source per snippet key; shown as-is when the generated Twoslash hast lacks a key. */
export const SNIPPETS = {
	app: appSource.trimEnd(),
	typed: inputsSource.trimEnd(),
	schema: schemaSource.trimEnd(),
	contexts: contextsSource.trimEnd(),
	extension: extensionSource.trimEnd(),
	testing: testingSource.trimEnd(),
	// The create-crust template's package.json, cropped to what `crust build` reads.
	build: `{
  "name": "my-cli",
  "version": "1.2.3",
  "bin": { "my-cli": "src/cli.ts" },
  "scripts": {
    "build": "crust build",
    "release": "crust publish"
  }
}`,
} satisfies Record<string, string>;
export type SnippetKey = keyof typeof SNIPPETS;

/**
 * One terminal line. `run` is a prompt that runs a file with the selected runtime,
 * `cmd` a prompt as written, `err` stderr.
 */
export type Line =
	| { kind: "run"; file: string; args: string }
	| { kind: "cmd" | "out" | "err"; text: string };

const run = (file: string, args = ""): Line => ({ kind: "run", file, args });
const cmd = (text: string): Line => ({ kind: "cmd", text });
const out = (text: string): Line => ({ kind: "out", text });
const err = (text: string): Line => ({ kind: "err", text });

export type Runtime = { key: string; label: string; run: (file: string) => string };

// Each runtime executes the TypeScript source directly; the output is identical.
export const RUNTIMES: readonly Runtime[] = [
	{ key: "bun", label: "Bun", run: (file) => `bun run ${file}` },
	{ key: "node", label: "Node.js", run: (file) => `node ${file}` },
	{ key: "deno", label: "Deno", run: (file) => `deno run -A ${file}` },
];

export type Feature = {
	key: string;
	tab: string;
	title: string;
	/** Snippet shown in the code panel while this tab is active, and its header slots. */
	code: SnippetKey;
	file: string;
	lang: string;
	output: readonly Line[];
};

export const FEATURES: readonly Feature[] = [
	{
		key: "typed",
		tab: "Typed inputs",
		title: "Typed inputs, end to end",
		code: "typed",
		file: "convert.ts",
		lang: "TypeScript",
		output: [
			run("convert.ts", "report.md"),
			out("Converting report.md as html"),
			out(""),
			run("convert.ts", "report.md --to pdf"),
			out("Converting report.md as pdf"),
		],
	},
	{
		key: "schema",
		tab: "Validation",
		title: "Validate with any Standard Schema",
		code: "schema",
		file: "serve.ts",
		lang: "TypeScript",
		output: [
			run("serve.ts"),
			out("listening on port 3000"),
			out(""),
			run("serve.ts", "70000"),
			err("Error: Invalid input:"),
			err("  - args.port: Too big: expected number to be <=65535"),
		],
	},
	{
		key: "contexts",
		tab: "Contexts",
		title: "Inject dependencies; clean up even on failure",
		code: "contexts",
		file: "work.ts",
		lang: "TypeScript",
		output: [
			run("work.ts", "query"),
			out("db opened"),
			out("select 1: ok"),
			out("db closed"),
			out(""),
			run("work.ts", "fail"),
			out("db opened"),
			out("db closed"),
			out(""),
			err("Error: query failed"),
		],
	},
	{
		key: "extension",
		tab: "Extensions",
		title: "Add flags and hooks with your own extension",
		code: "extension",
		file: "deploy.ts",
		lang: "TypeScript",
		output: [
			run("deploy.ts"),
			out("deployed"),
			out(""),
			run("deploy.ts", "--preview"),
			out("nothing changed"),
		],
	},
	{
		key: "testing",
		tab: "Testing",
		title: "Test in-process, prompts included",
		code: "testing",
		file: "cli.test.ts",
		lang: "TypeScript",
		output: [
			run("cli.test.ts"),
			out("1"),
			out('Error: Unknown command "unknown".'),
			out("✓ Name? Ada"),
		],
	},
	{
		key: "build",
		tab: "Build",
		title: "Build once; ship binaries and an npm package",
		code: "build",
		file: "package.json",
		lang: "JSON",
		output: [
			cmd("crust build --target bun-linux-x64"),
			out(".crust/"),
			out("├── manifest.json"),
			out("├── root/bin/my-cli.js"),
			out("└── linux-x64/bin/my-cli-bun-linux-x64"),
		],
	},
	{
		key: "help",
		tab: "Help",
		title: "Help for humans",
		code: "app",
		file: "src/cli.ts",
		lang: "TypeScript",
		output: [
			run("src/cli.ts", "--help"),
			out("my-cli - Manage deployments"),
			out(""),
			out("Usage:"),
			out("  my-cli <command> [options]"),
			out(""),
			out("Commands:"),
			out("  deploy     Deploy the app"),
			out("  skills (skill) Manage agent skill installations"),
			out(""),
			out("Options:"),
			out("  -h, --help                   Show help"),
			out(""),
			out("Agent skills:"),
			out("  my-cli — Manage deployments"),
			out("    Source: .crust/root/skills/my-cli"),
		],
	},
	{
		key: "skills",
		tab: "Skills",
		title: "Skills for agents",
		code: "app",
		file: "src/cli.ts",
		lang: "TypeScript",
		output: [
			cmd("crust build"),
			out(".crust/artifacts/skills/my-cli/"),
			out("├── SKILL.md"),
			out("└── commands/"),
			out("    ├── my-cli.md"),
			out("    ├── deploy.md"),
			out("    └── skills.md"),
		],
	},
];
