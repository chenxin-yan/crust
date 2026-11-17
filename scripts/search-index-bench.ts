// Measures `search()` on the shipped artifact: a generated CLI compiled with `bun build --compile`.
// Reports medians only; nothing here is a CI threshold.
//
//   pnpm run build:pkgs && bun scripts/search-index-bench.ts [--groups 100] [--runs 21]
//
// 100 groups of 30 commands each give 3,100 indexed commands.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const QUERY = "rotate an api key";

/**
 * A CLI with `groups` groups of 30 commands (one argument and three flags each), plus
 * `noop` (the baseline) and `bench`, which prints the time to build the lazy command
 * tree, build the index, and run one query, as JSON.
 */
export function generateSearchFixtureSource(groups: number): string {
	return `import { Crust, type CommandSnapshot, defineCommand } from "@crustjs/core";
import { createCommandIndex, isListed } from "@crustjs/core/tooling";
import { search } from "@crustjs/extensions";

const nouns = ["account", "api-key", "bucket", "certificate", "cluster", "database", "deployment", "domain", "firewall", "function", "gateway", "image", "instance", "invoice", "job", "key-pair", "load-balancer", "log", "member", "metric", "namespace", "network", "node", "notification", "organization", "pipeline", "policy", "project", "queue", "record", "region", "release", "repository", "role", "route", "secret", "service", "snapshot", "subnet", "subscription", "table", "team", "template", "token", "topic", "user", "volume", "webhook", "worker", "zone"];
const verbs = ["create", "delete", "describe", "list", "update", "get", "rotate", "enable", "disable", "restore", "export", "import", "attach", "detach", "move", "copy", "tag", "untag", "start", "stop", "restart", "scale", "promote", "archive", "validate", "search", "watch", "sync", "lock", "unlock"];

const groups = Array.from({ length: ${groups} }, (_, index) => {
	const noun = nouns[index % nouns.length]!;
	const name = index < nouns.length ? noun : \`\${noun}-v\${Math.floor(index / nouns.length) + 1}\`;
	const words = noun.replace("-", " ");
	return defineCommand(name, { description: \`Manage \${words}s\` }, (group) =>
		group.add(
			...verbs.map((verb) =>
				defineCommand(verb, { description: \`\${verb[0]!.toUpperCase()}\${verb.slice(1)} a \${words} in the current project\` }, (cmd) =>
					cmd
						.args({ name: "id", type: "string", description: \`ID of the \${words}\` })
						.flags({
							region: { type: "string", description: "Region to operate in" },
							dryRun: { type: "boolean", description: "Print the request without sending it" },
							output: { type: "string", choices: ["table", "json"], description: "Output format" },
						})
						.action(() => ({ ok: true })),
				),
			),
		),
	);
});

await new Crust("acme")
	.extend(search())
	.add(...groups)
	.add(defineCommand("noop", (cmd) => cmd.action(() => {})))
	.add(
		defineCommand("bench", (cmd) =>
			cmd.action(({ rootCommand, stdout }) => {
				const t0 = performance.now();
				const commands: { path: readonly string[]; command: CommandSnapshot }[] = [];
				const visit = (command: CommandSnapshot, path: readonly string[]) => {
					if (!isListed(command)) return;
					// Reading args and flags builds a pending command, as indexing does.
					void command.args;
					void command.flags;
					commands.push({ path, command });
					for (const [name, sub] of Object.entries(command.subCommands)) visit(sub, [...path, name]);
				};
				visit(rootCommand, []);
				const t1 = performance.now();
				const index = createCommandIndex(commands);
				const t2 = performance.now();
				index.search(${JSON.stringify(QUERY)}, 5);
				const t3 = performance.now();
				stdout(JSON.stringify({ commands: commands.length, treeMs: t1 - t0, indexMs: t2 - t1, queryMs: t3 - t2 }));
			}),
		),
	)
	.execute();
`;
}

function run(command: string[], cwd: string): string {
	const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
	if (result.exitCode !== 0) {
		throw new Error(
			`Command failed (${command.join(" ")}):\n${result.stdout.toString()}${result.stderr.toString()}`,
		);
	}
	return result.stdout.toString();
}

function median(values: readonly number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Wall time of one process run, in milliseconds. */
function wallMs(command: string[], cwd: string): number {
	const start = performance.now();
	run(command, cwd);
	return performance.now() - start;
}

function bench(groups: number, runs: number): string {
	const root = resolve(import.meta.dir, "..");
	for (const name of ["core", "extensions"]) {
		if (!existsSync(join(root, "packages", name, "dist"))) {
			throw new Error(`packages/${name}/dist is missing; run pnpm run build:pkgs first`);
		}
	}
	const dir = mkdtempSync(join(tmpdir(), "crust-search-bench-"));
	try {
		mkdirSync(join(dir, "node_modules/@crustjs"), { recursive: true });
		for (const name of ["core", "extensions"]) {
			symlinkSync(join(root, "packages", name), join(dir, `node_modules/@crustjs/${name}`), "dir");
		}
		writeFileSync(join(dir, "cli.ts"), generateSearchFixtureSource(groups));
		const cli = join(dir, process.platform === "win32" ? "cli.exe" : "cli");
		run([process.execPath, "build", "--compile", "cli.ts", "--outfile", cli], dir);

		const phases: { commands: number; treeMs: number; indexMs: number; queryMs: number }[] = [];
		const baseline: number[] = [];
		const searched: number[] = [];
		for (let index = 0; index < runs; index++) {
			phases.push(JSON.parse(run([cli, "bench"], dir)));
			baseline.push(wallMs([cli, "noop"], dir));
			searched.push(wallMs([cli, "search", QUERY], dir));
		}
		const ms = (value: number) => `${value.toFixed(1)} ms`;
		const of = (key: "treeMs" | "indexMs" | "queryMs") => median(phases.map((phase) => phase[key]));
		return [
			`Runtime: Bun ${Bun.version} (bun build --compile), ${process.platform}-${process.arch}, ${cpus()[0]?.model ?? "unknown CPU"}`,
			`Indexed commands: ${phases[0]?.commands}; medians of ${runs} runs`,
			"",
			"| Step | Median |",
			"| --- | --- |",
			`| Lazy tree build (args and flags of every command) | ${ms(of("treeMs"))} |`,
			`| Index build (createCommandIndex) | ${ms(of("indexMs"))} |`,
			`| One query | ${ms(of("queryMs"))} |`,
			`| Baseline: \`acme noop\` wall time | ${ms(median(baseline))} |`,
			`| \`acme search "${QUERY}"\` wall time | ${ms(median(searched))} |`,
		].join("\n");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const option = (name: string, fallback: number) => {
		const at = process.argv.indexOf(`--${name}`);
		const value = at === -1 ? fallback : Number(process.argv[at + 1]);
		if (!Number.isInteger(value) || value < 1)
			throw new Error(`--${name} takes a positive integer`);
		return value;
	};
	try {
		console.log(bench(option("groups", 100), option("runs", 21)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
