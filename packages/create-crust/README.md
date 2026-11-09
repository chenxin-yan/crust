# create-crust

Scaffold a new Crust CLI project for Bun or Node.js

## Usage

```sh
npm create crust@latest my-cli
# or
pnpm create crust@latest my-cli
# or
bun create crust@latest my-cli
```

The initializer prompts for the runtime, build output, dependency installation, and Git initialization. Pass flags to skip the prompts:

```sh
npx create-crust@latest my-cli --runtime node --artifact binary --no-git
```

See [options](https://crustjs.com/docs/quick-start#create-crust-options) for every flag and default.

## Documentation

Full docs: [crustjs.com/docs/quick-start](https://crustjs.com/docs/quick-start)

## License

MIT
