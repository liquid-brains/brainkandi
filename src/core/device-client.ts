import { VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';

import type { RandomSessionParameters, SessionProfile } from './profiles';

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
		return(new VielightDevice({ ip: deviceAddress }));
	}
}

export class SessionRunner {
	private activeAbortController: AbortController | undefined;
	private activeDevice: SessionDevice | undefined;

	public constructor(private readonly deviceFactory: SessionDeviceFactory) {}

	public async runProfile(deviceAddress: string, profile: SessionProfile, onStatus?: (status: string) => void, onGeneratedFile?: (fileName: string, data: Record<string, unknown>) => void): Promise<void> {
		const device = this.deviceFactory.connect(deviceAddress);
		this.beginSession(device);
		try {
			switch (profile.kind) {
				case 'file':
					await device.runFileFromData(profile.fileName, profile.fileData, { signal: this.activeSessionSignal() });
					return;
				case 'random':
					await this.runRandom(device, profile.parameters, onStatus, onGeneratedFile);
					return;
				case 'ai':
					throw(new Error('This profile type is not supported.'));
			}
		} finally {
			this.endSession(device);
		}
	}

	public async runExperiment(deviceAddress: string, parameters: RandomSessionParameters, onStatus?: (status: string) => void): Promise<void> {
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
