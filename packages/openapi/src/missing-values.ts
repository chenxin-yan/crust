// Asking the app's `.onMissing()` handler for a generated command's missing required values.
import type { ExtensionContext } from "@crustjs/core";
import { getTerminalIO, isCI } from "@crustjs/utils/terminal";

import type { OpenApiSpec } from "./api-command.ts";
import { type CommandPlan, boundNames } from "./lint.ts";
import { flagValue, record } from "./schema.ts";

/** A required value a generated command was not given, which the `.onMissing()` handler is asked for. */
export interface MissingField {
	/** The argument or flag name, as on the command line. */
	readonly name: string;
	/** Where the value goes: a path, query or header parameter, or a top-level body field. */
	readonly in: "path" | "query" | "header" | "body";
	/** The value's type: the answer is converted to it. */
	readonly kind: "string" | "number" | "boolean";
	/** The values a string enum allows. */
	readonly choices?: readonly string[];
	/** Whether it takes a list, which the answer gives separated by commas. */
	readonly multiple: boolean;
	readonly description?: string;
}

/** The `.onMissing()` handler: the value as text, or `undefined` to leave it missing. */
export type MissingValueHandler = (
	field: MissingField,
) => string | undefined | Promise<string | undefined>;

/**
 * Whether someone can answer: stdin and stderr are terminals, outside CI unless a test injected
 * the terminal (`withTerminalIO`), as `@crustjs/prompts` resolves its streams.
 */
export function canAsk(): boolean {
	const ambient = getTerminalIO();
	// CI guards against a pseudo-terminal nobody answers; an injected one is answered by whoever injected it.
	if (isCI() && ambient?.input?.isTTY !== true) return false;
	return (
		(ambient?.input ?? process.stdin).isTTY === true &&
		(ambient?.output ?? process.stderr).isTTY === true
	);
}

/** A required value of a planned command that nothing gave, as the handler is asked for it. */
interface Missing {
	readonly kind: "arg" | "flag";
	readonly field: MissingField;
}

/**
 * The required values of `plan`'s command that nothing gave (argv, the environment, a default,
 * bound input or a binding), in input order. A required body field counts only without `--body`,
 * and only when the body is required or a body field has a value (given, or bound).
 */
function missingValues(
	ctx: Pick<ExtensionContext, "sources">,
	spec: OpenApiSpec,
	plan: CommandPlan,
): Missing[] {
	const { op, inputs } = plan;
	const given = (kind: "arg" | "flag", name: string) =>
		Object.hasOwn(kind === "arg" ? ctx.sources.args : ctx.sources.flags, name);
	const bodyGiven = inputs.some(({ target, name }) => target.in === "body" && given("flag", name));
	// A body is sent when it is required, or a body field has a value: from a flag, or a binding.
	const bound = boundNames(plan.fields);
	const bodyNeeded =
		op.body !== undefined &&
		(op.body.required ||
			inputs.some(({ target, name }) => target.in === "field" && given("flag", name)) ||
			plan.bodyFields.some((field) => bound.has(field.name)));
	const missing: Missing[] = [];
	for (const { kind, name, target } of inputs) {
		if (given(kind, name)) continue;
		let field: Omit<MissingField, "kind" | "multiple" | "choices">;
		let schema: unknown;
		if (target.in === "param" && target.param.required) {
			const { param } = target;
			if (param.in === "cookie") continue;
			schema = param.schema;
			field = {
				name,
				in: param.in,
				...(param.description !== undefined && { description: param.description }),
			};
		} else if (target.in === "field" && target.field.required && bodyNeeded && !bodyGiven) {
			schema = target.field.schema;
			const description = record(schema)?.description;
			field = { name, in: "body", ...(typeof description === "string" && { description }) };
		} else {
			continue;
		}
		const { type, multiple, choices } = flagValue(spec, schema);
		missing.push({ kind, field: { ...field, kind: type, multiple, ...(choices && { choices }) } });
	}
	return missing;
}

/**
 * Asks `handler` for each missing required value of the routed command, in input order, and binds
 * the answers once, merged over the input bound before. The command is one of `candidates`, which
 * are several only where the app adds the generated commands more than once and two operations
 * fit: then only a value every candidate asks for alike is asked for. An unanswered value stops
 * the asking, and nothing is bound: validation reports it.
 */
export async function bindMissingValues(
	ctx: Pick<ExtensionContext, "sources" | "bindInput" | "boundInput">,
	candidates: readonly { readonly spec: OpenApiSpec; readonly plan: CommandPlan }[],
	handler: MissingValueHandler,
): Promise<void> {
	const [first = [], ...others] = candidates.map(({ spec, plan }) =>
		missingValues(ctx, spec, plan),
	);
	const { isDeepStrictEqual } = process.getBuiltinModule("node:util");
	type Answer = string | number | boolean | (string | number | boolean)[];
	// Keyed by input names, which may be `__proto__`.
	const answers: Record<"args" | "flags", Record<string, Answer>> = {
		args: Object.create(null),
		flags: Object.create(null),
	};
	let answered = false;
	for (const missing of first) {
		if (!others.every((values) => values.some((other) => isDeepStrictEqual(other, missing)))) {
			continue;
		}
		const { kind, field } = missing;
		const answer = await handler(field);
		if (answer === undefined) return;
		(kind === "arg" ? answers.args : answers.flags)[field.name] = field.multiple
			? answer.split(",").map((item) => typed(item.trim(), field.kind))
			: typed(answer, field.kind);
		answered = true;
	}
	if (!answered) return;
	const before = ctx.boundInput;
	ctx.bindInput({
		...before,
		args: { ...before?.args, ...answers.args },
		flags: { ...before?.flags, ...answers.flags },
	});
}

/** An answer as typed `run()` input carries a value of `kind`; text that is not one fails to bind. */
function typed(text: string, kind: MissingField["kind"]): string | number | boolean {
	if (kind === "number" && text.trim() !== "" && Number.isFinite(Number(text))) return Number(text);
	if (kind === "boolean" && (text === "true" || text === "false")) return text === "true";
	return text;
}
