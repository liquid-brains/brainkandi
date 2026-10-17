import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWithSessionBackground } from './session-background';

const { platform, background } = vi.hoisted(function () {
	return({
		platform: { OS: 'android' },
		background: { start: vi.fn(), stop: vi.fn() }
	});
});

vi.mock('react-native', function () { return({ Platform: platform }); });
vi.mock('react-native-background-actions', function () { return({ default: background }); });

beforeEach(function (): void {
	platform.OS = 'android';
	background.start.mockImplementation(async function (task: () => Promise<void>): Promise<void> {
		void task();
	});
	background.stop.mockResolvedValue(undefined);
});

afterEach(function (): void {
	vi.resetAllMocks();
	vi.useRealTimers();
});

describe('session background execution', function () {
	it('keeps the service active across minute boundaries and removes it on completion', async function () {
		vi.useFakeTimers();
		const nextMinute = vi.fn();
		const running = runWithSessionBackground(async function (): Promise<void> {
			await new Promise<void>(function (resolve): void { setTimeout(resolve, 60000); });
			nextMinute();
			await new Promise<void>(function (resolve): void { setTimeout(resolve, 60000); });
		});
		await vi.waitFor(function (): void { expect(background.start).toHaveBeenCalledOnce(); });
		expect(background.start.mock.calls[0]?.[1]).toEqual({
			taskName: 'BrainKandiSession',
			taskTitle: 'Brain Kandi',
			taskDesc: 'Keeping your session running in the background.',
			taskIcon: { name: 'ic_launcher', type: 'mipmap' },
			foregroundServiceType: ['connectedDevice']
		});
		await vi.advanceTimersByTimeAsync(60000);
		expect(nextMinute).toHaveBeenCalledOnce();
		expect(background.stop).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(60000);
		await running;
		expect(background.stop).toHaveBeenCalledOnce();
	});

	it('cleans up and propagates session failures', async function () {
		const error = new Error('Device disconnected.');
		await expect(runWithSessionBackground(async function (): Promise<void> {
			throw(error);
		})).rejects.toBe(error);
		expect(background.stop).toHaveBeenCalledOnce();
	});

	it('cleans up when the in-app Stop action aborts the session', async function () {
		const controller = new AbortController();
		const running = runWithSessionBackground(function (): Promise<void> {
			return(new Promise(function (_, reject): void {
				controller.signal.addEventListener('abort', function (): void {
					reject(new Error('Session stopped.'));
				}, { once: true });
			}));
		});
		await vi.waitFor(function (): void { expect(background.start).toHaveBeenCalledOnce(); });
		controller.abort();
		await expect(running).rejects.toThrow('Session stopped.');
		expect(background.stop).toHaveBeenCalledOnce();
	});

	it('does not run a session if the foreground service cannot start', async function () {
		const error = new Error('Service unavailable.');
		background.start.mockRejectedValue(error);
		const operation = vi.fn();
		await expect(runWithSessionBackground(operation)).rejects.toBe(error);
		expect(operation).not.toHaveBeenCalled();
		expect(background.stop).toHaveBeenCalledOnce();
	});

	it.each(['web', 'ios'])('preserves execution without loading an Android service on %s', async function (os): Promise<void> {
		platform.OS = os;
		const operation = vi.fn().mockResolvedValue(undefined);
		await runWithSessionBackground(operation);
		expect(operation).toHaveBeenCalledOnce();
		expect(background.start).not.toHaveBeenCalled();
		expect(background.stop).not.toHaveBeenCalled();
	});
});
