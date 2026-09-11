import { RuleTester } from "oxlint/plugins-dev";

import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "widenThenAssert" };

tester.run("anti-slop/no-widen-then-assert", noWidenThenAssertRule, {
	valid: [
		"const source = { id: 'first' }; const widened: unknown = source;",
		"type Record<K, V> = { key: K; value: V }; const source = { id: 'first' }; const widened: Record<string, unknown> = source; const asserted = widened as { id: string };",
		"import { Readonly } from './local'; const source = { id: 'first' }; const widened: Readonly<Record<string, unknown>> = source; const asserted = widened as { id: string };",
		"declare const input: unknown; const parsed = input as { readonly id: string };",
	],
	invalid: [
		{
			code: "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
			errors: [error],
		},
		{
			code: "const source = { id: 'second' }; const widened: Readonly<Record<string, unknown>> = source; const parsed = widened as { id: string };",
			errors: [error],
		},
	],
});
