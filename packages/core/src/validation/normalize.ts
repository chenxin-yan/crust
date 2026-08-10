import type { ContextInstance } from "../api/context.ts";
import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import { addFlagSpellingEntries, type FlagSpelling } from "../parsing/spellings.ts";
import type { ArgDef, ArgsDef, FlagDef, FlagsDef } from "../types.ts";
import { validateSchemaExclusivity, validateVariadicArgPosition } from "./args.ts";
import { validateIncomingAliases } from "./commands.ts";
import { sortContexts, validateIncomingContext } from "./contexts.ts";
import { validateIncomingFlag } from "./flags.ts";

function validateSyncParse(
	parse: ((raw: string) => unknown) | undefined,
	subject: "flag" | "arg",
	name: string,
): void {
	if (parse?.constructor.name !== "AsyncFunction") return;
	const label = subject === "flag" ? `flag --${name}` : `argument <${name}>`;
	throw new CrustError(
		"DEFINITION",
		`Async parse not supported for ${label}. Use a sync parser; do async work in run().`,
		{ subject, name, reason: "async-parse" },
	);
}

function validateDefaultChoices(
	def: { default?: unknown; choices?: readonly string[] },
	label: string,
	subject: "flag" | "arg",
	name: string,
): void {
	const { default: value, choices } = def;
	if (value === undefined || choices === undefined) return;
	const values = Array.isArray(value) ? value : [value];
	for (const item of values) {
		if (choices.includes(String(item))) continue;
		throw new CrustError(
			"DEFINITION",
			`Invalid default value "${String(item)}" for ${label}. Expected one of: ${choices.join(", ")}`,
			{ subject, name, reason: "default-choice" },
		);
	}
}

/**
 * Normalize one raw flag before adding it to a trusted flag namespace.
 *
 * Per-definition rules re-run even for Context/Extension-owned flags:
 * `Extension` and `ContextInstance` are public structural types, so a
 * hand-written object (never passed through `defineExtension`/`defineContext`)
 * typechecks and would otherwise inject unvalidated definitions. Attachment
 * runs once per prepare/provide, so the re-check is off the parse hot path.
 */
export function normalizeFlag(
	incoming: { name: string; def: FlagDef },
	existing: FlagsDef,
	spellings: Map<string, FlagSpelling>,
	ownerLabel: string,
): void {
	validateIncomingFlag(incoming, existing, ownerLabel);
	validateSyncParse(incoming.def.parse, "flag", incoming.name);
	validateDefaultChoices(incoming.def, `--${incoming.name}`, "flag", incoming.name);
	addFlagSpellingEntries(spellings, incoming.name, incoming.def);
}

/** Normalize positional arguments as one ordered definition. */
export function normalizeArgs(existing: ArgsDef | undefined, incoming: ArgsDef): ArgsDef {
	const prior = existing ?? [];
	const added = incoming.map((def) => ({ ...def })) as ArgsDef;
	const args = [...prior, ...added] as ArgsDef;
	const names = new Set(prior.map((def) => def.name));

	// Appending can invalidate the previous tail: only the last arg may be
	// variadic, so re-check just that one prior def alongside the new ones.
	const firstAffected = added.length > 0 && prior.length > 0 ? prior.length - 1 : prior.length;
	for (let index = firstAffected; index < args.length; index++) {
		const def = args[index]!;
		if (index >= prior.length) {
			const name = def.name;
			if (typeof name !== "string" || name.length === 0) {
				throw new CrustError(
					"DEFINITION",
					"Every argument definition must carry a non-empty name",
					{
						subject: "arg",
						reason: "missing-name",
					},
				);
			}
			if (names.has(name)) {
				throw new CrustError("DEFINITION", `Argument "${name}" is already defined`, {
					subject: "arg",
					name,
					reason: "duplicate-arg",
				});
			}
			names.add(name);
			validateSchemaExclusivity("arg", name, def as ArgDef);
			validateSyncParse(def.parse, "arg", name);
			validateDefaultChoices(def, `<${name}>`, "arg", name);
		}
		validateVariadicArgPosition(def, index, args.length);
	}
	return args;
}

/** Normalize one child spelling set against its siblings. */
export function normalizeChild(
	incoming: { canonicalName: string; aliases?: readonly string[] },
	existing: Record<string, CommandNode>,
	subjectLabel: string,
): void {
	if (Object.hasOwn(existing, incoming.canonicalName)) {
		throw new CrustError("DEFINITION", `${subjectLabel} is already registered`, {
			subject: "command",
			name: incoming.canonicalName,
			reason: "duplicate-command",
		});
	}
	validateIncomingAliases(incoming, existing, subjectLabel);
}

/** Normalize one Context batch and return its cached topological order. */
export function normalizeContext(
	incoming: readonly ContextInstance[],
	existing: readonly ContextInstance[],
	effectiveFlags: FlagsDef,
	spellings: Map<string, FlagSpelling>,
	where: string,
): ContextInstance[] {
	const contexts = [...existing];
	for (const instance of incoming) {
		validateIncomingContext(instance, contexts);
		for (const [name, def] of Object.entries(instance.ownedFlags)) {
			normalizeFlag({ name, def }, effectiveFlags, spellings, `Context "${instance.name}"`);
			effectiveFlags[name] = def;
		}
		contexts.push(instance);
	}
	return sortContexts(contexts, where);
}
