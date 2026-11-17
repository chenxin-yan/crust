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
} from "./operations.ts";
import { type OperationOverride, type OverrideEntry, mergeOverride } from "./overrides.ts";
import { isSuccess } from "./request.ts";
import {
	type JsonSchema,
	type SchemaField,
	isArraySchema,
	publishedSchema,
	record,
	schemaFields,
	valueKind,
} from "./schema.ts";

export interface LintInput {
	readonly spec: OpenApiSpec;
	/** The rule for every operation; an entry naming a parameter the operation lacks is ignored. */
	readonly each?: (operation: Operation) => OperationOverride | undefined;
	/** Exceptions by operationId; a field set here replaces the rule's field. */
	readonly override?: Readonly<Record<string, OverrideEntry>>;
	/** Names and aliases of the app's own commands, by group path. */
	readonly added?: Readonly<Record<string, readonly string[]>>;
	/** The root commands the `api` Extension contributes. */
	readonly extensionCommands?: readonly string[];
	readonly hasConfirmHandler?: boolean;
	/** Whether `defineApi` has a `paginate`, which an override's replaces. */
	readonly hasPaginate?: boolean;
}

/** An argument or flag of a generated command, and where its value goes. */
export interface PlannedInput {
	readonly kind: "arg" | "flag";
	readonly name: string;
	/** What the input comes from, e.g. `query parameter "id"`. */
	readonly source: string;
	readonly target:
		| { readonly in: "param"; readonly param: Param }
		| { readonly in: "field"; readonly field: SchemaField }
		| { readonly in: "body" }
		| { readonly in: "paginate" };
}

/** An operation that is not excluded, as the command it becomes. */
export interface CommandPlan {
	readonly op: Operation;
	/** The rule's override fields merged with the entry's. */
	readonly fields: OperationOverride;
	/** A group path as typed on the command line; `""` is the root. */
	readonly group: string;
	readonly name: string;
	readonly inputs: readonly PlannedInput[];
	/** The top-level fields of a JSON request body. */
	readonly bodyFields: readonly SchemaField[];
	/** The JSON Schema of the result after `unwrap`, when it is known. */
	readonly outputSchema?: JsonSchema;
}

/** More untagged root commands than this get a `many-root-commands` warning. */
const MANY_ROOT_COMMANDS = 20;
// The canonical flag spellings core rejects (`assertUsableSpelling`): integer-like names, `no-`
// (boolean negation), `__proto__`, whitespace, `=` or a leading `-`.
const UNFLAGGABLE = /^$|^(?:0|[1-9]\d*)$|^no-|^__proto__$|^-|[\s=]/;
// The command and group names core rejects (`resolveCommandName`, `isBareToken`): empty,
// whitespace, a leading `-` or `__proto__`. An argument name must only be non-empty.
const UNUSABLE_COMMAND = /^$|[ \t\n\r\v\f]|^-|^__proto__$/;

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
	return planCommands(input).diagnostics;
}

/**
 * The commands the spec's operations become, as generated commands, lint and the manifest map
 * them, and every problem {@link lint} reports.
 */
