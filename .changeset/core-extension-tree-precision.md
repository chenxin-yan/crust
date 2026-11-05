---
"@crustjs/core": patch
---

An `.extend()` call with an Extension whose command names are only known at runtime no longer makes every typed `run()` result `unknown`. Commands added with `.add()` or `.command()` keep their result types, since no Extension can replace them; only commands contributed by Extensions registered up to and in that call become `unknown`, because a same-id re-registration may replace them.
