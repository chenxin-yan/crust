export const numericStringBoundarySources = [
	"function len(s: string): number { return s.length; } console.log(len(process.argv[99] + 1));",
	"function len(s: string): number { return s.length; } console.log(len((process.argv[99]! + 1)!));",
	"function value(): string { return process.argv[99] + 1; } console.log(value().length);",
	"function value(s: string): string { return s + 1; } console.log(value(process.argv[99]).length);",
	"function len(s: string): number { return s.length; } console.log(len(process.argv[98] + process.argv[99]));",
];
