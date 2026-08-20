import type { Program } from "./ir.js";

export function emitGo(program: Program): string {
	const statements = program.statements
		.map((statement) => `\tfmt.Println(${JSON.stringify(statement.value)})`)
		.join("\n");

	return `package main

import "fmt"

func main() {
${statements}
}
`;
}
