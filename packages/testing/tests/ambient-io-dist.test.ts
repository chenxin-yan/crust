import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const coreDir = resolve(import.meta.dir, "../../core");
const progressDir = resolve(import.meta.dir, "../../progress");

beforeAll(() => {
	// Turbo builds dependencies before tests. These fallbacks only serve a
	// direct `bun test` on a fresh checkout and never replace an existing dist.
	for (const packageDir of [coreDir, progressDir]) {
		if (existsSync(join(packageDir, "dist/index.js"))) continue;
		const build = Bun.spawnSync(["bun", "run", "build"], { cwd: packageDir });
		if (build.exitCode !== 0) {
			throw new Error(`build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`);
		}
	}
});

describe("ambient invocation IO built-package integration", () => {
	it("shares the ambient scope across separately bundled Core and Progress", async () => {
		const { Crust } = await import("../../core/dist/index.js");
		const { spinner } = await import("../../progress/dist/index.js");
		const errors: string[] = [];
		const app = new Crust("ambient-dist").action(async () => {
			await spinner({ message: "Dist bridge", task: async () => undefined });
		});

		await app.execute({
			argv: [],
			io: { stdout: () => {}, stderr: (text) => errors.push(text) },
		});

		expect(errors).toEqual(["✓ Dist bridge"]);
	});
});
