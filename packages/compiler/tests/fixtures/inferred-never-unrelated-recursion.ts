function stop(): never {
	throw new Error("stop");
}
function wrapper() {
	if (process.argv.length < 0) wrapper();
	return stop();
}
wrapper();
