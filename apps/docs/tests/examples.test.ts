import { readFile } from "node:fs/promises";

import { Crust } from "@crustjs/core";
import { expect, it, vi } from "vite-plus/test";

import { config, database } from "../examples/guide/contexts-setup";
import { app as extensionsExample } from "../examples/modules/extensions/index";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

it("the disposable Context example cleans up after success and failure", async () => {
	for (const fail of [false, true]) {
		const app = new Crust("work").provide(database()).action(async ({ ctx, stdout }) => {
			const db = await ctx.database;
			if (fail) throw new Error("query failed");
			stdout(db.query("select 1"));
		});
		const outcome = await app.run([]);
		expect(outcome.status).toBe(fail ? "failed" : "completed");
		expect(outcome.stdout.trim()).toBe(
			fail ? "database opened\ndatabase closed" : "database opened\nselect 1: ok\ndatabase closed",
		);
	}
});

it("the cancellable Context example passes a signal and rejects failed requests", async () => {
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	try {
		const app = new Crust("app").provide(config()).action(({ ctx }) => ctx.config);
		fetchSpy.mockResolvedValueOnce(new Response("region=eu"));
		expect(await app.run([])).toMatchObject({ status: "completed", result: "region=eu" });

		fetchSpy.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		expect(await app.run([])).toMatchObject({
			status: "failed",
			error: new Error("Config request failed: 503"),
		});

		expect(fetchSpy).toHaveBeenCalledWith("https://api.example.com/config", {
			signal: expect.any(AbortSignal),
		});
	} finally {
		fetchSpy.mockRestore();
	}
});

it("extensions example prints the version for `--version` on the actionless root", async () => {
	const outcome = await extensionsExample.run([], { flags: { version: true } });
	expect(outcome).toMatchObject({ status: "finished", by: "crust:version" });
	expect(outcome.stdout.trim()).toBe("my-cli v0.2.0");
});

it("build guide example names its root after the guide's `bin` launcher", async () => {
	const example = await read("../examples/guide/build.ts");
	const guide = await read("../content/docs/guide/build-and-distribution.mdx");
	const rootName = /new Crust\("([^"]+)"\)/.exec(example)?.[1];
	const launcher = /node \.crust\/root\/bin\/([^.\s]+)\.js origin/.exec(guide)?.[1];
	expect(launcher).toBeDefined();
	expect(rootName).toBe(launcher);
});
