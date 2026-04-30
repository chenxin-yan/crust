// ────────────────────────────────────────────────────────────────────────────
// @crustjs/style — DX exploration playground
//
// A runnable tour of the new `fg` / `bg` API and the depth-aware fallback.
// Each section is self-contained — comment out blocks to focus on one topic.
//
// Run:
//   bun run packages/style/playground/explore.ts
//
// Try the depth-fallback at the bottom by overriding env vars:
//   FORCE_COLOR=1 bun run packages/style/playground/explore.ts
//   NO_COLOR=1 bun run packages/style/playground/explore.ts
//   TERM=xterm-256color bun run packages/style/playground/explore.ts
//   TERM=xterm bun run packages/style/playground/explore.ts
// ────────────────────────────────────────────────────────────────────────────

import {
	applyStyle,
	bg,
	bgCode,
	bold, // chainable StyleFn (use as bold(text))
	boldCode, // AnsiPair (use with composeStyles / applyStyle)
	composeStyles,
	createStyle,
	fg,
	fgCode,
	getGlobalColorMode,
	italic,
	resolveColorDepth,
	setGlobalColorMode,
	style,
	underline,
} from "@crustjs/style";

// Tiny banner helper — visually separates each section in the output.
function section(title: string): void {
	console.log(`\n${"═".repeat(72)}`);
	console.log(`  ${title}`);
	console.log("═".repeat(72));
}

