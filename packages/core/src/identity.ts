import { CrustError } from "./errors.ts";

declare const brand: unique symbol;

/** Stable identity shared by Extensions and documentation section renderers. */
export type ExtensionId = string & { readonly [brand]: true };

/** Mint an Extension identity from any non-blank string. */
export function defineExtensionId(id: string): ExtensionId {
	if (!id.trim()) {
		throw new CrustError("DEFINITION", "Extension id must be a non-empty string", {
			subject: "extension",
			reason: "empty-id",
		});
	}
	return id as ExtensionId;
}
