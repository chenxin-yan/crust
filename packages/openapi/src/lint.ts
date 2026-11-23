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

/**
 * What each problem means for `crust build`, by one rule: can configuration (an override other
 * than `exclude`, `.onConfirm()`, `.add()`) make the operation a working command?
 * - `fix`: yes, so the build fails until it is configured, or the operation is excluded.
 * - `skip`: no, so the operation is left out (marked in `api --list`), and the build passes.
 * - `document`: no command can come from the document, so the build fails.
 * At run time every problem leaves its operation out, and nothing throws.
 */
export const PROBLEM_KINDS: Readonly<Record<Diagnostic["code"], "fix" | "skip" | "document">> = {
	"unsupported-version": "document",
	"missing-operation-id": "skip",
	"duplicate-operation-id": "skip",
	"no-success-response": "skip",
	"unsupported-param-style": "skip",
	"content-param": "skip",
	"required-cookie-param": "skip",
	"unsupported-body-type": "skip",
	"command-collision": "fix",
	"flag-collision": "fix",
	"unflaggable-name": "fix",
	"unusable-name": "fix",
	"positional-order": "fix",
	"override-unknown-operation": "fix",
	"override-stale": "fix",
	"override-unknown-param": "fix",
	"confirm-without-handler": "fix",
	"paginate-needs-array": "fix",
};

// The canonical flag spellings core rejects (`assertUsableSpelling`): integer-like names, `no-`
// (boolean negation), `__proto__`, whitespace, `=` or a leading `-`.
const UNFLAGGABLE = /^$|^(?:0|[1-9]\d*)$|^no-|^__proto__$|^-|[\s=]/;
// The command and group names core rejects (`resolveCommandName`, `isBareToken`): empty,
// whitespace, a leading `-` or `__proto__`. An argument name must only be non-empty.
const UNUSABLE_COMMAND = /^$|[ \t\n\r\v\f]|^-|^__proto__$/;

/**
 * Every problem with turning the spec's operations into commands: the model's diagnostics, then
 * each operation's that is not excluded, then command collisions and overrides of unknown
 * operations. Names are compared after {@link kebab}, so operationIds, tags and inputs that differ
 * only in case or separators collide. Each problem leaves its operation out.
 *
 * An input the mapping cannot offer (a parameter with an unsupported style, one described by
 * `content`, a cookie parameter, a non-JSON request body) is a problem only when the operation
 * cannot be called without it; an optional one just gets no flag.
 */
export function lint(input: LintInput): Diagnostic[] {
	return planCommands(input).diagnostics;
}

/**
 * The `crust build` error for the problems that need a decision ({@link PROBLEM_KINDS}), each with
 * its fix, or `undefined` when there is none.
 */
export function buildProblems(diagnostics: readonly Diagnostic[]): string | undefined {
	const failing = diagnostics.filter(({ code }) => PROBLEM_KINDS[code] !== "skip");
	if (failing.length === 0) return undefined;
	const count = failing.length === 1 ? "1 problem needs" : `${failing.length} problems need`;
	return [
		`defineApi: ${count} a decision before this CLI can be built.`,
		"",
		...failing.flatMap(({ message, fix }) => [`  ${message}`, `    fix: ${fix}`]),
	].join("\n");
}

