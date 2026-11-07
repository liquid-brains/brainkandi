import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

type VolumeKeysModule = { setEnabled(enabled: boolean): void };

const volumeKeyEventName = 'brainkandiVolumeKey';

function nativeModule(): VolumeKeysModule | undefined {
	return(Platform.OS === 'android' ? (NativeModules.BrainKandiVolumeKeys as VolumeKeysModule | undefined) : undefined);
}

export function volumeKeysAvailable(): boolean {
	return(nativeModule() !== undefined);
}

// Captures the hardware volume buttons while enabled; returns a function that releases them.
export function captureVolumeKeys(onKey: (value: 1 | -1) => void): () => void {
	const module = nativeModule();
	if (module === undefined) {
		return(function (): void {});
	}
	const subscription = DeviceEventEmitter.addListener(volumeKeyEventName, function (direction: unknown): void {
		onKey(direction === 'up' ? 1 : -1);
	});
	module.setEnabled(true);
	return(function (): void {
		module.setEnabled(false);
		subscription.remove();
	});
}
