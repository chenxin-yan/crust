import { RAW_INPUT_PROPERTY } from "@crustjs/core/tooling";

import type { OpenApiSpec } from "./api-command.ts";
import { defaultGroup, defaultName, kebab } from "./names.ts";
import {
	type Diagnostic,
	type Operation,
	type Param,
	isJsonMediaType,
	operationLabel,
	operations,
	record,
} from "./operations.ts";
import { deref } from "./spec-traversal.ts";

/** The fields of an operation override that lint reads. */
export interface OperationOverride {
	/** Default: the operation's `deprecated`. */
	readonly exclude?: boolean;
	/** A group path as typed on the command line (`"dns records"`); `""` is the root. */
	readonly group?: string;
	readonly name?: string;
	/** Input names by the spec's parameter or top-level body field name. */
	readonly flagName?: Readonly<Record<string, string>>;
	/** Parameters that become positional arguments, in order. Default: the path's parameters in template order. */
	readonly positional?: readonly string[];
	/** Parameters filled by the app instead of an input. */
	readonly bind?: Readonly<Record<string, unknown>>;
	readonly confirm?: string | false;
}

export interface LintInput {
	readonly spec: OpenApiSpec;
	/** The rule for every operation; an entry naming a parameter the operation lacks is ignored. */
	readonly each?: (operation: Operation) => OperationOverride | undefined;
	/** Exceptions by operationId; a field set here replaces the rule's field. */
	readonly override?: Readonly<
		Record<
			string,
			OperationOverride & { readonly expect?: { readonly method: string; readonly path: string } }
		>
	>;
	/** Names and aliases of the app's own commands, by group path. */
	readonly added?: Readonly<Record<string, readonly string[]>>;
	readonly hasConfirmHandler?: boolean;
}

/** More untagged root commands than this get a `many-root-commands` warning. */
const MANY_ROOT_COMMANDS = 20;
const SCALAR_TYPES: readonly unknown[] = ["string", "number", "integer", "boolean"];
// The canonical flag spellings core rejects (`assertUsableSpelling`): integer-like names, `no-`
// (boolean negation), `__proto__`, whitespace, `=` or a leading `-`.
const UNFLAGGABLE = /^$|^(?:0|[1-9]\d*)$|^no-|^__proto__$|^-|[\s=]/;

interface Input {
	readonly kind: "arg" | "flag";
	readonly name: string;
	/** What the input comes from, e.g. `query parameter "id"`. */
	readonly source: string;
}

/**
 * Every problem with turning the spec's operations into commands: the model's diagnostics, then
 * each operation's (an excluded operation is checked only against its override), then command
 * collisions, overrides of unknown operations and too many root commands. Names are compared after
 * {@link kebab}, so operationIds, tags and inputs that differ only in case or separators collide.
 *
 * An input the mapping cannot offer (a parameter with an unsupported style, one described by
 * `content`, a cookie parameter, a non-JSON request body) excludes the operation only when the
 * operation cannot be called without it: a required one is an error, an optional one a warning
 * with the same code (`cookie-param-ignored` for cookies), and it gets no flag.
 */
