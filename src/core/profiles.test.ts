import { describe, expect, it } from 'vitest';

import { createProfileID, validateRandomSessionParameters } from './profiles';
import type { RandomSessionParameters } from './profiles';

describe('random session parameters', function () {
	it('creates distinct assigned profile IDs without platform crypto', function () {
		const firstID = createProfileID();
		const secondID = createProfileID();

		expect(firstID).toMatch(/^profile_/);
		expect(secondID).toMatch(/^profile_/);
		expect(secondID).not.toBe(firstID);
	});

	it('allows omitted maximum values', function () {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 20,
				frequency: { ranges: [{ min: 10 }] },
				coupling: { min: 15 },
				power: { min: 2 }
			});
		}).not.toThrow();
	});

	it('requires a cross-coupling minimum when its maximum is set', function () {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 20,
				frequency: { ranges: [{ min: 10 }] },
				coupling: { min: 20, max: 15 },
				power: { min: 2 }
			});
		}).toThrow('minimum must not exceed maximum');
	});

	it('allows Off % independently of frequency ranges', function () {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 1,
				frequency: { ranges: [{ min: 1 }], offPercentage: 100 },
				abCoupling: { distribution: 100 },
				power: { min: 1 }
			});
		}).not.toThrow();
	});

	it('rejects a distribution containing only zero weights', function () {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 5,
				frequency: { ranges: [{ min: 10, weight: 0 }, { min: 40, weight: 0 }] },
				power: { min: 1 }
			});
		}).toThrow('positive total weight');
	});

	it.each<Partial<RandomSessionParameters>>([
		{ duration: 0 },
		{ duration: 61 },
		{ duration: 1.5 },
		{ basename: 'invalid.name' },
		{ frequency: { ranges: [] } },
		{ frequency: { ranges: [{ min: 0 }] } },
		{ frequency: { ranges: [{ min: 10000 }] } },
		{ frequency: { ranges: [{ min: 1.5 }] } },
		{ frequency: { ranges: [{ min: 20, max: 10 }] } },
		{ frequency: { ranges: [{ min: 10, max: 10000 }] } },
		{ frequency: { ranges: [{ min: 10, weight: Infinity }] } },
		{ frequency: { ranges: [{ min: 10, weight: NaN }] } },
		{ frequency: { ranges: [{ min: 10 }], offPercentage: -1 } },
		{ frequency: { ranges: [{ min: 10 }], offPercentage: 101 } },
		{ frequency: { ranges: [{ min: 10 }], offPercentage: 0.5 } },
		{ power: { min: 0 } },
		{ power: { min: 141 } },
		{ power: { min: 1, max: 141 } },
		{ coupling: { min: -1 } },
		{ coupling: { min: 0, max: 101 } },
		{ coupling: { min: 0, distribution: NaN } },
		{ abCoupling: { distribution: Infinity } }
	])('rejects parameters outside generator limits: %j', function (overrides) {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 5,
				frequency: { ranges: [{ min: 10 }] },
				power: { min: 1 },
				...overrides
			});
		}).toThrow();
	});

	it('accepts the inclusive generator limits', function () {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 60,
				frequency: { ranges: [{ min: 1, max: 9999, weight: 100 }] },
				power: { min: 1, max: 140 },
				coupling: { min: 0, max: 100, distribution: 100 },
				abCoupling: { distribution: 0 }
			});
		}).not.toThrow();
	});
});
