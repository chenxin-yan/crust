import { afterEach, describe, expect, it } from "bun:test";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";

import { writeSkills } from "../src/build.ts";
import { installSkill } from "../src/generate.ts";
import { loadPackagedSkills } from "../src/source.ts";

let tempRoot: string | undefined;

afterEach(async () => {
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

async function withCwd<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const cwd = process.cwd;
	process.cwd = () => dir;
	try {
		return await run();
	} finally {
		process.cwd = cwd;
	}
}

describe("package-as-source pipeline", () => {
	it("builds once and links directly to the packaged source", async () => {
		tempRoot = await mkdtemp(join(tmpdir(), "crust-skills-e2e-"));
		const app = new Crust("demo", { description: "Demo CLI" })
			.action(() => {})
			.add(
				defineCommand("deploy", { description: "Deploy" }, (command) => command.action(() => {})),
			);
		const source = join(tempRoot, "package", "skills");
		await writeSkills(app, { outDir: source, version: "1.0.0" });

		// Discovery reads required Agent Skills frontmatter and validates the directory name.
		expect(loadPackagedSkills(source)).toMatchObject([{ name: "demo", description: "Demo CLI" }]);

		await withCwd(tempRoot, () =>
			installSkill({
				sourceDir: join(source, "demo"),
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const installed = join(tempRoot, ".claude", "skills", "demo");
		expect((await lstat(installed)).isSymbolicLink()).toBe(true);
		expect(await readFile(join(installed, "SKILL.md"), "utf8")).toContain("name: demo");
		expect(await readFile(join(installed, "commands", "deploy.md"), "utf8")).toContain(
			"# `demo deploy`",
		);
	});
});
