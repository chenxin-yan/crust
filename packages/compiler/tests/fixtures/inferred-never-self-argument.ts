// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Unknown accepts the self-reference without introducing any.
function stop(value: unknown): never {
	throw new Error(String(value));
}

function wrapper() {
	return stop(wrapper);
}

wrapper();
