import AsyncStorage from '@react-native-async-storage/async-storage';

import { decapsulateProfiles, decapsulateSharedProfileDocument, encapsulateProfiles } from './profile-codec';
import { createProfileID } from './profiles';
import type { ProfileID, SessionProfile, StoredProfile } from './profiles';
import { resolveSequenceProfile, sequenceExternalProfiles } from './sequences';

const profilesStorageKey = 'brainkandi.profiles.v1';

export interface ProfileStore {
	list(): Promise<StoredProfile[]>;
	save(profile: SessionProfile, profileID?: ProfileID): Promise<StoredProfile>;
	remove(profileID: ProfileID): Promise<void>;
	importSharedProfile(serialized: string): Promise<StoredProfile>;
}

export class AsyncStorageProfileStore implements ProfileStore {
	public async list(): Promise<StoredProfile[]> {
		const serialized = await AsyncStorage.getItem(profilesStorageKey);
		if (serialized === null) {
			return([]);
		}
		return(decapsulateProfiles(serialized));
	}

	public async save(profile: SessionProfile, profileID?: ProfileID): Promise<StoredProfile> {
		const profiles = await this.list();
		const storedProfile: StoredProfile = {
			id: profileID ?? createProfileID(),
			profile: profile
		};
		const existingIndex = profiles.findIndex(function (existingProfile): boolean {
			return(existingProfile.id === storedProfile.id);
		});
		if (existingIndex === -1) {
			profiles.push(storedProfile);
		} else {
			profiles[existingIndex] = storedProfile;
		}
		for (const item of profiles) {
			resolveSequenceProfile(item.profile, profiles);
		}
		await AsyncStorage.setItem(profilesStorageKey, encapsulateProfiles(profiles));
		return(storedProfile);
	}

	public async importSharedProfile(serialized: string): Promise<StoredProfile> {
		const document = decapsulateSharedProfileDocument(serialized);
		const profiles = await this.list();
		const missing = (document.external ?? []).filter(function (item): boolean {
			return(!profiles.some(function (existing): boolean { return(existing.id === item.id); }));
		});
		const candidates = [...profiles, ...missing];
		const used = new Set(sequenceExternalProfiles(document.profile, candidates).map(function (item): ProfileID { return(item.id); }));
		const imported: StoredProfile = { id: createProfileID(), profile: document.profile };
		const updated = [...profiles, ...missing.filter(function (item): boolean { return(used.has(item.id)); }), imported];
		for (const item of updated) {
			resolveSequenceProfile(item.profile, updated);
		}
		await AsyncStorage.setItem(profilesStorageKey, encapsulateProfiles(updated));
		return(imported);
	}

	public async remove(profileID: ProfileID): Promise<void> {
		const profiles = await this.list();
		const remainingProfiles = profiles.filter(function (profile): boolean {
			return(profile.id !== profileID);
		});
		if (remainingProfiles.length === profiles.length) {
			throw(new Error('Profile does not exist.'));
		}
		await AsyncStorage.setItem(profilesStorageKey, encapsulateProfiles(remainingProfiles));
	}
}
