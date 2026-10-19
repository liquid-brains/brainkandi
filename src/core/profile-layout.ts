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
			if (slot.kind === 'folder' && 'id' in slot && typeof slot.id === 'string' && slot.id !== '' && !folders.has(slot.id) && 'name' in slot && typeof slot.name === 'string' && slot.name.trim() !== '' && 'profiles' in slot && Array.isArray(slot.profiles)) {
				folders.add(slot.id);
				return({ kind: 'folder', id: slot.id, name: slot.name.trim(), profiles: slot.profiles.map(profileID) });
			}
		}
		throw(new Error('Saved profile layout contains an invalid item.'));
	}).filter(function (slot) { return(slot !== null); }));
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
		return({ ...slot, profiles: profiles });
	}).filter(function (slot) { return(slot !== null); });
	for (const id of remaining) {
		updated.push({ kind: 'profile', profileID: id });
	}
	return(updated);
}

export function dropProfileTile(layout: ProfileLayout, from: number, to: number): ProfileLayout {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || to >= layout.length) {
		return(layout);
	}
	const source = layout[from];
	if (source === undefined || source === null || from === to) {
		return(layout);
	}
	const target = layout[to] ?? null;
	const updated = [...layout];
	if (source.kind === 'profile' && target?.kind === 'folder') {
		updated[to] = { ...target, profiles: [...target.profiles, source.profileID] };
		updated[from] = null;
	} else {
		updated.splice(from, 1);
		updated.splice(to, 0, source);
	}
	return(updated.filter(function (slot) { return(slot !== null); }));
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
		return({ ...folder, profiles: profiles });
	}).filter(function (slot) { return(slot !== null); });
	const tile: ProfileTile = { kind: 'profile', profileID: profileID };
	updated.push(tile);
	return(updated);
}

export function deleteProfileFolder(layout: ProfileLayout, folderID: string): ProfileLayout {
	const folder = layout.find(function (slot): boolean { return(slot?.kind === 'folder' && slot.id === folderID); });
	if (folder?.kind !== 'folder') {
		return(layout);
	}
	return(layout.flatMap(function (slot): ProfileTile[] | (ProfileTile | ProfileFolder)[] {
		if (slot === folder) {
			return(folder.profiles.map(function (profileID): ProfileTile { return({ kind: 'profile', profileID: profileID }); }));
		}
		return(slot === null ? [] : [slot]);
	}));
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
