---
"@crustjs/create": minor
---

`scaffold()` resolves a string `template` from the current working directory, exactly like `dest`. It no longer infers a package root from `process.argv[1]`. For templates shipped inside a generator package, use a module-relative `file:` URL such as `new URL("../templates/base", import.meta.url)`; a non-`file:` URL now fails with Node's standard `ERR_INVALID_URL_SCHEME` error.

Template traversal lists files by path relative to the template directory instead of relying on `Dirent.parentPath`, so templates inside Yarn PnP zip archives copy into the destination instead of failing with `EACCES` at the filesystem root. Symlinked files are still skipped.
