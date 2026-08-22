import { RuleTester } from "oxlint/plugins-dev";

import { noUnknownParametersRule } from "./no-unknown-parameters.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "unknownParameter" };
const allowBoundaries = [{ allowInBoundaryFunctions: true }];

tester.run("anti-slop/no-unknown-parameters", noUnknownParametersRule, {
	valid: [
		"function consume(value: User) {}",
		"function enrich(cause: unknown) {}",
		{
			code: "function parseUser(value: unknown): User { return decode(value); }",
			options: allowBoundaries,
		},
		{
			code: "const validateUser = (value: unknown): User => decode(value);",
			options: allowBoundaries,
		},
		{
			code: "function isUser(value: unknown): value is User { return check(value); }",
			options: allowBoundaries,
		},
		{
			code: "function assertUser(value: unknown): asserts value is User { check(value); }",
			options: allowBoundaries,
		},
	],
	invalid: [
		{ code: "function consume(value: unknown) {}", errors: [error] },
		{ code: "function parseUser(value: unknown): User { return decode(value); }", errors: [error] },
		{
			code: "const consume = (value: unknown) => value;",
			options: allowBoundaries,
			errors: [error],
		},
		{
			code: "type Consumer = (value: unknown) => void;",
			options: allowBoundaries,
			errors: [error],
		},
	],
});
