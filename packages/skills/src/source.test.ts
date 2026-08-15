import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("packaged skill sources", () => {
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
			expect(await resolveSkillSource(name)).toBe(source);
		} finally {
			Object.defineProperty(process, "execPath", descriptor);
		}
	});

	it("rejects non-file URLs", async () => {
		await expect(resolveSkillSource(new URL("https://example.com/skills"))).rejects.toBeInstanceOf(
			SkillSourceUnavailableError,
		);
	});

	it("rejects empty and invalid skill sources", async () => {
		const empty = join(tempRoot, "empty");
		await mkdir(empty);
		await expect(loadPackagedSkills(empty)).rejects.toThrow(
			"does not contain any skill directories",
		);

		const invalid = join(tempRoot, "invalid");
		await mkdir(join(invalid, "demo"), { recursive: true });
		await expect(loadPackagedSkills(invalid)).rejects.toThrow("has no valid crust.json");

		await writeFile(
			join(invalid, "demo", "crust.json"),
			JSON.stringify({ name: "other", description: "Other", version: "1.0.0", kind: "generated" }),
		);
		await expect(loadPackagedSkills(invalid)).rejects.toThrow('declares name "other"');
	});
});
