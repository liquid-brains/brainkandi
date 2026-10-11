import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(function () { return(new Map<string, string>()); });
const setItem = vi.hoisted(function () { return(vi.fn()); });

vi.mock('@react-native-async-storage/async-storage', function () {
	return({
		default: {
			getItem: async function (key: string): Promise<string | null> { return(storage.get(key) ?? null); },
			setItem: setItem
		}
	});
});

import { AsyncStorageSettingsStore, decapsulateSettings, encapsulateSettings } from './settings-store';

beforeEach(function (): void {
	storage.clear();
	setItem.mockReset();
	setItem.mockImplementation(async function (key: string, value: string): Promise<void> {
		storage.set(key, value);
	});
});

describe('app settings', function () {
	it('defaults system colors off without existing storage', async function () {
		expect(await new AsyncStorageSettingsStore().load()).toEqual({ useSystemColors: false });
	});

	it.each([false, true])('round-trips useSystemColors %s', async function (useSystemColors) {
		const settings = { useSystemColors: useSystemColors };
		expect(decapsulateSettings(encapsulateSettings(settings))).toEqual(settings);
		await new AsyncStorageSettingsStore().save(settings);
		expect(await new AsyncStorageSettingsStore().load()).toEqual(settings);
	});

	it('persists toggling system colors back off', async function () {
		const store = new AsyncStorageSettingsStore();
		await store.save({ useSystemColors: true });
		await store.save({ useSystemColors: false });
		expect(await new AsyncStorageSettingsStore().load()).toEqual({ useSystemColors: false });
	});

	it.each(['bad JSON', 'null', '[]', '{"version":2,"useSystemColors":true}', '{"version":1}', '{"version":1,"useSystemColors":"false"}'])('reports malformed settings: %s', function (serialized) {
		expect(function (): void { decapsulateSettings(serialized); }).toThrow();
	});

	it('surfaces storage failures without claiming the setting was saved', async function () {
		setItem.mockRejectedValueOnce(new Error('Storage unavailable.'));
		await expect(new AsyncStorageSettingsStore().save({ useSystemColors: true })).rejects.toThrow('Storage unavailable.');
		expect(await new AsyncStorageSettingsStore().load()).toEqual({ useSystemColors: false });
	});
});