export function planCommands(input: LintInput): {
	diagnostics: Diagnostic[];
	commands: CommandPlan[];
} {
	const { spec, override = {}, added = {} } = input;
	const model = operations(spec);
	const diagnostics = [...model.diagnostics];
	const groups = new Set<string>();
	const placed: (CommandPlan & { command: string })[] = [];
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
		const bodySchemaFields = op.body === undefined ? [] : schemaFields(spec, op.body.schema);
		const bodyFields = bodySchemaFields.map(({ name }) => name);

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
		const paramNames = new Set(op.params.map(({ name }) => name));
		const known = new Set([...paramNames, ...bodyFields]);
		const entryNames = [
			...Object.keys(entry?.flagName ?? {}).map((name) => ["flagName", name] as const),
			...(entry?.positional ?? []).map((name) => ["positional", name] as const),
			...Object.keys(entry?.bind ?? {}).map((name) => ["bind", name] as const),
		];
		for (const [field, name] of entryNames) {
			// Only parameters can be positional; a body field's value is never an argument.
			if (field === "positional" ? paramNames.has(name) : known.has(name)) continue;
			report(
				"error",
				"override-unknown-param",
				`${label}: the override's \`${field}\` names "${name}", which is not a ${field === "positional" ? "parameter" : "parameter or body field"} of the operation`,
				"Remove the entry, or use a parameter name from the spec",
			);
		}

		if (fields.exclude ?? op.deprecated) continue;

		if (!op.responses.some(({ status }) => isSuccess(status))) {
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
		// An `undefined` entry is no entry: the default applies.
		const bound = boundNames(fields);
		const rename = (name: string) => {
			const renamed = Object.hasOwn(fields.flagName ?? {}, name)
				? fields.flagName![name]
				: undefined;
			return typeof renamed === "string" ? renamed : kebab(name);
		};
		const pathParams = new Set(
			op.params.filter((param) => param.in === "path").map(({ name }) => name),
		);
		const positional =
			fields.positional ??
			[...op.path.matchAll(/\{([^}]+)\}/g)]
				.map((match) => match[1]!)
				.filter((name) => pathParams.has(name));
		const inputs: PlannedInput[] = [];
		const sent = op.params.filter(
			(param) => param.in !== "cookie" && !bound.has(param.name) && !unmapped.has(param),
		);
		const paramInput = (param: Param, kind: PlannedInput["kind"]): PlannedInput => ({
			kind,
			name: rename(param.name),
			source: `${param.in} parameter "${param.name}"`,
			target: { in: "param", param },
		});
		// Arguments in the positional order, which fills the path: never the declaration order.
		for (const name of positional) {
			for (const param of sent) if (param.name === name) inputs.push(paramInput(param, "arg"));
		}
		for (const param of sent) {
			if (!positional.includes(param.name)) inputs.push(paramInput(param, "flag"));
		}
		// Positional values fill arguments in order, so one can be left out only at the end, and a
		// list takes every value after it.
		const args = inputs.flatMap(({ kind, target }) =>
			kind === "arg" && target.in === "param" ? [target.param] : [],
		);
		for (const [index, param] of args.entries()) {
			const later = args.slice(index + 1);
			const problem =
				later.length === 0
					? undefined
					: valueKind(spec, param.schema, "scalar") === "array"
						? "is a list, which takes every value after it"
						: !param.required && later.some((next) => next.required)
							? "is optional, before a required one"
							: undefined;
			if (problem === undefined) continue;
			report(
				"error",
				"positional-order",
				`${label}: the positional ${param.in} parameter "${param.name}" ${problem}`,
				"Order `positional` with the required parameters first and a list last",
			);
		}
		if (op.body !== undefined) {
			const { body } = op;
			if (isJsonMediaType(body.contentType)) {
				inputs.push({
					kind: "flag",
					name: "body",
					source: "the request body",
					target: { in: "body" },
				});
				for (const bodyField of bodySchemaFields) {
					const { name: field, kind } = bodyField;
					if (bound.has(field) || kind === "other") continue;
					const repeated = op.params.find(
						(param) => param.in !== "cookie" && kebab(param.name) === kebab(field),
					);
					if (repeated !== undefined) {
						report(
							"warning",
							"body-field-shadowed",
							`${label}: the body field "${field}" repeats the ${repeated.in} parameter "${repeated.name}", so it gets no flag; the parameter keeps its input`,
							"Pass the body field in `--body`",
						);
						continue;
					}
					inputs.push({
						kind: "flag",
						name: rename(field),
						source: `body field "${field}"`,
						target: { in: "field", field: bodyField },
					});
				}
			} else if (body.required) {
				report(
					"error",
					"unsupported-body-type",
					`${label}: the request body is ${body.contentType}; only JSON bodies are generated`,
					`Call the operation with \`api ${op.path} --body\`, or set \`exclude: true\` in its override`,
				);
			} else if (bodySchemaFields.length > 0) {
				report(
					"warning",
					"unsupported-body-type",
					`${label}: the optional ${body.contentType} request body is not offered; only JSON bodies are generated`,
					`Send the body with \`api ${op.path} --body\` when you need it`,
				);
			}
		}

		// The result after `unwrap`: the override's `outputSchema`, else the response's without `unwrap`.
		const resultSchema =
			fields.outputSchema ?? (fields.unwrap === undefined ? successSchema(op) : undefined);
		// `--paginate` joins the pages' lists, so the result must be one, or unknown after `unwrap`,
		// and not a tuple, whose positions joining would break.
		const paginates =
			(fields.paginate !== undefined || input.hasPaginate === true) &&
			(resultSchema === undefined
				? fields.unwrap !== undefined
				: isArraySchema(spec, resultSchema) && !isTupleSchema(spec, resultSchema, 0));
		// One schema for one page and the joined pages: without the limits of one page's list.
		const outputSchema =
			paginates && resultSchema !== undefined
				? withoutListLimits(spec, resultSchema, 0)
				: resultSchema;
		if (paginates) {
			inputs.push({
				kind: "flag",
				name: "paginate",
				source: "--paginate",
				target: { in: "paginate" },
			});
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
			// `flagName` is keyed by the spec's name, so it renames every input of one name alike.
			const specNames = new Set(same.map(({ target }) => specName(target)));
			report(
				"error",
				"flag-collision",
				`${label}: ${sources.slice(0, -1).join(", ")} and ${sources.at(-1)} share the input name "${name}"`,
				specNames.size === 1
					? "Fill them with one `bind` entry, or set `exclude: true` and write the command with `call()`, or use `api`"
					: "Set `flagName` for one of them in the operation's override",
			);
		}

		const group = fields.group ?? defaultGroup(op);
		const name = fields.name ?? defaultName(op, group);
		const command = group === "" ? name : `${group} ${name}`;
		const names = [
			...(group === "" ? [] : group.split(" ").map((word) => ["group", word] as const)),
			["command", name] as const,
			...inputs.flatMap(({ kind, name: arg }) =>
				kind === "arg" ? [["argument", arg] as const] : [],
			),
		];
		const unusable = names.filter(([kind, word]) =>
			kind === "argument" ? word === "" : UNUSABLE_COMMAND.test(word),
		);
		for (const [kind, word] of unusable) {
			report(
				"error",
				"unusable-name",
				`${label}: the ${kind} name "${word}" is ${kind === "argument" ? "empty" : 'empty, has whitespace, starts with "-" or is "__proto__"'}, which core rejects`,
				kind === "argument"
					? "Set `flagName` for its parameter in the operation's override"
					: `Set \`${kind === "group" ? "group" : "name"}\` in the operation's override`,
			);
		}
		placed.push({
			op,
			fields,
			group,
			name,
			command,
			inputs,
			bodyFields:
				op.body !== undefined && isJsonMediaType(op.body.contentType) ? bodySchemaFields : [],
			...(outputSchema !== undefined && { outputSchema }),
		});
		addGroup(groups, group);
		if (group === "" && fields.group === undefined) rootCommands++;
	}

	const addedGroups = new Set<string>();
	for (const group of Object.keys(added)) addGroup(addedGroups, group);
	for (const group of addedGroups) groups.add(group);
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
	// The app's added commands and the Extension's `api` stay; the generated commands they clash
	// with, also by a group of that name, are left out.
	const taken = [
		...Object.entries(added).flatMap(([group, names]) =>
			names.map((name) => ({ group, name, by: `a command added to the group "${group}"` })),
		),
		...(input.extensionCommands ?? []).map((name) => ({
			group: "",
			name,
			by: `the Extension's "${name}" command`,
		})),
	];
	for (const { group, name, by } of taken) {
		const command = group === "" ? name : `${group} ${name}`;
		const op = commands.get(command);
		if (op !== undefined) collide(op, command, by);
		if (!groups.has(command)) continue;
		for (const inside of placed.filter((plan) => plan.command.startsWith(`${command} `))) {
			diagnostics.push({
				level: "error",
				code: "command-collision",
				operationId: inside.op.id,
				method: inside.op.method,
				path: inside.op.path,
				message: `${operationLabel(inside.op.method, inside.op.path)}: the command "${inside.command}" is in the group "${command}", which is also ${by}`,
				fix: "Set `group` in the override of the operation",
			});
		}
		// A group the app's own commands are added to stays, so core reports the clash.
		if (!addedGroups.has(command)) continue;
		diagnostics.push({
			level: "error",
			code: "command-collision",
			message: `The command "${command}", ${by}, is also a group of added commands`,
			fix: "Rename the added command, or set `group` in the overrides of the operations in that group",
		});
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
	return { diagnostics, commands: placed.map(({ command: _command, ...plan }) => plan) };
}

