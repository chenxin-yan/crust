import { CrustError } from "../errors.ts";
import type { FlagDef, FlagsDef } from "../types.ts";

function flagSpellings(name: string, def: FlagDef): string[] {
	return [name, ...(def.short ? [def.short] : []), ...(def.aliases ?? [])];
}

/** Validate one flag against the complete canonical/short/alias namespace. */
export function validateIncomingFlag(
	incoming: { name: string; def: FlagDef },
	existing: FlagsDef,
	ownerLabel: string,
): void {
	const incomingSpellings = flagSpellings(incoming.name, incoming.def);
	const duplicate = incomingSpellings.find(
		(spelling, index) => incomingSpellings.indexOf(spelling) !== index,
	);
	if (duplicate !== undefined) {
		throw new CrustError(
			"DEFINITION",
			`${ownerLabel} flag "--${incoming.name}" repeats spelling "${duplicate}"`,
			{ subject: "flag", name: incoming.name, reason: "flag-collision" },
		);
	}

	for (const [existingName, existingDef] of Object.entries(existing)) {
		const existingSpellings = new Set(flagSpellings(existingName, existingDef));
		const collision = incomingSpellings.find((spelling) => existingSpellings.has(spelling));
		if (collision !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`${ownerLabel} flag "--${incoming.name}" spelling "${collision}" collides with flag "--${existingName}"`,
				{ subject: "flag", name: incoming.name, reason: "flag-collision" },
			);
		}
	}
}
