// Writes src/agents.generated.ts from the agent registry of the `skills` package
// (a devDependency, never shipped). `--check` exits 1 instead when the file differs.
//   node scripts/generate-agents.ts [--check]
//
// Each snapshot runs in a child process with an empty environment, so nothing from this machine
// leaks in. The child records every environment variable `skills` reads; each one is then set to
// a sentinel directory in another child, and an agent whose global directory moves under it gets
// that variable as its override. Any other effect fails the generation.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const REGENERATE_COMMAND = "pnpm --filter @crustjs/skills run generate:agents";
const OUTPUT = fileURLToPath(new URL("../src/agents.generated.ts", import.meta.url));
const SENTINEL_HOME = resolve("/crust-generate-agents-home");
const SNAPSHOT_FLAG = "--snapshot";
const RESULT_PREFIX = "AGENTS_SNAPSHOT ";

interface AgentSnapshot {
	id: string;
	name: string;
	projectSkillsDir: string;
	globalSkillsDir: string | null;
}

interface Snapshot {
	version: string;
	agents: AgentSnapshot[];
	reads: string[];
}

/** Child mode: `--snapshot [NAME VALUE]` prints the registry and the variables read for it. */
async function snapshot(variable?: string, value?: string): Promise<void> {
	// Assigned here, not in the spawn environment, so Node's own startup never sees them.
	process.env.HOME = SENTINEL_HOME;
	process.env.USERPROFILE = SENTINEL_HOME;
	if (variable !== undefined) process.env[variable] = value;
	// The snapshot is the POSIX layout on every host; `skills` reads `os.platform()` for Reasonix.
	Object.defineProperty(process, "platform", { value: "linux" });
	os.platform = () => "linux";
	// Named `node:os` imports (`import { platform } from "os"`) see the replacement only after this.
	syncBuiltinESMExports();
	const reads = new Set<string>();
	const record = (name: string | symbol) => {
		if (typeof name === "string") reads.add(name);
	};
	process.env = new Proxy(process.env, {
		get: (target, name) => (typeof name === "string" ? (record(name), target[name]) : undefined),
		// Written on the target: a write through the proxy defines a descriptor `process.env` rejects.
		set: (target, name, written) => {
			if (typeof name === "string") target[name] = String(written);
			return true;
		},
		has: (target, name) => (record(name), name in target),
		getOwnPropertyDescriptor: (target, name) => (
			record(name),
			Object.getOwnPropertyDescriptor(target, name)
		),
	});
	const { getSupportedAgents, version } = await import("skills");
	const agents = getSupportedAgents()
		.filter((agent) => agent.id !== "universal")
		.map(({ id, name, projectSkillsDir, globalSkillsDir }) => ({
			id,
			name,
			projectSkillsDir,
			globalSkillsDir,
		}));
	const result: Snapshot = { version, agents, reads: [...reads].sort() };
	console.log(RESULT_PREFIX + JSON.stringify(result));
}

async function runSnapshot(variable?: string, value?: string): Promise<Snapshot> {
	const args = [...process.execArgv, fileURLToPath(import.meta.url), SNAPSHOT_FLAG];
	if (variable !== undefined && value !== undefined) args.push(variable, value);
	// Empty but for what Windows needs to start Node at all.
	const env = process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
	const { stdout } = await promisify(execFile)(process.execPath, args, {
		env,
		timeout: 20_000,
		maxBuffer: 16 * 1024 * 1024,
	});
	const line = stdout.split("\n").find((text) => text.startsWith(RESULT_PREFIX));
	if (!line)
		throw new Error(`No snapshot from the child process${variable ? ` with ${variable}` : ""}.`);
	return JSON.parse(line.slice(RESULT_PREFIX.length)) as Snapshot;
}

function posixRelative(dir: string, root: string): string | undefined {
	if (dir === root) return "";
	if (!dir.startsWith(root + sep)) return undefined;
	return dir
		.slice(root.length + 1)
		.split(sep)
		.join("/");
}

