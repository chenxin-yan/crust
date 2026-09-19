import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "../../packages/core/dist/index.js";
import { isInGitRepo } from "../../packages/create/dist/index.js";
import { help } from "../../packages/extensions/dist/index.js";
import * as man from "../../packages/man/dist/index.js";
import * as progress from "../../packages/progress/dist/index.js";
import {
	assertTTY,
	createPrompts,
	isTTY,
	NonInteractiveError,
} from "../../packages/prompts/dist/index.js";
import { loadPackagedSkills } from "../../packages/skills/dist/index.js";
import { createStore } from "../../packages/store/dist/index.js";
import { createStyle, fg, padEnd, stringWidth, table } from "../../packages/style/dist/index.js";
import * as testing from "../../packages/testing/dist/index.js";

const roots = {
	core: Crust,
	create: isInGitRepo,
	extensions: help,
	man: man.man,
	progress: progress.progress,
	prompts: createPrompts,
	skills: loadPackagedSkills,
	store: createStore,
	style: createStyle,
	testing: testing.captureExecute,
};
for (const [name, value] of Object.entries(roots)) {
	assert(value !== undefined, `Missing root export from @crustjs/${name}`);
}

const style = createStyle({ mode: "always" });
assert(style.red("crust") === "\x1b[31mcrust\x1b[39m", "expected red ANSI output");
assert(stringWidth("abc") === 3, "expected ASCII width 3");
assert(stringWidth("界") === 2, "expected CJK width 2");
assert(stringWidth("👋") === 2, "expected emoji width 2");
// Widths the JavaScript fallback (live on Node/Deno) must measure like Bun:
// single regional indicator (1), colon-form SGR (1), prepend + base (1), Hangul filler (0).
assert(stringWidth("\u{1F1E6}") === 1, "expected single regional indicator width 1");
assert(stringWidth("\x1b[38:2::1:2:3mX\x1b[0m") === 1, "expected colon-form SGR width 1");
assert(
	padEnd("\u{1F1E6}|", 4) === "\u{1F1E6}|  ",
	"expected regional indicator padded to 4 columns",
);
assert.equal(
	table(
		["cell", "w"],
		[
			["\u{1F1E6}", "1"],
			["\x1b[38:2::1:2:3mX\x1b[0m", "1"],
			["\u0600a", "1"],
			["\u1160", "0"],
		],
	),
	"| cell | w |\n|------|---|\n| \u{1F1E6}    | 1 |\n| \x1b[38:2::1:2:3mX\x1b[0m    | 1 |\n| \u0600a    | 1 |\n| \u1160     | 0 |",
	"expected table padding to follow Bun-equivalent widths",
);
// Route through the mode-forced instance: bare `fg` degrades on non-TTY stdout.
assert(
	style.fg("#ff0000")("x") === "\x1b[38;2;255;0;0mx\x1b[39m",
	"expected vendored color parser output",
);
assert.throws(
	() => fg("x", "not-a-color"),
	TypeError,
	"expected TypeError for invalid color input",
);

const skillsRoot = await mkdtemp(join(tmpdir(), "crust-runtime-skills-"));
try {
	const skillDir = join(skillsRoot, "smoke-skill");
	await mkdir(skillDir);
	await writeFile(
		join(skillDir, "SKILL.md"),
		"---\nname: smoke-skill\ndescription: Runtime smoke skill\n---\n\n# Smoke\n",
	);
	const skills = loadPackagedSkills(skillsRoot);
	assert(skills.length === 1, "expected one packaged skill");
	assert(skills[0]?.description === "Runtime smoke skill", "expected parsed description");
} finally {
	await rm(skillsRoot, { recursive: true, force: true });
}

const storeRoot = await mkdtemp(join(tmpdir(), "crust-runtime-store-"));
try {
	const store = createStore({
		dirPath: storeRoot,
		name: "smoke",
		fields: { theme: { type: "string", default: "light" } },
	});
	await store.write({ theme: "dark" });
	assert((await store.read()).theme === "dark", "expected persisted store value");
} finally {
	await rm(storeRoot, { recursive: true, force: true });
}

const { stdout: output } = await testing.captureExecute(
	new Crust("runtime-smoke").extend(help()).action(() => {}),
	["--help"],
);
assert(
	output.includes("runtime-smoke") && output.includes("Usage:"),
	`Sample CLI help output was incomplete:\n${output}`,
);

const ambientErrors = [];
await new Crust("ambient-dist")
	.action(async () => {
		await progress.spinner({
			message: "Dist bridge",
			task: async () => undefined,
			theme: { success: (text) => text, message: (text) => text },
		});
	})
	.execute({
		argv: [],
		io: { stdout: () => {}, stderr: (text) => ambientErrors.push(text) },
	});
assert.deepEqual(ambientErrors, ["✓ Dist bridge"]);

if (!isTTY()) {
	try {
		assertTTY();
		throw new Error("expected assertTTY to throw");
	} catch (error) {
		assert(error instanceof NonInteractiveError, "expected NonInteractiveError");
	}
} else {
	console.log("runtime-smoke: skipping non-TTY assertion in an interactive terminal");
}

assert(
	isInGitRepo(new URL("../../", import.meta.url).pathname),
	"expected checkout to be a Git worktree",
);

console.log(`runtime-smoke-ok (${Object.keys(roots).length} package roots)`);
