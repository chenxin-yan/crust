import {
	type CommandDefinition,
	type CommandShape,
	type ContextInstance,
	type ExtensionFactory,
	type RunInput,
	defineContext,
	defineExtension,
} from "@crustjs/core";
import type { RunInputPayload } from "@crustjs/core/tooling";

type AnyCommandDefinition = CommandDefinition<any, any, any, any>;

/** The typed `run()` input of the command added from definition `D`. */
type DefinitionInput<D> =
	D extends CommandDefinition<any, any, infer Shape extends CommandShape, any>
		? RunInput<Shape>
		: RunInputPayload;

/** A follow-up step to suggest: a command the application adds, or a command line as text. */
export type NextStep =
	| {
			/** The command's definition; the step names the command the application added from it. */
			readonly command: AnyCommandDefinition;
			/** Arguments and flags in the shape `run()` takes, rendered as argv. */
			readonly input?: RunInputPayload | undefined;
			/** What the step is for; printed above its command line. */
			readonly description?: string | undefined;
	  }
	| {
			/** A command line printed as written, such as `cd my-app` or `pnpm install`. */
			readonly command: string;
			readonly input?: undefined;
			/** What the step is for; printed above its command line. */
			readonly description?: string | undefined;
	  };

/** The `nextSteps` Context value: collects the steps to suggest after this invocation. */
export interface NextSteps {
	/** Suggest the command added from `definition`, with `input` typed from its arguments and flags. */
	add<D extends AnyCommandDefinition>(
		definition: D,
		input?: DefinitionInput<D>,
		description?: string,
	): void;
	/** Suggest a command line printed as written, such as `cd my-app` or `pnpm install`. */
	add(text: string, description?: string): void;
}

export interface NextStepsOptions {
	/**
	 * Recovery steps for a failed invocation, printed before the steps the action added.
	 * Receives the thrown value as-is; match it yourself, e.g. with `instanceof`.
	 */
	readonly onError?: (error: unknown) => readonly NextStep[] | undefined;
}

// The postRun hook reads the steps through the Context value without exposing them on it.
const addedSteps = new WeakMap<NextSteps, NextStep[]>();

const nextStepsContext = /* @__PURE__ */ defineContext("nextSteps").setup(() => {
	const steps: NextStep[] = [];
	const next: NextSteps = {
		add: (
			command: AnyCommandDefinition | string,
			input?: RunInputPayload | string,
			description?: string,
		) =>
			void steps.push(
				typeof command === "string"
					? // SAFETY: the text overload's second parameter is the description.
						{ command, description: input as string | undefined }
					: // SAFETY: the definition overload's second parameter is the input.
						{ command, input: input as RunInputPayload | undefined, description },
			),
	};
	addedSteps.set(next, steps);
	return next;
});

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Provides the `nextSteps` Context and, after an invocation completes or fails,
 * prints a `Next steps:` block to stderr: on failure the `onError` steps first,
 * then the steps the action added. A command declares the Context with
 * `.use(nextSteps)`, awaits `ctx.nextSteps`, and calls
 * `.add(definition, input?, description?)` or `.add(text, description?)` on it.
 * A step whose command the application does not add, or whose input does not match
 * it, is skipped with a note on stderr; printing never changes the invocation's result.
 */
export const nextSteps: ExtensionFactory<
	[options?: NextStepsOptions],
	{ nextSteps: NextSteps },
	readonly [ContextInstance<"nextSteps", NextSteps, {}, {}>],
	{},
	[],
	never,
	{ nextSteps: NextSteps }
> = /* @__PURE__ */ defineExtension("crust:next-steps").factory(
	(extension, options: NextStepsOptions = {}) =>
		extension
			.use(nextStepsContext)
			.provide(nextStepsContext())
			// A throwing postRun turns a completed invocation into a failure, so every error stays here.
			.postRun(async (context, outcome) => {
				if (outcome.status === "handled") return;
				try {
					const steps: NextStep[] = [];
					if (outcome.status === "failed" && options.onError) {
						try {
							steps.push(...(options.onError(outcome.error) ?? []));
						} catch (error) {
							context.stderr(`nextSteps(): onError: ${errorMessage(error)}`);
						}
					}
					steps.push(...(addedSteps.get(await context.ctx.nextSteps) ?? []));
					if (steps.length === 0) return;
					const { renderNextSteps } = await import("./next-steps-render.ts");
					const { notes, text } = renderNextSteps(
						context.rootCommand,
						steps,
						context.commandPathOf,
					);
					for (const note of notes) context.stderr(`nextSteps(): ${note}`);
					if (text) context.stderr(text);
				} catch (error) {
					// The report itself may fail (e.g. a throwing stderr sink); it must not escape either.
					try {
						context.stderr(`nextSteps(): ${errorMessage(error)}`);
					} catch {}
				}
			}),
);
