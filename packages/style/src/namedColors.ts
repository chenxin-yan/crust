// ────────────────────────────────────────────────────────────────────────────
// Named Colors & LiteralUnion — TypeScript helpers for `ColorInput` autocomplete
// ────────────────────────────────────────────────────────────────────────────
//
// `NamedColor` is the CSS Color Module Level 4 named-color set (148 entries,
// including `rebeccapurple`; excluding `transparent` and `currentcolor` since
// they have no meaningful ANSI mapping). It mirrors the strings
// `Bun.color()` accepts at runtime — passed-through to Bun's CSS parser.
//
// `LiteralUnion<L, B>` is the canonical workaround for
// [TypeScript#29729](https://github.com/microsoft/TypeScript/issues/29729):
// when a literal union (`"red" | "blue"`) is unioned with its base type
// (`string`), TS eagerly widens the result to just `string` and drops the
// literal information from autocomplete. Intersecting the base type with
// `Record<never, never>` (a structurally empty record) keeps the union
// "split" so editors surface the literals while still accepting any string
// at the type level.
//
// References:
// - type-fest's `LiteralUnion`: https://github.com/sindresorhus/type-fest/blob/main/source/literal-union.d.ts
// - csstype uses the same `string & {}` trick for `Color`:
//   https://github.com/frenic/csstype/blob/master/index.d.ts

/**
 * A literal union that preserves IDE autocomplete for the known literals
 * `LiteralType` while still accepting any value of `BaseType`.
 *
 * @typeParam LiteralType - Known literal members to surface as completions.
 * @typeParam BaseType - The widened primitive that should remain assignable.
 *
 * @example
 * ```ts
 * type Pet = LiteralUnion<"dog" | "cat", string>;
 * const a: Pet = "dog";   // ✅ autocompleted
 * const b: Pet = "fish";  // ✅ accepted (string fallback)
 * ```
 */
export type LiteralUnion<
	LiteralType,
	BaseType extends string | number | bigint | boolean | symbol | null,
> = LiteralType | (BaseType & Record<never, never>);

/**
 * The 148 CSS named colors recognized by `Bun.color()`.
 *
 * Includes `rebeccapurple` (CSS Color Module Level 4 addition).
 * Excludes `transparent` and `currentcolor`, which have no meaningful
 * mapping to an ANSI foreground/background sequence.
 *
 * Used by {@link ColorInput} so editors autocomplete every named color
 * the underlying Bun parser actually supports.
 *
 * @see {@link https://drafts.csswg.org/css-color/#named-colors | CSS Color Module Level 4 — Named Colors}
 */
export type NamedColor =
	// A
	| "aliceblue"
	| "antiquewhite"
	| "aqua"
	| "aquamarine"
	| "azure"
	// B
	| "beige"
	| "bisque"
	| "black"
	| "blanchedalmond"
	| "blue"
	| "blueviolet"
	| "brown"
	| "burlywood"
	// C
	| "cadetblue"
	| "chartreuse"
	| "chocolate"
	| "coral"
	| "cornflowerblue"
	| "cornsilk"
	| "crimson"
	| "cyan"
	// D
	| "darkblue"
	| "darkcyan"
	| "darkgoldenrod"
	| "darkgray"
	| "darkgreen"
	| "darkgrey"
	| "darkkhaki"
	| "darkmagenta"
	| "darkolivegreen"
	| "darkorange"
	| "darkorchid"
	| "darkred"
	| "darksalmon"
	| "darkseagreen"
	| "darkslateblue"
	| "darkslategray"
	| "darkslategrey"
	| "darkturquoise"
	| "darkviolet"
	| "deeppink"
	| "deepskyblue"
	| "dimgray"
	| "dimgrey"
	| "dodgerblue"
	// F
	| "firebrick"
	| "floralwhite"
	| "forestgreen"
	| "fuchsia"
	// G
	| "gainsboro"
	| "ghostwhite"
	| "gold"
	| "goldenrod"
	| "gray"
	| "green"
	| "greenyellow"
	| "grey"
	// H
	| "honeydew"
	| "hotpink"
	// I
	| "indianred"
	| "indigo"
	| "ivory"
	// K
	| "khaki"
	// L
	| "lavender"
	| "lavenderblush"
	| "lawngreen"
	| "lemonchiffon"
	| "lightblue"
	| "lightcoral"
	| "lightcyan"
	| "lightgoldenrodyellow"
	| "lightgray"
	| "lightgreen"
	| "lightgrey"
	| "lightpink"
	| "lightsalmon"
	| "lightseagreen"
	| "lightskyblue"
	| "lightslategray"
	| "lightslategrey"
	| "lightsteelblue"
	| "lightyellow"
	| "lime"
	| "limegreen"
	| "linen"
	// M
	| "magenta"
	| "maroon"
	| "mediumaquamarine"
	| "mediumblue"
	| "mediumorchid"
	| "mediumpurple"
	| "mediumseagreen"
	| "mediumslateblue"
	| "mediumspringgreen"
	| "mediumturquoise"
	| "mediumvioletred"
	| "midnightblue"
	| "mintcream"
	| "mistyrose"
	| "moccasin"
	// N
	| "navajowhite"
	| "navy"
	// O
	| "oldlace"
	| "olive"
	| "olivedrab"
	| "orange"
	| "orangered"
	| "orchid"
	// P
	| "palegoldenrod"
	| "palegreen"
	| "paleturquoise"
	| "palevioletred"
	| "papayawhip"
	| "peachpuff"
	| "peru"
	| "pink"
	| "plum"
	| "powderblue"
	| "purple"
	// R
	| "rebeccapurple"
	| "red"
	| "rosybrown"
	| "royalblue"
	// S
	| "saddlebrown"
	| "salmon"
	| "sandybrown"
	| "seagreen"
	| "seashell"
	| "sienna"
	| "silver"
	| "skyblue"
	| "slateblue"
	| "slategray"
	| "slategrey"
	| "snow"
	| "springgreen"
	| "steelblue"
	// T
	| "tan"
	| "teal"
	| "thistle"
	| "tomato"
	| "turquoise"
	// V
	| "violet"
	// W
	| "wheat"
	| "white"
	| "whitesmoke"
	// Y
	| "yellow"
	| "yellowgreen";
