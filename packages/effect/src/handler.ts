import {
	type AnyContextFactory,
	type ContextBag,
	type ContextInstance,
	type CrustCommandContext,
	contextSources,
	CrustError,
	type FactoryValueOf,
} from "@crustjs/core";
import { Context, Effect } from "effect";

import { type CrustTaggedError, tryCrust, unwrapExit } from "./errors.ts";
import { actionExits, type LayerValue, layerFactories } from "./layer.ts";

type ActionInput = CrustCommandContext<any, any, any>;

// Hoisted into a typed const: isolatedDeclarations rejects call expressions in an extends clause (TS9021).
const HandlerInputBase: Context.ServiceClass<
	HandlerInput,
	"@crustjs/effect/HandlerInput",
	ActionInput
> = Context.Service<HandlerInput, ActionInput>()("@crustjs/effect/HandlerInput");

/** The invocation input, provided to every {@link handler} program so {@link service} can pull plain Contexts. */
class HandlerInput extends HandlerInputBase {}

/**
 * Union of the services provided by the {@link layer} Contexts in an action
 * input's `ctx` bag. Open-name bags (`Record<string, …>`) provide nothing:
 * their entries cannot be tied to a layer on the path.
 */
export type ServicesOf<Input> = Input extends { readonly ctx: infer Bag }
	? string extends keyof Bag
		? never
		: { [K in keyof Bag]-?: Bag[K] extends Promise<LayerValue<infer S>> ? S : never }[keyof Bag]
	: never;

/**
 * Adapt an Effect program to a Crust action. Every {@link layer} on the
 * command path is built up front and its services provided; `ctx` inference
 * is unchanged. A failure rethrows the original error so `execute()` renders
 * it unchanged, and interruption rethrows an `AbortError` so cancellation
 * exits with 130.
 */
export function handler<Input extends ActionInput, Out, E>(
	fn: (input: Input) => Effect.Effect<Out, E, ServicesOf<Input> | HandlerInput>,
): (input: Input) => Promise<Out>;
export function handler<
	Input extends ActionInput,
	Eff extends Effect.Effect<any, any, ServicesOf<Input> | HandlerInput>,
	Out,
>(fn: (input: Input) => Generator<Eff, Out, never>): (input: Input) => Promise<Out>;
export function handler<Input extends ActionInput, Out>(
	fn: (
		input: Input,
	) => Effect.Effect<Out, unknown, any> | Generator<Effect.Effect<any, any, any>, Out, never>,
): (input: Input) => Promise<Out> {
	return async (input) => {
		const ctx: ContextBag = input.ctx;
		const layers = (ctx[contextSources] ?? []).filter(
			(source): source is ContextInstance =>
				"factory" in source && layerFactories.has(source.factory),
		);
		const bag: Readonly<Record<string, Promise<Context.Context<unknown>>>> = input.ctx;
		const built: Context.Context<unknown>[] = [];
		// Builds and fn(input) run inside the Effect so a failed sibling build or a
		// synchronous throw still yields a failure Exit for the layers that did build.
		const program = Effect.gen(function* () {
			// allSettled: a failing build must not race a sibling still acquiring.
			const settled = yield* Effect.promise(() =>
				Promise.allSettled(layers.map(({ name }) => bag[name]!)),
			);
			for (const result of settled) if (result.status === "fulfilled") built.push(result.value);
			const rejected = settled.find((result) => result.status === "rejected");
			if (rejected) return yield* tryCrust(() => Promise.reject(rejected.reason));
			const returned = fn(input);
			return yield* Effect.provideContext(
				Effect.isEffect(returned) ? returned : Effect.gen(() => returned),
				Context.mergeAll(...built, Context.make(HandlerInput, input)),
			);
		});
		const exit = await Effect.runPromiseExit(program);
		for (const services of built) actionExits.set(services, exit);
		return unwrapExit(exit);
	};
}

/**
 * Pull a plain Crust Context by factory from inside a {@link handler} program.
 * Lazy like `ctx.<name>`; requires the effective same-name provider to use
 * the same factory (including its `.of()` doubles). Missing or different factories fail with
 * Core's missing-context error as a `CrustDefinitionError`.
 */
export function service<F extends AnyContextFactory>(
	factory: F,
): Effect.Effect<FactoryValueOf<F>, CrustTaggedError, HandlerInput> {
	const name = factory.contextName;
	return Effect.flatMap(HandlerInput, (input) =>
		tryCrust((): Promise<FactoryValueOf<F>> => {
			const ctx: ContextBag = input.ctx;
			const sources = ctx[contextSources] ?? [];
			const provider = sources.findLast((source) => "factory" in source && source.name === name);
			// Core resolves the last same-name provider, not a shadowed ancestor.
			const bag: Readonly<Record<string, Promise<FactoryValueOf<F>>>> = input.ctx;
			if (
				provider &&
				"factory" in provider &&
				provider.factory === factory &&
				Object.hasOwn(bag, name)
			) {
				return bag[name]!;
			}
			throw new CrustError(
				"DEFINITION",
				`No matching provider for Context "${name}". Add .provide(${name}(...)) using the same factory passed to service(), or its .of() double, to the app or an ancestor command.`,
				{ subject: "context", name, reason: "missing-context" },
			);
		}),
	);
}
