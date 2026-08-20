function greeting(): string {
	return `hello ${process.argv.slice(2)[0]}`;
}

console.log(greeting());
process.exit(process.argv.slice(2).length - 1);
