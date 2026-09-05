import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	type Extension,
} from "../index.ts";

describe("defineExtension", () => {
	const HELP = defineExtensionId("acme:help");
	const help = defineExtension(HELP, (options: { readonly verbose?: boolean } = {}) => ({
		flags: [{ name: "verbose", type: "boolean", default: options.verbose ?? false }],
	}));

	it("exposes the identity and builds frozen, normalized Extensions with default options", () => {
		expect(help.id).toBe(HELP);
		const extension = help();
		expect(extension.id).toBe(HELP);
		expect(Object.isFrozen(extension)).toBe(true);
		expect(Object.isFrozen(extension.uses)).toBe(true);
		expect(extension.flags?.verbose?.default).toBe(false);
		expect(help({ verbose: true }).flags?.verbose?.default).toBe(true);
		type _args = Expect<Equal<Parameters<typeof help>, [options?: { readonly verbose?: boolean }]>>;
	});

	it("passes required options through on each call", () => {
		const prefix = defineExtension(HELP, (options: { prefix: string }) => ({
			flags: [{ name: "prefix", type: "string", default: options.prefix }],
		}));
		type _args = Expect<Equal<Parameters<typeof prefix>, [options: { prefix: string }]>>;
		expect(prefix({ prefix: "first" }).flags?.prefix?.default).toBe("first");
		expect(prefix({ prefix: "second" }).flags?.prefix?.default).toBe("second");
	});

	it("accepts the factory as a section consumer", async () => {
		const app = new Crust("help", {
			sections: [{ title: "Examples", body: "help --verbose", only: [help] }],
		});
		expect((await app.snapshot()).meta.sections?.[0]?.only).toEqual([HELP]);
	});

	it("infers flags, dependencies, providers, and commands from the callback", () => {
		const logger = defineContext("logger", () => ({ info: () => {} }));
		const provided = logger();
		const command = defineCommand("docs", (cmd) => cmd.action(() => "docs"));
		const logging = defineExtension(HELP, () => ({
			uses: [logger],
			provides: [provided],
			commands: [command],
			flags: [{ name: "verbose", type: "boolean" }],
			hooks: {
				async postRun({ ctx, flags }) {
					(await ctx.logger).info();
					type _flag = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
				},
			},
		}));
		type _shape = Expect<
			Equal<
				ReturnType<typeof logging>,
				Extension<
					{ logger: { info: () => void } },
					readonly [typeof provided],
					readonly [{ readonly name: "verbose"; readonly type: "boolean" }],
					readonly [typeof command]
				>
			>
		>;
		expect(logging().commands).toEqual([command]);
	});

	it("keeps the object and omitted-config forms unchanged", () => {
		const extension = defineExtension(HELP, {
			flags: [{ name: "verbose", type: "boolean", default: false }],
		});
		expect<Extension>(extension).toEqual(help());
		expect(Object.isFrozen(extension)).toBe(true);
		expect(defineExtension(HELP)).toEqual({ id: HELP, uses: [] });
	});
});
