import { CrustError } from "./errors.ts";

declare const brand: unique symbol;

/**
 * Stable identity shared by Extensions and documentation section renderers. `Id` keeps a literal
 * id, so the types know which Extension a later registration of the same id replaces.
 */
export type ExtensionId<Id extends string = string> = Id & { readonly [brand]: true };

/** Mint an Extension identity from any non-blank, trimmed string. */
export function defineExtensionId<const Id extends string>(id: Id): ExtensionId<Id> {
	// Untrimmed ids like " x " would be distinct from "x" yet render identically
	// in error messages and audience mismatches, so reject them at the boundary.
	if (process.env.CRUST_INTERNAL_BUILD !== "1" && (!id || id !== id.trim())) {
		throw new CrustError("DEFINITION", "Extension id must be a non-empty, trimmed string", {
			subject: "extension",
			reason: "empty-id",
		});
	}
	// SAFETY: brand mint; the check above runs from source and in `crust build`.
	return id as ExtensionId<Id>;
}
