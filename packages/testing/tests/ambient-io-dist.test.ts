import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

beforeAll(() => {
	// Turbo builds dependencies before tests; a direct `bun test` needs dist built first.
	for (const pkg of ["core", "progress"]) {
		if (!existsSync(resolve(import.meta.dir, `../../${pkg}/dist/index.js`))) {
			throw new Error(`${pkg} dist missing — run \`bun run build\` first`);
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
