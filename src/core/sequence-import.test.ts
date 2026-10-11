import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(function () { return(new Map<string, string>()); });
const writes = vi.hoisted(function () { return(vi.fn()); });
vi.mock('@react-native-async-storage/async-storage', function () {
	return({
		default: {
			getItem: async function (key: string): Promise<string | null> { return(storage.get(key) ?? null); },
			setItem: writes
		}
	});
});

import { AsyncStorageProfileStore } from './profile-store';
import { decapsulateSharedProfileDocument, encapsulateSharedProfile } from './profile-codec';
import { createSequenceStep, runnableProfileSteps, sequenceStepHasChanged } from './sequences';
import type { FileProfile, ProfileID, SequenceProfile, StoredProfile } from './profiles';

const file: FileProfile = { kind: 'file', name: 'Source', fileName: 'source.vnp0', fileData: { filename: 'source' } };
const source: StoredProfile = { id: 'source' as ProfileID, profile: file };

beforeEach(function (): void {
	storage.clear();
	writes.mockReset();
	writes.mockImplementation(async function (key: string, value: string): Promise<void> { storage.set(key, value); });
});

describe('portable sequences', function () {
	it('imports referenced externals once and never overwrites existing profiles', async function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Mixed', steps: [createSequenceStep(source, 'reference'), createSequenceStep(source, 'value')] };
		const serialized = encapsulateSharedProfile(sequence, [source]);
		const store = new AsyncStorageProfileStore();
		const imported = await store.importSharedProfile(serialized);
		expect(await store.list()).toEqual([source, imported]);
		await store.save({ ...file, name: 'Local edit', fileName: 'local.vnp0' }, source.id);
		const second = await store.importSharedProfile(serialized);
		const profiles = await store.list();
		expect(profiles).toHaveLength(3);
		expect(profiles[0]?.profile.name).toBe('Local edit');
		expect(profiles.filter(function (item): boolean { return(item.id === source.id); })).toHaveLength(1);
		expect(runnableProfileSteps(second.profile, profiles).map(function (item): string { return(item.name); })).toEqual(['Local edit', 'Source']);
	});

	it('does not create backing profiles for steps included only by value', async function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Only values', steps: [createSequenceStep(source, 'value')] };
		const serialized = encapsulateSharedProfile(sequence, [source]);
		expect(JSON.parse(serialized).external).toBeUndefined();
		const store = new AsyncStorageProfileStore();
		const imported = await store.importSharedProfile(serialized);
		const profiles = await store.list();
		expect(profiles).toEqual([imported]);
		expect(imported.profile.kind).toBe('sequence');
		if (imported.profile.kind !== 'sequence') {
			expect.fail('Imported profile must remain a sequence.');
		}
		expect(sequenceStepHasChanged(imported.profile.steps[0]!, profiles)).toBe(true);
		expect(runnableProfileSteps(imported.profile, profiles)).toEqual([file]);
	});

	it('does not create even a supplied external unless a reference uses it', async function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Value', steps: [createSequenceStep(source, 'value')] };
		const store = new AsyncStorageProfileStore();
		const imported = await store.importSharedProfile(JSON.stringify({ version: 1, profile: sequence, external: [source] }));
		expect(await store.list()).toEqual([imported]);
	});

	it('imports transitive references but not sequence backing profiles included by value', async function () {
		const nested: StoredProfile = { id: 'nested' as ProfileID, profile: { kind: 'sequence', name: 'Nested', steps: [createSequenceStep(source, 'reference')] } };
		const outer: SequenceProfile = { kind: 'sequence', name: 'Outer', steps: [createSequenceStep(nested, 'value')] };
		const store = new AsyncStorageProfileStore();
		const imported = await store.importSharedProfile(encapsulateSharedProfile(outer, [source, nested]));
		expect(await store.list()).toEqual([source, imported]);
	});

	it('imports external sequence profiles and their referenced children', async function () {
		const nested: StoredProfile = { id: 'nested' as ProfileID, profile: { kind: 'sequence', name: 'Nested', steps: [createSequenceStep(source, 'reference')] } };
		const outer: SequenceProfile = { kind: 'sequence', name: 'Outer', steps: [createSequenceStep(nested, 'reference')] };
		const store = new AsyncStorageProfileStore();
		const imported = await store.importSharedProfile(encapsulateSharedProfile(outer, [source, nested]));
		const profiles = await store.list();
		expect(profiles).toEqual([nested, source, imported]);
		expect(runnableProfileSteps(imported.profile, profiles)).toEqual([file]);
	});

	it('preserves a missing reference snapshot without inventing an external profile on import', async function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Missing', steps: [createSequenceStep(source, 'reference')] };
		const store = new AsyncStorageProfileStore();
		const imported = await store.importSharedProfile(JSON.stringify({ version: 1, profile: sequence }));
		expect(await store.list()).toEqual([imported]);
		expect(runnableProfileSteps(imported.profile, await store.list())).toEqual([file]);
	});

	it('persists references and values, follows edits, and retains snapshots after deletion', async function () {
		const store = new AsyncStorageProfileStore();
		await store.save(file, source.id);
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Mixed', steps: [createSequenceStep(source, 'reference'), createSequenceStep(source, 'value')] };
		const saved = await store.save(sequence);
		await store.save({ ...file, name: 'Edited' }, source.id);
		expect(runnableProfileSteps(saved.profile, await store.list()).map(function (item): string { return(item.name); })).toEqual(['Edited', 'Source']);
		await store.remove(source.id);
		const reloaded = (await new AsyncStorageProfileStore().list())[0];
		expect(reloaded).toEqual(saved);
		expect(runnableProfileSteps(reloaded!.profile, await store.list())).toEqual([file, file]);
	});

	it.each([null, {}, [{ id: '', profile: file }], [source, source]])('rejects malformed external documents %j', function (external) {
		expect(function (): void {
			decapsulateSharedProfileDocument(JSON.stringify({ version: 1, profile: { kind: 'sequence', name: 'Sequence', steps: [] }, external: external }));
		}).toThrow();
	});

	it('rejects a saved edit that introduces a circular reference without changing storage', async function () {
		const store = new AsyncStorageProfileStore();
		const empty: SequenceProfile = { kind: 'sequence', name: 'Root', steps: [] };
		const root = await store.save(empty);
		const cyclic: SequenceProfile = { ...empty, steps: [createSequenceStep(root, 'reference')] };
		await expect(store.save(cyclic, root.id)).rejects.toThrow('circular reference');
		expect(await store.list()).toEqual([root]);
	});

	it('writes root and missing externals atomically, and surfaces failed persistence', async function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Reference', steps: [createSequenceStep(source, 'reference')] };
		const store = new AsyncStorageProfileStore();
		writes.mockRejectedValueOnce(new Error('Cannot save.'));
		await expect(store.importSharedProfile(encapsulateSharedProfile(sequence, [source]))).rejects.toThrow('Cannot save.');
		expect(await store.list()).toEqual([]);
		writes.mockClear();
		await store.importSharedProfile(encapsulateSharedProfile(sequence, [source]));
		expect(writes).toHaveBeenCalledTimes(1);
		expect(await store.list()).toHaveLength(2);
	});
});
