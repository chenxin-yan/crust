# Keep Core errors adapter-neutral

`CrustError` exposes one of four stable codes (`DEFINITION`, `PARSE`, `VALIDATION`, or `COMMAND_NOT_FOUND`), readonly serializable `details`, `cause`, and `is(code)` narrowing, but no generated `_tag`. Context and Command Handler failures pass through unchanged; the overlapping `CONFIG` and `EXECUTION` codes are removed. A future `@crustjs/effect` adapter may translate those errors into adapter-owned Effect tagged errors; Core remains independent of Effect while preserving all data required for an exact conversion.
