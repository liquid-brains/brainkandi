import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProfileID } from './profiles';

export type ProfileTile = { kind: 'profile'; profileID: ProfileID };
export type ProfileFolder = { kind: 'folder'; id: string; name: string; profiles: ProfileID[] };
export type ProfileLayout = (ProfileTile | ProfileFolder | null)[];

const layoutStorageKey = 'brainkandi.profile-layout.v1';

export function decodeProfileLayout(serialized: string): ProfileLayout {
	const value: unknown = JSON.parse(serialized);
	if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 || !('slots' in value) || !Array.isArray(value.slots)) {
		throw(new Error('Saved profile layout has an unsupported format.'));
	}
	const profiles = new Set<string>();
	const folders = new Set<string>();
	function profileID(value: unknown): ProfileID {
		if (typeof value !== 'string' || value === '' || profiles.has(value)) {
			throw(new Error('Saved profile layout contains an invalid or duplicate profile.'));
		}
		profiles.add(value);
		return(value as ProfileID);
	}
	return(value.slots.map(function (slot: unknown): ProfileTile | ProfileFolder | null {
		if (slot === null) {
			return(null);
		}
		if (typeof slot === 'object' && slot !== null && 'kind' in slot) {
			if (slot.kind === 'profile' && 'profileID' in slot) {
				return({ kind: 'profile', profileID: profileID(slot.profileID) });
			}
			if (slot.kind === 'folder' && 'id' in slot && typeof slot.id === 'string' && slot.id !== '' && !folders.has(slot.id) && 'name' in slot && typeof slot.name === 'string' && slot.name.trim() !== '' && 'profiles' in slot && Array.isArray(slot.profiles) && slot.profiles.length > 0) {
				folders.add(slot.id);
				return({ kind: 'folder', id: slot.id, name: slot.name.trim(), profiles: slot.profiles.map(profileID) });
			}
		}
		throw(new Error('Saved profile layout contains an invalid item.'));
	}));
}

export function reconcileProfileLayout(layout: ProfileLayout, profileIDs: ProfileID[]): ProfileLayout {
	const remaining = new Set(profileIDs);
	function keep(id: ProfileID): boolean {
		return(remaining.delete(id));
	}
	const updated = layout.map(function (slot): ProfileTile | ProfileFolder | null {
		if (slot === null) {
			return(null);
		}
		if (slot.kind === 'profile') {
			return(keep(slot.profileID) ? slot : null);
		}
		const profiles = slot.profiles.filter(keep);
		return(profiles.length === 0 ? null : { ...slot, profiles: profiles });
	});
	while (updated.length > 0 && updated[updated.length - 1] === null) {
		updated.pop();
	}
	for (const id of remaining) {
		updated.push({ kind: 'profile', profileID: id });
	}
	return(updated);
}

export function dropProfileTile(layout: ProfileLayout, from: number, to: number, group: boolean, folderID: string): ProfileLayout {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || to > layout.length + 3) {
		return(layout);
	}
	const source = layout[from];
	if (source === undefined || source === null || from === to) {
		return(layout);
	}
	const target = layout[to] ?? null;
	const updated = [...layout];
	while (updated.length <= to) {
		updated.push(null);
	}
	if (group && source.kind === 'profile' && target !== null) {
		if (target.kind === 'folder') {
			updated[to] = { ...target, profiles: [...target.profiles, source.profileID] };
		} else {
			updated[to] = { kind: 'folder', id: folderID, name: 'New folder', profiles: [target.profileID, source.profileID] };
		}
		updated[from] = null;
	} else {
		updated[to] = source;
		updated[from] = target;
	}
	return(updated);
}

export function moveProfileOut(layout: ProfileLayout, folderID: string, profileID: ProfileID): ProfileLayout {
	const folder = layout.find(function (slot): boolean { return(slot?.kind === 'folder' && slot.id === folderID); });
	if (folder?.kind !== 'folder' || !folder.profiles.includes(profileID)) {
		return(layout);
	}
	const updated = layout.map(function (slot) {
		if (slot !== folder) {
			return(slot);
		}
		const profiles = folder.profiles.filter(function (id): boolean { return(id !== profileID); });
		return(profiles.length === 0 ? null : { ...folder, profiles: profiles });
	});
	const empty = updated.indexOf(null);
	const tile: ProfileTile = { kind: 'profile', profileID: profileID };
	if (empty === -1) {
		updated.push(tile);
	} else {
		updated[empty] = tile;
	}
	return(updated);
}

export class AsyncStorageProfileLayoutStore {
	public async load(): Promise<ProfileLayout> {
		const serialized = await AsyncStorage.getItem(layoutStorageKey);
		return(serialized === null ? [] : decodeProfileLayout(serialized));
	}

	public async save(layout: ProfileLayout): Promise<void> {
		const serialized = JSON.stringify({ version: 1, slots: layout });
		decodeProfileLayout(serialized);
		await AsyncStorage.setItem(layoutStorageKey, serialized);
	}
}
