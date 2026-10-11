import { describe, expect, it } from 'vitest';

import { brandColors, getAppColors } from './colors';

describe('app colors', function () {
	it.each(['light', 'dark', 'unspecified', null, undefined] as const)('keeps Brain Kandi colors when the toggle is off, with system scheme %s', function (scheme) {
		expect(getAppColors(false, scheme)).toBe(brandColors);
	});

	it('uses distinct system light and dark palettes when enabled', function () {
		const light = getAppColors(true, 'light');
		const dark = getAppColors(true, 'dark');
		expect(light.background).not.toBe(brandColors.background);
		expect(dark.background).not.toBe(brandColors.background);
		expect(light.background).not.toBe(dark.background);
		expect(light.text).not.toBe(dark.text);
		expect(light.surface).not.toBe(dark.surface);
	});

	it('uses a light palette when the system has no specified scheme', function () {
		expect(getAppColors(true, 'unspecified')).toEqual(getAppColors(true, 'light'));
		expect(getAppColors(true, null)).toEqual(getAppColors(true, 'light'));
	});
});
