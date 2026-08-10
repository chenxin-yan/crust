import { defineCommand } from "@crustjs/core";

import { todoStore } from "../shared.ts";

export const listCommand = defineCommand(
	"list",
	{ description: "List todos", requires: [todoStore] },
	(command) =>
		command
			.flags({
				name: "done",
				type: "boolean",
				description: "Filter by completion status",
			})
			.action(({ flags, ctx, stdout }) => {
				const todos = ctx.todos.list(flags.done);
				if (todos.length === 0) {
					stdout("No todos found.");
					return;
				}
				for (const todo of todos) {
					stdout(`${todo.done ? "[x]" : "[ ]"} ${todo.id}. ${todo.text} (${todo.priority})`);
				}
			}),
);
