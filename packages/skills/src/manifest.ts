import type { CommandSnapshot } from "@crustjs/core";
import {
	buildCommandDocumentation,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";

import { getSkillCommandAnnotations } from "./annotations.ts";
import type { ManifestArg, ManifestFlag, ManifestNode } from "./types.ts";

export function buildManifest(command: CommandSnapshot): ManifestNode {
	return buildNode(buildCommandDocumentation(command), command);
}
function buildNode(model: CommandDocumentation, source: CommandSnapshot): ManifestNode {
	const annotations = getSkillCommandAnnotations(source);
	return {
		name: normalizeName(model.name),
		path: model.path.map(normalizeName),
		description: model.description,
		usage: model.usage,
		instructions: annotations?.instructions,
		runnable: model.hasAction,
		args: model.args.map(normalizeArg),
		flags: [...model.flags].sort((a, b) => a.name.localeCompare(b.name)).map(normalizeFlag),
		children: [...model.children]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((child) => buildNode(child, source.subCommands[child.name]!)),
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
