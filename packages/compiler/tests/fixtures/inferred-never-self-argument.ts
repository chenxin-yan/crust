function stop(value: unknown): never {
	throw new Error(String(value));
}

function wrapper() {
	return stop(wrapper);
}

wrapper();