/**
 * The JSON Schema of the operation's 2xx responses, when every one is JSON with the same schema:
 * a text or empty 2xx result would not fit it.
 */
function successSchema(op: Operation): JsonSchema | undefined {
	const successes = op.responses.filter(({ status }) => isSuccess(status));
	if (
		successes.some(({ contentType }) => contentType === undefined || !isJsonMediaType(contentType))
	) {
		return undefined;
	}
	const schemas = successes.map(({ schema }) => schema);
	const [first] = schemas;
	if (first === undefined || schemas.some((schema) => schema === undefined)) return undefined;
	const text = JSON.stringify(first);
	return schemas.every((schema) => JSON.stringify(schema) === text) ? first : undefined;
}

/** Adds a group path and every group path above it. */
function addGroup(groups: Set<string>, group: string): void {
	if (group === "") return;
	const words = group.split(" ");
	for (let end = 1; end <= words.length; end++) groups.add(words.slice(0, end).join(" "));
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

/** Keywords that constrain one list as a whole, which joined pages need not meet. */
const LIST_LIMITS = [
	"minItems",
	"maxItems",
	"uniqueItems",
	"contains",
	"minContains",
	"maxContains",
];

/** How many nested `allOf` levels the list helpers follow, as {@link valueKind} does. */
const ALL_OF_DEPTH = 8;

/**
 * A schema with list-wide keywords dropped from it and from its `allOf` members, each resolved like
 * a published schema (so a `$ref` member is replaced by its target); the items keep theirs.
 */
function withoutListLimits(spec: OpenApiSpec, schema: JsonSchema, depth: number): JsonSchema {
	const node = record(schema);
	if (node === undefined) return schema;
	const out = Object.fromEntries(
		Object.entries(node).filter(([key]) => !LIST_LIMITS.includes(key)),
	);
	if (Array.isArray(node.allOf) && depth < ALL_OF_DEPTH) {
		out.allOf = node.allOf.map((member) => {
			const resolved = publishedSchema(spec, member);
			return record(resolved) === undefined
				? member
				: withoutListLimits(spec, resolved as JsonSchema, depth + 1);
		});
	}
	return out;
}

/**
 * Whether a list schema fixes its leading items (`prefixItems`, or a 3.0-style `items` array),
 * also in its `allOf` members, resolved like published schemas.
 */
function isTupleSchema(spec: OpenApiSpec, schema: unknown, depth: number): boolean {
	const node = record(schema);
	if (node === undefined) return false;
	if (node.prefixItems !== undefined || Array.isArray(node.items)) return true;
	return (
		Array.isArray(node.allOf) &&
		depth < ALL_OF_DEPTH &&
		node.allOf.some((member) => isTupleSchema(spec, publishedSchema(spec, member), depth + 1))
	);
}

/** The names `bind` fills: its entries that are functions. */
export function boundNames(fields: OperationOverride): Set<string> {
	return new Set(
		Object.entries(fields.bind ?? {}).flatMap(([name, bind]) => (bind === undefined ? [] : [name])),
	);
}

/** The spec's name an input comes from. */
function specName(target: PlannedInput["target"]): string {
	return target.in === "param"
		? target.param.name
		: target.in === "field"
			? target.field.name
			: target.in;
}
