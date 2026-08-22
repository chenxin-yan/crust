import { RuleTester } from "oxlint/plugins-dev";

import { noReflectSetRule } from "./no-reflect-set.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "reflectSet" };

tester.run("anti-slop/no-reflect-set", noReflectSetRule, {
	valid: [
		"owner.property = value;",
		"owner[key] = value;",
		"const value = Reflect.get(owner, key);",
		"const Reflect = { set() { return true; } }; Reflect.set();",
		"function write(Reflect: { set(): boolean }) { return Reflect.set(); }",
	],
	invalid: [
		{ name: "static access", code: "Reflect.set(owner, key, value);", errors: [error] },
		{ name: "computed access", code: "Reflect['set'](owner, key, value);", errors: [error] },
	],
});
