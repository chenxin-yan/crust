import { defineCommand } from "@crustjs/core";

import { todoStore } from "../shared.ts";

export const removeCommand = defineCommand(
	"remove",
	{ description: "Remove a todo", requires: [todoStore] },
	(command) =>
		command
			.args({ name: "id", type: "number", required: true, description: "Todo ID" })
			.flags({
				name: "force",
				type: "boolean",
				short: "f",
				description: "Remove an unfinished todo",
			})
			.action(({ args, flags, ctx, stdout }) => {
				const result = ctx.todos.remove(args.id, flags.force === true);
				if (result === "not-found") throw new Error(`Todo #${args.id} not found`);
				if (result === "unfinished") {
					throw new Error(`Todo #${args.id} is unfinished; pass --force to remove it`);
				}
				stdout(`Removed #${args.id}.`);
			}),
);
