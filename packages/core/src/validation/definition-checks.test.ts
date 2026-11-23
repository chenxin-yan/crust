import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { unwrap } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { defineExtension, type ExtensionFlagDef } from "../api/extension.ts";
import { defineArg, defineFlag } from "../api/flags.ts";
import {
	Crust,
	defineCommand,
	type AnyCommandDefinitionBuilder,
	type CommandDefinitionBuilder,
} from "../command/crust.ts";
import { CrustError, type DefinitionErrorReason } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";

// Each definition rule has one check. TypeScript owns rules about types and structure; the
// definition checks own string contents and the assembled tree. The checks run from source
// (dev, tests) and inside `crust build`, which defines `process.env.CRUST_INTERNAL_BUILD` as
// "1" in the artifacts it bundles so they compile out. A rule here compiles without a
// `@ts-expect-error`, and a rule TypeScript owns has no runtime check.

/** The `DEFINITION` reason a definition throws or rejects with, if any. */
async function definitionReason(define: () => unknown): Promise<string | undefined> {
	try {
		await define();
	} catch (error) {
		if (error instanceof CrustError && error.is("DEFINITION")) return error.details?.reason;
		throw error;
	}
	return undefined;
}

const ext = (id: string) => defineExtension(defineExtensionId(id));
const action = <B extends CommandDefinitionBuilder<any, any>>(command: B) =>
	command.action(() => {});

let captured: AnyCommandDefinitionBuilder | undefined;
const dynamicFlags: Record<string, ExtensionFlagDef> = {};

const checkedRules: readonly (readonly [DefinitionErrorReason, () => unknown])[] = [
	["empty-spelling", () => new Crust("cli").flags({ "": { type: "string" } })],
	["empty-spelling", () => defineFlag({ type: "string", short: "" })],
	["integer-like-name", () => new Crust("cli").flags({ "1": { type: "string" } })],
	["integer-like-name", () => new Crust("cli").flags({ "4294967295": { type: "string" } })],
	["reserved-no-prefix", () => new Crust("cli").flags({ "no-x": { type: "boolean" } })],
	["reserved-no-prefix", () => defineFlag({ type: "boolean", aliases: ["no-b"] })],
	["reserved-spelling", () => new Crust("cli").flags({ ["__proto__"]: { type: "string" } })],
	["invalid-flags", () => new Crust("cli").flags({ __proto__: { type: "string" } })],
	["invalid-spelling", () => new Crust("cli").flags({ "a b": { type: "string" } })],
	["invalid-spelling", () => new Crust("cli").flags({ "-a": { type: "string" } })],
	["invalid-spelling", () => new Crust("cli").flags({ "a=b": { type: "string" } })],
	["invalid-spelling", () => defineFlag({ type: "string", short: "-" })],
	["invalid-short", () => defineFlag({ type: "string", short: "ab" })],
	["invalid-short", () => defineFlag({ type: "string", short: "\u{1F600}f" })],
	["empty-env", () => defineFlag({ type: "string", env: { name: "" } })],
	["empty-delimiter", () => defineFlag({ type: "string", multiple: true, delimiter: "" })],
	["flag-collision", () => defineFlag({ type: "string", short: "x", aliases: ["x"] })],
	[
		"flag-collision",
		() =>
			new Crust("cli").flags({
				a: { type: "string", short: "x" },
				b: { type: "string", short: "x" },
			}),
	],
	[
		"flag-collision",
		() => new Crust("cli").flags({ a: { type: "string" } }).flags({ a: { type: "number" } }),
	],
	[
		"flag-collision",
		() =>
			new Crust("cli").flags({ mode: { type: "string" } }).provide(
				defineContext("owner")
					.flags({ mode: { type: "string" } })
					.setup(() => 1)(),
			),
	],
	[
		"flag-collision",
		() =>
			new Crust("cli")
				.extend(ext("trace").flags({ trace: { type: "boolean" } }))
				.add(defineCommand("child", (c) => action(c.flags({ trace: { type: "string" } }))))
				.snapshot(),
	],
	[
		"flag-collision",
		() =>
			defineContext("ctx")
				.flags({ a: { type: "string" } })
				.flags({ b: { type: "string", aliases: ["a"] } }),
	],
	["empty-name", () => new Crust("")],
	["empty-name", () => defineCommand("\u00a0", action)],
	["empty-name", () => new Crust("cli").args({ name: "", type: "string" })],
	["empty-name", () => defineArg("", { type: "string" })],
	["reserved-name", () => defineCommand("__proto__", action)],
	["invalid-name", () => defineCommand("a b", action)],
	["invalid-name", () => defineCommand("-a", action)],
	["invalid-name", () => defineCommand("a", action).as("-b")],
	["invalid-alias", () => defineCommand("a", { aliases: ["b c"] }, action)],
	["invalid-alias", () => defineCommand("a", { aliases: [""] }, action)],
	["alias-collision", () => defineCommand("a", { aliases: ["a"] }, action)],
	["alias-collision", () => defineCommand("a", { aliases: ["b"] }, action).as("b")],
	[
		"command-collision",
		() => new Crust("cli").add(defineCommand("a", action)).add(defineCommand("a", action)),
	],
	[
		"command-collision",
		() =>
			new Crust("cli")
				.add(defineCommand("a", action))
				.add(defineCommand("b", { aliases: ["a"] }, action)),
	],
	[
		"command-collision",
		() =>
			new Crust("cli")
				.add(defineCommand("build", action))
				.extend(ext("build").add(defineCommand("build", action)))
				.snapshot(),
	],
	["invalid-sections", () => new Crust("cli", { sections: [{ title: " ", body: "x" }] })],
	[
		"invalid-sections",
		() => defineCommand("a", { sections: [{ title: "a\nb", body: "x" }] }, action),
	],
	["invalid-sections", () => defineContext("env").sections({ title: "Env", body: " " })],
	[
		"duplicate-section",
		() =>
			new Crust("cli", { sections: [{ title: "Notes", body: "x" }] })
				.provide(
					defineContext("notes")
						.sections({ title: "Notes", body: "y" })
						.setup(() => 1)(),
				)
				.snapshot(),
	],
	[
		"invalid-section-path",
		() =>
			new Crust("cli")
				.extend(ext("docs").sections(() => [{ command: ["nope"], title: "T", body: "B" }]))
				.snapshot(),
	],
	[
		"duplicate-renderer",
		() =>
			new Crust("cli")
				.extend(
					ext("a").renderer(() => undefined),
					ext("b").renderer(() => undefined),
				)
				.snapshot(),
	],
	[
		"duplicate-no-action",
		() =>
			new Crust("cli")
				.extend(
					ext("a").noAction(() => {}),
					ext("b").noAction(() => {}),
				)
				.snapshot(),
	],
	[
		"flag-shape-mismatch",
		() =>
			new Crust("cli")
				.flags({ config: { type: "string", short: "c" } })
				.command("cp", (c) => c.flags({ copy: { type: "boolean", short: "c" } }).action(() => {}))
				.snapshot(),
	],
	[
		"flag-shape-mismatch",
		() =>
			new Crust("cli")
				.flags({ verbose: { type: "boolean" } })
				.command("db", (c) =>
					c.command("migrate", (m) => m.flags({ verbose: { type: "number" } }).action(() => {})),
				)
				.snapshot(),
	],
	["empty-id", () => defineExtensionId("")],
	["empty-id", () => defineExtensionId(" x")],
	[
		"foreign-command-builder",
		() =>
			new Crust("cli")
				.add(defineCommand("first", (c) => (captured = c)))
				.add(defineCommand("second", () => captured!))
				.snapshot(),
	],
	["factory-id-mismatch", () => ext("a").factory(() => ext("b"))()],
	[
		"unknown-handle-flag",
		() =>
			ext("dynamic")
				.flags(dynamicFlags)
				.handle("nope", () => {}),
	],
];

