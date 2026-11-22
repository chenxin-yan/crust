// Each line marked "error" is one compile error with the mapper.
import { defineCommand } from "@crustjs/core";

import { acme } from "./app.ts";

export const wrong = defineCommand("wrong", {}, (command) =>
	command.use(acme.client).action(async ({ ctx }) => {
		const api = await ctx.api;
		await api.call("getUsr", { path: { id: "me" } }); // error: an unknown operationId
		await api.call("getUser", { path: { id: "me" }, query: { expnad: true } }); // error: an unknown parameter
		await api.call("createUser", { body: { nmae: "Ada" } }); // error: an unknown body field
		const user = await api.call("getUser", { path: { id: "me" } });
		return user.nickname; // error: not a field of the result
	}),
);
