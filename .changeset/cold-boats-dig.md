---
"@crustjs/core": minor
---

Breaking: replace config-based Context definitions with immutable fluent authoring: defineContext(name).use(...factories).flags(...defs).setup((input, options) => value). The terminal .setup() returns the same callable ContextFactory with .of(value). Factory options move out of the setup input into setup's optional second parameter, so annotating only `options: T` keeps ctx, flags, and the value inferred; optional or defaulted options can be omitted when calling the factory. Remove the defineContext(name, setup) and defineContext(name, config, setup) forms and ContextConfig; ContextSetup drops its Options type parameter (now ContextSetup<Flags, Deps>), and ContextBuilder is exported.