describe("definition checks", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		captured = undefined;
	});

	it.each(checkedRules.map(([reason, define]) => ({ reason, define })))(
		"$reason is checked from source",
		async ({ reason, define }) => {
			expect(await definitionReason(define)).toBe(reason);
		},
	);

	it.each(checkedRules.map(([reason, define]) => ({ reason, define })))(
		"$reason is not checked in a built artifact",
		async ({ reason, define }) => {
			vi.stubEnv("CRUST_INTERNAL_BUILD", "1");
			// Without its check, a definition may fail in some other way; it never reports the rule.
			const reported = await definitionReason(define).catch(() => undefined);
			expect(reported).not.toBe(reason);
		},
	);
});

describe("rules TypeScript owns", () => {
	it("has no runtime check", async () => {
		const typeOnly = [
			() =>
				new Crust("cli").flags({
					// @ts-expect-error -- default outside choices
					a: { type: "string", choices: ["x", "y"], default: "z" },
				}),
			() =>
				new Crust("cli").args(
					// @ts-expect-error -- default outside choices
					{ name: "a", type: "string", choices: ["x"], default: "z" },
				),
			() =>
				new Crust("cli").flags({
					// @ts-expect-error -- delimiter requires multiple
					a: { type: "string", delimiter: "," },
				}),
			() =>
				new Crust("cli").flags({
					// @ts-expect-error -- env is an object
					a: { type: "string", env: "A" },
				}),
			() =>
				new Crust("cli").args(
					// @ts-expect-error -- duplicate name
					{ name: "a", type: "string" },
					{ name: "a", type: "string" },
				),
			() =>
				new Crust("cli").args(
					// @ts-expect-error -- variadic must be last
					{ name: "a", type: "string", variadic: true },
					{ name: "b", type: "string" },
				),
			() =>
				new Crust("cli").args(
					// @ts-expect-error -- afterDoubleDash must be last
					{ name: "a", type: "string", afterDoubleDash: true },
					{ name: "b", type: "string" },
				),
		];
		for (const define of typeOnly) expect(await definitionReason(define)).toBeUndefined();

		// A parser's Promise is its value: only the types require `parse` to be synchronous.
		const pending = Promise.resolve("x");
		const app = new Crust("cli")
			.flags({
				// @ts-expect-error -- parse must be synchronous
				a: { type: "string", parse: () => pending },
			})
			.action(({ flags }) => flags.a);
		const outcome = await unwrap(app.run([], { flags: { a: "x" } }));
		expect(outcome).toMatchObject({ status: "completed", result: pending });
	});
});
