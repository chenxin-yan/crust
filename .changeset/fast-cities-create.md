---
"@crustjs/core": minor
---

Breaking: replace object-based extension definitions with immutable fluent authoring: defineExtension<MetaKeys>(id).use(...).provide(...).flags(...).add(...), followed by lifecycle methods. Configure extensions with .factory((extension, ...args) => extension...), preserving .id. Rename Context dependency configuration from uses to use. Remove the old object, factory-callback and curried defineExtension forms, ExtensionConfig, DefineExtensionWith, and exposed extension data fields; use ExtensionBuilder for authoring and Extension for registration.
