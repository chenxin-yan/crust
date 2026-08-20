function multiply(left: number, right: number): number {
	return left * right;
}

function label(value: number): string {
	return `result: ${value}`;
}

console.log(label(multiply(6, 7)));
