---
"@crustjs/store": minor
---

New `format: { extension, parse, stringify }` option of `createStore()`: a store file in a format other than JSON, such as TOML or INI, with a parser of your choice. The file is `<name>.<extension>`, and the lock, the atomic replace, the 16 MiB limit and validation work as for JSON. A waiter now also takes over a link left at the lock path once it is 10 seconds old, rather than following it and waiting forever.
