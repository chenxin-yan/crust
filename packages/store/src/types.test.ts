import { describe, expect, it } from "bun:test";
import type {
	CreateStore,
	CreateStoreOptions,
	Store,
	StoreConfigShape,
	StoreValidator,
} from "./types.ts";

interface AppConfig {
	theme: "light" | "dark";
	retries: number;
	telemetry: boolean;
}

const APP_DEFAULTS: AppConfig = {
	theme: "light",
	retries: 1,
	telemetry: false,
};

const validateAppConfig: StoreValidator<AppConfig> = (input) => {
	if (typeof input !== "object" || input === null) {
		throw new Error("Expected object");
	}

	return input as AppConfig;
};

function createStoreStub<TConfig extends StoreConfigShape>(): Store<TConfig> {
	return {
		async read() {
			return undefined;
		},
		async write(_config) {},
		async update(_updater) {},
		async reset() {},
	};
}

const createStore = ((options: unknown) => {
	void options;
	return createStoreStub<StoreConfigShape>();
}) as CreateStore;

describe("CreateStoreOptions", () => {
	it("accepts defaults branch", () => {
		const options: CreateStoreOptions<AppConfig> = {
			appName: "my-cli",
			defaults: APP_DEFAULTS,
		};

		expect(options.defaults.theme).toBe("light");
	});

	it("accepts validator branch", () => {
		const options: CreateStoreOptions<AppConfig> = {
			appName: "my-cli",
			validate: validateAppConfig,
		};

		expect(typeof options.validate).toBe("function");
	});

	it("rejects missing defaults and validate", () => {
		// @ts-expect-error — strict options require defaults or validate
		const _invalid: CreateStoreOptions<AppConfig> = { appName: "my-cli" };
		expect(true).toBe(true);
	});
});

describe("CreateStore strict inference", () => {
	it("infers config shape from defaults", () => {
		const store = createStore({
			appName: "my-cli",
			defaults: APP_DEFAULTS,
		});

		const _typedStore: Store<AppConfig> = store;

		const _validWrite: Parameters<typeof store.write>[0] = {
			theme: "dark",
			retries: 2,
			telemetry: true,
		};

		const _invalidWrite: Parameters<typeof store.write>[0] = {
			theme: "dark",
			retries: 2,
			telemetry: true,
			// @ts-expect-error — unknown fields are rejected in write()
			extra: "nope",
		};

		const _updater: Parameters<typeof store.update>[0] = (current) => {
			// @ts-expect-error — unknown fields are rejected in update()
			const _missing = current.missing;
			return {
				...current,
				retries: current.retries + 1,
			};
		};

		expect(typeof _typedStore.update).toBe("function");
	});

	it("infers config shape from validator", () => {
		const store = createStore({
			appName: "my-cli",
			validate: validateAppConfig,
		});

		const _typedStore: Store<AppConfig> = store;
		expect(typeof _typedStore.write).toBe("function");
	});

	it("rejects createStore without type source", () => {
		// @ts-expect-error — strict API requires defaults or validate
		createStore<AppConfig>({ appName: "my-cli" });
		expect(true).toBe(true);
	});
});
