import { scaffold } from "./scaffold.ts";

// Compile-time renderer contract; checked by check:types, never executed.
function _acceptsSyncAndAsyncRenderersReturningStrings(): void {
	void scaffold({ template: ".", dest: ".", context: {}, render: (source) => source });
	void scaffold({
		template: ".",
		dest: ".",
		context: { name: "app" },
		render: async (source, context) => `${source}${context.name ?? ""}`,
	});
	void scaffold({
		template: ".",
		dest: ".",
		context: {},
		// @ts-expect-error -- rendered output must be a string
		render: () => 1,
	});
}
