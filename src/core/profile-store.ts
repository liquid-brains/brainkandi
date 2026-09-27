import AsyncStorage from '@react-native-async-storage/async-storage';

import { decapsulateProfiles, encapsulateProfiles } from './profile-codec';
import { createProfileID } from './profiles';
import type { ProfileID, SessionProfile, StoredProfile } from './profiles';

const profilesStorageKey = 'brainkandi.profiles.v1';

export interface ProfileStore {
	list(): Promise<StoredProfile[]>;
	save(profile: SessionProfile, profileID?: ProfileID): Promise<StoredProfile>;
	remove(profileID: ProfileID): Promise<void>;
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
		await AsyncStorage.setItem(profilesStorageKey, encapsulateProfiles(profiles));
		return(storedProfile);
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
