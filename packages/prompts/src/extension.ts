// ────────────────────────────────────────────────────────────────────────────
// @crustjs/prompts/extension — asks for missing values declared with `prompt`
// ────────────────────────────────────────────────────────────────────────────

import {
	type ArgSnapshot,
	type ExtensionFactory,
	type ExtensionId,
	type FlagSnapshot,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

import { canPrompt } from "./core/renderer.ts";
import { confirm } from "./prompts/confirm.ts";
import { input } from "./prompts/input.ts";
import { multiselect } from "./prompts/multiselect.ts";
import { select } from "./prompts/select.ts";

declare module "@crustjs/core" {
	interface ArgExtras {
		/**
		 * The question `prompts()` asks on a terminal when the argument has no value, or only its
		 * default. Read only by `prompts()` from `@crustjs/prompts/extension`.
		 */
		prompt?: string;
	}
	interface FlagExtras {
		/**
		 * The question `prompts()` asks on a terminal when the flag has no value, or only its
		 * default. Read only by `prompts()` from `@crustjs/prompts/extension`.
		 */
		prompt?: string;
	}
}

const PROMPTS: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:prompts");

/**
 * Asks for `def`'s value and binds the answer: yes/no for a boolean, a list for `choices`
 * (several picks for a list value), otherwise text, converted as the same word on the command
 * line and asked again with the error until it converts. Asks nothing for a list value without
 * `choices`, a count flag, or an exclusive group.
 */
async function ask(
	def: ArgSnapshot | FlagSnapshot,
	message: string,
	list: boolean,
	bindText: (text: string | readonly string[]) => void,
	bindBoolean: (value: boolean) => void,
): Promise<void> {
	if (def.type === "boolean") {
		bindBoolean(await confirm({ message, default: def.default === true }));
	} else if (def.choices && list) {
		const preselected = Array.isArray(def.default) ? def.default.map(String) : undefined;
		bindText(await multiselect({ message, choices: def.choices, default: preselected }));
	} else if (def.choices) {
		const preselected = typeof def.default === "string" ? def.default : undefined;
		bindText(await select({ message, choices: def.choices, default: preselected }));
	} else if (!list && def.type !== "count" && def.type !== "exclusive") {
		const preselected = def.default === undefined ? undefined : String(def.default);
		await input({
			message,
			default: preselected,
			// The default stays as declared: its text may not convert, as for a custom `parse`.
			validate: (answer) => {
				if (answer !== preselected) bindText(answer);
			},
		});
	}
}

/**
 * Asks on a terminal for each argument and flag with a `prompt` question that has no value
 * or only its default, before the Command Action runs. A value from argv, an environment
 * variable, or another Extension (such as `--input`) is never asked for. Asks only under
 * `execute()` where {@link canPrompt} is true, never under typed `run()`; elsewhere the
 * command's own errors, such as a missing required flag, apply.
 */
export const prompts: ExtensionFactory = /* @__PURE__ */ defineExtension(PROMPTS)
	.owns("prompt")
	.factory((extension) =>
		extension.preRun(async (ctx) => {
			// Typed `run()` captures stderr, so it is never a terminal there.
			if (!ctx.stderr.isTTY || !canPrompt()) return;
			const missing = (source: string | undefined) => source === undefined || source === "default";
			for (const arg of ctx.command.args) {
				if (arg.prompt === undefined || !missing(ctx.sources.args[arg.name])) continue;
				await ask(
					arg,
					arg.prompt,
					arg.variadic !== undefined,
					(text) => ctx.bindText({ args: { [arg.name]: text } }),
					(value) => ctx.bindInput({ args: { [arg.name]: value } }),
				);
			}
			for (const [name, flag] of Object.entries(ctx.command.flags)) {
				if (flag.prompt === undefined || !missing(ctx.sources.flags[name])) continue;
				await ask(
					flag,
					flag.prompt,
					flag.multiple === true,
					(text) => ctx.bindText({ flags: { [name]: text } }),
					(value) => ctx.bindInput({ flags: { [name]: value } }),
				);
			}
		}),
	);
