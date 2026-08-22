import { RuleTester } from "oxlint/plugins-dev";

import { noForbiddenTermInSymbolNamesRule } from "./no-shape-in-symbol-names.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = { messageId: "forbiddenSymbolName" };

tester.run("anti-slop/no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
	valid: [
		"const contract = value;",
		"schema.shape; schema['shape'];",
		"import { shape } from 'vendor'; shape();",
		"import { shape as schemaContract } from 'vendor'; schemaContract();",
		"import { ShapePanel } from 'vendor'; const view = <ShapePanel />;",
	],
	invalid: [
		{ code: "const commandShape = value;", errors: [error] },
		{ code: "class Owner { #dataShape = value; }", errors: [error] },
		{ code: "const ShapePanel = () => <section />;", errors: [error] },
		{ code: "const view = <ShapePanel />;", errors: [error] },
	],
});
