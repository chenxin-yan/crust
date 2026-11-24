---
"@crustjs/core": minor
---

**Breaking:** a repeatable flag with a `delimiter` given only empty text on the command line, such as `--filter ""`, is now an empty list (`[]`) instead of counting as omitted. It used to give the flag's `default`, or nothing when it has none, so "filter to nothing" meant "filter to everything". A required flag still needs a value, and an environment variable left with no value after splitting still counts as unset.
