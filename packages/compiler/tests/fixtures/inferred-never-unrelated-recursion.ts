function stop(): never {
	throw new Error("stop");
}
function wrapper() {
	if (false) wrapper();
	return stop();
}
wrapper();
