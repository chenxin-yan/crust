import { Crust } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { man } from "./extension.ts";

describe("man Extension", () => {
	it("exposes the reserved identity on the factory", () => {
		expect(String(man.id)).toBe("crust:man");
		expect(man().id).toBe(man.id);
	});

	it("returns the root manual with a configurable section", async () => {
		const { files } = await runBuildHooks(
			new Crust("demo", { description: "Demo CLI" }).extend(man({ section: 5 })),
		);

		expect([...files.keys()]).toEqual(["man/demo.5"]);
		expect(files.get("man/demo.5")).toContain(".Dt DEMO 5");
	});

	it("honors a configured installed name", async () => {
		const { files } = await runBuildHooks(new Crust("demo").extend(man({ name: "my-tool" })));

		expect([...files.keys()]).toEqual(["man/my-tool.1"]);
		expect(files.get("man/my-tool.1")).toContain(".Nm my-tool");
	});

	it("rejects names containing path separators", async () => {
		const { error } = await runBuildHooks(new Crust("demo").extend(man({ name: "foo\\bar" })));

		expect(error).toContain("must not contain path separators");
	});
});
