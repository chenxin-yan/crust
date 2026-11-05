import { defineExtensionId } from "./identity.ts";

// Compile-time checks mirroring the runtime `!id || id !== id.trim()` rule; never invoked.
function _extensionIds(dynamic: string, template: `acme:${string}`) {
	// @ts-expect-error -- empty
	defineExtensionId("");
	// @ts-expect-error -- blank
	defineExtensionId("  ");
	// @ts-expect-error -- leading whitespace
	defineExtensionId(" acme:docs");
	// @ts-expect-error -- trailing line break
	defineExtensionId("acme:docs\n");
	// @ts-expect-error -- String.prototype.trim also strips non-ASCII spaces
	defineExtensionId("\u00a0acme:docs");
	const either = Math.random() ? "acme:a" : " acme:b";
	// @ts-expect-error -- every literal member is checked
	defineExtensionId(either);

	defineExtensionId("acme:docs");
	// Interior whitespace survives trim().
	defineExtensionId("acme docs");
	// Widened ids are runtime-checked.
	defineExtensionId(dynamic);
	defineExtensionId(template);
}
