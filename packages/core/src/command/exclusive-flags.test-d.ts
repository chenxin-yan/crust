import type { Equal, Expect } from "../../tests/helpers.ts";
import { Crust } from "./crust.ts";

// Compile-time checks for `type: "exclusive"` groups, `requires`, `hidden` and `deprecated`; never invoked.

function _exclusiveValue() {
	new Crust("cli")
		.flags({
			scope: {
				type: "exclusive",
				required: true,
				flags: {
					"org-id": { type: "string" },
					"project-id": { type: "integer", min: 1 },
					all: { type: "boolean" },
				},
			},
			format: {
				type: "exclusive",
				flags: { json: { type: "boolean" }, yaml: { type: "boolean" } },
			},
		})
		.action(({ flags }) => {
			type _scope = Expect<
				Equal<
					typeof flags.scope,
					| { flag: "org-id"; value: string }
					| { flag: "project-id"; value: number }
					| { flag: "all" }
				>
			>;
			type _format = Expect<
				Equal<typeof flags.format, { flag: "json" } | { flag: "yaml" } | undefined>
			>;
			switch (flags.scope.flag) {
				case "org-id":
					flags.scope.value.toUpperCase();
					break;
				case "project-id":
					flags.scope.value.toFixed();
					break;
				case "all":
					// @ts-expect-error a boolean member has no value
					void flags.scope.value;
					break;
			}
		});
}

function _typedInput() {
	const app = new Crust("cli").command("deploy", (command) =>
		command
			.flags({
				scope: {
					type: "exclusive",
					required: true,
					flags: { "org-id": { type: "string" }, all: { type: "boolean" } },
				},
			})
			.action(() => {}),
	);
	void app.run(["deploy"], { flags: { scope: { flag: "org-id", value: "acme" } } });
	void app.run(["deploy"], { flags: { scope: { flag: "all" } } });
	// @ts-expect-error a required group must be given
	void app.run(["deploy"], { flags: {} });
	// @ts-expect-error two members cannot be written
	void app.run(["deploy"], { flags: { scope: { flag: "org-id", value: "acme", all: true } } });
	// @ts-expect-error not a member
	void app.run(["deploy"], { flags: { scope: { flag: "team", value: "x" } } });

	// A member's `env` may supply a required group, so typed input may omit it.
	const withEnv = new Crust("cli").command("deploy", (command) =>
		command
			.flags({
				scope: {
					type: "exclusive",
					required: true,
					flags: { "org-id": { type: "string", env: "ORG_ID" }, all: { type: "boolean" } },
				},
			})
			.action(() => {}),
	);
	void withEnv.run(["deploy"], { flags: {} });
}

function _definitionErrors() {
	new Crust("cli").flags({
		scope: {
			type: "exclusive",
			// @ts-expect-error a member cannot have a default
			flags: { "org-id": { type: "string", default: "acme" } },
		},
	});
	new Crust("cli").flags({
		scope: {
			type: "exclusive",
			// @ts-expect-error a member cannot be required on its own
			flags: { all: { type: "boolean", required: true } },
		},
	});
	new Crust("cli").flags({
		scope: {
			type: "exclusive",
			flags: {
				// @ts-expect-error `descripton` is not a flag property
				all: { type: "boolean", descripton: "All" },
			},
		},
	});
	new Crust("cli").flags({
		// @ts-expect-error a group has no default
		scope: { type: "exclusive", default: { flag: "all" }, flags: { all: { type: "boolean" } } },
	});
	// @ts-expect-error only a group has members
	new Crust("cli").flags({ out: { type: "string", flags: {} } });
}

function _requires() {
	new Crust("cli").flags({
		jq: { type: "string", requires: ["json"] },
		json: { type: "boolean" },
		scope: { type: "exclusive", flags: { all: { type: "boolean" } } },
		web: { type: "boolean", requires: ["scope"] },
	});
	new Crust("cli").flags({
		// @ts-expect-error `requires` names a flag of the same record
		jq: { type: "string", requires: ["jsno"] },
		json: { type: "boolean" },
	});
}

function _hiddenAndDeprecated() {
	new Crust("cli")
		.flags({
			"kernel-memory": { type: "string", hidden: true, deprecated: "Use --memory instead." },
		})
		.command("scan", { deprecated: "Use `scout`." }, (command) => command.action(() => {}));
	// @ts-expect-error `deprecated` is a message
	new Crust("cli").flags({ old: { type: "string", deprecated: true } });
}
