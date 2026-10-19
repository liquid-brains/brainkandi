import { describe, expect, it } from 'vitest';

import { BrainlightError } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import { defaultFormValues, formValuesFromRandomParameters, getRandomFormValidationErrors, randomFormFromProfile, randomParametersFromForm, randomParametersFromProfile, randomProfileFromForm } from './random-profile-form';
import type { RandomSessionParameters } from './profiles';

describe('random profile editor', function () {
	it('round-trips frequency ranges, Off % and independent A/B coupling', function () {
		const parameters: RandomSessionParameters = {
			basename: 'weighted',
			duration: 5,
			sessionDuration: 59,
			frequency: {
				ranges: [{ min: 10, max: 20 }, { min: 40 }],
				offPercentage: 10,
				perChannel: true
			},
			coupling: { min: 5, max: 10, distribution: 25 },
			abCoupling: { distribution: 75 },
			power: { min: 1, max: 5, perChannel: false }
		};

		expect(randomParametersFromForm(formValuesFromRandomParameters(parameters))).toEqual(parameters);
	});

	it('defaults Off % to zero and leaves weights unset for library calculation', function () {
		const parameters = randomParametersFromForm(defaultFormValues);

		expect(parameters.sessionDuration).toBe(1);
		expect(parameters.frequency.ranges).toEqual([{ min: 10 }]);
		expect(parameters.frequency.offPercentage).toBe(0);
		expect(parameters.abCoupling).toBeUndefined();
		expect(formValuesFromRandomParameters(parameters).abCouplingDistribution).toBe('');
	});

	it('allows an omitted session duration and defaults missing profile values to one minute', function () {
		const parameters: RandomSessionParameters = {
			duration: 5,
			frequency: { ranges: [{ min: 10 }] },
			power: { min: 1 }
		};

		expect(randomParametersFromForm({ ...defaultFormValues, sessionDuration: '' }).sessionDuration).toBeUndefined();
		expect(formValuesFromRandomParameters(parameters).sessionDuration).toBe('1');
	});

	it.each(['0', '60', '1.5', 'invalid'])('rejects invalid per-session duration %s', function (sessionDuration) {
		const errors = getRandomFormValidationErrors({ ...defaultFormValues, sessionDuration: sessionDuration });

		expect(errors[0]?.field).toBe('sessionDuration');
	});

	it('supports all channels off without adding an off range', function () {
		const parameters = randomParametersFromForm({
			...defaultFormValues,
			frequencyRanges: [
				{ min: '10', max: '' }
			],
			frequencyOffPercentage: '100',
			abCouplingDistribution: '0'
		});

		expect(parameters.frequency.ranges).toEqual([{ min: 10 }]);
		expect(parameters.frequency.offPercentage).toBe(100);
		expect(parameters.abCoupling).toEqual({ distribution: 0 });
		expect(randomParametersFromForm(formValuesFromRandomParameters(parameters))).toEqual(parameters);
	});

	it.each(['invalid', 'NaN', 'Infinity', '-1', '101', '0.5'])('identifies invalid Off %% %s while allowing saving', function (offPercentage) {
		const input = { ...defaultFormValues, frequencyOffPercentage: offPercentage };
		const errors = getRandomFormValidationErrors(input);
		expect(errors[0]?.field).toBe('frequency.offPercentage');
		const profile = randomProfileFromForm('Invalid off', input);
		expect(function (): void { randomParametersFromProfile(profile); }).toThrow();
	});

	it('treats blank Off % as zero', function () {
		expect(randomParametersFromForm({ ...defaultFormValues, frequencyOffPercentage: '' }).frequency.offPercentage).toBe(0);
	});

	it.each(['invalid', '-1', '101', '0.5'])('rejects invalid Phase A probability %s', function (distribution) {
		expect(function (): void {
			randomParametersFromForm({ ...defaultFormValues, abCouplingDistribution: distribution });
		}).toThrow();
	});

	it('requires a minimum for every frequency range', function () {
		expect(function (): void {
			randomParametersFromForm({
				...defaultFormValues,
				frequencyRanges: [{ min: '', max: '' }]
			});
		}).toThrow('Frequency minimum is required');
	});

	it('rejects cross-coupling maximum without a minimum instead of discarding it', function () {
		expect(function (): void {
			randomParametersFromForm({ ...defaultFormValues, couplingMax: '10' });
		}).toThrow('Cross-coupling minimum is required');
	});

	it('reports every invalid input with the shared field ID', function () {
		const errors = getRandomFormValidationErrors({
			...defaultFormValues,
			basename: 'invalid.name',
			duration: '',
			frequencyRanges: [
				{ min: 'invalid', max: '10000' },
				{ min: '20', max: '10' }
			],
			frequencyOffPercentage: '-1',
			powerMin: '0',
			powerMax: '141',
			couplingMin: '',
			couplingMax: '10',
			couplingRandomDistribution: '101',
			abCouplingDistribution: '-1'
		});

		expect(errors.every(function (error): boolean { return(BrainlightError.isInstance(error)); })).toBe(true);
		expect(errors.map(function (error): string { return(error.field); })).toEqual(expect.arrayContaining([
			'basename', 'duration', 'power.min', 'power.max', 'coupling.min', 'coupling.distribution',
			'abCoupling.distribution', 'frequency.ranges.0.min', 'frequency.ranges.0.max',
			'frequency.offPercentage', 'frequency.ranges.1.max'
		]));
		expect(new Set(errors.map(function (error): string { return(error.field); })).size).toBe(errors.length);
	});

	it('keeps invalid numeric settings saveable but not runnable', function () {
		const form = { ...defaultFormValues, duration: '61' };
		const profile = randomProfileFromForm('Invalid', form);

		expect(profile.parameters?.duration).toBe(61);
		expect(randomFormFromProfile(profile)).toEqual(form);
		expect(function (): void { randomParametersFromProfile(profile); }).toThrow();
	});

	it('preserves incomplete and nonnumeric settings as draft input', function () {
		const input = { ...defaultFormValues, duration: '', powerMin: 'not a number' };
		const profile = randomProfileFromForm('Draft', input);

		expect(profile.input).toEqual(input);
		expect(profile.parameters).toBeUndefined();
		expect(randomFormFromProfile(profile)).toEqual(input);
		expect(function (): void { randomParametersFromProfile(profile); }).toThrow();
	});

	it('clears only corrected errors and reindexes removed frequency entries', function () {
		const input = {
			...defaultFormValues,
			duration: '61',
			frequencyRanges: [
				{ min: '0', max: '' },
				{ min: '10000', max: '' }
			]
		};
		const corrected = {
			...input,
			duration: '5',
			frequencyRanges: input.frequencyRanges.slice(1)
		};

		expect(getRandomFormValidationErrors(corrected).map(function (error): string { return(error.field); })).toEqual(['frequency.ranges.0.min']);
		expect(getRandomFormValidationErrors({
			...corrected,
			frequencyRanges: [{ min: '10', max: '' }]
		})).toEqual([]);
	});

	it('does not expose or reuse manually supplied range weights when editing or running', function () {
		const profile = {
			kind: 'random' as const,
			name: 'Previously weighted',
			parameters: { duration: 5, frequency: { ranges: [{ min: 10, weight: 0 }, { min: 40, weight: 100 }], offPercentage: 25 }, power: { min: 1 } }
		};
		const form = randomFormFromProfile(profile);
		expect(form.frequencyRanges).toEqual([{ min: '10', max: '' }, { min: '40', max: '' }]);
		expect(randomParametersFromForm(form).frequency.ranges).toEqual([{ min: 10 }, { min: 40 }]);
		expect(randomParametersFromProfile(profile).frequency.ranges).toEqual([{ min: 10 }, { min: 40 }]);
	});
});
