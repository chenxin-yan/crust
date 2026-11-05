import type { TerminalIO } from "./renderer.ts";
import { isTTY, resolvePromptIO } from "./renderer.ts";
import type { SchemaOrValidate } from "./types.ts";
import { validateSubmitValue } from "./validate.ts";

type ShortCircuitOptions<Input> = {
	readonly initial?: Input;
	readonly default?: Input;
};

type ShortCircuitResult<Answer> =
	| { readonly shortCircuited: true; readonly value: Answer }
	| { readonly shortCircuited: false; readonly promptIO: Required<TerminalIO> };

/** @internal Resolve values that let a prompt answer without rendering. */
export function resolveShortCircuit<Input>(
	options: ShortCircuitOptions<Input>,
	io?: TerminalIO,
): Promise<ShortCircuitResult<Input>>;
export function resolveShortCircuit<Input, Answer>(
	options: ShortCircuitOptions<Input>,
	io: TerminalIO | undefined,
	parse: (value: Input, source: "initial" | "default") => Answer | Promise<Answer>,
): Promise<ShortCircuitResult<Answer>>;
export async function resolveShortCircuit<Input, Answer>(
	options: ShortCircuitOptions<Input>,
	io?: TerminalIO,
	parse?: (value: Input, source: "initial" | "default") => Answer | Promise<Answer>,
): Promise<ShortCircuitResult<Input | Answer>> {
	if (options.initial !== undefined) {
		return {
			shortCircuited: true,
			value: parse ? await parse(options.initial, "initial") : options.initial,
		};
	}

	const promptIO = resolvePromptIO(io);
	// A prompt drawn into a redirected output would hang invisibly, so both streams must be TTYs.
	if (!(isTTY(promptIO.input) && isTTY(promptIO.output)) && options.default !== undefined) {
		return {
			shortCircuited: true,
			value: parse ? await parse(options.default, "default") : options.default,
		};
	}

	return { shortCircuited: false, promptIO };
}

/**
 * @internal Resolve short-circuit values for text prompts, parsing them
 * through `schema` or checking them with `validate` when one is set.
 */
export async function resolveTextShortCircuit<Output>(
	promptName: string,
	options: ShortCircuitOptions<string> & SchemaOrValidate<Output>,
	io?: TerminalIO,
): Promise<ShortCircuitResult<Output | string>> {
	if (options.schema !== undefined && options.validate !== undefined) {
		throw new Error(`${promptName}() cannot combine "schema" with "validate"`);
	}
	const { schema, validate } = options;
	if (!schema && !validate) return resolveShortCircuit(options, io);
	return resolveShortCircuit(options, io, async (value, source) => {
		const result = await validateSubmitValue(value, schema, validate);
		if (!result.ok) {
			throw new Error(`${source} value rejected${schema ? " by schema" : ""}: ${result.error}`);
		}
		return result.value;
	});
}
