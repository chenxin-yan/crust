import { Crust, defineCommand } from "../index.ts";
import {
	bindInput,
	customBindings,
	type BindInput,
	type BoundInput,
	type CustomBindings,
} from "../tooling.ts";

// Compile-time regression checks; intentionally never invoked.
function _bindInputAcceptsCompletedApplicationsOnly(): void {
	const app = new Crust("cli").add(
		defineCommand("deploy", (command) =>
			command.args({ name: "target", type: "string", required: true }).action(() => {}),
		),
	);
	const recipe = defineCommand("inert", (command) => command.action(() => {}));

	const argv: Promise<BoundInput> = bindInput(app, { argv: ["deploy", "prod"] });
	void argv;
	const structured: Promise<BoundInput> = bindInput(app, {
		path: ["deploy"],
		input: { args: { target: "prod" }, raw: ["--literal"] },
	});
	void structured;
	const custom: CustomBindings = customBindings(app, ["deploy"]);
	void custom;

	// @ts-expect-error -- an inert command definition is not an application
	void bindInput(recipe, { argv: [] });
	// @ts-expect-error -- exactly one input form is required
	void bindInput(app, {});
	// @ts-expect-error -- structured values are the runtime union, not arbitrary objects
	void bindInput(app, { path: ["deploy"], input: { args: { target: () => "prod" } } });
}

function _boundInputIsRuntimeErased(bound: BoundInput, input: BindInput): void {
	const path: readonly string[] = bound.commandPath;
	void path;
	const target: unknown = bound.args.target;
	void target;
	// @ts-expect-error -- bound values are not narrowed by definitions
	const typed: string = bound.args.target;
	void typed;
	if ("argv" in input) {
		const argv: readonly string[] = input.argv;
		void argv;
	} else {
		const raw: readonly string[] | undefined = input.input.raw;
		void raw;
	}
}
