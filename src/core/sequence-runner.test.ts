import { afterEach, describe, expect, it, vi } from 'vitest';
import { VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';

import { SessionRunner } from './device-client';
import { createSequenceStep, resolveSequenceProfile } from './sequences';
import { decapsulateJourneys, encapsulateJourneys } from './journey-store';
import type { Journey } from './journey-store';
import type { ProfileID, SequenceProfile, StoredProfile } from './profiles';

const file: StoredProfile = { id: 'file' as ProfileID, profile: { kind: 'file', name: 'File', fileName: 'file.vnp0', fileData: { filename: 'file' } } };
const random: StoredProfile = { id: 'random' as ProfileID, profile: { kind: 'random', name: 'Profile', parameters: { duration: 1, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } } };
const sequence: SequenceProfile = { kind: 'sequence', name: 'Sequence', steps: [createSequenceStep(file, 'reference'), createSequenceStep(random, 'value'), createSequenceStep(file, 'value')] };

afterEach(function (): void { vi.restoreAllMocks(); });

describe('sequence execution and journal snapshots', function () {
	it('runs all steps in order on one device and signal and captures supplied and generated files', async function () {
		const device = new VielightDevice({ ip: '192.0.2.1' });
		const calls: string[] = [];
		const signals: (AbortSignal | undefined)[] = [];
		const runFile = vi.spyOn(device, 'runFileFromData').mockImplementation(async function (name, _, options): Promise<void> {
			calls.push(name);
			signals.push(options?.signal);
		});
		const on = vi.spyOn(device, 'on');
		const off = vi.spyOn(device, 'off');
		vi.spyOn(device, 'runRandom').mockImplementation(async function (_, options): Promise<void> {
			calls.push('random');
			signals.push(options?.signal);
			const listener = on.mock.calls.find(function (call): boolean { return(call[0] === 'run-randomupload-finish-file'); })?.[1];
			expect(listener).toBeDefined();
			listener?.({ fileName: 'random.vnp0', fileCount: 1, fileIndex: 1, data: { filename: 'random' } });
		});
		const connect = vi.fn(function (): VielightDevice { return(device); });
		const runner = new SessionRunner({ connect: connect });
		const status = vi.fn();
		const capture = vi.fn();
		await runner.runProfile('192.0.2.1', sequence, status, capture, [file, random]);
		expect(connect).toHaveBeenCalledTimes(1);
		expect(calls).toEqual(['file.vnp0', 'random', 'file.vnp0']);
		expect(runFile).toHaveBeenCalledTimes(2);
		expect(signals[0]).toBeInstanceOf(AbortSignal);
		expect(signals.every(function (signal): boolean { return(signal === signals[0]); })).toBe(true);
		expect(capture.mock.calls).toEqual([
			['file.vnp0', { filename: 'file' }],
			['random.vnp0', { filename: 'random' }],
			['file.vnp0', { filename: 'file' }]
		]);
		expect(status.mock.calls.flat()).toEqual([
			'Step 1 of 3: File',
			'Step 2 of 3: Profile',
			'Step 2 of 3: Profile. Uploaded session part 1 of 1.',
			'Step 3 of 3: File'
		]);
		expect(off).toHaveBeenCalledTimes(5);
	});

	it('does not connect if any later step is invalid', async function () {
		const connect = vi.fn();
		const runner = new SessionRunner({ connect: connect });
		const invalid: StoredProfile = { ...random, profile: { kind: 'random', name: 'Invalid', parameters: { duration: 61, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } } };
		await expect(runner.runProfile('192.0.2.1', { ...sequence, steps: [...sequence.steps, createSequenceStep(invalid, 'value')] })).rejects.toThrow('Duration');
		expect(connect).not.toHaveBeenCalled();
	});

	it('Stop aborts the active step and prevents the following steps even if the device resolves', async function () {
		const device = new VielightDevice({ ip: '192.0.2.1' });
		const runner = new SessionRunner({ connect: function (): VielightDevice { return(device); } });
		let finish: (() => void) | undefined;
		let signal: AbortSignal | undefined;
		const runFile = vi.spyOn(device, 'runFileFromData').mockImplementation(function (_, __, options): Promise<void> {
			signal = options?.signal;
			return(new Promise<void>(function (resolve): void { finish = resolve; }));
		});
		const runRandom = vi.spyOn(device, 'runRandom').mockResolvedValue();
		const running = runner.runProfile('192.0.2.1', sequence);
		runner.stopCurrentSession();
		expect(signal?.aborted).toBe(true);
		finish?.();
		await expect(running).rejects.toThrow('Session stopped');
		expect(runFile).toHaveBeenCalledTimes(1);
		expect(runRandom).not.toHaveBeenCalled();
		runFile.mockResolvedValue();
		await expect(runner.runProfile('192.0.2.1', file.profile)).resolves.toBeUndefined();
	});

	it('records Stop on the final step instead of reporting successful completion', async function () {
		const device = new VielightDevice({ ip: '192.0.2.1' });
		const runner = new SessionRunner({ connect: function (): VielightDevice { return(device); } });
		vi.spyOn(device, 'runFileFromData').mockImplementation(async function (): Promise<void> {
			runner.stopCurrentSession();
		});
		await expect(runner.runProfile('192.0.2.1', { kind: 'sequence', name: 'Last', steps: [createSequenceStep(file, 'value')] })).rejects.toThrow('Session stopped');
	});

	it('stops on a failed step and cleans up so another session can start', async function () {
		const device = new VielightDevice({ ip: '192.0.2.1' });
		const runner = new SessionRunner({ connect: function (): VielightDevice { return(device); } });
		const runFile = vi.spyOn(device, 'runFileFromData').mockRejectedValueOnce(new Error('Device disconnected.'));
		const runRandom = vi.spyOn(device, 'runRandom').mockResolvedValue();
		await expect(runner.runProfile('192.0.2.1', sequence)).rejects.toThrow('Device disconnected.');
		expect(runRandom).not.toHaveBeenCalled();
		runFile.mockResolvedValue();
		await expect(runner.runProfile('192.0.2.1', file.profile)).resolves.toBeUndefined();
	});

	it('keeps the effective run snapshot and all files immutable in the journal', function () {
		const changed: StoredProfile = { ...file, profile: { ...file.profile, name: 'Current file' } };
		const resolved = resolveSequenceProfile(sequence, [changed, random]);
		const journey: Journey = {
			id: 'sequence-run',
			profile: JSON.parse(JSON.stringify(resolved)),
			startedAt: '2026-10-04T21:00:00.000Z',
			outcome: 'completed',
			files: [{ fileName: 'file.vnp0', data: { filename: 'file' } }, { fileName: 'random.vnp0', data: { filename: 'random' } }]
		};
		changed.profile.name = 'Changed later';
		const reloaded = decapsulateJourneys(encapsulateJourneys([journey]))[0];
		expect(reloaded).toEqual(journey);
		if (reloaded?.profile.kind !== 'sequence') {
			expect.fail('Journal snapshot must contain the sequence.');
		}
		expect(reloaded.profile.steps.map(function (step): string { return(step.profile.name); })).toEqual(['Current file', 'Profile', 'File']);
	});
});
