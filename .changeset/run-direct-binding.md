---
"@crustjs/core": minor
---

Typed `run()` binds structured input directly against the selected command definitions instead of serializing it to argv. Only own argument and flag properties count as supplied input; inherited properties do not bypass defaults or required-value validation. Positional values starting with `-` or matching subcommand names/aliases are accepted; the `PARSE` reasons `option-like-positional` and `ambiguous-positional` are removed. JSON and URL inputs retain identity, with no serialization guard or copy, removing `unserializable-json` and throwing fewer errors for untyped inputs. `ExtensionContext.argv` for `run()` contains only the typed command path. `ParseErrorDetails.value` remains available for compatibility but is no longer populated by Core.
