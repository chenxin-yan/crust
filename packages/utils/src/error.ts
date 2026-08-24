/** Narrows a caught Node.js system error to its stable errno contract. */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && typeof error.code === "string";
}
