import { createAudioPlayer } from 'expo-audio';
import { Platform, Vibration } from 'react-native';

export type SessionSound = 'start' | 'switch' | 'end';

const sources: Record<SessionSound, number> = {
	start: require('../../assets/sounds/start.wav') as number,
	switch: require('../../assets/sounds/switch.wav') as number,
	end: require('../../assets/sounds/end.wav') as number
};

export function playSessionSound(sound: SessionSound): void {
	try {
		const player = createAudioPlayer(sources[sound]);
		player.addListener('playbackStatusUpdate', function (status): void {
			if (status.didJustFinish) {
				player.remove();
			}
		});
		player.play();
	} catch {
		// Sounds are optional; never interrupt a session because one failed.
	}
}

const vibrationPatterns: Record<SessionSound, number[]> = {
	start: [0, 200],
	switch: [0, 100, 100, 100],
	end: [0, 400]
};

export function vibrationAvailable(): boolean {
	return(Platform.OS !== 'web');
}

export function vibrateForSessionEvent(sound: SessionSound): void {
	if (!vibrationAvailable()) {
		return;
	}
	try {
		Vibration.vibrate(vibrationPatterns[sound]);
	} catch {
		// Vibration is optional; never interrupt a session because it failed.
	}
}
