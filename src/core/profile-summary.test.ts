import { describe, expect, it } from 'vitest';

import { randomParametersSummary } from './profile-summary';
import type { RandomSessionParameters } from './profiles';

const base: RandomSessionParameters = {
	basename: 'random',
	duration: 5,
	frequency: { ranges: [{ min: 10 }] },
	power: { min: 1 }
};

describe('randomParametersSummary', function () {
	it('lists only duration and frequency for defaults', function () {
		expect(randomParametersSummary(base)).toBe('5 minute(s), 10 Hz');
	});

	it('lists every non-default field', function () {
		const summary = randomParametersSummary({
			basename: 'mine',
			duration: 10,
			sessionDuration: 3,
			frequency: { ranges: [{ min: 8, max: 12 }], distributeRanges: true, perChannel: true, offPercentage: 20 },
			coupling: { min: 1, max: 9999, distribution: 70 },
			abCoupling: { distribution: 40 },
			power: { min: 20, max: 60, perChannel: false }
		});
		expect(summary).toBe('10 minute(s), 8-12 Hz, 3 min per file, ranges distributed evenly, frequency per channel, Off 20%, Coupling 1-9999 Hz (70%), Phase A 40%, Power 20-60, power shared across channels, Name mine');
	});
});
