export function isErrnoException<ErrorValue>(
	error: ErrorValue,
): error is ErrorValue & NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
