declare const console: {
	log(...values: unknown[]): void;
};

declare const process: {
	readonly argv: string[];
	exit(code: number): never;
};
