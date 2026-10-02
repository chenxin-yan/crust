// ────────────────────────────────────────────────────────────────────────────
// ANSI Codes — Open/close escape sequences for modifiers and colors
// ────────────────────────────────────────────────────────────────────────────

/**
 * An ANSI style pair consisting of an opening and closing escape sequence.
 *
 * @example
 * ```ts
 * const bold: AnsiPair = { open: "\x1b[1m", close: "\x1b[22m" };
 * ```
 */
export interface AnsiPair {
	readonly open: string;
	readonly close: string;
}

// Style method → `[open, close]` SGR parameters. Literal tables keep the
// method-name union inferable under isolatedDeclarations.
const modifierCodes = {
	/** Bold / increased intensity. */
	bold: [1, 22],
	/** Dim / decreased intensity. */
	dim: [2, 22],
	italic: [3, 23],
	underline: [4, 24],
	/** Inverse / reverse video. */
	inverse: [7, 27],
	/** Hidden / conceal. */
	hidden: [8, 28],
	/** Strikethrough / crossed out. */
	strikethrough: [9, 29],
} as const;

const colorCodes = {
	black: [30, 39],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	blue: [34, 39],
	magenta: [35, 39],
	cyan: [36, 39],
	white: [37, 39],
	/** Bright black (gray). */
	gray: [90, 39],
	brightRed: [91, 39],
	brightGreen: [92, 39],
	brightYellow: [93, 39],
	brightBlue: [94, 39],
	brightMagenta: [95, 39],
	brightCyan: [96, 39],
	brightWhite: [97, 39],

	bgBlack: [40, 49],
	bgRed: [41, 49],
	bgGreen: [42, 49],
	bgYellow: [43, 49],
	bgBlue: [44, 49],
	bgMagenta: [45, 49],
	bgCyan: [46, 49],
	bgWhite: [47, 49],
	bgBrightBlack: [100, 49],
	bgBrightRed: [101, 49],
	bgBrightGreen: [102, 49],
	bgBrightYellow: [103, 49],
	bgBrightBlue: [104, 49],
	bgBrightMagenta: [105, 49],
	bgBrightCyan: [106, 49],
	bgBrightWhite: [107, 49],
} as const;

export type StyleMethodName = keyof typeof modifierCodes | keyof typeof colorCodes;

const styleMethodCodes = { ...modifierCodes, ...colorCodes };

export const styleMethodNames: readonly StyleMethodName[] = Object.freeze(
	// SAFETY: Object.keys returns exactly the own keys of the literal code tables.
	Object.keys(styleMethodCodes) as StyleMethodName[],
);

export const styleMethodPairs: Readonly<Record<StyleMethodName, AnsiPair>> = Object.freeze(
	// SAFETY: the entries map every registered style method name to its pair.
	Object.fromEntries(
		styleMethodNames.map((name) => {
			const [open, close] = styleMethodCodes[name];
			return [name, { open: `\x1b[${open}m`, close: `\x1b[${close}m` }];
		}),
	) as Record<StyleMethodName, AnsiPair>,
);

export function isModifierName(name: StyleMethodName): boolean {
	return Object.hasOwn(modifierCodes, name);
}
