import {
	type CommandSection,
	type CommandSnapshot,
	type ExtensionId,
	defineExtensionId,
	visibleSectionsFor,
} from "@crustjs/core";
import {
	buildCommandDocumentation,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";

import type { ManifestArg, ManifestFlag, ManifestNode } from "./types.ts";

export const SKILLS: ExtensionId = defineExtensionId("crust:skills");

export function buildManifest(command: CommandSnapshot): ManifestNode {
	const sectionsByPath = new Map<string, readonly CommandSection[]>(
		visibleSectionsFor(command, SKILLS).map(
			({ path, sections }) => [JSON.stringify(path), sections] as const,
		),
	);
	return buildNode(buildCommandDocumentation(command), [], sectionsByPath);
}
function buildNode(
	model: CommandDocumentation,
	path: readonly string[],
	sectionsByPath: ReadonlyMap<string, readonly CommandSection[]>,
): ManifestNode {
	return {
		name: normalizeName(model.name),
		path: model.path.map(normalizeName),
		description: model.description,
		usage: model.usage,
		sections: (sectionsByPath.get(JSON.stringify(path)) ?? []).map(({ title, body }) => ({
			title,
			body,
		})),
		runnable: model.hasAction,
		args: model.args.map(normalizeArg),
		flags: [...model.flags].sort((a, b) => a.name.localeCompare(b.name)).map(normalizeFlag),
		children: [...model.children]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((child) => buildNode(child, [...path, child.name], sectionsByPath)),
	};
}
function normalizeName(raw: string): string {
	return raw.trim().toLowerCase();
}
function normalizeArg(arg: DocumentationArg): ManifestArg {
	const result: ManifestArg = {
		name: arg.name,
		type: manifestType(arg.type),
		required: arg.required,
		variadic: arg.variadic,
	};
	if (arg.description !== undefined) result.description = arg.description;
	if (arg.default !== undefined) result.default = serializeDefault(arg.default);
	return result;
}
function normalizeFlag(flag: DocumentationFlag): ManifestFlag {
	const result: ManifestFlag = {
		name: flag.name,
		spellings: flag.spellings,
		type: manifestType(flag.type),
		required: flag.required,
		multiple: flag.multiple,
		short: flag.short,
		aliases: [...flag.aliases].sort(),
	};
	if (flag.description !== undefined) result.description = flag.description;
	if (flag.default !== undefined) result.default = serializeDefault(flag.default);
	return result;
}
function manifestType(type: string | undefined): "string" | "number" | "boolean" {
	return type === "number" || type === "boolean" ? type : "string";
}
function serializeDefault(value: unknown): string {
	return Array.isArray(value) ? JSON.stringify(value) : String(value);
}
