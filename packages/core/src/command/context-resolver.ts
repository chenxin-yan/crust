import {
	contextNameOf,
	contextSources,
	type AnyContextFactory,
	type AnyContextInstance,
	type ContextBag,
	type ContextMap,
	type ContextValue,
} from "../api/context.ts";
import { CrustError, type CaughtError } from "../errors.ts";
import type { FlagsDef, InferFlags, InvocationIO } from "../types.ts";

function isDisposableValue(value: ContextValue): value is Disposable | AsyncDisposable {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
	// SAFETY: structural property probe on an object; both properties are checked below.
	const candidate = value as Partial<Disposable & AsyncDisposable>;
	return (
		typeof candidate[Symbol.asyncDispose] === "function" ||
		typeof candidate[Symbol.dispose] === "function"
	);
}

function registerDisposable(
	value: ContextValue,
	disposal: AsyncDisposableStack,
	registered: WeakSet<object>,
): void {
	if (!isDisposableValue(value) || registered.has(value)) return;
	// Marked only on actual registration: a bare value returned first must not
	// block disposal when a later setup decorates the same object and returns it.
	registered.add(value);
	disposal.use(value);
}

/** Validated flag values for one invocation, erased to the resolver. */
type ValidatedFlags = InferFlags<FlagsDef>;

export interface ContextResolver {
	bag<Deps extends ContextMap>(
		sources: readonly (AnyContextFactory | AnyContextInstance)[],
	): ContextBag<Deps>;
	setValidatedFlags(flags: ValidatedFlags): void;
	settle(): Promise<void>;
}

