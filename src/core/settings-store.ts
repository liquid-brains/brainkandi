import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppSettings = {
	useSystemColors: boolean;
};

export const defaultSettings: AppSettings = { useSystemColors: false };
const settingsStorageKey = 'brainkandi.settings.v1';

export function encapsulateSettings(settings: AppSettings): string {
	if (typeof settings.useSystemColors !== 'boolean') {
		throw(new Error('Use system colors must be a boolean.'));
	}
	return(JSON.stringify({ version: 1, useSystemColors: settings.useSystemColors }));
}

export function decapsulateSettings(serialized: string): AppSettings {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw(new Error('Saved settings are not valid JSON.'));
	}
	if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 || !('useSystemColors' in value) || typeof value.useSystemColors !== 'boolean') {
		throw(new Error('Saved settings have an unsupported format.'));
	}
	return({ useSystemColors: value.useSystemColors });
}

export class AsyncStorageSettingsStore {
	public async load(): Promise<AppSettings> {
		const serialized = await AsyncStorage.getItem(settingsStorageKey);
		if (serialized === null) {
			return({ ...defaultSettings });
		}
		return(decapsulateSettings(serialized));
	}

	public async save(settings: AppSettings): Promise<void> {
		await AsyncStorage.setItem(settingsStorageKey, encapsulateSettings(settings));
	}
}
