import type { CommandSnapshot } from "@crustjs/core";
import {
	buildCommandDocumentation,
	formatDefault,
	sectionsFor,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";
import type { BaseValueType } from "@crustjs/utils/primitive";

import { SKILLS } from "./extension.ts";
import type { ManifestArg, ManifestFlag, ManifestNode } from "./types.ts";

export function buildManifest(command: CommandSnapshot): ManifestNode {
	const model = buildCommandDocumentation(command);
	assertCommandFiles(model, new Map());
	return buildNode(model);
}

/**
 * Core accepts any non-empty command name, but each one becomes a file-name segment under
 * `commands/`. Rejects names that would traverse out of it or that normalize onto another
 * command's file or directory, before any output is replaced.
 */
function assertCommandFiles(model: CommandDocumentation, owners: Map<string, string>): void {
	const segments = (model.path.length <= 1 ? [model.name] : model.path.slice(1)).map((raw) => {
		const segment = normalizeName(raw);
		if (segment === "." || segment === ".." || /[/\\\0]/.test(segment)) {
			throw new Error(
				`Cannot generate skills for command name "${raw}": it must be a single file-name segment, without "/" or "\\" and not "." or "..".`,
			);
		}
		return segment;
	});
	const invocation = model.path.join(" ");
	const file = `commands/${segments.join("/")}`;
	// A nested command's directory `commands/<path>` must not collide with another `<name>.md` file.
	const hasDirectory = model.path.length > 1 && model.children.length > 0;
	for (const path of hasDirectory ? [`${file}.md`, file] : [`${file}.md`]) {
		const owner = owners.get(path);
		if (owner !== undefined) {
			throw new Error(
				`Cannot generate skills: commands "${owner}" and "${invocation}" both render to "${path}".`,
			);
		}
		owners.set(path, invocation);
	}
	for (const child of model.children) assertCommandFiles(child, owners);
}
function buildNode(model: CommandDocumentation): ManifestNode {
	return {
		name: normalizeName(model.name),
		path: model.path.map(normalizeName),
		description: model.description,
		usage: model.usage,
		sections: sectionsFor(model.sections, SKILLS).map(({ title, body }) => ({
			title,
			body,
		})),
		runnable: model.hasAction,
		args: model.args.map(normalizeArg),
		flags: [...model.flags].sort((a, b) => a.name.localeCompare(b.name)).map(normalizeFlag),
		children: [...model.children].sort((a, b) => a.name.localeCompare(b.name)).map(buildNode),
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
	if (arg.default !== undefined) result.default = formatDefault(arg.default);
	return result;
}
function normalizeFlag(flag: DocumentationFlag): ManifestFlag {
	const result: ManifestFlag = {
		name: flag.name,
		spellings: flag.spellings,
		type: manifestType(flag.type),
		required: flag.required,
		multiple: flag.multiple,
	};
	if (flag.description !== undefined) result.description = flag.description;
	if (flag.default !== undefined) result.default = formatDefault(flag.default);
	return result;
}
function manifestType(type: string | undefined): BaseValueType {
	return type === "number" || type === "boolean" ? type : "string";
}
