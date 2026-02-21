/**
 * Detect whether a buffer contains binary data by checking for null bytes.
 *
 * Inspects up to the first 8192 bytes for `0x00`. Text files almost never
 * contain null bytes, so their presence is a strong indicator of binary content.
 *
 * @param buffer - The buffer to inspect.
 * @returns `true` if the buffer appears to contain binary data.
 */
export function isBinary(buffer: Buffer): boolean {
	const length = Math.min(buffer.length, 8192);
	for (let i = 0; i < length; i++) {
		if (buffer[i] === 0x00) {
			return true;
		}
	}
	return false;
}
