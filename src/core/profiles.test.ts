import { describe, expect, it } from 'vitest';

import { createProfileID, validateRandomSessionParameters } from './profiles';

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
				freqMin: 10,
				couplingMin: 15,
				powerMin: 2
			});
		}).not.toThrow();
	});

	it('requires a cross-coupling minimum when its maximum is set', function () {
		expect(function (): void {
			validateRandomSessionParameters({
				duration: 20,
				freqMin: 10,
				couplingMax: 15,
				powerMin: 2
			});
		}).toThrow('minimum is required');
	});
});
