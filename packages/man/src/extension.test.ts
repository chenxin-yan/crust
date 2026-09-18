import { describe, expect, it } from "bun:test";

import { Crust } from "@crustjs/core";

import { man } from "./extension.ts";

describe("man Extension", () => {
	it("exposes the reserved identity on the factory", () => {
		expect(String(man.id)).toBe("crust:man");
		expect(man().id).toBe(man.id);
	});

	it("returns the root manual with a configurable section", async () => {
		const extension = man({ section: 5 });
		const snapshot = await new Crust("demo", { description: "Demo CLI" })
			.extend(extension)
			.snapshot();

		const artifacts = await extension.build?.({ snapshot });

		expect(artifacts).toEqual([{ path: "man/demo.5", content: expect.any(String) }]);
		const output = artifacts?.[0]?.content as string;
		expect(output).toContain(".Dt DEMO 5");
	});

	it("honors a configured installed name", async () => {
		const extension = man({ name: "my-tool" });
		const snapshot = await new Crust("demo").extend(extension).snapshot();

		const artifacts = await extension.build?.({ snapshot });

		expect(artifacts?.[0]?.path).toBe("man/my-tool.1");
		expect(artifacts?.[0]?.content).toContain(".Nm my-tool");
	});

	it("rejects names containing path separators", async () => {
		const extension = man({ name: "foo\\bar" });
		const snapshot = await new Crust("demo").extend(extension).snapshot();

		await expect(extension.build?.({ snapshot })).rejects.toThrow(
			"must not contain path separators",
		);
	});
});
