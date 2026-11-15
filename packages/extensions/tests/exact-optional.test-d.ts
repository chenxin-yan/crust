// Compiled by `tsconfig.exact.json` with `exactOptionalPropertyTypes`, as a consumer would:
// optional inputs commonly filled from optional flags accept an explicit `undefined`.
import { Crust, defineCommand } from "@crustjs/core";
import { confirm, createPrompts, input, multiselect, password, select } from "@crustjs/prompts";

import { nextSteps } from "../src/next-steps.ts";

declare const fromFlag: string | undefined;
declare const maybeCount: number | undefined;
declare const maybeYes: boolean | undefined;

async function _promptsAcceptUndefined() {
	const name: string = await input({
		message: "Name?",
		initial: fromFlag,
		default: fromFlag,
		placeholder: fromFlag,
		validate: (value) => void value.trim(),
	});
	const secret: string = await password({ message: "Secret?", initial: fromFlag, mask: fromFlag });
	const yes: boolean = await confirm({
		message: "Continue?",
		initial: maybeYes,
		default: maybeYes,
	});
	const pick: "a" | "b" = await select({
		message: "Pick",
		choices: ["a", "b"],
		initial: fromFlag === "a" ? "a" : undefined,
		maxVisible: maybeCount,
	});
	const many: ("a" | "b")[] = await multiselect({
		message: "Pick",
		choices: ["a", "b"],
		initial: fromFlag === "a" ? ["a"] : undefined,
		min: maybeCount,
		max: maybeCount,
		required: maybeYes,
	});
	createPrompts({ theme: undefined });
	void [name, secret, yes, pick, many];
}

async function _runInputAcceptsUndefined() {
	const add = defineCommand("add", (c) =>
		c
			.args({ name: "title", type: "string" })
			.flags({ count: { type: "number" } })
			.action(() => {}),
	);
	const app = new Crust("app").extend(nextSteps()).add(add);
	await app.run(["add"], { args: { title: fromFlag }, flags: { count: maybeCount } });
	await app.run(["add"], { args: undefined, flags: undefined, raw: undefined });
	await app.at(["add"]).run({ args: { title: fromFlag } });

	defineCommand("next", (c) =>
		c.use(nextSteps).action(async ({ ctx }) => {
			(await ctx.nextSteps).add(add, { args: { title: fromFlag } }, fromFlag);
		}),
	);
	nextSteps({ onError: () => [{ command: add, input: undefined, description: fromFlag }] });
}
