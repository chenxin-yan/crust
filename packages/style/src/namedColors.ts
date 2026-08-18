// ────────────────────────────────────────────────────────────────────────────
// Named Colors — CSS color literals for `ColorInput` autocomplete
// ────────────────────────────────────────────────────────────────────────────
//
// `NamedColor` is the CSS Color Module Level 4 named-color set (148 entries,
// including `rebeccapurple`; excluding `transparent` and `currentcolor` since
// they have no meaningful ANSI mapping).

/**
 * The 148 CSS named colors recognized by the portable color parser.
 *
 * Includes `rebeccapurple` (CSS Color Module Level 4 addition).
 * Excludes `transparent` and `currentcolor`, which have no meaningful
 * mapping to an ANSI foreground/background sequence.
 *
 * Used by {@link ColorInput} so editors autocomplete every supported named color.
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
