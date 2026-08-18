import { expect, it } from "bun:test";
import { readdirSync } from "node:fs";

// Rules with no FIX_* brand by design: cheap-to-hit definition mistakes the
// runtime catches without type-level machinery. `duplicateExtension` and
// `contextFlagPairCollision` are enforced inline in
// command/crust.ts rather than as exported rule functions; the entries
// pre-exempt them if they are ever extracted.
const runtimeOnly = new Set([
	"nonEmptyName",
	"reservedSpelling",
	"defaultWithinChoices",
	"definitionProvenance",
	"duplicateExtension",
	"contextFlagPairCollision",
]);
const structuralTypeRules = new Set(["schemaExclusivity", "parserType"]);

it("keeps runtime rules and FIX brands in parity", async () => {
	const files = readdirSync(import.meta.dir)
		.filter((file) => /\.(rules|brands)\.ts$/.test(file))
		.concat("shared.ts");
	const sources = await Promise.all(
		files.map((file) => Bun.file(`${import.meta.dir}/${file}`).text()),
	);
	const rules = new Set(
		sources.flatMap((source) =>
			[...source.matchAll(/export function (\w+)/g)].map((match) => match[1]!),
		),
	);
	rules.delete("flagDefinitionSpellings"); // shared spelling-table helper, not a rule
	const brands = new Set(
		sources.flatMap((source) =>
			// `readonly` anchors on actual brand declarations; doc comments quoting
			// FIX_* names must not keep parity green after a brand is deleted.
			[...source.matchAll(/readonly FIX_([A-Z_]+)/g)].map(([, name]) =>
				name!.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
			),
		),
	);
	expect(
		[...rules].filter((rule) => !runtimeOnly.has(rule) && !structuralTypeRules.has(rule)).sort(),
	).toEqual([...brands].sort());
});
