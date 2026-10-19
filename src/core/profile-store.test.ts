import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(function () { return(new Map<string, string>()); });

vi.mock('@react-native-async-storage/async-storage', function () {
	return({
		default: {
			getItem: async function (key: string): Promise<string | null> { return(storage.get(key) ?? null); },
			setItem: async function (key: string, value: string): Promise<void> { storage.set(key, value); }
		}
	});
});

import { AsyncStorageProfileStore } from './profile-store';
import { defaultFormValues, randomFormFromProfile, randomParametersFromProfile, randomProfileFromForm } from './random-profile-form';

beforeEach(function (): void { storage.clear(); });

describe('saving invalid random profiles', function () {
	it.each(['61', '', 'bad duration'])('saves and reloads %s, then runs only after correction', async function (duration) {
		const store = new AsyncStorageProfileStore();
		const input = { ...defaultFormValues, duration: duration };
		const saved = await store.save(randomProfileFromForm('Draft', input));
		const reloaded = (await new AsyncStorageProfileStore().list())[0];

		expect(reloaded).toEqual(saved);
		if (reloaded?.profile.kind !== 'random') {
			expect.fail('Saved profile must remain random.');
		}
		const reloadedProfile = reloaded.profile;
		expect(randomFormFromProfile(reloadedProfile)).toEqual(input);
		expect(function (): void { randomParametersFromProfile(reloadedProfile); }).toThrow();

		await store.save(randomProfileFromForm('Corrected', defaultFormValues), saved.id);
		const corrected = (await store.list())[0];
		if (corrected?.profile.kind !== 'random') {
			expect.fail('Corrected profile must remain random.');
		}
		expect(randomParametersFromProfile(corrected.profile).duration).toBe(5);
	});

	it('keeps invalid drafts from blocking other profiles from saving or loading', async function () {
		const store = new AsyncStorageProfileStore();
		await store.save(randomProfileFromForm('Invalid', { ...defaultFormValues, powerMin: '' }));
		const valid = await store.save(randomProfileFromForm('Valid', defaultFormValues));
		await store.save({ kind: 'file', name: 'File', fileName: 'file.vnp0', fileData: {} });

		expect(await store.list()).toHaveLength(3);
		expect((await store.list())[1]).toEqual(valid);
	});

	it.each(['101', 'invalid percentage'])('saves invalid Off %% %s and clears it after correction', async function (offPercentage) {
		const store = new AsyncStorageProfileStore();
		const input = { ...defaultFormValues, frequencyOffPercentage: offPercentage };
		const saved = await store.save(randomProfileFromForm('Off draft', input));
		const reloaded = (await store.list())[0]?.profile;
		if (reloaded?.kind !== 'random') {
			expect.fail('Saved profile must remain random.');
		}
		expect(randomFormFromProfile(reloaded)).toEqual(input);
		expect(function (): void { randomParametersFromProfile(reloaded); }).toThrow();
		await store.save(randomProfileFromForm('Off corrected', { ...input, frequencyOffPercentage: '25' }), saved.id);
		const corrected = (await store.list())[0]?.profile;
		if (corrected?.kind !== 'random') {
			expect.fail('Corrected profile must remain random.');
		}
		expect(randomParametersFromProfile(corrected).frequency.offPercentage).toBe(25);
	});
});

describe('copying saved profiles', function () {
	it('saves identical profile data under a new identifier', async function () {
		const store = new AsyncStorageProfileStore();
		const original = await store.save({
			kind: 'file',
			name: 'Session',
			fileName: 'session.vnp0',
			fileData: { modules: [{ module_no: 1 }] }
		});
		const copy = await store.save({ ...original.profile, name: `Copy of ${original.profile.name}` });

		expect(copy.id).not.toBe(original.id);
		expect(copy.profile).toEqual({ ...original.profile, name: 'Copy of Session' });
		expect(await store.list()).toEqual([original, copy]);
	});
});
