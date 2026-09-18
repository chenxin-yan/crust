import { expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import { app as extensionsExample } from "../examples/modules/extensions/index";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

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
