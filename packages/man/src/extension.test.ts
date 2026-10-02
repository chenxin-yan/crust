import { Crust, defineCommand, defineContext } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { man } from "./extension.ts";

describe("man Extension", () => {
	it("exposes the reserved identity on the factory", () => {
		expect(String(man.id)).toBe("crust:man");
		expect(man().id).toBe(man.id);
	});

	it("returns the root manual with a configurable section", async () => {
		const { files } = await runBuildHooks(
			new Crust("demo", { description: "Demo CLI" }).extend(man({ section: 5 })),
		);

		expect([...files.keys()]).toEqual(["man/demo.5"]);
		expect(files.get("man/demo.5")).toContain(".Dt DEMO 5");
	});

	it("documents Context sections where each Context is provided", async () => {
		const env = defineContext("env")
			.sections({ title: "Environment", body: "APP_TOKEN  API token" })
			.setup(() => ({}));
		const database = defineContext("database")
			.sections({ title: "Database", body: "DATABASE_URL  connection" })
			.setup(() => ({}));
		const { files } = await runBuildHooks(
			new Crust("demo")
				.extend(man())
				.provide(env())
				.add(
					defineCommand("db", (db) =>
						db
							.provide(database())
							.add(defineCommand("migrate", (migrate) => migrate.action(() => {}))),
					),
				),
		);

		const page = files.get("man/demo.1");
		expect(page).toContain(".Sh ENVIRONMENT\nAPP_TOKEN  API token");
		expect(page).toContain(".Sh COMMANDS\n.Ss db\n.Sy DATABASE\nDATABASE_URL  connection");
		expect(page?.match(/APP_TOKEN/g)).toHaveLength(1);
		expect(page?.match(/DATABASE_URL/g)).toHaveLength(1);
		expect(page).not.toContain(".Ss db migrate");
	});

	it.each(["foo\\bar", "foo/bar", "_tool", "my~cli"])(
		"rejects root names that are not installed command names: %s",
		async (name) => {
			const { error } = await runBuildHooks(new Crust(name).extend(man()));

			expect(error).toContain(`Manual name "${name}" is not a valid command name`);
		},
	);
});
