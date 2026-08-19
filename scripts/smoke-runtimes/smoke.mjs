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
import { createStyle, fg, stringWidth } from "../../packages/style/dist/index.js";
import * as testing from "../../packages/testing/dist/index.js";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

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
	testing: testing.captureRun,
};
for (const [name, value] of Object.entries(roots)) {
	assert(value !== undefined, `Missing root export from @crustjs/${name}`);
}

const style = createStyle({ mode: "always" });
assert(style.red("crust") === "\x1b[31mcrust\x1b[39m", "expected red ANSI output");
assert(stringWidth("abc") === 3, "expected ASCII width 3");
assert(stringWidth("界") === 2, "expected CJK width 2");
assert(stringWidth("👋") === 2, "expected emoji width 2");
// Route through the mode-forced instance: bare `fg` degrades on non-TTY stdout.
assert(
	style.fg("#ff0000")("x") === "\x1b[38;2;255;0;0mx\x1b[39m",
	"expected vendored color parser output",
);
let invalidColorRejected = false;
try {
	fg("x", "not-a-color");
} catch (error) {
	invalidColorRejected = error instanceof TypeError;
}
assert(invalidColorRejected, "expected TypeError for invalid color input");

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

const stdout = [];
const originalLog = console.log;
console.log = (...values) => stdout.push(values.join(" "));
try {
	await new Crust("runtime-smoke")
		.extend(help())
		.action(() => {})
		.execute({ argv: ["--help"] });
} finally {
	console.log = originalLog;
}
const output = stdout.join("\n");
assert(
	output.includes("runtime-smoke") && output.includes("Usage:"),
	`Sample CLI help output was incomplete:\n${output}`,
);

if (!isTTY()) {
	try {
		assertTTY();
		throw new Error("expected assertTTY to throw");
	} catch (error) {
		assert(error instanceof NonInteractiveError, "expected NonInteractiveError");
	}
} else {
	originalLog("runtime-smoke: skipping non-TTY assertion in an interactive terminal");
}

assert(
	isInGitRepo(new URL("../../", import.meta.url).pathname),
	"expected checkout to be a Git worktree",
);

originalLog(`runtime-smoke-ok (${Object.keys(roots).length} package roots)`);
