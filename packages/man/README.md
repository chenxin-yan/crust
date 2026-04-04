# @crustjs/man

Generate **mdoc(7)** manual pages (section 1) from a Crust CLI definition.

See the [Man module docs](https://crustjs.com/docs/modules/man) for install steps, `writeManPage`, `crust build --man`, and packaging notes.

## Roadmap (v2+)

- Optional **one man page per subcommand** (or a mode switch)
- Extra **meta** or sidecar content for long **DESCRIPTION**, **EXAMPLES**, **SEE ALSO**
- **Subprocess**-based tree export when in-process `prepareCommandTree` is not enough
