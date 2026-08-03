# .flags() replaces local flags instead of merging

Repeated `.flags()` calls on a builder replace the command's local flag
definitions; they do not merge. Additive merge (the Commander/yargs
convention) would require record-intersection types on every call —
the same TypeScript type-check cost the builder already avoids by
omitting compile-time inherited/local collision checks. The intended
idiom is a single `.flags()` call carrying all definitions, which is
also the best-inferring form. The docs carry a prominent callout so
migrating users don't lose flags to `.flags(a).flags(b)`.
