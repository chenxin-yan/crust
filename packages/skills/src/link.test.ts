import { describe, expect, it } from "bun:test";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { isOwnedSkillLink, skillLinkTarget } from "./link.ts";

describe("skill links", () => {
	it("uses relative project targets and absolute global targets", () => {
		const root = resolve("link-test");
		const sourceDir = join(root, "package", "skills", "demo");
		const outputDir = join(root, "project", ".agents", "skills", "demo");

		expect(skillLinkTarget(sourceDir, outputDir, "project")).toBe(
			relative(dirname(outputDir), sourceDir),
		);
		expect(isAbsolute(skillLinkTarget(sourceDir, outputDir, "project"))).toBe(false);
		expect(skillLinkTarget(sourceDir, outputDir, "global")).toBe(sourceDir);
		expect(isAbsolute(skillLinkTarget(sourceDir, outputDir, "global"))).toBe(true);
	});

	it("recognizes only targets ending in skills/<name> as owned", () => {
		expect(isOwnedSkillLink("../../package/skills/demo", "demo")).toBe(true);
		expect(isOwnedSkillLink("C:\\pkg\\skills\\demo", "demo")).toBe(true);
		expect(isOwnedSkillLink("../../package/not-skills/demo", "demo")).toBe(false);
		expect(isOwnedSkillLink("../../package/skills/other", "demo")).toBe(false);
	});
});
