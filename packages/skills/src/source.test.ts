import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPackagedSkills, resolveSkillSource, SkillSourceUnavailableError } from "./source.ts";

let tempRoot: string;

beforeEach(async () => {
	tempRoot = await mkdtemp(join(tmpdir(), "crust-skill-source-"));
});

afterEach(async () => {
	await rm(tempRoot, { recursive: true, force: true });
});

async function writeSkill(root: string, dirName: string, declaredName = dirName): Promise<void> {
	const dir = join(root, dirName);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "SKILL.md"),
		`---\nname: ${declaredName}\ndescription: ${declaredName} skill\n---\n`,
	);
}

describe("packaged skill sources", () => {
	it("returns a logical path without resolving its symlink", async () => {
		const realSource = join(tempRoot, "store", "skills");
		const logicalSource = join(tempRoot, "node_modules", "pkg", "skills");
		await mkdir(realSource, { recursive: true });
		await mkdir(join(tempRoot, "node_modules", "pkg"), { recursive: true });
		await symlink(realSource, logicalSource);

		expect(resolveSkillSource(logicalSource)).toBe(logicalSource);
	});

	it("resolves an executable-relative fallback", async () => {
		const name = `skills-${crypto.randomUUID()}`;
		const source = join(tempRoot, "bin", name);
		await mkdir(source, { recursive: true });
		const descriptor = Object.getOwnPropertyDescriptor(process, "execPath")!;
		Object.defineProperty(process, "execPath", {
			...descriptor,
			value: join(tempRoot, "bin", "cli"),
		});
		try {
			expect(resolveSkillSource(name)).toBe(source);
		} finally {
			Object.defineProperty(process, "execPath", descriptor);
		}
	});

	it("rejects non-file URLs as a definition error, not an unavailable source", () => {
		let error: unknown;
		try {
			resolveSkillSource(new URL("https://example.com/skills"));
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("file: protocol");
		expect(error).not.toBeInstanceOf(SkillSourceUnavailableError);
	});

	it("loads name and description from SKILL.md frontmatter", async () => {
		const root = join(tempRoot, "skills");
		await writeSkill(root, "demo");
		expect(loadPackagedSkills(root)).toMatchObject([
			{ name: "demo", description: "demo skill", sourceDir: join(root, "demo") },
		]);
	});

	it("rejects empty, invalid, and mismatched skill sources", async () => {
		const empty = join(tempRoot, "empty");
		await mkdir(empty);
		expect(() => loadPackagedSkills(empty)).toThrow("does not contain any skill directories");

		const invalid = join(tempRoot, "invalid");
		await mkdir(join(invalid, "demo"), { recursive: true });
		expect(() => loadPackagedSkills(invalid)).toThrow("does not contain any skill directories");

		await writeSkill(invalid, "demo", "other");
		expect(() => loadPackagedSkills(invalid)).toThrow('declares name "other"');
	});

	it("rejects a SKILL.md missing name or description frontmatter", async () => {
		const root = join(tempRoot, "skills");
		const dir = join(root, "demo");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "---\nname: demo\n---\n");
		expect(() => loadPackagedSkills(root)).toThrow(
			"requires name and description in SKILL.md frontmatter",
		);
	});

	it("skips directories without SKILL.md instead of failing valid skills", async () => {
		const root = join(tempRoot, "skills");
		await writeSkill(root, "demo");
		await mkdir(join(root, "__MACOSX"), { recursive: true });
		expect(loadPackagedSkills(root)).toMatchObject([{ name: "demo" }]);
	});
});
