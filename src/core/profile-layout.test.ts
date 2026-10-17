import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(function () { return(new Map<string, string>()); });
const setItem = vi.hoisted(function () { return(vi.fn()); });
vi.mock('@react-native-async-storage/async-storage', function () {
	return({ default: {
		getItem: async function (key: string): Promise<string | null> { return(storage.get(key) ?? null); },
		setItem: setItem
	} });
});

import { AsyncStorageProfileLayoutStore, decodeProfileLayout, dropProfileTile, moveProfileOut, reconcileProfileLayout } from './profile-layout';
import type { ProfileLayout, ProfileTile } from './profile-layout';
import type { ProfileID } from './profiles';

const a = 'a' as ProfileID;
const b = 'b' as ProfileID;
const c = 'c' as ProfileID;
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

	it('inserts profiles in list order without swapping intermediate items or creating gaps', function () {
		const moved = dropProfileTile([tile(a), tile(b), tile(c)], 0, 2, false, 'folder');
		expect(moved).toEqual([tile(b), tile(c), tile(a)]);
		expect(dropProfileTile(moved, 2, 0, false, 'folder')).toEqual([tile(a), tile(b), tile(c)]);
		expect(dropProfileTile(moved, 0, 3, false, 'folder')).toBe(moved);
	});

	it('creates folders and adds profiles to existing folders', function () {
		const grouped = dropProfileTile([tile(a), tile(b), tile(c)], 0, 1, true, 'folder');
		expect(grouped).toEqual([{ kind: 'folder', id: 'folder', name: 'New folder', profiles: [b, a] }, tile(c)]);
		expect(dropProfileTile(grouped, 1, 0, true, 'unused')).toEqual([{ kind: 'folder', id: 'folder', name: 'New folder', profiles: [b, a, c] }]);
		expect(dropProfileTile([tile(c), grouped[0]!], 0, 1, true, 'unused')).toEqual([{ kind: 'folder', id: 'folder', name: 'New folder', profiles: [b, a, c] }]);
	});

	it('moves folders as a unit instead of nesting them', function () {
		const folder = { kind: 'folder' as const, id: 'folder', name: 'Favorites', profiles: [a, b] };
		expect(dropProfileTile([folder, tile(c)], 0, 1, true, 'unused')).toEqual([tile(c), folder]);
	});

	it('ignores invalid, empty, and same-position drops', function () {
		const layout = [tile(a), null];
		for (const [from, to] of [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 99], [0, 0.5]]) {
			expect(dropProfileTile(layout, from!, to!, true, 'folder')).toBe(layout);
		}
	});

	it('removes deleted profiles and empty folders without losing other placements', function () {
		const layout: ProfileLayout = [tile(a), { kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b, c] }];
		expect(reconcileProfileLayout(layout, [b])).toEqual([{ kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b] }]);
		expect(reconcileProfileLayout(layout, [a])).toEqual([tile(a)]);
	});

	it('appends a profile moved out of a folder and removes empty folders and legacy gaps', function () {
		const layout: ProfileLayout = [null, { kind: 'folder', id: 'folder', name: 'Favorites', profiles: [a, b] }];
		const moved = moveProfileOut(layout, 'folder', a);
		expect(moved).toEqual([{ kind: 'folder', id: 'folder', name: 'Favorites', profiles: [b] }, tile(a)]);
		expect(moveProfileOut(moved, 'folder', b)).toEqual([tile(a), tile(b)]);
		expect(moveProfileOut(layout, 'missing', a)).toBe(layout);
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
		'{"version":1,"slots":[{"kind":"folder","id":"f","name":"Folder","profiles":[]}]}',
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
