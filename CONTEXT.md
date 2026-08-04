# Crust — Glossary

## Flag alias

An alternate long or short spelling of a flag. An alias is a **perfect
synonym**: every operation valid on the canonical name is valid on any
alias, including boolean negation (`--no-<alias>`). Parsed values are
always reported under the canonical name.

## Negation

The automatic `--no-<spelling>` form of a boolean flag. Applies to the
canonical name and every long alias. A flag opts out with `noNegate`.
The `no-` prefix is reserved: no flag name, short, or alias may start
with it.
