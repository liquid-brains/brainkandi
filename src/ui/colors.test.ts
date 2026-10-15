import { describe, expect, it } from 'vitest';

import { brandColors, getAppColors } from './colors';

function contrastRatio(first: string, second: string): number {
	function luminance(color: string): number {
		const normalizedColor = color.length === 4 ? `#${color.slice(1).split('').map(function (channel): string { return(channel + channel); }).join('')}` : color;
		const channels = [1, 3, 5].map(function (index): number {
			const channel = Number.parseInt(normalizedColor.slice(index, index + 2), 16) / 255;
			return(channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
		});
		return(0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!);
	}
	const firstLuminance = luminance(first);
	const secondLuminance = luminance(second);
	return((Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05));
}

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

	it('preserves the original system light accent and button colors', function () {
		const light = getAppColors(true, 'light');
		expect(light.accent).toBe('#007aff');
		expect(light.button).toBe('#007aff');
	});

	it('visibly separates system light sections from the page background', function () {
		const light = getAppColors(true, 'light');
		expect(contrastRatio(light.sectionBorder, light.background)).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(light.sectionBorder, light.section)).toBeGreaterThanOrEqual(3);
	});
});
