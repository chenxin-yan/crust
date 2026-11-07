import {
	type CommandDefinition,
	type CommandShape,
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	type RunInput,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { RunInputPayload } from "@crustjs/core/tooling";

const NEXT_STEPS: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:next-steps");

type AnyCommandDefinition = CommandDefinition<any, any, any, any>;

/** The typed `run()` input of the command added from definition `D`. */
type DefinitionInput<D> =
	D extends CommandDefinition<any, any, infer Shape extends CommandShape, any>
		? RunInput<Shape>
		: RunInputPayload;

/** A follow-up command to suggest. */
export interface NextStep {
	/** The command's definition; the step names the command the application added from it. */
	readonly command: AnyCommandDefinition;
	/** Arguments, flags, and `raw` tokens in the shape `run()` takes, rendered as argv. */
	readonly input?: RunInputPayload;
	/** What the step is for; printed above its command line. */
	readonly description?: string;
}

/** The `nextSteps` Context value: collects the steps to suggest after this invocation. */
export interface NextSteps {
	/** Suggest the command added from `definition`, with `input` typed from its arguments and flags. */
	add<D extends AnyCommandDefinition>(
		definition: D,
		input?: DefinitionInput<D>,
		description?: string,
	): void;
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
		add: (command, input?: RunInputPayload, description?: string) =>
			void steps.push({ command, input, description }),
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
 * `.use(nextSteps)` and calls `(await ctx.nextSteps).add(definition, input?, description?)`.
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
> = /* @__PURE__ */ defineExtension(NEXT_STEPS).factory(
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
