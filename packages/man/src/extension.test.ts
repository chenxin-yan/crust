import { Crust } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { man } from "./extension.ts";

describe("man Extension", () => {
	it("returns the root manual with a configurable section", async () => {
		const { files } = await runBuildHooks(
			new Crust("demo", { description: "Demo CLI" }).extend(man({ section: 5 })),
		);

		expect([...files.keys()]).toEqual(["man/demo.5"]);
		expect(files.get("man/demo.5")).toContain(".Dt DEMO 5");
	});

	it("rejects root names that are not installed command names", async () => {
		const { error } = await runBuildHooks(new Crust("foo/bar").extend(man()));

		expect(error).toContain('Manual name "foo/bar" is not a valid command name');
	});
});
