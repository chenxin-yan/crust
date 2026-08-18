import {
  type ExtensionContext,
  defineCommand,
  defineExtension,
  defineExtensionId,
} from "@crustjs/core";

const timers = new WeakMap<ExtensionContext, number>();

export const diagnostics = defineExtension(defineExtensionId("diagnostics"), {
  flags: [
    {
      name: "trace",
      type: "boolean",
      description: "Print diagnostic timing",
    },
  ],
  commands: [
    defineCommand("doctor", { description: "Check the installation" }, (command) =>
      command.action(({ rootCommand, stdout }) => stdout(`checking ${rootCommand.meta.name}`)),
    ),
  ],
  hooks: {
    preRun(ctx) {
      if (ctx.flags.trace === true) timers.set(ctx, performance.now());
    },
    postRun(ctx, outcome) {
      const started = timers.get(ctx);
      if (started === undefined) return;
      timers.delete(ctx);
      ctx.stderr(`${outcome.status} in ${performance.now() - started}ms`);
    },
  },
});
