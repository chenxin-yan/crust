import { RuleTester } from "oxlint/plugins-dev";

import { noWidenThenAssertRule } from "./no-widen-then-assert.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "widenThenAssert" };

tester.run("anti-slop/no-widen-then-assert", noWidenThenAssertRule, {
	valid: [
		"const source = { id: 'first' }; const widened: unknown = source;",
		"declare const input: unknown; const parsed = input as { readonly id: string };",
		"const config = { id: 'first' }; const proxy: { id: string } = config as any; proxy as { id: string };",
		"const source = { id: 'first' }; const widened: Record<string, unknown> = source; widened as Record<string, unknown>;",
	],
	invalid: [
		{
			code: "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
			errors: [error],
		},
		{
			code: "const source = { id: 'second' }; const widened: unknown = source; const parsed = <{ readonly id: string }>widened;",
			errors: [error],
		},
		{
			code: "const source = { id: 'second' }; const widened: object = source; widened as { readonly id: string };",
			errors: [error],
		},
		{
			code: "const source = { id: 'second' }; const widened: Record<string, unknown> = source; widened as { [key: string]: string };",
			errors: [error],
		},
		{
			code: "const source = { id: 'second' }; const widened = source as unknown; widened as { readonly id: string };",
			errors: [error],
		},
		{
			code: "type Item = { readonly id: string }; const source: Item = { id: 'second' }; const widened: object = source; widened as Item;",
			errors: [error],
		},
	],
});
