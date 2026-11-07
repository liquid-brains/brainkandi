import { createAudioPlayer } from 'expo-audio';

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
