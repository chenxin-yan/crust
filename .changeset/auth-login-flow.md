---
"@crustjs/auth": minor
---

`login()` can force either flow, name the profile after sign-in, and report warnings to the command that runs it. Breaking:

- `auth.login({ flow: "auto" | "device" | "browser" })` replaces `device?: boolean`. `"device"` and `"browser"` always run that login, even on CI, such as for a `--device` or `--web` flag; `"auto"`, the default, picks one as before. Replace `device: flags.device` with `flow: flags.device ? "device" : "auto"`.
- `onWarning` moves from `createAuth()` to `login()` and `token()` (new type `TokenOptions`), so a command can print the `plaintext-storage` warning on its own stderr. The call that stores a login in plaintext reports it each time; `credentialStore({ keyring: { onWarning } })` still reports once per process.
- On a client with `profiles`, `auth.login({ profile })` stores the login as another profile than the current one (new type `ProfileLoginOptions`): a name, or a function of the new tokens that returns one, such as the account name your API reports. The function runs after sign-in and before the login is stored; when it throws or returns an invalid name, nothing is stored.
- On a client with `profiles`, every login makes its profile the current one, in the write that stores the login, as `gh auth login` and `gcloud auth login` do. Before, a login under a new name was not used until `auth.profiles.use(name)`.
- `logout()` of a login that never existed, or was already logged out, reports `local: "absent"` instead of `"deleted"`.