export function lint(input: LintInput): Diagnostic[] {
	const { spec, override = {}, added = {} } = input;
	const model = operations(spec);
	const diagnostics = [...model.diagnostics];
	const groups = new Set<string>();
	const placed: { op: Operation; command: string }[] = [];
	let rootCommands = 0;

	for (const op of model.operations) {
		const label = operationLabel(op.method, op.path);
		const report = (
			level: Diagnostic["level"],
			code: Diagnostic["code"],
			message: string,
			fix: string,
		) =>
			diagnostics.push({
				level,
				code,
				operationId: op.id,
				method: op.method,
				path: op.path,
				message,
				fix,
			});
		const entry = Object.hasOwn(override, op.id) ? override[op.id] : undefined;
		const fields = mergeOverride(input.each?.(op), entry);
		const bodyFields = Object.keys(record(record(op.body?.schema)?.properties) ?? {});

		if (entry?.expect !== undefined) {
			const { method, path } = entry.expect;
			if (method.toLowerCase() !== op.method || path !== op.path) {
				report(
					"error",
					"override-stale",
					`${label}: the override for "${op.id}" expects ${operationLabel(method, path)}`,
					"Check that the override still fits the operation, then update its `expect`",
				);
			}
		}
		const known = new Set([...op.params.map(({ name }) => name), ...bodyFields]);
		const entryNames = [
			...Object.keys(entry?.flagName ?? {}).map((name) => ["flagName", name] as const),
			...(entry?.positional ?? []).map((name) => ["positional", name] as const),
			...Object.keys(entry?.bind ?? {}).map((name) => ["bind", name] as const),
		];
		for (const [field, name] of entryNames) {
			if (known.has(name)) continue;
			report(
				"error",
				"override-unknown-param",
				`${label}: the override's \`${field}\` names "${name}", which is not a parameter or body field of the operation`,
				"Remove the entry, or use a parameter name from the spec",
			);
		}

		if (fields.exclude ?? op.deprecated) continue;

		if (!op.responses.some(({ status }) => /^2(?:\d\d|XX)$/i.test(status))) {
			report(
				"error",
				"no-success-response",
				`${label} has no 2xx response`,
				"Add a 2xx response to the operation in the spec, or set `exclude: true` in its override",
			);
		}
		if (op.summary === undefined) {
			report(
				"warning",
				"missing-summary",
				`${label} has no summary, so its command has no description`,
				"Add a summary to the operation in the spec, or set `description` in its override",
			);
		}
		if (typeof fields.confirm === "string" && input.hasConfirmHandler !== true) {
			report(
				"error",
				"confirm-without-handler",
				`${label}: the override sets \`confirm\`, but no confirmation handler is configured`,
				"Configure a confirmation handler, or remove `confirm` from the override",
			);
		}

		// Parameters an input cannot carry; cookie parameters are never sent.
		const unmapped = new Set<Param>();
		for (const param of op.params) {
			const problem = paramProblem(spec, param, op.path);
			if (problem === undefined) continue;
			unmapped.add(param);
			const [level, code, tail, fix] = problem;
			report(level, code, `${label}: the ${param.in} parameter "${param.name}" ${tail}`, fix);
		}

		// Inputs, as generated commands map them: positional parameters become arguments, other
		// parameters and the scalar fields of a JSON body flags, the whole JSON body `--body`.
		const bound = new Set(Object.keys(fields.bind ?? {}));
		const rename = (name: string) =>
			Object.hasOwn(fields.flagName ?? {}, name) ? fields.flagName![name]! : kebab(name);
		const pathParams = new Set(
			op.params.filter((param) => param.in === "path").map(({ name }) => name),
		);
		const positional =
			fields.positional ??
			[...op.path.matchAll(/\{([^}]+)\}/g)]
				.map((match) => match[1]!)
				.filter((name) => pathParams.has(name));
		const inputs: Input[] = [];
		const sent = op.params.filter((param) => param.in !== "cookie");
		for (const param of sent) {
			if (bound.has(param.name) || unmapped.has(param)) continue;
			inputs.push({
				kind: positional.includes(param.name) ? "arg" : "flag",
				name: rename(param.name),
				source: `${param.in} parameter "${param.name}"`,
			});
		}
		if (op.body !== undefined) {
			const { body } = op;
			if (isJsonMediaType(body.contentType)) {
				inputs.push({ kind: "flag", name: "body", source: "the request body" });
				const properties = record(record(body.schema)?.properties) ?? {};
				for (const field of bodyFields) {
					if (bound.has(field) || valueKind(spec, properties[field], "other") === "other") continue;
					const repeated = sent.find((param) => kebab(param.name) === kebab(field));
					if (repeated !== undefined) {
						report(
							"warning",
							"body-field-shadowed",
							`${label}: the body field "${field}" repeats the ${repeated.in} parameter "${repeated.name}"; the parameter's input fills it, and the field gets no flag`,
							"Pass the body field in `--body` when it needs another value",
						);
						continue;
					}
					inputs.push({ kind: "flag", name: rename(field), source: `body field "${field}"` });
				}
			} else if (body.required) {
				report(
					"error",
					"unsupported-body-type",
					`${label}: the request body is ${body.contentType}; only JSON bodies are generated`,
					`Call the operation with \`api ${op.path} --body\`, or set \`exclude: true\` in its override`,
				);
			} else if (Object.keys(record(record(body.schema)?.properties) ?? {}).length > 0) {
				report(
					"warning",
					"unsupported-body-type",
					`${label}: the optional ${body.contentType} request body is not offered; only JSON bodies are generated`,
					`Send the body with \`api ${op.path} --body\` when you need it`,
				);
			}
		}

		for (const { kind, name, source } of inputs) {
			if (name === RAW_INPUT_PROPERTY) {
				report(
					"error",
					"reserved-input-name",
					`${label}: ${source} would be the input "${name}", which holds passthrough values`,
					"Set `flagName` for it in the operation's override",
				);
			} else if (kind === "flag" && UNFLAGGABLE.test(name)) {
				report(
					"error",
					"unflaggable-name",
					`${label}: ${source} would be the flag "${name}", which core rejects`,
					"Set `flagName` for it in the operation's override",
				);
			}
		}
		for (const [name, same] of Map.groupBy(inputs, (item) => item.name)) {
			if (same.length < 2) continue;
			const sources = same.map(({ source }) => source);
			report(
				"error",
				"flag-collision",
				`${label}: ${sources.slice(0, -1).join(", ")} and ${sources.at(-1)} share the input name "${name}"`,
				"Set `flagName` for one of them in the operation's override",
			);
		}

		const group = fields.group ?? defaultGroup(op);
		const name = fields.name ?? defaultName(op, group);
		const command = group === "" ? name : `${group} ${name}`;
		placed.push({ op, command });
		addGroup(groups, group);
		if (group === "" && fields.group === undefined) rootCommands++;
	}

	for (const group of Object.keys(added)) addGroup(groups, group);
	const commands = new Map<string, Operation>();
	const collide = (op: Operation, command: string, other: string) =>
		diagnostics.push({
			level: "error",
			code: "command-collision",
			operationId: op.id,
			method: op.method,
			path: op.path,
			message: `${operationLabel(op.method, op.path)}: the command "${command}" is also ${other}`,
			fix: "Set `group` or `name` in the override of one of them",
		});
	for (const { op, command } of placed) {
		const first = commands.get(command);
		if (first !== undefined) {
			collide(
				op,
				command,
				`the command of ${operationLabel(first.method, first.path)} (${first.id})`,
			);
		} else {
			commands.set(command, op);
		}
		if (groups.has(command)) collide(op, command, "a command group");
	}
	for (const [group, names] of Object.entries(added)) {
		for (const name of names) {
			const command = group === "" ? name : `${group} ${name}`;
			const op = commands.get(command);
			if (op !== undefined) collide(op, command, `a command added to the group "${group}"`);
			if (groups.has(command)) {
				diagnostics.push({
					level: "error",
					code: "command-collision",
					message: `The added command "${command}" is also a command group`,
					fix: "Rename the added command, or set `group` in the overrides of the operations in that group",
				});
			}
		}
	}

	const ids = new Set(model.operations.map(({ id }) => id));
	for (const id of Object.keys(override)) {
		if (ids.has(id)) continue;
		diagnostics.push({
			level: "error",
			code: "override-unknown-operation",
			operationId: id,
			message: `The override for "${id}" matches no operation in the spec`,
			fix: "Remove the override, or correct its operationId",
		});
	}
	if (rootCommands > MANY_ROOT_COMMANDS) {
		diagnostics.push({
			level: "warning",
			code: "many-root-commands",
			message: `${rootCommands} untagged operations become root commands`,
			fix: "Set `group` in an `each` rule to put them in groups",
		});
	}
	return diagnostics;
}

