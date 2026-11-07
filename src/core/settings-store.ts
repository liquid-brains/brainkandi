import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppSettings = {
	useSystemColors: boolean;
	useLiquidGlassButtons: boolean;
	showJSONCode: boolean;
	useVolumeButtonsForFeedback: boolean;
	playSessionSounds: boolean;
};

export const defaultSettings: AppSettings = { useSystemColors: false, useLiquidGlassButtons: false, showJSONCode: false, useVolumeButtonsForFeedback: false, playSessionSounds: false };
const settingsStorageKey = 'brainkandi.settings.v1';

export function encapsulateSettings(settings: AppSettings): string {
	if (typeof settings.useSystemColors !== 'boolean') {
		throw(new Error('Use system colors must be a boolean.'));
	}
	if (typeof settings.useLiquidGlassButtons !== 'boolean') {
		throw(new Error('Use liquid glass buttons must be a boolean.'));
	}
	if (typeof settings.showJSONCode !== 'boolean') {
		throw(new Error('Show JSON code must be a boolean.'));
	}
	if (typeof settings.useVolumeButtonsForFeedback !== 'boolean') {
		throw(new Error('Use volume buttons for feedback must be a boolean.'));
	}
	if (typeof settings.playSessionSounds !== 'boolean') {
		throw(new Error('Play session sounds must be a boolean.'));
	}
	return(JSON.stringify({ version: 1, useSystemColors: settings.useSystemColors, useLiquidGlassButtons: settings.useLiquidGlassButtons, showJSONCode: settings.showJSONCode, useVolumeButtonsForFeedback: settings.useVolumeButtonsForFeedback, playSessionSounds: settings.playSessionSounds }));
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
	if ('useLiquidGlassButtons' in value && typeof value.useLiquidGlassButtons !== 'boolean') {
		throw(new Error('Saved liquid glass button setting is invalid.'));
	}
	if ('showJSONCode' in value && typeof value.showJSONCode !== 'boolean') {
		throw(new Error('Saved show JSON code setting is invalid.'));
	}
	if ('useVolumeButtonsForFeedback' in value && typeof value.useVolumeButtonsForFeedback !== 'boolean') {
		throw(new Error('Saved volume button feedback setting is invalid.'));
	}
	if ('playSessionSounds' in value && typeof value.playSessionSounds !== 'boolean') {
		throw(new Error('Saved session sounds setting is invalid.'));
	}
	return({
		useSystemColors: value.useSystemColors,
		useLiquidGlassButtons: 'useLiquidGlassButtons' in value ? value.useLiquidGlassButtons === true : false,
		showJSONCode: 'showJSONCode' in value ? value.showJSONCode === true : false,
		useVolumeButtonsForFeedback: 'useVolumeButtonsForFeedback' in value ? value.useVolumeButtonsForFeedback === true : false,
		playSessionSounds: 'playSessionSounds' in value ? value.playSessionSounds === true : false
	});
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
