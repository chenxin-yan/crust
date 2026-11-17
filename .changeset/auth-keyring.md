---
"@crustjs/auth": minor
---

Stored logins are encrypted under a key kept in the OS keyring.

- `createAuth()` encrypts the login's tokens with AES-256-GCM under one key per app in the OS keyring: `Bun.secrets` on Bun, the optional peer dependency `@napi-rs/keyring` on Node (pinned to the Secret Service on Linux). The key is created once, under an app-wide `key-init` lock, and never rewritten; the credentials file records its id. Without a keyring the tokens are stored in plaintext in the same `0600` file and the new `onWarning` option receives `{ code: "plaintext-storage" }` once per process (nothing is printed); the new `strict: true` option refuses instead. `status()` adds `storage: { kind, plaintextRecords }`.
- A missing or replaced key fails closed: reading an encrypted login throws `LoginRequiredError` with the new reasons `key-missing` or `key-mismatch`, and an unreadable keyring throws the new `CredentialKeyError` (`code` `"credential-key"`, `reason` `"unreadable"`, or `"unavailable"` when a login can't be stored). Nothing is reset or downgraded to plaintext; the next login reuses the keyring's key and logs out the logins encrypted under the old one.
- Plaintext logins are encrypted the next time a login or refresh writes them; a file that records a key never takes plaintext again.
- `@crustjs/auth/oauth`: `credentialStore()` takes `keyring: { strict?, onWarning? }` (without it, no keyring is used) and gains `status()` (`kind`, `encryption`, `keyReadable`, `plaintextRecords`); `ticket.commit()` reports `discarded`, the logins a key-replacing login logged out.
