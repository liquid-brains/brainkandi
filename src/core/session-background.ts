import { Platform } from 'react-native';

export async function runWithSessionBackground(operation: () => Promise<void>): Promise<void> {
	if (Platform.OS !== 'android') {
		await operation();
		return;
	}
	const { default: background } = await import('react-native-background-actions');
	try {
		await new Promise<void>(function (resolve, reject): void {
			void background.start(async function (): Promise<void> {
				try {
					await operation();
					resolve();
				} catch (error) {
					reject(error);
				}
			}, {
				taskName: 'BrainKandiSession',
				taskTitle: 'Brain Kandi',
				taskDesc: 'Keeping your session running in the background.',
				taskIcon: { name: 'ic_launcher', type: 'mipmap' },
				foregroundServiceType: ['connectedDevice']
			}).catch(reject);
		});
	} finally {
		await background.stop();
	}
}
