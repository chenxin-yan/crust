import { describe, expectTypeOf, it } from "vite-plus/test";

import { Crust, defineCommand } from "../index.ts";

const deploy = defineCommand("deploy", (c) =>
	c.flags({ force: { type: "boolean" } }).action(() => {}),
);

describe(".group()", () => {
	it("keeps the commands and flags a block registers in the types", async () => {
		const app = new Crust("app")
			.group("Core", (g) => g.add(deploy).command("logs", (c) => c.action(() => "text")))
			.group("Resources", (g) =>
				g
					.flags({ memory: { type: "string", valueName: "bytes" } })
					.flags({ cpus: { type: "number" } }),
			)
			.action(({ flags }) => {
				expectTypeOf(flags.memory).toEqualTypeOf<string | undefined>();
				expectTypeOf(flags.cpus).toEqualTypeOf<number | undefined>();
			});
		const outcome = await app.run(["deploy"], { flags: { force: true } });
		expectTypeOf(outcome.status).toEqualTypeOf<"completed" | "handled" | "failed">();
		await app.run(["logs"]);
	});

	it("rejects mixing commands and flags in one block", () => {
		new Crust("app").group("Core", (g) =>
			// @ts-expect-error -- a command group takes no flags
			g.add(deploy).flags({ memory: { type: "string" } }),
		);
		new Crust("app").group("Resources", (g) =>
			// @ts-expect-error -- a flag group takes no commands
			g.flags({ memory: { type: "string" } }).add(deploy),
		);
		new Crust("app").group("Core", (g) =>
			// @ts-expect-error -- blocks do not nest
			g.group("Inner", (inner) => inner.add(deploy)),
		);
		defineCommand("x", (c) =>
			// @ts-expect-error -- a block returns its handle, not the enclosing builder
			c.group("Resources", () => c.flags({ memory: { type: "string" } })),
		);
	});

	it("takes valueName only on flags that take a value", () => {
		new Crust("app").flags({
			// @ts-expect-error -- a boolean takes no value
			force: { type: "boolean", valueName: "x" },
		});
		new Crust("app").flags({
			// @ts-expect-error -- a count takes no value
			verbose: { type: "count", valueName: "x" },
		});
	});
});
