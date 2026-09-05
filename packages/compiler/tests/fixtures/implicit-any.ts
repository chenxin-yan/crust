function echo(value) {
	return this ?? value;
}
echo("hello");
