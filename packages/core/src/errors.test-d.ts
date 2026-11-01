import type { Equal, Expect } from "../tests/helpers.ts";
import {
	CrustError,
	type CrustErrorCode,
	type CrustErrorDetails,
	type DefinitionErrorDetails,
	type DefinitionErrorReason,
	type ParseErrorDetails,
	type ParseErrorReason,
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

function _reasonsAutocompleteButStayOpen() {
	type _parse = Expect<
		Equal<ParseErrorDetails["reason"], ParseErrorReason | (string & {}) | undefined>
	>;
	type _definition = Expect<
		Equal<DefinitionErrorDetails["reason"], DefinitionErrorReason | (string & {}) | undefined>
	>;
	type _known = Expect<Equal<Extract<ParseErrorReason, "unknown-flag">, "unknown-flag">>;
	// Satellite packages add their own reasons.
	new CrustError("DEFINITION", "env", { name: "PORT", reason: "flag-only-key" });
}

function _codeNarrowsDetails(error: unknown) {
	if (error instanceof CrustError && error.code === "PARSE") {
		type _details = Expect<Equal<typeof error.details, ParseErrorDetails | undefined>>;
	}
}