/** The commands the spec's operations become, and every problem {@link lint} reports. */
export function planCommands(input: LintInput): {
	diagnostics: Diagnostic[];
	commands: CommandPlan[];
} {
	const { spec, override = {}, added = {} } = input;
	const model = operations(spec);
	const diagnostics = [...model.diagnostics];
	const groups = new Set<string>();
	const placed: (CommandPlan & { command: string })[] = [];

	for (const op of model.operations) {
		const label = operationLabel(op.method, op.path);
		const report = (code: Diagnostic["code"], message: string, fix: string) =>
			diagnostics.push({
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

		// Excluding an operation settles every problem it has, also its override's.
		if (fields.exclude ?? op.deprecated) continue;
		if (entry?.expect !== undefined) {
			const { method, path } = entry.expect;
			if (method.toLowerCase() !== op.method || path !== op.path) {
				report(
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
				"override-unknown-param",
				`${label}: the override's \`${field}\` names "${name}", which is not a ${field === "positional" ? "parameter" : "parameter or body field"} of the operation`,
				"Remove the entry, or use a parameter name from the spec",
			);
		}

		if (!op.responses.some(({ status }) => isSuccess(status))) {
			report(
				"no-success-response",
				`${label} has no 2xx response`,
				"Add a 2xx response to the operation in the spec, or set `exclude: true` in its override",
			);
		}
		if (typeof fields.confirm === "string" && input.hasConfirmHandler !== true) {
			report(
				"confirm-without-handler",
				`${label}: the override sets \`confirm\`, but the handle has no \`.onConfirm()\` handler`,
				"Add `.onConfirm()` to the handle, or remove `confirm` from the override",
			);
		}

		// Parameters an input cannot carry; cookie parameters are never sent.
		const unmapped = new Set<Param>();
		for (const param of op.params) {
			const problem = paramProblem(spec, param, op.path);
			if (problem === undefined) continue;
			unmapped.add(param);
			// An optional one just gets no flag.
			if (!param.required) continue;
			const [code, tail, fix] = problem;
			report(code, `${label}: the ${param.in} parameter "${param.name}" ${tail}`, fix);
		}

		// Inputs, as generated commands map them: positional parameters become arguments, other
		// parameters and the scalar fields of a JSON body flags, the whole JSON body `--request-body`.
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
					name: "request-body",
					source: "the request body",
					target: { in: "body" },
				});
				for (const bodyField of bodySchemaFields) {
					const { name: field, kind } = bodyField;
					if (bound.has(field) || kind === "other") continue;
					const repeated = op.params.find(
						(param) => param.in !== "cookie" && kebab(param.name) === kebab(field),
					);
					// The parameter keeps its input; the body field is sent only from `--body`.
					if (repeated !== undefined) continue;
					inputs.push({
						kind: "flag",
						name: rename(field),
						source: `body field "${field}"`,
						target: { in: "field", field: bodyField },
					});
				}
			} else if (body.required) {
				report(
					"unsupported-body-type",
					`${label}: the request body is ${body.contentType}; only JSON bodies are generated`,
					`Call the operation with \`api ${op.path} --body\`, or set \`exclude: true\` in its override`,
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
		if (fields.paginate !== undefined && !paginates) {
			report(
				"paginate-needs-array",
				`${label}: the override sets \`paginate\`, but its result after \`unwrap\` is not a list, so pages cannot be joined`,
				"Set `unwrap` to return the page's list (with its `outputSchema`), or remove `paginate` from the override",
			);
		}
		if (paginates) {
			inputs.push({
				kind: "flag",
				name: "paginate",
				source: "--paginate",
				target: { in: "paginate" },
			});
		}

		for (const { kind, name, source } of inputs) {
			if (kind === "flag" && UNFLAGGABLE.test(name)) {
				report(
					"unflaggable-name",
					`${label}: ${source} would be the flag "${name}", which core rejects`,
					"Set `flagName` for it in the operation's override",
				);
			}
		}
		for (const [name, same] of Map.groupBy(inputs, (item) => item.name)) {
			if (same.length < 2) continue;
			const sources = same.map(({ source }) => source);
			// A built-in input (`--request-body`, `--paginate`) has no spec name: only the other can be renamed.
			const fromSpec = same.filter(({ target }) => target.in === "param" || target.in === "field");
			// `flagName` is keyed by the spec's name, so it renames every input of one name alike.
			const specNames = new Set(fromSpec.map(({ target }) => specName(target)));
			report(
				"flag-collision",
				`${label}: ${sources.slice(0, -1).join(", ")} and ${sources.at(-1)} share the input name "${name}"`,
				fromSpec.length < same.length
					? `Set \`flagName\` for the ${fromSpec.map(({ source }) => source).join(" and ")} in the operation's override`
					: specNames.size === 1
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
	}

	const addedGroups = new Set<string>();
	for (const group of Object.keys(added)) addGroup(addedGroups, group);
	for (const group of addedGroups) groups.add(group);
	// A skipped operation becomes no command, so it clashes with nothing.
	const skipped = new Set(
		diagnostics.flatMap(({ code, operationId }) =>
			PROBLEM_KINDS[code] === "skip" ? [operationId] : [],
		),
	);
	const commanded = placed.filter(({ op }) => !skipped.has(op.id));
	for (const { group } of commanded) addGroup(groups, group);
	const commands = new Map<string, Operation>();
	const collide = (op: Operation, command: string, other: string) =>
		diagnostics.push({
			code: "command-collision",
			operationId: op.id,
			method: op.method,
			path: op.path,
			message: `${operationLabel(op.method, op.path)}: the command "${command}" is also ${other}`,
			fix: "Set `group` or `name` in the override of one of them",
		});
	for (const { op, command } of commanded) {
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
		for (const inside of commanded.filter((plan) => plan.command.startsWith(`${command} `))) {
			diagnostics.push({
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
			code: "command-collision",
			message: `The command "${command}", ${by}, is also a group of added commands`,
			fix: "Rename the added command, or set `group` in the overrides of the operations in that group",
		});
	}

	const ids = new Set(model.operations.map(({ id }) => id));
	for (const id of Object.keys(override)) {
		if (ids.has(id)) continue;
		diagnostics.push({
			code: "override-unknown-operation",
			operationId: id,
			message: `The override for "${id}" matches no operation in the spec`,
			fix: "Remove the override, or correct its operationId",
		});
	}
	// A skipped operation becomes no command whatever its configuration, so its own problems that
	// configuration settles (its inputs, names and override) are not reported: they fail no build.
	return {
		diagnostics: diagnostics.filter(
			({ code, operationId }) =>
				PROBLEM_KINDS[code] !== "fix" || operationId === undefined || !skipped.has(operationId),
		),
		commands: placed.map(({ command: _command, ...plan }) => plan),
	};
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
 * Why a parameter gets no input, as `[code, message tail, fix]`, or `undefined`. It is a problem
 * only for a required parameter, which the operation cannot be called without.
 */
function paramProblem(
	spec: OpenApiSpec,
	param: Param,
	path: string,
): [Diagnostic["code"], string, string] | undefined {
	const fix = `Call the operation with \`api ${path}\`, or set \`exclude: true\` in its override`;
	if (param.in === "cookie") {
		return [
			"required-cookie-param",
			"is required, and generated commands send no cookies",
			`Call the operation with \`api ${path}\` and a \`Cookie\` header, or set \`exclude: true\` in its override`,
		];
	}
	if (param.contentType !== undefined) {
		return [
			"content-param",
			`is described by \`content\` (${param.contentType}), which maps to no flag`,
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
	return ["unsupported-param-style", `is not ${shape} in style ${expected}`, fix];
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
