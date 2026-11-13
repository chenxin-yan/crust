import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, expect, it } from "vite-plus/test";

// Consumers with `exactOptionalPropertyTypes` read a schema's `.optional()` property as
// `T | undefined`; JSON drops an undefined property, so the store must accept it.

const repoRoot = resolve(import.meta.dirname, "../../..");
const storePkg = resolve(import.meta.dirname, "..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");
const zodPkg = dirname(createRequire(import.meta.url).resolve("zod/package.json"));
const fixtureDir = mkdtempSync(join(tmpdir(), "crust-store-exact-"));

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

const CONSUMER_SOURCE = `import { createStore } from "@crustjs/store";
import { z } from "zod";

createStore({
	dirPath: "/tmp",
	name: "optional",
	fields: { item: { schema: z.object({ due: z.string().optional() }) } },
});

createStore({
	dirPath: "/tmp",
	name: "date",
	// @ts-expect-error -- a Date is not JSON, optional or not
	fields: { item: { schema: z.object({ due: z.date().optional() }) } },
});
`;

it("accepts optional schema properties under exactOptionalPropertyTypes", () => {
	mkdirSync(join(fixtureDir, "node_modules/@crustjs"), { recursive: true });
	symlinkSync(storePkg, join(fixtureDir, "node_modules/@crustjs/store"));
	symlinkSync(zodPkg, join(fixtureDir, "node_modules/zod"));
	writeFileSync(join(fixtureDir, "consumer.ts"), CONSUMER_SOURCE);
	writeFileSync(
		join(fixtureDir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "esnext",
				moduleResolution: "bundler",
				target: "esnext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["consumer.ts"],
		}),
	);

	const result = spawnSync(tscBin, ["-p", "."], { cwd: fixtureDir, timeout: 60_000 });
	expect(result.stdout.toString() + result.stderr.toString()).toBe("");
	expect(result.status).toBe(0);
});
