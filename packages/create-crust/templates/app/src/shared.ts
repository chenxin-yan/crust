import { readFile, writeFile } from "node:fs/promises";

import { defineContext, defineFlag } from "@crustjs/core";

export type Priority = "low" | "medium" | "high";

export interface Todo {
	id: number;
	text: string;
	priority: Priority;
	done: boolean;
}

export interface TodoStore {
	list(done?: boolean): readonly Todo[];
	add(text: string, priority: Priority): Todo;
	markDone(id: number): boolean;
	remove(id: number, force: boolean): "removed" | "not-found" | "unfinished";
	[Symbol.asyncDispose]?(): Promise<void>;
}

const dataFile = defineFlag("data-file", {
	type: "path",
	default: "todos.json",
	description: "Path to the todo data file",
});

function isTodo(value: unknown): value is Todo {
	if (typeof value !== "object" || value === null) return false;
	const todo = value as Record<string, unknown>;
	return (
		typeof todo.id === "number" &&
		typeof todo.text === "string" &&
		(todo.priority === "low" || todo.priority === "medium" || todo.priority === "high") &&
		typeof todo.done === "boolean"
	);
}

export const todoStore = defineContext(
	"todos",
	{ flags: [dataFile] },
	async ({ flags }): Promise<TodoStore> => {
		let todos: Todo[] = [];
		try {
			const saved: unknown = JSON.parse(await readFile(flags["data-file"], "utf8"));
			if (!Array.isArray(saved) || !saved.every(isTodo)) {
				throw new Error(`Invalid todo data in ${flags["data-file"]}`);
			}
			todos = saved;
		} catch (error) {
			// ENOENT: a missing data file just means an empty todo list.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		let dirty = false;

		return {
			list(done) {
				return done === undefined ? todos : todos.filter((todo) => todo.done === done);
			},
			add(text, priority) {
				const todo = {
					id: Math.max(0, ...todos.map(({ id }) => id)) + 1,
					text,
					priority,
					done: false,
				};
				todos.push(todo);
				dirty = true;
				return todo;
			},
			markDone(id) {
				const todo = todos.find((candidate) => candidate.id === id);
				if (!todo) return false;
				todo.done = true;
				dirty = true;
				return true;
			},
			remove(id, force) {
				const index = todos.findIndex((todo) => todo.id === id);
				if (index === -1) return "not-found";
				if (!todos[index]!.done && !force) return "unfinished";
				todos.splice(index, 1);
				dirty = true;
				return "removed";
			},
			async [Symbol.asyncDispose]() {
				// ponytail: direct JSON writes keep the starter small; use atomic writes when durability matters.
				if (dirty) await writeFile(flags["data-file"], `${JSON.stringify(todos, null, 2)}\n`);
			},
		};
	},
);
