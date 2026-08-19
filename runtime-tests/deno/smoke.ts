import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-types="../../packages/core/dist/index.d.ts"
import { Crust } from "@crustjs/core";
// @ts-types="../../packages/create/dist/index.d.ts"
import { isInGitRepo } from "@crustjs/create";
// @ts-types="../../packages/prompts/dist/index.d.ts"
import { assertTTY, isTTY, NonInteractiveError } from "@crustjs/prompts";
// @ts-types="../../packages/skills/dist/index.d.ts"
import { loadPackagedSkills } from "@crustjs/skills";
// @ts-types="../../packages/store/dist/index.d.ts"
import { createStore } from "@crustjs/store";
// @ts-types="../../packages/style/dist/index.d.ts"
import { createStyle, stringWidth } from "@crustjs/style";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test("style renders ANSI and measures terminal widths", () => {
	const style = createStyle({ mode: "always" });
	assert(style.red("crust") === "\x1b[31mcrust\x1b[39m", "expected red ANSI output");
	assert(stringWidth("abc") === 3, "expected ASCII width 3");
	assert(stringWidth("界") === 2, "expected CJK width 2");
	assert(stringWidth("👋") === 2, "expected emoji width 2");
});

Deno.test("skills parse SKILL.md frontmatter", async () => {
	const root = await mkdtemp(join(tmpdir(), "crust-deno-skills-"));
	try {
		const skillDir = join(root, "smoke-skill");
		await Deno.mkdir(skillDir);
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: smoke-skill\ndescription: Deno smoke skill\n---\n\n# Smoke\n",
		);

		const skills = loadPackagedSkills(root);
		assert(skills.length === 1, "expected one packaged skill");
		assert(skills[0]?.description === "Deno smoke skill", "expected parsed description");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

Deno.test("store persists and reads typed values", async () => {
	const root = await mkdtemp(join(tmpdir(), "crust-deno-store-"));
	try {
		const store = createStore({
			dirPath: root,
			name: "smoke",
			fields: {
				theme: { type: "string", default: "light" },
				tags: {
					type: "string",
					array: true,
					default: [],
					validate: (value) => ({ value: [...value] }),
				},
			},
		});
		await store.write({ theme: "dark", tags: ["deno"] });
		const saved = await store.read();
		assert(saved.theme === "dark", "expected persisted store value");
		assert(saved.tags[0] === "deno", "expected structurally stable array value");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

Deno.test("core runs a command without a TTY", async () => {
	let ran = false;
	await new Crust("smoke")
		.action(() => {
			ran = true;
		})
		.run([]);
	assert(ran, "expected command action to run");
});

Deno.test("prompts reject non-interactive input without entering raw mode", () => {
	assert(!isTTY(), "expected smoke tests to run without a TTY");
	try {
		assertTTY();
		throw new Error("expected assertTTY to throw");
	} catch (error) {
		assert(error instanceof NonInteractiveError, "expected NonInteractiveError");
	}
});

Deno.test("create can spawn git through node:child_process", () => {
	assert(
		isInGitRepo(new URL("../../", import.meta.url).pathname),
		"expected checkout to be a Git worktree",
	);
});