async function generate(): Promise<{ version: string; source: string }> {
	const baseline = await runSnapshot();
	const variables = baseline.reads.filter((name) => name !== "HOME" && name !== "USERPROFILE");
	const probes = await Promise.all(
		variables.map(async (variable) => {
			const value = resolve(`/crust-generate-agents-env/${variable}`);
			return { variable, value, snapshot: await runSnapshot(variable, value) };
		}),
	);

	const overrides = new Map<string, { variable: string; rest: string }>();
	for (const { variable, value, snapshot: probe } of probes) {
		const fail = (agent: string, what: string) => {
			throw new Error(
				`${variable} changes agent "${agent}" in a way the snapshot cannot record: ${what}.`,
			);
		};
		const baseIds = new Set(baseline.agents.map((agent) => agent.id));
		const probeIds = new Set(probe.agents.map((agent) => agent.id));
		for (const id of baseIds.symmetricDifference(probeIds)) {
			fail(id, baseIds.has(id) ? "it disappears" : "it appears");
		}
		if ([...baseIds].join() !== [...probeIds].join()) fail("*", "the agent order changes");
		for (const [index, agent] of probe.agents.entries()) {
			const base = baseline.agents[index]!;
			if (agent.name !== base.name) fail(agent.id, "its name changes");
			if (agent.projectSkillsDir !== base.projectSkillsDir) {
				fail(agent.id, `its project directory becomes "${agent.projectSkillsDir}"`);
			}
			if (agent.globalSkillsDir === base.globalSkillsDir) continue;
			const rest =
				agent.globalSkillsDir === null ? undefined : posixRelative(agent.globalSkillsDir, value);
			if (rest === undefined || base.globalSkillsDir === null) {
				fail(agent.id, `its global directory becomes "${agent.globalSkillsDir}"`);
			}
			const existing = overrides.get(agent.id);
			if (existing) fail(agent.id, `it already follows ${existing.variable}`);
			overrides.set(agent.id, { variable, rest: rest! });
		}
	}

	const entries = baseline.agents
		.map((agent) => {
			const globalSkillsDir =
				agent.globalSkillsDir === null ? null : posixRelative(agent.globalSkillsDir, SENTINEL_HOME);
			if (globalSkillsDir === undefined) {
				throw new Error(
					`Agent "${agent.id}": global skills directory "${agent.globalSkillsDir}" is not under the home directory, so it cannot be recorded portably.`,
				);
			}
			const override = overrides.get(agent.id);
			const row = [agent.name, agent.projectSkillsDir, globalSkillsDir];
			return {
				id: agent.id,
				row: override ? [...row, override.variable, override.rest] : row,
			};
		})
		.sort((a, b) => (a.id < b.id ? -1 : 1));

	const license = readFileSync(
		join(dirname(fileURLToPath(import.meta.resolve("skills/package.json"))), "LICENSE"),
		"utf8",
	);
	const copyright = license.match(/^Copyright .+$/m)?.[0];
	if (!copyright) throw new Error("skills/LICENSE has no copyright line.");

	const key = (id: string) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : JSON.stringify(id));
	// The formatter's layout (100 columns, a tab counting 2): a longer row gets one value per line.
	const formatRow = (id: string, row: readonly (string | null)[]) => {
		const values = row.map((value) => JSON.stringify(value));
		const line = `\t${key(id)}: [${values.join(", ")}],`;
		if (line.length + 1 <= 100) return line;
		return `\t${key(id)}: [\n${values.map((value) => `\t\t${value},\n`).join("")}\t],`;
	};
	const source = `// Generated from the agent registry of skills@${baseline.version} (https://github.com/vercel-labs/skills).
// skills is MIT licensed: ${copyright}
// Do not edit; regenerate with \`${REGENERATE_COMMAND}\`.

/**
 * Agent id: [label, project skills dir, global skills dir under the home directory or \`null\`],
 * then, when an environment variable relocates the global skills dir, [variable, path under it].
 */
export const AGENTS = {
${entries.map(({ id, row }) => formatRow(id, row)).join("\n")}
} as const;
`;
	return { version: baseline.version, source };
}

if (process.argv[2] === SNAPSHOT_FLAG) {
	await snapshot(process.argv[3], process.argv[4]);
} else {
	const { version, source } = await generate();
	if (process.argv.includes("--check")) {
		// A Windows checkout may have CRLF line endings.
		if (readFileSync(OUTPUT, "utf8").replaceAll("\r\n", "\n") !== source) {
			console.error(
				`src/agents.generated.ts does not match skills@${version}. Run \`${REGENERATE_COMMAND}\`.`,
			);
			process.exit(1);
		}
	} else {
		writeFileSync(OUTPUT, source);
	}
}
