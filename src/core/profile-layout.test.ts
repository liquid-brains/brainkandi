import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(function () { return(new Map<string, string>()); });
const setItem = vi.hoisted(function () { return(vi.fn()); });
vi.mock('@react-native-async-storage/async-storage', function () {
	return({ default: {
		getItem: async function (key: string): Promise<string | null> { return(storage.get(key) ?? null); },
		setItem: setItem
	} });
});

import { addProfileFolder, addProfileToFolder, AsyncStorageProfileLayoutStore, decodeProfileLayout, deleteProfileFolder, moveProfileTo, moveProfileToFolderEnd, reconcileProfileLayout, renameProfileFolder, toggleProfileFolder } from './profile-layout';
import type { ProfileLayout, ProfileTile } from './profile-layout';
import type { ProfileID } from './profiles';

const a = 'a' as ProfileID;
const b = 'b' as ProfileID;
const c = 'c' as ProfileID;
const d = 'd' as ProfileID;
function tile(profileID: ProfileID): ProfileTile {
	return({ kind: 'profile', profileID: profileID });
}

beforeEach(function (): void {
	storage.clear();
	setItem.mockReset();
	setItem.mockImplementation(async function (key: string, value: string): Promise<void> { storage.set(key, value); });
});

describe('profile launcher layout', function () {
	it('starts in creation order and appends newly created or imported profiles', function () {
		expect(reconcileProfileLayout([], [a, b])).toEqual([tile(a), tile(b)]);
		expect(reconcileProfileLayout([tile(b), null, tile(a)], [a, b, c])).toEqual([tile(b), tile(a), tile(c)]);
	});

	it('moves profiles before or after another profile, joining its folder', function () {
		const folder = { kind: 'folder' as const, id: 'folder', name: 'Favorites', profiles: [a, b] };
		expect(moveProfileTo([folder, tile(c)], c, a, false)).toEqual([{ ...folder, profiles: [c, a, b] }]);
		expect(moveProfileTo([folder, tile(c)], c, b, true)).toEqual([{ ...folder, profiles: [a, b, c] }]);
		expect(moveProfileTo([folder, tile(c)], a, c, true)).toEqual([{ ...folder, profiles: [b] }, tile(c), tile(a)]);
		expect(moveProfileTo([tile(a), tile(b), tile(c)], a, c, true)).toEqual([tile(b), tile(c), tile(a)]);
	});

	it('ignores moves onto itself or unknown profiles', function () {
		const layout = [tile(a), tile(b)];
		expect(moveProfileTo(layout, a, a, true)).toBe(layout);
		expect(moveProfileTo(layout, a, d, true)).toBe(layout);
		expect(moveProfileTo(layout, d, a, true)).toBe(layout);
	});

	it('moves profiles to the end of a folder or out to the unfiled list', function () {
		const folder = { kind: 'folder' as const, id: 'folder', name: 'Favorites', profiles: [a, b] };
		expect(moveProfileToFolderEnd([folder, tile(c)], c, 'folder')).toEqual([{ ...folder, profiles: [a, b, c] }]);
		expect(moveProfileToFolderEnd([folder, tile(c)], a, 'folder')).toEqual([{ ...folder, profiles: [b, a] }, tile(c)]);
		expect(moveProfileToFolderEnd([folder, tile(c)], a, undefined)).toEqual([{ ...folder, profiles: [b] }, tile(c), tile(a)]);
		const layout = [folder, tile(c)];
		expect(moveProfileToFolderEnd(layout, c, 'missing')).toBe(layout);
	});

	it('adds, renames and collapses folders', function () {
		const layout = addProfileFolder([tile(a)], 'f', '  Fav ');
		expect(layout).toEqual([tile(a), { kind: 'folder', id: 'f', name: 'Fav', profiles: [] }]);
		expect(addProfileFolder(layout, 'g', ' ')).toBe(layout);
		expect(renameProfileFolder(layout, 'f', 'Best')[1]).toMatchObject({ name: 'Best' });
		expect(renameProfileFolder(layout, 'f', ' ')).toBe(layout);
		const collapsed = toggleProfileFolder(layout, 'f');
		expect(collapsed[1]).toMatchObject({ collapsed: true });
		expect(toggleProfileFolder(collapsed, 'f')).toEqual(layout);
	});

	it('persists collapsed folders', async function () {
		const store = new AsyncStorageProfileLayoutStore();
		const layout: ProfileLayout = [{ kind: 'folder', id: 'f', name: 'Fav', profiles: [a], collapsed: true }];
		await store.save(layout);
		expect(await store.load()).toEqual(layout);
	});

	it('removes deleted profiles while preserving folders that are empty', function () {
		const layout: ProfileLayout = [tile(a), { kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b, c] }];
		expect(reconcileProfileLayout(layout, [b])).toEqual([{ kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b] }]);
		expect(reconcileProfileLayout(layout, [a])).toEqual([tile(a), { kind: 'folder', id: 'folder', name: 'Favorites', profiles: [] }]);
	});

	it('adds newly created profiles to the folder that was open during creation', function () {
		const layout: ProfileLayout = [tile(a), { kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b] }, tile(c)];
		expect(addProfileToFolder(layout, 'folder', d)).toEqual([
			tile(a),
			{ kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b, d] },
			tile(c)
		]);
		expect(addProfileToFolder([tile(d), ...layout], 'folder', d)).toEqual([
			tile(a),
			{ kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b, d] },
			tile(c)
		]);
		expect(addProfileToFolder(layout, 'missing', d)).toBe(layout);
	});

	it('deletes folders while returning their profiles to the main layout', function () {
		const layout: ProfileLayout = [tile(a), { kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b, c] }, tile(d)];
		expect(deleteProfileFolder(layout, 'folder')).toEqual([tile(a), tile(b), tile(c), tile(d)]);
		expect(deleteProfileFolder(layout, 'missing')).toBe(layout);
	});

	it('persists newly created empty folders', async function () {
		const store = new AsyncStorageProfileLayoutStore();
		const layout: ProfileLayout = [{ kind: 'folder', id: 'folder', name: 'New folder', profiles: [] }];
		await store.save(layout);
		expect(await store.load()).toEqual(layout);
		expect(reconcileProfileLayout(layout, [a])).toEqual([...layout, tile(a)]);
	});

	it('persists positions, folder names and child order independently of profiles', async function () {
		const store = new AsyncStorageProfileLayoutStore();
		expect(await store.load()).toEqual([]);
		const layout: ProfileLayout = [{ kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b, a] }, tile(c)];
		await store.save(layout);
		expect(await new AsyncStorageProfileLayoutStore().load()).toEqual(layout);
	});

	it('loads legacy grid layouts as compact lists while preserving folder IDs, names and contents', async function () {
		const folder = { kind: 'folder', id: 'existing-folder', name: 'Favorites', profiles: [b, a] };
		storage.set('brainkandi.profile-layout.v1', JSON.stringify({ version: 1, slots: [null, folder, null, tile(c), null] }));
		const store = new AsyncStorageProfileLayoutStore();
		const layout = await store.load();
		expect(layout).toEqual([folder, tile(c)]);
		await store.save(layout);
		expect(JSON.parse(storage.get('brainkandi.profile-layout.v1')!)).toEqual({ version: 1, slots: [folder, tile(c)] });
	});

	it.each([
		'null', '{}', '{"version":2,"slots":[]}', '{"version":1,"slots":[{}]}',
		'{"version":1,"slots":[{"kind":"profile","profileID":2}]}',
		'{"version":1,"slots":[{"kind":"profile","profileID":"a"},{"kind":"profile","profileID":"a"}]}',
		'{"version":1,"slots":[{"kind":"folder","id":"f","name":" ","profiles":["a"]}]}',
		'{"version":1,"slots":[{"kind":"folder","id":"f","name":"Folder","profiles":["a"]},{"kind":"folder","id":"f","name":"Folder","profiles":["b"]}]}'
	])('rejects malformed layout %s', function (serialized) {
		expect(function () { decodeProfileLayout(serialized); }).toThrow();
	});

	it('surfaces failed writes without replacing the saved layout', async function () {
		const store = new AsyncStorageProfileLayoutStore();
		await store.save([tile(a)]);
		setItem.mockRejectedValueOnce(new Error('Storage unavailable.'));
		await expect(store.save([tile(b)])).rejects.toThrow('Storage unavailable.');
		expect(await store.load()).toEqual([tile(a)]);
	});
});
