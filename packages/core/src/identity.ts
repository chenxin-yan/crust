import { CrustError } from "./errors.ts";
import type { ClosedMembers, TrimWhitespace } from "./validation/shared.ts";

declare const brand: unique symbol;

/** Stable identity shared by Extensions and documentation section renderers. */
export type ExtensionId = string & { readonly [brand]: true };

// Mirrors the runtime `!id || id !== id.trim()` check for statically known literals.
type ExtensionIdBrand<Id extends string> = [
	Extract<ClosedMembers<Id>, "" | `${TrimWhitespace}${string}` | `${string}${TrimWhitespace}`>,
] extends [never]
	? {}
	: { readonly FIX_EXTENSION_ID: "Extension id must be a non-empty, trimmed string" };

/** Mint an Extension identity from any non-blank, trimmed string. */
export function defineExtensionId<const Id extends string>(
	id: Id & ExtensionIdBrand<Id>,
): ExtensionId;

export function defineExtensionId(id: string): ExtensionId {
	// Untrimmed ids like " x " would be distinct from "x" yet render identically
	// in error messages and audience mismatches, so reject them at the boundary.
	if (!id || id !== id.trim()) {
		throw new CrustError("DEFINITION", "Extension id must be a non-empty, trimmed string", {
			subject: "extension",
			reason: "empty-id",
		});
	}
	// SAFETY: brand mint after validating the id is non-blank and trimmed.
	return id as ExtensionId;
}
