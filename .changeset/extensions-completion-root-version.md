---
"@crustjs/extensions": minor
---

`completion()` now requires root `version` metadata at compile time, like `version()` and `updateNotifier()`, unless it is given a string `version` option. It already threw when a script was rendered without one. To migrate, pass `new Crust(name, { version })` or `completion({ version })`.
