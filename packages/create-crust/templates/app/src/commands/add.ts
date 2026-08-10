import { defineCommand } from "@crustjs/core";

import { type Priority, todoStore } from "../shared.ts";

export const addCommand = defineCommand(
	"add",
	{ description: "Add a todo", requires: [todoStore] },
	(command) =>
		command
			.args({
				name: "text",
				type: "string",
				variadic: true,
				required: true,
				description: "Todo text",
			})
			.flags({
				name: "priority",
				type: "string",
				choices: ["low", "medium", "high"],
				parse: (value) => value as Priority, // Crust validates choices before parsing.
				default: "medium",
				description: "Todo priority",
			})
			.action(({ args, flags, ctx, stdout }) => {
				const todo = ctx.todos.add(args.text.join(" "), flags.priority);
				stdout(`Added #${todo.id}: ${todo.text}`);
			}),
);
