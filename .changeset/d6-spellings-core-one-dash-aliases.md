---
"@crustjs/core": patch
---

`DocumentationFlag.spellings` now lists the single-dash form of one-character names and aliases, which the parser already accepts. `{ name: "port", short: "p", aliases: ["P", "listen"] }` documents `-p, -P, --port, --P, --listen`, so help, man pages, and skills show `-P` too.
