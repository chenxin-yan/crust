import { Crust, defineCommand } from "@crustjs/core";
import { json } from "@crustjs/extensions";
import { z } from "zod";

async function waitForApproval(): Promise<string> {
	return "ada";
}

//#region users
const users = defineCommand("users", { description: "List users" }, (cmd) =>
	cmd
		// [!code highlight]
		.output(z.array(z.object({ id: z.number(), name: z.string() })))
		.action(({ stdout }) => {
			const rows = [
				{ id: 1, name: "Ada" },
				{ id: 2, name: "Linus" },
			];
			stdout("ID  NAME");
			for (const row of rows) stdout(`${row.id}   ${row.name}`);
			return rows;
		}),
);
//#endregion

//#region login
const login = defineCommand("login", { description: "Log in" }, (cmd) =>
	cmd.output(z.object({ user: z.string() })).action(async ({ stderr }) => {
		// stderr() is always live, so the user sees this while the command waits.
		// [!code highlight]
		stderr("Open https://example.com/device and enter ABCD-1234");
		return { user: await waitForApproval() };
	}),
);
//#endregion

const app = new Crust("my-cli").extend(json()).add(users, login);

await app.execute();
