function length(value: string): number {
	return value.length;
}

function missing() {
	return process.argv[99];
}

console.log(length(missing()));
