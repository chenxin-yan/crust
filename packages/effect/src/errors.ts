import { CrustError, type CrustErrorCode, type CrustErrorDetails } from "@crustjs/core";
import { Cause, Data, Effect, Exit } from "effect";

/** Fields shared by every tagged Crust error; `cause` keeps the original for rethrow. */
interface CrustErrorFields<C extends CrustErrorCode> {
	readonly message: string;
	readonly details: CrustErrorDetails<C>;
	readonly cause: CrustError<C>;
}

type TaggedCrustError<Tag extends string, C extends CrustErrorCode> = new (
	fields: CrustErrorFields<C>,
) => Cause.YieldableError & { readonly _tag: Tag } & CrustErrorFields<C>;

// Bases are hoisted into typed consts: isolatedDeclarations rejects call
// expressions in an exported class's extends clause (TS9021).
const tagged = <Tag extends string, C extends CrustErrorCode>(tag: Tag): TaggedCrustError<Tag, C> =>
	Data.TaggedError(tag);
const DefinitionBase: TaggedCrustError<"CrustDefinitionError", "DEFINITION"> =
	tagged("CrustDefinitionError");
const ValidationBase: TaggedCrustError<"CrustValidationError", "VALIDATION"> =
	tagged("CrustValidationError");
const ParseBase: TaggedCrustError<"CrustParseError", "PARSE"> = tagged("CrustParseError");
const CommandNotFoundBase: TaggedCrustError<"CrustCommandNotFoundError", "COMMAND_NOT_FOUND"> =
	tagged("CrustCommandNotFoundError");

export class CrustDefinitionError extends DefinitionBase {}
export class CrustValidationError extends ValidationBase {}
export class CrustParseError extends ParseBase {}
export class CrustCommandNotFoundError extends CommandNotFoundBase {}

export type CrustTaggedError =
	| CrustDefinitionError
	| CrustValidationError
	| CrustParseError
	| CrustCommandNotFoundError;

const fields = <C extends CrustErrorCode>(error: CrustError<C>): CrustErrorFields<C> => ({
	message: error.message,
	details: error.details,
	cause: error,
});

/** Wrap a caught {@link CrustError} in the tagged class for its `code`. */
export function fromCrustError(error: CrustError): CrustTaggedError {
	if (error.is("DEFINITION")) return new CrustDefinitionError(fields(error));
	if (error.is("VALIDATION")) return new CrustValidationError(fields(error));
	if (error.is("PARSE")) return new CrustParseError(fields(error));
	// SAFETY: only four codes exist and `is()` narrows `this`, not the remainder, so this is COMMAND_NOT_FOUND.
	return new CrustCommandNotFoundError(fields(error as CrustError<"COMMAND_NOT_FOUND">));
}

function isCrustTaggedError(value: unknown): value is CrustTaggedError {
	return (
		value instanceof CrustDefinitionError ||
		value instanceof CrustValidationError ||
		value instanceof CrustParseError ||
		value instanceof CrustCommandNotFoundError
	);
}

/** Matches Core's cancellation check: prompts reject with a `DOMException` named `AbortError`. */
function isAbortError(value: unknown): value is Error {
	return value instanceof Error && value.name === "AbortError";
}

/**
 * Lift a throwing thunk or promise into an Effect. A thrown `CrustError`
 * fails with its tagged wrapper, an `AbortError` interrupts the fiber, and
 * anything else is a defect.
 */
export function tryCrust<A>(
	evaluate: () => A | PromiseLike<A>,
): Effect.Effect<A, CrustTaggedError> {
	return Effect.tryPromise({
		try: () => Promise.resolve().then(evaluate),
		catch: (error) => error,
	}).pipe(
		Effect.catch((error) => {
			if (isAbortError(error)) return Effect.interrupt;
			if (error instanceof CrustError) return Effect.fail(fromCrustError(error));
			return Effect.die(error);
		}),
	);
}

/** Rethrow the original error behind a failed Cause so Core renders it unchanged. */
function unwrapCause(cause: Cause.Cause<unknown>): never {
	if (Cause.hasInterruptsOnly(cause))
		throw new DOMException("Effect was interrupted.", "AbortError");
	const error = Cause.squash(cause);
	throw isCrustTaggedError(error) ? error.cause : error;
}

/** Return the success value; failures rethrow the original error, interruption an `AbortError`. */
export function unwrapExit<A, E>(exit: Exit.Exit<A, E>): A {
	if (Exit.isSuccess(exit)) return exit.value;
	return unwrapCause(exit.cause);
}
