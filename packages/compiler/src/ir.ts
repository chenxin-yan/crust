/** The deliberately small boundary between TypeScript analysis and Go emission. */
export interface Program {
	readonly statements: readonly Statement[];
}

export interface LogStatement {
	readonly kind: "log";
	readonly value: string;
}

export type Statement = LogStatement;
