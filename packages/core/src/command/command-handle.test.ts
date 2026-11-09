import { describe, expect, it } from "vite-plus/test";

import { unwrap } from "../../tests/helpers.ts";
import { Crust, defineCommand } from "./crust.ts";

function buildGit() {
	const received: { args: unknown; flags: unknown }[] = [];
	const add = defineCommand("add", (command) =>
		command
			.args(
				{ name: "name", type: "string", required: true },
				{ name: "url", type: "string", required: true },
			)
			.flags({ fetch: { type: "boolean" } })
			.action(({ args, flags, stdout }) => {
				received.push({ args, flags });
				stdout(`added ${args.name}`);
				return { remote: args.name };
			}),
	);
	const remote = defineCommand("remote", { aliases: ["r"] }, (command) => command.add(add));
	const app = new Crust("git").action(() => "root" as const).add(remote);
	return { app, received };
}

describe("app.at(path) command handles", () => {
	it("binds a typed path and runs it with structured input", async () => {
		const { app, received } = buildGit();
		const remoteAdd = app.at(["remote", "add"]);

		const pending = remoteAdd.run({
			args: { name: "origin", url: "git@x" },
			flags: { fetch: true },
		});

		const outcome = await unwrap(pending);
		expect(outcome).toMatchObject({ status: "completed", result: { remote: "origin" } });
		expect(outcome.stdout).toBe("added origin");
		expect(received).toEqual([{ args: { name: "origin", url: "git@x" }, flags: { fetch: true } }]);
		expect(remoteAdd.path).toEqual(["remote", "add"]);
	});

	it("selects the root with an empty path and keeps input optional", async () => {
		const { app } = buildGit();
		const root = app.at([]);
		expect(await unwrap(root.run())).toMatchObject({ status: "completed", result: "root" });
		expect(root.path).toEqual([]);
	});

	it("keeps the caller's spelling for aliased paths", async () => {
		const { app } = buildGit();
		const handle = app.at(["r", "add"]);
		expect(handle.path).toEqual(["r", "add"]);
		expect(await unwrap(handle.run({ args: { name: "o", url: "u" } }))).toMatchObject({
			result: { remote: "o" },
		});
	});
});
