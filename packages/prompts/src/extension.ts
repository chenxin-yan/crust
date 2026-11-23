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
 * line and asked again with the error until it converts. An empty answer without a default
 * leaves an optional value unset and is refused for a required one. Asks nothing for a list
 * value without `choices`, a count flag, or an exclusive group.
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
		bindText(
			await multiselect({
				message,
				choices: def.choices,
				default: preselected,
				required: def.required,
			}),
		);
	} else if (def.choices) {
		const preselected = typeof def.default === "string" ? def.default : undefined;
		bindText(await select({ message, choices: def.choices, default: preselected }));
	} else if (!list && def.type !== "count" && def.type !== "exclusive") {
		await input({
			message,
			// A kept default is bound too, so a later positional argument can follow it; core
			// parses declared defaults as text, so it converts as declared.
			default: def.default === undefined ? undefined : String(def.default),
			validate: (answer) => {
				if (answer !== "") bindText(answer);
				else if (def.required) throw new Error("A value is required");
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
				if (arg.prompt !== undefined && missing(ctx.sources.args[arg.name])) {
					await ask(
						arg,
						arg.prompt,
						arg.variadic !== undefined,
						(text) => ctx.bindText({ args: { [arg.name]: text } }),
						(value) => ctx.bindInput({ args: { [arg.name]: value } }),
					);
				}
				// A positional argument cannot follow an omitted one, so asking for it could never bind.
				if (missing(ctx.sources.args[arg.name])) break;
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
