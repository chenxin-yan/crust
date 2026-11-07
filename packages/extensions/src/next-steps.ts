import {
	type ContextFactory,
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { RunInputPayload } from "@crustjs/core/tooling";

const NEXT_STEPS: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:next-steps");

/** A follow-up command to suggest. */
export interface NextStep {
	/** Command path below the application root, by canonical names, e.g. `["db", "migrate"]`. */
	readonly command: readonly string[];
	/** Arguments, flags, and `raw` tokens in the shape `run()` takes, rendered as argv. */
	readonly input?: RunInputPayload;
	/** What the step is for; printed above its command line. */
	readonly description?: string;
}

/** The `next` Context value: collects the steps to suggest after this invocation. */
export interface NextSteps {
	add(command: readonly string[], input?: RunInputPayload, description?: string): void;
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

/**
 * The `next` Context provided by {@link nextSteps}. A command declares it with
 * `.use(nextStepsContext)` and calls `(await ctx.next).add(...)` from its action.
 */
export const nextStepsContext: ContextFactory<"next", void, NextSteps> =
	/* @__PURE__ */ defineContext("next").setup(() => {
		const steps: NextStep[] = [];
		const next: NextSteps = {
			add: (command, input, description) => void steps.push({ command, input, description }),
		};
		addedSteps.set(next, steps);
		return next;
	});

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Provides {@link nextStepsContext} and, after an invocation completes or fails,
 * prints a `Next steps:` block to stderr: on failure the `onError` steps first,
 * then the steps the action added. A step that does not match the command tree
 * is skipped with a note on stderr; printing never changes the invocation's result.
 */
export const nextSteps: ExtensionFactory<
	[options?: NextStepsOptions],
	{ next: NextSteps },
	readonly [ContextInstance<"next", NextSteps, {}, {}>],
	{},
	[],
	never,
	{ next: NextSteps }
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
					steps.push(...(addedSteps.get(await context.ctx.next) ?? []));
					if (steps.length === 0) return;
					const { renderNextSteps } = await import("./next-steps-render.ts");
					const { notes, text } = renderNextSteps(context.rootCommand, steps);
					for (const note of notes) context.stderr(`nextSteps(): ${note}`);
					if (text) context.stderr(text);
				} catch (error) {
					context.stderr(`nextSteps(): ${errorMessage(error)}`);
				}
			}),
);