/** Internal lazy invocation container. Public consumers receive scoped Context bags. */
export function createContextResolver(
	contexts: readonly AnyContextInstance[],
	io: InvocationIO,
	disposal: AsyncDisposableStack,
	signal: AbortSignal,
): ContextResolver {
	interface Entry {
		readonly name: string;
		readonly promise: Promise<ContextValue>;
		readonly resolve: (value: ContextValue) => void;
		readonly reject: (reason?: CaughtError) => void;
		readonly waitingOn: Set<string>;
		settled: boolean;
	}

	const byName = new Map(contexts.map((context) => [context.name, context]));
	const entries = new Map<string, Entry>();
	const registered = new WeakSet<object>();
	let validatedFlags: ValidatedFlags | undefined;
	// Construction closes when settle() finds no in-flight setup; existing entries
	// stay readable until the disposal marker below flips `disposed`.
	let constructing = true;
	let disposed = false;
	// Registered first so it runs last (LIFO): the flag flips only after every
	// Context value has been disposed. onError hooks receiving the same frozen
	// context object then get a clear rejection instead of a resurrected value.
	disposal.defer(() => {
		disposed = true;
	});

	const pathTo = (
		from: Entry,
		target: string,
		visited = new Set<string>(),
	): string[] | undefined => {
		if (from.name === target) return [from.name];
		if (visited.has(from.name)) return undefined;
		visited.add(from.name);
		for (const name of from.waitingOn) {
			const next = entries.get(name);
			if (!next) continue;
			const path = pathTo(next, target, visited);
			if (path) return [from.name, ...path];
		}
		return undefined;
	};

	const isFlagValidationError = (error: CaughtError): boolean => {
		// Setups may wrap the pull rejection (e.g. new Error("...", { cause })); walk
		// the cause chain so the retry-after-validation marker survives wrapping.
		// A throwing `cause` getter must not escape: this runs while settling the
		// entry, and an escape would leave the promise pending for every puller.
		try {
			const seen = new Set<unknown>();
			// SAFETY: structural probe of an arbitrary thrown value; the getter is protected by this try block.
			for (let e = error; e != null && !seen.has(e); e = (e as Partial<{ cause: unknown }>).cause) {
				seen.add(e);
				if (
					e instanceof CrustError &&
					e.code === "DEFINITION" &&
					e.details?.reason === "flags-before-validation"
				) {
					return true;
				}
			}
			return false;
		} catch {
			return false;
		}
	};

	// Bag getters run under enumeration (spread, JSON.stringify, deep-equal)
	// where nothing awaits the result; an early rejection must arrive pre-handled
	// or it crashes the process as an unhandledRejection.
	function handledRejection(reason: CrustError): Promise<never> {
		const rejection = Promise.reject(reason);
		void rejection.catch(() => {});
		return rejection;
	}

	const makePull = (origin: Entry | null) => (name: string) => {
		const originSuffix = origin ? ` (pulled while constructing Context "${origin.name}")` : "";
		if (disposed) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`Context "${name}" cannot be pulled from onError because invocation Contexts have already been disposed.`,
					{ subject: "context", name, reason: "context-after-disposal" },
				),
			);
		}
		const context = byName.get(name);
		if (!context) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`No provider for Context "${name}". Add .provide(${name}(...)) to the app or an ancestor command.${originSuffix}`,
					{ subject: "context", name, reason: "missing-context" },
				),
			);
		}
		if (!constructing && !entries.has(name)) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`Context "${name}" cannot be constructed during invocation cleanup. Read it while setting up the Context whose cleanup needs it.`,
					{ subject: "context", name, reason: "context-during-disposal" },
				),
			);
		}
		if (validatedFlags === undefined && Object.keys(context.ownedFlags).length > 0) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`Context "${name}" owns flags and cannot be pulled before flag validation${originSuffix}. Pull it from an action or a postRun hook after a validated invocation.`,
					{ subject: "context", name, reason: "flags-before-validation" },
				),
			);
		}

		let entry = entries.get(name);
		if (!entry) {
			const deferred = Promise.withResolvers<ContextValue>();
			// Transitive cycle failures can reject an internal entry before a caller
			// observes its derived wait promise; keep the raw deferred rejection handled.
			void deferred.promise.catch(() => {});
			entry = {
				name,
				promise: deferred.promise,
				resolve: deferred.resolve,
				reject: deferred.reject,
				waitingOn: new Set(),
				settled: false,
			};
			entries.set(name, entry);
			const current = entry;
			void (async () => {
				try {
					const ownedFlags = Object.fromEntries(
						Object.keys(context.ownedFlags).map((flag) => [flag, validatedFlags?.[flag]]),
					);
					const value = await context.setup({
						// Spread first: injected io is only typed as stdout/stderr, but runtime
						// extras must not shadow the lifecycle fields below.
						...io,
						signal,
						flags: ownedFlags,
						ctx: makeBag(context.use, current),
						defer(cleanup) {
							if (current.settled) {
								throw new CrustError(
									"DEFINITION",
									`Context "${name}" cannot register cleanup after its setup has finished.`,
									{ subject: "context", name, reason: "context-defer-after-setup" },
								);
							}
							disposal.defer(cleanup);
						},
					});
					registerDisposable(value, disposal, registered);
					current.resolve(value);
				} catch (error) {
					if (isFlagValidationError(error)) entries.delete(name);
					current.reject(error);
				} finally {
					current.settled = true;
				}
			})();
		}

		if (origin && !entry.settled) {
			const path = pathTo(entry, origin.name);
			if (path) {
				const cycle = [origin.name, ...path].map((part) => `"${part}"`).join(" -> ");
				return handledRejection(
					new CrustError("DEFINITION", `Context dependency cycle: ${cycle}`, {
						subject: "context",
						name: origin.name,
						reason: "context-cycle",
					}),
				);
			}
			origin.waitingOn.add(name);
			return entry.promise.finally(() => origin.waitingOn.delete(name));
		}
		return entry.promise;
	};

	const makeBag = <Deps extends ContextMap>(
		sources: readonly (AnyContextFactory | AnyContextInstance)[],
		origin: Entry | null,
	): ContextBag<Deps> => {
		const bag: Record<string, Promise<ContextValue>> = {};
		const add = (source: AnyContextFactory | AnyContextInstance): void => {
			const name = contextNameOf(source);
			if (Object.hasOwn(bag, name)) return;
			Object.defineProperty(bag, name, {
				enumerable: true,
				get: () => makePull(origin)(name),
			});
			// Follow the source's own declared graph: a provided .of() double cuts the
			// *instance* use list, but the bag must match the factory-typed closure so a
			// transitive read fails loud (missing-context) instead of yielding undefined.
			for (const dependency of source.use) add(dependency);
		};
		for (const source of sources) add(source);
		Object.defineProperty(bag, contextSources, { value: Object.freeze([...sources]) });
		// SAFETY: the loop defines every name reachable from the source dependency closure inferred as Deps.
		return Object.freeze(bag) as ContextBag<Deps>;
	};

	return {
		bag: (sources) => makeBag(sources, null),
		setValidatedFlags(flags: ValidatedFlags): void {
			validatedFlags = flags;
		},
		// Structured teardown: a rejected sibling pull must not abandon an in-flight
		// setup past disposal — a late value would register on a disposed stack and
		// leak. A running setup can start new pulls, so loop until quiescent.
		// This is the drain boundary (single call site: dispatch()'s finally). The
		// close is synchronous with the quiescent check so no fire-and-forget pull
		// can start a setup between it and the disposal scope exit.
		async settle(): Promise<void> {
			for (;;) {
				const pending = [...entries.values()].filter((entry) => !entry.settled);
				if (pending.length === 0) {
					constructing = false;
					return;
				}
				await Promise.allSettled(pending.map((entry) => entry.promise));
			}
		},
	};
}
