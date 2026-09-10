import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
	type AnyCrust,
	type RunOutcome,
} from "../index.ts";

const app = new Crust("app")
	.flags({ name: "mode", type: "string", choices: ["safe", "fast"], required: true })
	.action(({ flags }) => flags.mode);
const valid: Promise<RunOutcome<"safe" | "fast">> = app.run([], { flags: { mode: "safe" } });
void valid;
declare const condition: boolean;
const validUnion: Promise<RunOutcome<"safe" | "fast">> = app.run(
	[],
	condition ? { flags: { mode: "safe" } } : { flags: { mode: "fast" } },
);
void validUnion;
interface JsonPayload {
	name: string;
}
declare const payload: JsonPayload;
const jsonApp = app.flags({ name: "config", type: "json" });
void jsonApp.run(
	[],
	condition
		? { flags: { mode: "safe", config: payload } }
		: { flags: { mode: "fast", config: payload } },
);
// @ts-expect-error one invalid union branch cannot bypass compatibility validation
void app.run([], condition ? { flags: { mode: "safe" } } : { flags: { mode: "wrong" } });
// @ts-expect-error a union branch must still supply the required flag
void app.run([], condition ? { flags: { mode: "safe" } } : { flags: { mdoe: "fast" } });
void app.run(
	[],
	// @ts-expect-error a fresh union branch cannot add a typo beside valid required fields
	condition ? { flags: { mode: "safe" } } : { flags: { mode: "fast", mdoe: "fast" } },
);
// @ts-expect-error explicit IO cannot bypass an invalid union branch
void app.run([], condition ? { flags: { mode: "safe" } } : { flags: { mode: "wrong" } }, {});
declare const broad: string;
declare const mode: "safe" | "fast";
void app.run([], { flags: { mode } });
if (broad === "safe" || broad === "fast") void app.run([], { flags: { mode: broad } });
// @ts-expect-error broad strings are not known choices
void app.run([], { flags: { mode: broad } });
// @ts-expect-error wrong choice
void app.run([], { flags: { mode: "wrong" } });
// @ts-expect-error wrong primitive
void app.run([], { flags: { mode: 3 } });
// @ts-expect-error explicit IO cannot bypass known choices through the compatibility overload
void app.run([], { flags: { mode: broad } }, { stdout: () => {} });
// @ts-expect-error explicit IO cannot bypass excess-key checks
void app.run([], { flags: { mode: "safe", mdoe: "fast" } }, {});
// @ts-expect-error missing required flag
void app.run([]);
// @ts-expect-error typo beside otherwise valid required input
void app.run([], { flags: { mode: "safe", mdoe: "fast" } });
// @ts-expect-error unknown top-level section beside otherwise valid required input
void app.run([], { flags: { mode: "safe" }, flgas: { mode: "fast" } });
const structuralSections = { flags: { mode }, flgas: { mode } };
void app.run([], structuralSections);
// Standard structural assignability permits extra keys on variables; runtime checks them.
const structuralInput = { flags: { mode, mdoe: "fast" } };
void app.run([], structuralInput);
const broadVariableInput = { flags: { mode: broad } };
// @ts-expect-error variable values must still satisfy known choices
void app.run([], broadVariableInput);
const missingVariableInput = { flags: { mdoe: "fast" } };
// @ts-expect-error variables must still supply known required fields
void app.run([], missingVariableInput);
// @ts-expect-error no such path
void app.run(["missing"], { flags: { mode: "safe" } });
const erased: AnyCrust = app;
const unknownResult: Promise<RunOutcome<unknown>> = erased.run([broad], { flags: { mode: broad } });
void unknownResult;
// @ts-expect-error erased inspection view is not authoring authority
erased.flags({ name: "other", type: "boolean" });
const dynamicFlag = defineFlag(broad, { type: "string" });
new Crust(broad).flags(dynamicFlag);
// @ts-expect-error uncertainty in the name must not hide an invalid literal short spelling
defineFlag(broad, { type: "string", short: "long" });
declare const invalidName: "" | "valid";
// @ts-expect-error independently invalid union flag name
defineFlag(invalidName, { type: "string" });
// @ts-expect-error independently invalid union command name
new Crust(invalidName);
// @ts-expect-error whitespace-only literal names remain invalid
new Crust(" \t\n");
// @ts-expect-error reserved literal names remain invalid
new Crust("__proto__");

const partial = new Crust("partial").flags(dynamicFlag, {
	name: "mode",
	type: "string",
	choices: ["safe", "fast"],
	required: true,
});
void partial.run([], { flags: { mode: "safe", other: "dynamic" } });
// @ts-expect-error an open neighbor cannot erase a known required flag
void partial.run([]);
// @ts-expect-error an open neighbor cannot widen known choices
void partial.run([], { flags: { mode: "wrong" } });
// @ts-expect-error a known field still rejects broad strings beside dynamic fields
void partial.run([], { flags: { mode: broad } });

function localProviders(condition: boolean) {
	const text = defineContext("db", () => "text");
	const number = defineContext("db", () => 42);
	const demand = defineExtension(defineExtensionId("demand"), { uses: [text] });
	const root = new Crust("app").provide(text()).extend(demand);
	root.command("inline", (c) => (condition ? c.provide(text()) : c));
	root.add(defineCommand("sealed", (c) => (condition ? c.provide(text()) : c)));
	defineCommand("local", (c) => c.use(text).provide(text()));
	// @ts-expect-error provider values must satisfy declared demands
	defineCommand("bad", (c) => c.use(text).provide(number()));
	// @ts-expect-error reversed declaration order preserves value demands
	defineCommand("bad", (c) => c.provide(number()).use(text));
	// @ts-expect-error one incompatible conditional provider remains invalid
	root.command("bad", (c) => (condition ? c.provide(number()) : c));
	// @ts-expect-error duplicate actual local providers remain rejected
	defineCommand("duplicate", (c) => c.provide(text()).provide(text()));
	// @ts-expect-error same-call duplicates remain rejected
	defineCommand("duplicate", (c) => c.provide(text(), text()));
	// @ts-expect-error root duplicate providers remain rejected
	root.provide(text());
}
void localProviders;

function mixedDefinitions(condition: boolean, text: string) {
	const mixed = condition
		? { type: "string" as const, short: "long" as const }
		: { type: "string" as const };
	// @ts-expect-error an uncertain definition cannot hide a known invalid short spelling
	defineFlag(text, mixed);
	// @ts-expect-error a dynamic body cannot hide a known invalid title
	new Crust("app", { sections: [{ title: "two\nlines", body: text }] });
	// @ts-expect-error a dynamic title cannot hide a known invalid body
	new Crust("app", { sections: [{ title: text, body: " " }] });
}
void mixedDefinitions;
// @ts-expect-error overlapping collision diagnostics must not cancel each other out
defineFlag("value", { type: "string", short: "v", aliases: ["value", "v"] });
function openInvalidDefinitions(condition: boolean) {
	const args: { name: string; type: "string"; choices: readonly ["ok"]; default: "bad" }[] = [];
	// @ts-expect-error an open collection must retain independently invalid default membership
	new Crust("app").args(...args);
	const flags = condition
		? ([{ name: "ok", type: "string" } as const] as const)
		: ([{ name: "bad", type: "string", short: "long" } as const] as const);
	// @ts-expect-error an uncertain collection must not hide its independently invalid branch
	new Crust("app").flags(...flags);
	// @ts-expect-error multiple reserved-prefix diagnostics must not cancel each other out
	new Crust("app").flags({ name: "no-value", type: "string", aliases: ["no-alias"] });
}
void openInvalidDefinitions;