/** The rule's fields, each replaced by the entry's when the entry sets it. */
function mergeOverride(
	rule: OperationOverride | undefined,
	entry: OperationOverride | undefined,
): OperationOverride {
	return Object.fromEntries(
		[...Object.entries(rule ?? {}), ...Object.entries(entry ?? {})].filter(
			([, value]) => value !== undefined,
		),
	);
}

/** Adds a group path and every group path above it. */
function addGroup(groups: Set<string>, group: string): void {
	if (group === "") return;
	const words = group.split(" ");
	for (let end = 1; end <= words.length; end++) groups.add(words.slice(0, end).join(" "));
}

/**
 * Whether a schema's values fit a typed flag: a scalar (a scalar type, or an enum of scalars), an
 * array of scalars, or neither. `untyped` is the kind of a schema with no `type` and no `enum`
 * (also `true`); `false` accepts no value, so it is neither. Only one item level is read, so a
 * recursive array schema ends.
 */
function valueKind(
	spec: OpenApiSpec,
	value: unknown,
	untyped: "scalar" | "other",
): "scalar" | "array" | "other" {
	const kind = shapeOf(spec, value, untyped);
	if (kind !== "array") return kind;
	const items = deref(spec, (value as Readonly<Record<string, unknown>>).items);
	return shapeOf(spec, items, untyped) === "scalar" ? "array" : "other";
}

