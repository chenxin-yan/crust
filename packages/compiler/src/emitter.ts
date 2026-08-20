import type { Program } from "./ir.js";

export function emitGo(program: Program): string {
	const statements = program.statements
		.map((statement) => `\tfmt.Println(${goString(statement.value)})`)
		.join("\n");

	return `package main

import "fmt"

func main() {
${statements}
}
`;
}

function goString(value: string): string {
	return JSON.stringify(
		Array.from(value, (character) =>
			character.length === 1 && /[\uD800-\uDFFF]/.test(character) ? "\uFFFD" : character,
		).join(""),
	);
}
