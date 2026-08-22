import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/** Ban Reflect.set, which bypasses ordinary typed property assignment. */
export const noReflectSetRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow Reflect.set; use typed property assignment or parse dynamic input into a domain type.",
		},
		messages: {
			reflectSet:
				"Replace `Reflect.set` with typed property assignment. Parse dynamic input into a named domain type before writing it.",
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
				if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "set")) {
					context.report({ node, messageId: "reflectSet" });
				}
			},
		};
	},
});
