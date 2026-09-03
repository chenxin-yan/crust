import { type CommandSnapshot, type ExtensionId, defineExtensionId } from "@crustjs/core";
import {
	buildCommandDocumentation,
	isListed,
	sectionsFor,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";
import type { BaseValueType } from "@crustjs/utils/primitive";

import type { ManifestArg, ManifestFlag, ManifestNode } from "./types.ts";

export const SKILLS: ExtensionId = defineExtensionId("crust:skills");

export function buildManifest(command: CommandSnapshot): ManifestNode {
	const rootName = normalizeName(command.meta.name);
	if (
		Object.values(command.subCommands).some(
			(child) => isListed(child) && normalizeName(child.meta.name) === rootName,
		)
	) {
		throw new Error(
			`Cannot generate skills when a direct subcommand has the root command name "${rootName}".`,
		);
	}
	return buildNode(buildCommandDocumentation(command), command);
}
function buildNode(model: CommandDocumentation, source: CommandSnapshot): ManifestNode {
	return {
		name: normalizeName(model.name),
		path: model.path.map(normalizeName),
		description: model.description,
		usage: model.usage,
		sections: sectionsFor(source.meta.sections, SKILLS).map(({ title, body }) => ({
			title,
			body,
		})),
		runnable: model.hasAction,
		args: model.args.map(normalizeArg),
		flags: [...model.flags].sort((a, b) => a.name.localeCompare(b.name)).map(normalizeFlag),
		children: [...model.children]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((child) => {
				const snapshot = source.subCommands[child.name];
				if (snapshot === undefined) {
					throw new Error(`Missing command snapshot for documented child "${child.name}".`);
				}
				return buildNode(child, snapshot);
			}),
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
		aliases: [...flag.aliases].sort((a, b) => a.localeCompare(b)),
	};
	if (flag.description !== undefined) result.description = flag.description;
	if (flag.default !== undefined) result.default = serializeDefault(flag.default);
	return result;
}
function manifestType(type: string | undefined): BaseValueType {
	return type === "number" || type === "boolean" ? type : "string";
}
function serializeDefault<Value>(value: Value): string {
	return Array.isArray(value) ? JSON.stringify(value) : String(value);
}
