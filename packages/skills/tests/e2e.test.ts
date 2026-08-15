import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust, defineCommand } from "@crustjs/core";

import { writeSkills } from "../src/build.ts";
import { installSkill } from "../src/generate.ts";

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
	it("builds once and installs a copy without a mutable intermediate store", async () => {
		tempRoot = await mkdtemp(join(tmpdir(), "crust-skills-e2e-"));
		const app = new Crust("demo", { description: "Demo CLI" })
			.action(() => {})
			.add(
				defineCommand("deploy", { description: "Deploy" }, (command) => command.action(() => {})),
			);
		const source = join(tempRoot, "package", "skills");
		await writeSkills(app, { outDir: source, version: "1.0.0" });

		await withCwd(tempRoot, () =>
			installSkill({
				sourceDir: join(source, "demo"),
				agents: ["claude-code"],
				scope: "project",
			}),
		);

		const installed = join(tempRoot, ".claude", "skills", "demo");
		expect(await readFile(join(installed, "SKILL.md"), "utf8")).toContain("name: demo");
		expect(await readFile(join(installed, "commands", "deploy.md"), "utf8")).toContain(
			"# `demo deploy`",
		);
		expect(JSON.parse(await readFile(join(installed, "crust.json"), "utf8"))).toMatchObject({
			name: "demo",
			version: "1.0.0",
		});
	});
});
