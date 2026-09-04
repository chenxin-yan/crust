import type { PromptIO } from "./renderer.ts";
import { isTTY, resolvePromptIO } from "./renderer.ts";

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
