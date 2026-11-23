import { Crust, defineCommand } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { runBuildHooks } from "../../crust/tests/build-hooks.ts";
import { man } from "./extension.ts";

describe("man Extension", () => {
	it("returns a page per visible command, named by its path, in a configurable section", async () => {
		const app = new Crust("demo", { description: "Demo CLI" })
			.add(
				defineCommand("remote", (cmd) =>
					cmd.add(defineCommand("add", (sub) => sub.action(() => {}))),
				),
			)
			.add(defineCommand("internal", { hidden: true }, (cmd) => cmd.action(() => {})))
			.extend(man({ section: 5 }));
		const { files } = await runBuildHooks(app);

		expect([...files.keys()]).toEqual(["man/demo.5", "man/demo-remote.5", "man/demo-remote-add.5"]);
		expect(files.get("man/demo.5")).toContain(".Dt DEMO 5");
		expect(files.get("man/demo-remote-add.5")).toContain(".Nm demo-remote-add\n");
		expect(files.get("man/demo-remote-add.5")).toContain(".Xr demo-remote 5\n");
	});

	it("rejects root names that are not installed command names", async () => {
		const { error } = await runBuildHooks(new Crust("foo/bar").extend(man()));

		expect(error).toContain('Manual name "foo/bar" is not a valid command name');
	});

	it("rejects a page name that is not an installed command name, naming the command", async () => {
		const app = new Crust("demo").add(defineCommand("do:it", (cmd) => cmd.action(() => {})));
		const { error } = await runBuildHooks(app.extend(man()));

		expect(error).toContain(
			'Manual name "demo-do:it" (command "do:it") is not a valid command name',
		);
	});

	it("rejects two commands whose pages share a name", async () => {
		const app = new Crust("demo")
			.add(defineCommand("a-b", (cmd) => cmd.action(() => {})))
			.add(defineCommand("a", (cmd) => cmd.add(defineCommand("b", (sub) => sub.action(() => {})))));
		const { error } = await runBuildHooks(app.extend(man()));

		expect(error).toContain(
			'Commands "demo a-b" and "demo a b" both become manual page "demo-a-b"',
		);
	});
});