function show(label: string, value: string): void {
	console.log(`  ${label.padEnd(28)} ${value}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The five ways to spell a color
// ════════════════════════════════════════════════════════════════════════════
// `fg` and `bg` accept anything Bun.color() accepts. Try replacing values.

section("1. ColorInput surface — every input format");

show("hex 6-digit", fg("salmon-ish", "#ff8866"));
show("hex 3-digit", fg("salmon-ish", "#f86"));
show("hex 8-digit (alpha dropped)", fg("salmon-ish", "#ff886688"));
show("CSS named", fg("tomato", "tomato"));
show("rgb()", fg("orange", "rgb(255, 136, 0)"));
show("hsl()", fg("orange", "hsl(32, 100%, 50%)"));
show("number 0xRRGGBB", fg("orange", 0xff8800));
show("[r, g, b] tuple", fg("orange", [255, 136, 0]));
show("{r, g, b} object", fg("orange", { r: 255, g: 136, b: 0 }));

// ════════════════════════════════════════════════════════════════════════════
// 2. Backgrounds — same input surface, derived via 38;→48; rewrite
// ════════════════════════════════════════════════════════════════════════════

section("2. bg() mirrors fg() exactly");

show("bg hex", bg("  hex bg  ", "#264653"));
show("bg named", bg("  bg named  ", "midnightblue"));
show("bg + fg combined", fg(bg("  combo  ", "#264653"), "white"));

// ════════════════════════════════════════════════════════════════════════════
// 3. Pair factories — fgCode / bgCode for composition
// ════════════════════════════════════════════════════════════════════════════
// `fgCode` / `bgCode` return an `AnsiPair` ({ open, close }) so you can
// stack them with built-in modifiers via `composeStyles` or `applyStyle`.

section("3. fgCode / bgCode — pair factories");

const accent = fgCode("#7dd3fc"); // sky-300
const warnBg = bgCode("#7c2d12"); // burnt orange

show("applyStyle + fgCode", applyStyle("just an accent", accent));
show(
	"composeStyles trio",
	// composeStyles takes AnsiPair objects — use boldCode, not bold().
	applyStyle("STATUS", composeStyles(boldCode, accent, warnBg)),
);
show("nested manually", applyStyle(applyStyle("inner", accent), warnBg));

// Inspect the actual escape codes (educational):
show("accent.open bytes", JSON.stringify(accent.open));
show("warnBg.open bytes", JSON.stringify(warnBg.open));

// ════════════════════════════════════════════════════════════════════════════
// 4. Depth-aware fallback — same color, every tier
// ════════════════════════════════════════════════════════════════════════════
// The standalone `fg` / `bg` exports take only `(text, input)` and resolve
// depth from the runtime `style` facade. To force a specific depth, build a
// `createStyle()` instance with the matching overrides and call its `.fg`
// / `.bg` methods.

section("4. Depth ladder — same input, four tiers");

const peach = "#ff9966";
const tcStyle = createStyle({ mode: "always" }); // truecolor
const s256 = createStyle({
	mode: "auto",
	overrides: { isTTY: true, term: "xterm-256color", colorTerm: undefined },
});
const s16 = createStyle({
	mode: "auto",
	overrides: { isTTY: true, term: "xterm", colorTerm: undefined },
});
const sNone = createStyle({ mode: "never" });

show("truecolor", tcStyle.fg("peach", peach));
show("256", s256.fg("peach", peach));
show("16", s16.fg("peach", peach));
show("none", `[${sNone.fg("peach", peach)}]`); // bracketed to prove no escapes

console.log();
const blue = "#4f9dde";
show("bg truecolor", tcStyle.bg("  blue  ", blue));
show("bg 256", s256.bg("  blue  ", blue));
show("bg 16", s16.bg("  blue  ", blue));
show("bg none", `[${sNone.bg("  blue  ", blue)}]`);

// ════════════════════════════════════════════════════════════════════════════
// 5. Capability introspection
// ════════════════════════════════════════════════════════════════════════════
// What did the runtime actually pick for *this* terminal?

section("5. What is my terminal capable of?");

show("resolveColorDepth('auto')", resolveColorDepth("auto"));
show("resolveColorDepth('always')", resolveColorDepth("always"));
show("resolveColorDepth('never')", resolveColorDepth("never"));
show("getGlobalColorMode()", String(getGlobalColorMode())); // string | undefined
show("style.colorDepth", style.colorDepth);
show("style.colorsEnabled", String(style.colorsEnabled));
show("style.trueColorEnabled", String(style.trueColorEnabled));

// ════════════════════════════════════════════════════════════════════════════
// 6. createStyle — locked instances with overrides
// ════════════════════════════════════════════════════════════════════════════
// Useful for tests, snapshot determinism, or building a "themed" color sink.

section("6. createStyle() — deterministic instances");

const forced = createStyle({ mode: "always" });
const muted = createStyle({ mode: "never" });
const fake256 = createStyle({
	mode: "auto",
	overrides: { isTTY: true, term: "xterm-256color", colorTerm: undefined },
});
const fake16 = createStyle({
	mode: "auto",
	overrides: { isTTY: true, term: "xterm", colorTerm: undefined },
});

show("forced.fg('hi', '#ff0066')", forced.fg("hi", "#ff0066"));
show("muted.fg('hi', '#ff0066')", muted.fg("hi", "#ff0066"));
show("fake256.fg('hi', '#ff0066')", fake256.fg("hi", "#ff0066"));
show("fake16.fg('hi', '#ff0066')", fake16.fg("hi", "#ff0066"));
show("fake256.colorDepth", fake256.colorDepth);
show("fake16.colorDepth", fake16.colorDepth);

// ════════════════════════════════════════════════════════════════════════════
// 7. Chainable modifiers + dynamic colors
// ════════════════════════════════════════════════════════════════════════════
// Built-in modifiers (bold, italic, underline) chain. Mix them with `fg`/`bg`
// by wrapping the styled output.

section("7. Mixing chainable modifiers with dynamic colors");

show("bold + fg", bold(fg("important!", "#ef4444")));
show("italic + bg", italic(bg("  banner  ", "#1e3a8a")));
show("underline + fg + bg", underline(fg(bg(" link ", "#fef3c7"), "#92400e")));

// Or use the engine directly with pair factories. Note: `boldCode` (the
// AnsiPair) here — not `bold` (the StyleFn).
const danger = composeStyles(boldCode, fgCode("#fff"), bgCode("#dc2626"));
show("applyStyle(DANGER, danger)", applyStyle(" DANGER ", danger));

// ════════════════════════════════════════════════════════════════════════════
// 8. Runtime mode switching
// ════════════════════════════════════════════════════════════════════════════
// `setGlobalColorMode` flips the mode for the shared `style` facade and the
// top-level `fg`/`bg` re-exports. `createStyle()` instances are NOT affected.

section("8. setGlobalColorMode toggles the global style");

console.log("  Before — global mode:", getGlobalColorMode());
show("fg via global", fg("global fg", "#22c55e"));

setGlobalColorMode("never");
console.log("  After 'never' — global mode:", getGlobalColorMode());
show("fg via global", `[${fg("global fg", "#22c55e")}]`); // brackets prove no codes

setGlobalColorMode("always");
console.log("  After 'always' — global mode:", getGlobalColorMode());
show("fg via global", fg("global fg", "#22c55e"));

setGlobalColorMode("auto"); // restore for the rest of the script

// ════════════════════════════════════════════════════════════════════════════
// 9. Migration parity — old vs new (byte-identical at truecolor)
// ════════════════════════════════════════════════════════════════════════════

section("9. Migration parity — old API vs new");

// Force a truecolor instance so the comparison is deterministic regardless
// of whether stdout is a TTY at the time you run this script.
const truecolor = createStyle({ mode: "always" });
const a = truecolor.rgb("hello", 255, 136, 0); // legacy
const b = truecolor.fg("hello", [255, 136, 0]); // new
show("rgb() output bytes", JSON.stringify(a));
show("fg()  output bytes", JSON.stringify(b));
show("byte-identical?", String(a === b));

const c = truecolor.hex("hello", "#ff8800");
const d = truecolor.fg("hello", "#ff8800");
show("hex() vs fg() identical?", String(c === d));

// ════════════════════════════════════════════════════════════════════════════
// 10. Error handling — invalid input throws TypeError
// ════════════════════════════════════════════════════════════════════════════

section("10. Invalid inputs throw TypeError");

for (const bad of ["#zzzzzz", "not-a-color", "rgb(999, 0, 0, 0, 0)"]) {
	try {
		fg("x", bad);
		console.log(`  ${String(bad).padEnd(28)} (no throw — unexpected)`);
	} catch (err) {
		const e = err as Error;
		show(JSON.stringify(bad), `${e.constructor.name}: ${e.message}`);
	}
}

// Empty text + valid color → "" (no escape codes for empty content):
show('fg("", "#ff0000")', `[${fg("", "#ff0000")}]`);

// Empty text + INVALID color still throws — callers can't accidentally
// mask bugs by passing an empty string. Validation happens regardless
// of `text` length.
try {
	fg("", "definitely-not-a-color");
} catch (err) {
	show('fg("", "bad")', (err as Error).message);
}

// ════════════════════════════════════════════════════════════════════════════
// 11. Real-world snippet — a tiny themed log helper
// ════════════════════════════════════════════════════════════════════════════

section("11. Building a themed logger");

const theme = {
	info: fgCode("#38bdf8"), // sky
	success: fgCode("#22c55e"), // green
	warn: fgCode("#f59e0b"), // amber
	error: composeStyles(boldCode, fgCode("#fff"), bgCode("#dc2626")),
} as const;

function log(level: keyof typeof theme, msg: string) {
	const tag = applyStyle(` ${level.toUpperCase()} `, theme[level]);
	console.log(`${tag}  ${msg}`);
}

log("info", "build started");
log("success", "23 packages compiled");
log("warn", "1 deprecation in @crustjs/style");
log("error", "type-check failed in apps/docs");

console.log(
	"\n  ✓ Playground complete. Edit this file and re-run to explore.\n",
);
