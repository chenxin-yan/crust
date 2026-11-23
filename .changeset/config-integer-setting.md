---
"@crustjs/config": minor
---

A setting can be `type: "integer"`, with `min` and `max`, as a flag can: `replicas: { type: "integer", min: 1 }`. A file value such as `1.5` fails with `Expected an integer for "replicas" in <file>.`, `set()` takes a number for it, and `jsonSchema()` describes it as `"type": "integer"`.
