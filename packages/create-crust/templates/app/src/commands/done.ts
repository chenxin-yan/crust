import { defineCommand } from "@crustjs/core";

import { todoStore } from "../shared.ts";

export const doneCommand = defineCommand(
	"done",
	{ description: "Mark a todo as done", requires: [todoStore] },
	(command) =>
		command
			.args({ name: "id", type: "number", required: true, description: "Todo ID" })
			.action(({ args, ctx, stdout }) => {
				if (!ctx.todos.markDone(args.id)) throw new Error(`Todo #${args.id} not found`);
				stdout(`Completed #${args.id}.`);
			}),
);
