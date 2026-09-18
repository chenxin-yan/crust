import { expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { Crust } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import { defineExtension } from "./extension.ts";

it("false-capable scope can omit defaulted flags from both descendant hooks", async () => {
	function extension(recursive: boolean) {
		return defineExtension(defineExtensionId("scope"), {
			flags: [{ name: "port", type: "number", default: 123, recursive }],
			hooks: {
				preRun({ flags }) {
					seen.push(flags.port);
				},
				postRun({ flags }) {
					seen.push(flags.port);
				},
			},
		});
	}
	const seen: unknown[] = [];
	for (const recursive of [false, true]) {
		const result = await new Crust("cli")
			.extend(extension(recursive))
			.command("child", (c) => c.action(() => {}))
			.run(["child"]);
		expect(result.status).toBe("completed");
	}
	expect(seen).toEqual([undefined, undefined, 123, 123]);
});

it("uncertain flag collections may be empty or leave the name to another extension", async () => {
	const flags: { name: "port"; type: "number"; default: number }[] = [];
	const seen: unknown[] = [];
	const observer = defineExtension(defineExtensionId("observer"), {
		flags,
		hooks: {
			preRun({ flags }) {
				seen.push(flags.port);
			},
		},
	});
	expect((await new Crust("cli").extend(observer).run([])).status).toBe("completed");
	const supplier = defineExtension(defineExtensionId("supplier"), {
		flags: [{ name: "port", type: "string", default: "text" }],
	});
	expect((await new Crust("cli").extend(observer, supplier).run([])).status).toBe("completed");
	expect(seen).toEqual([undefined, "text"]);
});

it("optional schema multiplicity exposes raw arrays in hooks, not validated output", async () => {
	const schema: StandardSchema<unknown, number> = {
		"~standard": { version: 1, vendor: "test", validate: () => ({ value: 42 }) },
	};
	const toggle: { name: "toggle"; type: "boolean"; schema: typeof schema; multiple?: true } = {
		name: "toggle",
		type: "boolean",
		schema,
		multiple: true,
	};
	const seen: unknown[] = [];
	const ext = defineExtension(defineExtensionId("schema"), {
		flags: [toggle],
		hooks: {
			preRun({ flags }) {
				seen.push(flags.toggle);
			},
			postRun({ flags }) {
				seen.push(flags.toggle);
			},
		},
	});
	const exitCode = await new Crust("cli")
		.extend(ext)
		.action(({ flags }) => {
			seen.push(flags.toggle);
		})
		.execute({ argv: ["--toggle"] });
	expect(exitCode).toBe(0);
	expect(seen).toEqual([[true], 42, [true]]);
});
