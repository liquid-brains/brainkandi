import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrainlightError, VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';

import { fixedRandomSessionStatus, SessionRunner } from './device-client';
import { decapsulateSharedProfile, encapsulateSharedProfile } from './profile-codec';
import { defaultFormValues, formValuesFromRandomParameters, randomParametersFromForm, randomProfileFromForm } from './random-profile-form';
import type { RandomSessionParameters } from './profiles';

afterEach(function (): void {
	vi.restoreAllMocks();
});

describe('random session execution with Off %', function () {
	it('reports only values fixed for the current session minute', function () {
		const data = { modules: [{ active: true, freq: 0, power: 0 }, { active: true, freq: 18, power: 42 }] };

		expect(fixedRandomSessionStatus({ duration: 5, frequency: { ranges: [{ min: 10 }], perChannel: false }, power: { min: 1, perChannel: false } }, data)).toBe('Frequency: 18 Hz; Power: 42');
		expect(fixedRandomSessionStatus({ duration: 5, frequency: { ranges: [{ min: 10 }], perChannel: true }, power: { min: 1, perChannel: true } }, data)).toBe('');
	});

	it('passes edited and shared parameters unchanged to Brainlight', async function () {
		const parameters: RandomSessionParameters = {
			basename: 'weighted',
			duration: 5,
			sessionDuration: 1,
			frequency: { ranges: [{ min: 10, max: 20 }], offPercentage: 40, perChannel: true },
			coupling: { min: 5, distribution: 25 },
			abCoupling: { distribution: 75 },
			power: { min: 1, perChannel: true }
		};
		const profile = decapsulateSharedProfile(encapsulateSharedProfile({
			kind: 'random',
			name: 'Weighted',
			parameters: randomParametersFromForm(formValuesFromRandomParameters(parameters))
		}));
		const device = new VielightDevice({ ip: '192.0.2.1' });
		const runRandom = vi.spyOn(device, 'runRandom').mockResolvedValue();
		const runner = new SessionRunner({ connect: function (): VielightDevice { return(device); } });

		await runner.runProfile('192.0.2.1', profile);

		expect(runRandom).toHaveBeenCalledWith(parameters, { signal: expect.any(AbortSignal) });
	});

	it.each([
		{ random: 0.1, frequency: 0 },
		{ random: 0.25, frequency: 15 },
		{ random: 0.8, frequency: 40 }
	])('generates automatic range selection and Off %% at random value $random', function ({ random, frequency }) {
		vi.spyOn(Math, 'random').mockReturnValue(random);
		const parameters = randomParametersFromForm({
			...formValuesFromRandomParameters({
				duration: 5,
				frequency: { ranges: [{ min: 10, max: 20 }, { min: 40 }], offPercentage: 20 },
				power: { min: 1 }
			}),
			abCouplingDistribution: '100'
		});
		const file = VielightDevice.generateRandomParams('weighted.vnp0', parameters);

		expect(file.modules).toHaveLength(12);
		for (const module of file.modules) {
			expect(module.freq).toBe(frequency);
			expect(module.active).toBe(true);
			expect(module.power).toBe(frequency === 0 ? 0 : 1);
			expect(module.moduleControl.phase).toBe(0);
		}
	});

	it.each([false, true])('applies off and Phase B with per-channel randomization %s', function (perChannel) {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const file = VielightDevice.generateRandomParams('off.vnp0', {
			duration: 5,
			frequency: { ranges: [{ min: 10 }], offPercentage: 100, perChannel: perChannel },
			abCoupling: { distribution: 0 },
			power: { min: 1 }
		});

		for (const module of file.modules) {
			expect(module.active).toBe(true);
			expect(module.freq).toBe(0);
			expect(module.power).toBe(0);
			expect(module.moduleControl.phase).toBe(1);
		}
	});

	it('selects off independently per channel instead of disabling the whole session part', function () {
		vi.spyOn(Math, 'random')
			.mockReturnValue(0.95)
			.mockReturnValueOnce(0.5)
			.mockReturnValueOnce(0.95)
			.mockReturnValueOnce(0.5)
			.mockReturnValueOnce(0.5)
			.mockReturnValueOnce(0.1);
		const file = VielightDevice.generateRandomParams('mixed.vnp0', {
			duration: 5,
			frequency: { ranges: [{ min: 10 }], offPercentage: 40, perChannel: false },
			power: { min: 1 }
		});

		expect(file.modules[0]).toMatchObject({ active: true, freq: 10 });
		expect(file.modules[1]).toMatchObject({ active: true, freq: 0, power: 0 });
		expect(file.modules.slice(2).every(function (module): boolean { return(module.active && module.freq === 10); })).toBe(true);
	});

	it('uses equal entry weights when omitted, regardless of range size', function () {
		vi.spyOn(Math, 'random').mockReturnValue(0.6);
		const file = VielightDevice.generateRandomParams('defaults.vnp0', {
			duration: 5,
			frequency: { ranges: [{ min: 10, max: 20 }, { min: 40 }] },
			power: { min: 1 }
		});

		expect(file.modules.every(function (module): boolean { return(module.active && module.freq === 40); })).toBe(true);
	});

	it.each([false, true])('never switches channels off at 0%%, including random zero, with per-channel frequency %s', function (perChannel) {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const parameters = randomParametersFromForm({
			...defaultFormValues,
			frequencyPerChannel: perChannel
		});
		const file = VielightDevice.generateRandomParams('zero.vnp0', parameters);
		expect(file.modules.every(function (module): boolean { return(module.active && module.freq === 10); })).toBe(true);
	});

	it('applies the specified Off % probability independently of range sizes', function () {
		let seed = 12345;
		vi.spyOn(Math, 'random').mockImplementation(function (): number {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return(seed / 4294967296);
		});
		const parameters = randomParametersFromForm({
			...defaultFormValues,
			frequencyRanges: [{ min: '10', max: '20' }, { min: '40', max: '' }],
			frequencyOffPercentage: '30',
			frequencyPerChannel: true
		});
		let offCount = 0;
		let activeCount = 0;
		let secondRangeCount = 0;
		for (let index = 0; index < 1000; index++) {
			const file = VielightDevice.generateRandomParams('probability.vnp0', parameters);
			for (const module of file.modules) {
				if (module.power === 0 && module.freq === 0) {
					offCount++;
				} else {
					activeCount++;
					if (module.freq === 40) {
						secondRangeCount++;
					}
				}
			}
		}
		expect(offCount / 12000).toBeGreaterThan(0.28);
		expect(offCount / 12000).toBeLessThan(0.32);
		expect(secondRangeCount / activeCount).toBeGreaterThan(0.48);
		expect(secondRangeCount / activeCount).toBeLessThan(0.52);
	});

	it.each(['61', '', 'not a number'])('blocks invalid saved duration %s before connecting and allows a corrected profile', async function (duration) {
		const device = new VielightDevice({ ip: '192.0.2.1' });
		const connect = vi.fn(function (): VielightDevice { return(device); });
		const runRandom = vi.spyOn(device, 'runRandom').mockResolvedValue();
		const runner = new SessionRunner({ connect: connect });
		const onStatus = vi.fn();
		const profile = randomProfileFromForm('Invalid', { ...defaultFormValues, duration: duration });

		try {
			await runner.runProfile('192.0.2.1', profile, onStatus);
			expect.fail('Invalid profile must not run.');
		} catch (error) {
			expect(BrainlightError.isInstance(error)).toBe(true);
			if (BrainlightError.isInstance(error)) {
				expect(error.field).toBe('duration');
			}
		}
		expect(connect).not.toHaveBeenCalled();
		expect(runRandom).not.toHaveBeenCalled();
		expect(onStatus).not.toHaveBeenCalled();

		await runner.runProfile('192.0.2.1', randomProfileFromForm('Corrected', defaultFormValues));
		expect(runRandom).toHaveBeenCalledTimes(1);
	});
});
