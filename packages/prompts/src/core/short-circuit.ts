import type { PromptIO } from "./renderer.ts";
import { isTTY, resolvePromptIO } from "./renderer.ts";
import type { SchemaOrValidate } from "./types.ts";
import { validateWithSchema } from "./validate.ts";

type ShortCircuitOptions<Input> = {
	readonly initial?: Input;
	readonly default?: Input;
};

type ShortCircuitResult<Answer> =
	| { readonly shortCircuited: true; readonly value: Answer }
	| { readonly shortCircuited: false; readonly promptIO: Required<PromptIO> };

/** @internal Resolve values that let a prompt answer without rendering. */
export function resolveShortCircuit<Input>(
	options: ShortCircuitOptions<Input>,
	io?: PromptIO,
): Promise<ShortCircuitResult<Input>>;
export function resolveShortCircuit<Input, Answer>(
	options: ShortCircuitOptions<Input>,
	io: PromptIO | undefined,
	parse: (value: Input, source: "initial" | "default") => Answer | Promise<Answer>,
): Promise<ShortCircuitResult<Answer>>;
export async function resolveShortCircuit<Input, Answer>(
	options: ShortCircuitOptions<Input>,
	io?: PromptIO,
	parse?: (value: Input, source: "initial" | "default") => Answer | Promise<Answer>,
): Promise<ShortCircuitResult<Input | Answer>> {
	if (options.initial !== undefined) {
		return {
			shortCircuited: true,
			value: parse ? await parse(options.initial, "initial") : options.initial,
		};
	}

	const promptIO = resolvePromptIO(io);
	if (!isTTY(promptIO.input) && options.default !== undefined) {
		return {
			shortCircuited: true,
			value: parse ? await parse(options.default, "default") : options.default,
		};
	}

	return { shortCircuited: false, promptIO };
}

/**
 * @internal Resolve short-circuit values for text prompts, parsing them
 * through `schema` when one is set.
 */
export async function resolveTextShortCircuit<Output>(
	promptName: string,
	options: ShortCircuitOptions<string> & SchemaOrValidate<Output>,
	io?: PromptIO,
): Promise<ShortCircuitResult<Output | string>> {
	if (options.schema !== undefined && options.validate !== undefined) {
		throw new Error(`${promptName}() cannot combine "schema" with "validate"`);
	}
	const schema = options.schema;
	if (!schema) return resolveShortCircuit(options, io);
	return resolveShortCircuit(options, io, async (value, source) => {
		const result = await validateWithSchema(schema, value);
		if (!result.ok) throw new Error(`${source} value rejected by schema: ${result.error}`);
		return result.value;
	});
}
