---
"@crustjs/effect": minor
---

Breaking: service(factory) now requires the provided Context to come from that same factory, including its .of() doubles. Different same-name factories fail through CrustDefinitionError rather than returning a value with an unchecked type. Add a typechecked Effect documentation example.
