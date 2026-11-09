import type { Equal, Expect } from "../tests/helpers.ts";
import {
	CrustError,
	type CrustErrorCode,
	type CrustErrorDetails,
	type ParseErrorDetails,
} from "./errors.ts";

function _instanceofKeepsCodeUnion(error: unknown) {
	if (!(error instanceof CrustError)) return;
	type _code = Expect<Equal<typeof error.code, CrustErrorCode>>;
	type _details = Expect<Equal<typeof error.details, CrustErrorDetails<CrustErrorCode>>>;
	// @ts-expect-error -- code is a code union, not any
	const _number: number = error.code;
	// @ts-expect-error -- details is a details union, not any
	const _wrong: { totally: "wrong" } = error.details;
	if (error.is("COMMAND_NOT_FOUND")) {
		type _narrowed = Expect<Equal<typeof error.details, CrustErrorDetails<"COMMAND_NOT_FOUND">>>;
	}
}

function _instanceofFromError(error: Error) {
	if (error instanceof CrustError) {
		type _code = Expect<Equal<typeof error.code, CrustErrorCode>>;
	}
}

class AppError extends CrustError<"PARSE"> {
	readonly hint = "retry";
}

function _instanceofKeepsSubclass(error: unknown) {
	if (error instanceof AppError) {
		type _hint = Expect<Equal<typeof error.hint, "retry">>;
		type _code = Expect<Equal<typeof error.code, "PARSE">>;
	}
}

// Structurally CrustError-compatible subclasses must keep their own members.
class OptionalMemberError extends CrustError {
	hint?: string;
}

class PrivateConstructorError extends CrustError<"PARSE"> {
	private constructor() {
		super("PARSE", "private");
	}
}

class ProtectedConstructorError extends CrustError<"PARSE"> {
	protected constructor() {
		super("PARSE", "protected");
	}
}

function _instanceofSubclassShapes(error: unknown) {
	if (error instanceof OptionalMemberError) {
		type _hint = Expect<Equal<typeof error.hint, string | undefined>>;
	}
	if (error instanceof PrivateConstructorError) {
		type _private = Expect<Equal<typeof error, PrivateConstructorError>>;
	}
	if (error instanceof ProtectedConstructorError) {
		type _protected = Expect<Equal<typeof error, ProtectedConstructorError>>;
	}
}

function _reasonsStayOpen() {
	// Satellite packages add their own reasons.
	new CrustError("DEFINITION", "env", { name: "PORT", reason: "flag-only-key" });
}

function _codeNarrowsDetails(error: unknown) {
	if (error instanceof CrustError && error.code === "PARSE") {
		type _details = Expect<Equal<typeof error.details, ParseErrorDetails | undefined>>;
	}
}
