import { VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';

import type { RandomSessionParameters, RestProfile, SessionProfile, StoredProfile } from './profiles';
import { randomParametersFromProfile } from './random-profile-form';
import { runnableProfileSteps } from './sequences';

export interface SessionDevice {
	runFileFromData: VielightDevice['runFileFromData'];
	runRandom: VielightDevice['runRandom'];
	stop: VielightDevice['stop'];
	on: VielightDevice['on'];
	off: VielightDevice['off'];
}

export interface SessionDeviceFactory {
	connect(deviceAddress: string): SessionDevice;
}

export class VielightDeviceFactory implements SessionDeviceFactory {
	public connect(deviceAddress: string): SessionDevice {
		return(new VielightDevice({ ip: deviceAddress, logger: console }));
	}
}

export class SessionRunner {
	private activeAbortController: AbortController | undefined;
	private activeDevice: SessionDevice | undefined;

	public constructor(private readonly deviceFactory: SessionDeviceFactory) {}

	public async runProfile(deviceAddress: string, profile: SessionProfile, onStatus?: (status: string) => void, onGeneratedFile?: (fileName: string, data: Record<string, unknown>) => void, profiles: StoredProfile[] = []): Promise<void> {
		const steps = runnableProfileSteps(profile, profiles);
		const device = this.deviceFactory.connect(deviceAddress);
		this.beginSession(device);
		try {
			for (const [index, step] of steps.entries()) {
				if (this.activeSessionSignal().aborted) {
					throw(new Error('Session stopped.'));
				}
				let setStatus = onStatus;
				if (profile.kind === 'sequence') {
					const stepName = step.kind === 'rest' ? `Rest for ${step.seconds} second(s)` : step.name;
					const prefix = `Step ${index + 1} of ${steps.length}: ${stepName}`;
					onStatus?.(prefix);
					setStatus = function (status): void { onStatus?.(`${prefix}. ${status}`); };
				}
				switch (step.kind) {
					case 'file':
						if (profile.kind === 'sequence') {
							onGeneratedFile?.(step.fileName, step.fileData);
						}
						await device.runFileFromData(step.fileName, step.fileData, { signal: this.activeSessionSignal() });
						break;
					case 'random':
						await this.runRandom(device, randomParametersFromProfile(step), setStatus, onGeneratedFile);
						break;
					case 'rest':
						onStatus?.(`Resting for ${step.seconds} second(s).`);
						await this.waitForRest(step);
						break;
				}
				if (this.activeSessionSignal().aborted) {
					throw(new Error('Session stopped.'));
				}
			}
		} finally {
			this.endSession(device);
		}
	}

	public async runExperiment(deviceAddress: string, parameters: RandomSessionParameters, onStatus?: (status: string) => void): Promise<void> {
		VielightDevice.validateRandomParams(parameters);
		const device = this.deviceFactory.connect(deviceAddress);
		this.beginSession(device);
		try {
			await this.runRandom(device, parameters, onStatus);
		} finally {
			this.endSession(device);
		}
	}

	public stopCurrentSession(): void {
		this.activeAbortController?.abort();
	}

	private beginSession(device: SessionDevice): void {
		if (this.activeAbortController !== undefined) {
			throw(new Error('A session is already running.'));
		}
		this.activeAbortController = new AbortController();
		this.activeDevice = device;
	}

	private endSession(device: SessionDevice): void {
		if (this.activeDevice === device) {
			this.activeAbortController = undefined;
			this.activeDevice = undefined;
		}
	}

	private activeSessionSignal(): AbortSignal {
		if (this.activeAbortController === undefined) {
			throw(new Error('No active session exists.'));
		}
		return(this.activeAbortController.signal);
	}

	private async waitForRest(step: RestProfile): Promise<void> {
		const signal = this.activeSessionSignal();
		await new Promise<void>(function (resolve, reject): void {
			const timeoutID = setTimeout(resolve, step.seconds * 1000);
			signal.addEventListener('abort', function (): void {
				clearTimeout(timeoutID);
				reject(new Error('Session stopped.'));
			}, { once: true });
		});
	}

	private async runRandom(device: SessionDevice, parameters: RandomSessionParameters, onStatus?: (status: string) => void, onGeneratedFile?: (fileName: string, data: Record<string, unknown>) => void): Promise<void> {
		const listenerIDs = [
			device.on('run-random-start', function (event): void {
				onStatus?.(`Preparing ${event.fileCount} session part(s) to run.`);
			}),
			device.on('run-random-upload-start-file', function (event): void {
				onStatus?.(`Uploading session part ${event.fileIndex} of ${event.fileCount}.`);
			}),
			device.on('run-randomupload-finish-file', function (event): void {
				onGeneratedFile?.(event.fileName, event.data);
				onStatus?.(`Uploaded session part ${event.fileIndex} of ${event.fileCount}.`);
			}),
			device.on('run-random-run-start-file', function (event): void {
				onStatus?.(`Running session part ${event.fileIndex} of ${event.fileCount}.`);
			}),
			device.on('run-random-run-finish-file', function (event): void {
				onStatus?.(`Finished session part ${event.fileIndex} of ${event.fileCount}.`);
			})
		];
		try {
			await device.runRandom(parameters, { signal: this.activeSessionSignal() });
		} finally {
			for (const listenerID of listenerIDs) {
				device.off(listenerID);
			}
		}
	}
}
