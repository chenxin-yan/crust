// Writes src/agents.generated.ts from the agent registry of the `skills` package
// (a devDependency, never shipped). `--check` exits 1 instead when the file differs.
//   node scripts/generate-agents.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REGENERATE_COMMAND = "pnpm --filter @crustjs/skills run generate:agents";
const OUTPUT = fileURLToPath(new URL("../src/agents.generated.ts", import.meta.url));
const SENTINEL_HOME = resolve("/crust-generate-agents-home");
// `skills` computes paths at import time from `os.homedir()` (HOME, USERPROFILE on Windows), from
// `os.platform()` (Reasonix's Windows folder) and from these variables; the snapshot is the POSIX
// layout of a sentinel home, the same on every host. `process.platform` is pinned too, though only
// its prompts and git code read it.
const PATH_OVERRIDES = [
	"XDG_CONFIG_HOME",
	"CLAUDE_CONFIG_DIR",
	"CODEX_HOME",
	"VIBE_HOME",
	"HERMES_HOME",
	"AUTOHAND_HOME",
	"GROK_HOME",
	"SARVAM_HOME",
	"REASONIX_HOME",
	"APPDATA",
	"FLATPAK_XDG_CONFIG_HOME",
];

process.env.HOME = SENTINEL_HOME;
process.env.USERPROFILE = SENTINEL_HOME;
for (const name of PATH_OVERRIDES) delete process.env[name];
Object.defineProperty(process, "platform", { value: "linux" });
os.platform = () => "linux";
// Named `node:os` imports (`import { platform } from "os"`) see the replacement only after this.
syncBuiltinESMExports();
const { getSupportedAgents, version } = await import("skills");

const license = readFileSync(
	join(dirname(fileURLToPath(import.meta.resolve("skills/package.json"))), "LICENSE"),
	"utf8",
);
const copyright = license.match(/^Copyright .+$/m)?.[0];
if (!copyright) throw new Error("skills/LICENSE has no copyright line.");

function homeRelative(id: string, dir: string | null): string | null {
	if (dir === null) return null;
	if (!dir.startsWith(SENTINEL_HOME + sep)) {
		throw new Error(
			`Agent "${id}": global skills directory "${dir}" is not under the home directory, so it cannot be recorded portably.`,
		);
	}
	return dir
		.slice(SENTINEL_HOME.length + 1)
		.split(sep)
		.join("/");
}

const entries = getSupportedAgents()
	.filter((agent) => agent.id !== "universal")
	.map((agent) => ({
		id: agent.id,
		label: agent.name,
		projectSkillsDir: agent.projectSkillsDir,
		globalSkillsDir: homeRelative(agent.id, agent.globalSkillsDir),
	}))
	.sort((a, b) => (a.id < b.id ? -1 : 1));

const key = (id: string) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : JSON.stringify(id));
const source = `// Generated from the agent registry of skills@${version} (https://github.com/vercel-labs/skills).
// skills is MIT licensed: ${copyright}
// Do not edit; regenerate with \`${REGENERATE_COMMAND}\`.

/** Agent id: [label, project skills dir, global skills dir under the home directory or \`null\`]. */
export const AGENTS = {
${entries
	.map(
		(entry) =>
			`\t${key(entry.id)}: [${[entry.label, entry.projectSkillsDir, entry.globalSkillsDir]
				.map((value) => JSON.stringify(value))
				.join(", ")}],`,
	)
	.join("\n")}
} as const;
`;

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
