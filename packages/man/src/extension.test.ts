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

	it.each(["foo/bar"])(
		"rejects root names that are not installed command names: %s",
		async (name) => {
			const { error } = await runBuildHooks(new Crust(name).extend(man()));

			expect(error).toContain(`Manual name "${name}" is not a valid command name`);
		},
	);
});
