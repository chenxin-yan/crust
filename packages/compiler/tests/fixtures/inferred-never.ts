function stop(): never {
	throw new Error("stop");
}

function wrapper() {
	return stop();
}

wrapper();
