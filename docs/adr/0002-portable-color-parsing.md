# ADR 0002: Narrow color parsing for portable runtimes

Status: accepted

Date: 2026-08-18

## Context

`@crustjs/style` delegated color parsing and ANSI conversion to the Bun-only `Bun.color()` API. Bun and Deno share no equivalent native color parser, while maintaining the full CSS Color specification in this package would add substantial code and compatibility burden for a terminal styling API.

## Decision

Parse colors in-package and accept only:

- three- and six-digit hexadecimal strings;
- integer RGB triples as `rgb(r, g, b)`, `rgb(r g b)` (separators not mixed), or `[r, g, b]`;
- the 148 named CSS colors already represented by `NamedColor`.

The parser emits truecolor, 256-color, and 16-color ANSI sequences consistently on Bun, Deno, and Node. Other CSS notation and the former packed-number, object, alpha-tuple, and alpha-hex forms are unsupported.

## Consequences

Color parsing no longer requires Bun. Calls using `hsl()`, `lab()`, `color-mix()`, alpha colors, packed numbers, or channel objects now throw the existing `TypeError` invalid-input error. This is a breaking pre-1.0 API narrowing and is recorded in the package changeset.
