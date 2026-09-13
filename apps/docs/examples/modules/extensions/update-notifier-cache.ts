import {
  updateNotifier,
  type UpdateNotifierCacheAdapter,
  type UpdateNotifierState,
} from "@crustjs/extensions";

let state: UpdateNotifierState | undefined;
const adapter: UpdateNotifierCacheAdapter = {
  read: async () => state,
  write: async (nextState) => {
    state = nextState;
  },
};

updateNotifier({ packageName: "my-cli", cache: { adapter } });
