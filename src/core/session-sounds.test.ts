import { describe, expect, it } from 'vitest';

import { isSwitchingFiles } from './session-switching';

describe('session sound switching', function () {
	it('does not switch on the first file or when nothing is running', function () {
		expect(isSwitchingFiles(undefined, false, 'a.vnp0')).toBe(false);
		expect(isSwitchingFiles('a.vnp0', true, undefined)).toBe(false);
	});

	it('switches when a later or different file begins', function () {
		expect(isSwitchingFiles(undefined, true, 'b.vnp0')).toBe(true);
		expect(isSwitchingFiles('a.vnp0', true, 'b.vnp0')).toBe(true);
		expect(isSwitchingFiles('a.vnp0', true, 'a.vnp0')).toBe(false);
	});
});
