import { describe, expect, it } from "bun:test";

import { Crust } from "@crustjs/core";
import { captureRun } from "@crustjs/testing";

import { addCommand } from "./commands/add.ts";
import { listCommand } from "./commands/list.ts";
import { type Todo, type TodoStore, todoStore } from "./shared.ts";

function memoryStore(): TodoStore {
	const todos: Todo[] = [];
	return {
		list(done) {
			return done === undefined ? todos : todos.filter((todo) => todo.done === done);
		},
		add(text, priority) {
			const todo = { id: todos.length + 1, text, priority, done: false };
			todos.push(todo);
			return todo;
		},
		markDone() {
			return false;
		},
		remove() {
			return "not-found";
		},
	};
}

describe("todo commands", () => {
	it("adds and lists todos through a Context double", async () => {
		const app = new Crust("test").provide(todoStore.of(memoryStore())).add(addCommand, listCommand);

		const added = await captureRun(app, ["add", "write", "tests", "--priority", "high"]);
		expect(added).toEqual({ stdout: "Added #1: write tests", stderr: "" });

		const listed = await captureRun(app, ["list", "--no-done"]);
		expect(listed).toEqual({ stdout: "[ ] 1. write tests (high)", stderr: "" });
	});
});
