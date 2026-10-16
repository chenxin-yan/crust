import { expect, it } from "vite-plus/test";

import { makeNode, unwrap } from "../../tests/helpers.ts";
import { Crust } from "../command/crust.ts";
import { parseArgs, parseStructured, validateParsed } from "./parser.ts";

it("binds prototype-named canonical flags and aliases identically through both front doors", () => {
	for (const name of ["constructor", "toString", "hasOwnProperty"]) {
		const command = makeNode({
			meta: "cli",
			flags: { [name]: { type: "string", aliases: ["alias"] } },
		});
		const structured = parseStructured(command, { flags: { [name]: "value" } });
		expect(parseArgs(command, [`--${name}`, "value"]).flags).toEqual(structured.flags);
		expect(parseArgs(command, ["--alias", "value"]).flags).toEqual(structured.flags);
		const aliasCommand = makeNode({
			meta: "cli",
			flags: { value: { type: "string", aliases: [name] } },
		});
		expect(parseArgs(aliasCommand, [`--${name}`, "value"]).flags.value).toBe("value");
	}
});

it("creates ordinary own positional properties for __proto__ in every binding branch", () => {
	for (const definition of [
		{ name: "__proto__", type: "string", required: true },
		{ name: "__proto__", type: "string", default: "fallback" },
		{ name: "__proto__", type: "string", variadic: true },
	] as const) {
		const command = makeNode({ meta: "cli", args: [definition] });
		const value = "variadic" in definition ? ["value"] : "value";
		for (const parsed of [
			parseArgs(command, ["value"]),
			parseStructured(command, { args: { ["__proto__"]: value } }),
		]) {
			expect(Object.hasOwn(parsed.args, "__proto__")).toBe(true);
			expect(Object.getPrototypeOf(parsed.args)).toBe(Object.prototype);
			expect(parsed.args.__proto__).toEqual(value);
		}
		for (const omitted of [parseArgs(command, []), parseStructured(command, {})]) {
			expect(Object.hasOwn(omitted.args, "__proto__")).toBe(true);
			if ("required" in definition) {
				expect(() => validateParsed(command, omitted)).toThrow("Missing required");
			} else {
				expect(omitted.args.__proto__).toEqual("default" in definition ? "fallback" : []);
			}
		}
	}
});

it("delivers an own __proto__ positional value to the typed action", async () => {
	const app = new Crust("cli")
		.args({ name: "__proto__", type: "string", required: true })
		.action(({ args }) => args.__proto__.toUpperCase());
	expect(await unwrap(app.run([], { args: { ["__proto__"]: "value" } }))).toMatchObject({
		status: "completed",
		result: "VALUE",
	});
});
