---
"@crustjs/auth": minor
---

Login profiles: one CLI can keep several named logins, such as a work account and a personal one.

- `createAuth({ ..., profiles: { env?: "ACME_PROFILE" } })` turns them on and returns a client with `profile(name?)` and `profiles` (new types `ProfileAuthClient`, `ProfileClient`, `ProfileAuthStatus`, `ProfilesOptions`, `AuthProfile`). Without `profiles`, the client, its types, its environment reads and the bytes it writes to the credentials file are unchanged. The profile variable must differ from `env`.
- `auth.profile(name)` returns `login`, `token`, `status`, and `logout` for that named login; no name means the current profile. The current profile is the profiles `env` variable's, else the one last logged in to or chosen with `auth.profiles.use(name)`, else `"default"`; the `env` token still wins over every profile.
- `auth.profiles.list()` returns `{ name, current }` for every profile `profile()` can reach with a stored login for this server and client id, from the file only. `auth.profiles.use(name)` remembers the current profile in the credentials file (`currentProfile`) and fails with `LoginRequiredError` (`missing`) for a profile without a login; logging out of it forgets it.
- `status()` adds `profile: { name, via }` with profiles on. A profile name is 1 to 64 letters, digits, `-`, `_`, and `.`, not starting with `.` or `-`; another is an `OAuthConfigError`. With profiles on, `LoginRequiredError`'s message names the profile.
- `@crustjs/auth/oauth`: nothing new; token sources ignore `currentProfile` and keep it as written.
