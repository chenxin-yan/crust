# Alias-symmetric boolean negation, parser-enforced noNegate

A flag alias is a perfect synonym, so `--no-<alias>` negates a boolean
exactly like `--no-<name>`. This is also the native behavior of
`util.parseArgs` with `allowNegative` — the parser originally carried
extra code (`validateCanonicalNegationUsage`) to _forbid_ alias
negation, which drifted out of sync with the man/completion generators
that all advertised `--no-<alias>`. We removed the restriction rather
than patching three generators; no ambiguity is possible because the
`no-` prefix is rejected at definition time for names, shorts, and
aliases. In the same change, `noNegate` was promoted from a
display-only hint to a parser-enforced contract: `--no-<any spelling>`
of a `noNegate` boolean is a PARSE error.

## Considered Options

- Canonical-only negation (previous behavior): kept ~40 lines of
  restriction code and required fixing man + bash/zsh/fish generators
  to hide alias negation; rejected as a paper cut with no payoff.