/**
 * {@link valueKind} for the schema itself, without reading its `items`. A schema without `type` or
 * `enum` takes the kind of its first `allOf` member that has one, as a `$ref` with sibling keywords
 * becomes; only that one level is read.
 */
function shapeOf(
	spec: OpenApiSpec,
	value: unknown,
	untyped: "scalar" | "other",
): "scalar" | "array" | "other" {
	const own = typeShape(value);
	if (own !== undefined || record(value) === undefined) return own ?? untyped;
	const { allOf } = value as Readonly<Record<string, unknown>>;
	const members = Array.isArray(allOf) ? allOf : [];
	return members.map((member) => typeShape(deref(spec, member))).find(Boolean) ?? untyped;
}

/** The kind a schema's own `type` or `enum` gives, or `undefined` without either. */
function typeShape(value: unknown): "scalar" | "array" | "other" | undefined {
	if (value === false) return "other";
	const schema = record(value);
	if (schema === undefined) return undefined;
	const types = (
		Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
	).filter((type) => type !== "null");
	if (types.length === 0) {
		if (!Array.isArray(schema.enum)) return undefined;
		return schema.enum.every(
			(item) => item === null || ["string", "number", "boolean"].includes(typeof item),
		)
			? "scalar"
			: "other";
	}
	if (types.length > 1) return "other";
	if (SCALAR_TYPES.includes(types[0])) return "scalar";
	return types[0] === "array" ? "array" : "other";
}

/**
 * Why a parameter gets no input, as `[level, code, message tail, fix]`, or `undefined`. A required
 * one excludes the operation (error); an optional one is left out (warning).
 */
function paramProblem(
	spec: OpenApiSpec,
	param: Param,
	path: string,
): [Diagnostic["level"], Diagnostic["code"], string, string] | undefined {
	const level = param.required ? "error" : "warning";
	const fix = param.required
		? `Call the operation with \`api ${path}\`, or set \`exclude: true\` in its override`
		: `Send the parameter with \`api ${path}\` when you need it`;
	if (param.in === "cookie") {
		return param.required
			? [
					"error",
					"required-cookie-param",
					"is required, and generated commands send no cookies",
					`Call the operation with \`api ${path}\` and a \`Cookie\` header, or set \`exclude: true\` in its override`,
				]
			: [
					"warning",
					"cookie-param-ignored",
					"gets no flag and is never sent",
					`Send it in a \`Cookie\` header with \`api ${path}\` when you need it`,
				];
	}
	const reach = param.required ? "" : `; it gets no flag and is reachable through \`api ${path}\``;
	if (param.contentType !== undefined) {
		return [
			level,
			"content-param",
			`is described by \`content\` (${param.contentType}), which maps to no flag${reach}`,
			fix,
		];
	}
	// Path parameters are single scalar arguments; query (`form`) and header (`simple`) parameters
	// are scalar flags or repeatable ones for arrays. A parameter without a type is a string.
	const style = param.style ?? (param.in === "query" ? "form" : "simple");
	const expected = param.in === "query" ? "form" : "simple";
	const kind = valueKind(spec, param.schema, "scalar");
	if (style === expected && (kind === "scalar" || (kind === "array" && param.in !== "path"))) {
		return undefined;
	}
	const shape = param.in === "path" ? "a scalar" : "a scalar or an array of scalars";
	return [level, "unsupported-param-style", `is not ${shape} in style ${expected}${reach}`, fix];
}
