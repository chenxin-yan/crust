---
"@crustjs/crust": minor
---

**Breaking:** a platform package of a binary release no longer declares a `bin`. Users install the root package, whose launcher starts the binary; a platform package installed on its own provides no command. This also fixes npm 10, which dropped the root's command when an optional platform package it skipped declared a `bin` of the same name, so the npm installation caveat is gone from the docs. `crust publish` refuses a staged platform package that declares a `bin`.
