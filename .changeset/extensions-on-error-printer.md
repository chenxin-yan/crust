---
"@crustjs/extensions": minor
---

`json()`, `help()`, and `didYouMean()` return the function that prints from `onError`. `didYouMean()` now puts its flag suggestion in the JSON error under `--json` whatever the `.extend()` order: `deploy --regoin eu --json` prints `Unknown flag "--regoin". Did you mean "--region"?` in the JSON also when `didYouMean()` is listed after `json()`.
