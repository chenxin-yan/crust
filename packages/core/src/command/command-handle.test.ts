import { describe, expect, it } from "bun:test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import type { RunOutcome } from "./crust.ts";
import { Crust, defineCommand } from "./crust.ts";

function buildGit() {
	const received: { args: unknown; flags: unknown }[] = [];
	const add = defineCommand("add", (command) =>
		command
			.args(
				{ name: "name", type: "string", required: true },
				{ name: "url", type: "string", required: true },
			)
			.flags({ name: "fetch", type: "boolean" })
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
		type _result = Expect<Equal<typeof pending, Promise<RunOutcome<{ remote: string }>>>>;

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

	it("forwards io callbacks to the bound command", async () => {
		const { app } = buildGit();
		const seen: string[] = [];
		await unwrap(
			app
				.at(["remote", "add"])
				.run({ args: { name: "o", url: "u" } }, { stdout: (text) => seen.push(text) }),
		);
		expect(seen).toEqual(["added o"]);
	});

	it("throws COMMAND_NOT_FOUND eagerly for an unknown path", () => {
		const { app } = buildGit();
		// @ts-expect-error -- deliberately exercise an unknown command path.
		expect(() => app.at(["remote", "missing"])).toThrow(
			expect.objectContaining({
				code: "COMMAND_NOT_FOUND",
				details: expect.objectContaining({ input: "missing", available: ["add"] }),
			}),
		);
	});

	it("keeps the caller's spelling for aliased paths", async () => {
		const { app } = buildGit();
		const handle = app.at(["r", "add"]);
		expect(handle.path).toEqual(["r", "add"]);
		expect(await unwrap(handle.run({ args: { name: "o", url: "u" } }))).toMatchObject({
			result: { remote: "o" },
		});
	});

	it("stays bound to the builder it was taken from", async () => {
		const { app } = buildGit();
		const root = app.at([]);
		const grown = app.add(defineCommand("status", (command) => command.action(() => "clean")));

		// The handle closes over the original immutable tree; `.add()` returns a new builder.
		// @ts-expect-error -- deliberately exercise an unknown command path.
		expect(() => app.at(["status"])).toThrow(
			expect.objectContaining({ code: "COMMAND_NOT_FOUND" }),
		);
		expect(await unwrap(grown.at(["status"]).run())).toMatchObject({ result: "clean" });
		expect(await unwrap(root.run())).toMatchObject({ result: "root" });
	});
});
