import { describe, expect, it } from 'vitest';

import { profileDragPosition, profileDropTarget } from './profile-drag';

describe('profile drag coordinates', function () {
	it('uses release coordinates even when no move event arrived after responder handoff', function () {
		expect(profileDragPosition({ nativeEvent: { pageX: 250, pageY: 450 } }, { x: 10, y: 200 }, { x: 40, y: 40 })).toEqual({ x: 240, y: 250 });
	});

	it('reads web touch-end coordinates from changedTouches', function () {
		expect(profileDragPosition({ nativeEvent: { changedTouches: [{ pageX: 0, pageY: 450 }] } }, { x: 10, y: 200 }, { x: 40, y: 40 })).toEqual({ x: -10, y: 250 });
	});

	it('retains the last position if an event lacks coordinates', function () {
		expect(profileDragPosition({ nativeEvent: {} }, { x: 10, y: 200 }, { x: 40, y: 40 })).toEqual({ x: 40, y: 40 });
	});

	it('maps the center of a tile to grouping and its edges to swapping', function () {
		const bounds = { width: 300, height: 336 };
		expect(profileDropTarget({ x: 150, y: 130 }, bounds)).toEqual({ index: 4, group: true });
		expect(profileDropTarget({ x: 105, y: 130 }, bounds)).toEqual({ index: 4, group: false });
		expect(profileDropTarget({ x: 195, y: 130 }, bounds)).toEqual({ index: 4, group: false });
	});

	it.each([{ x: -1, y: 0 }, { x: 300, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 336 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }])('cancels out-of-bounds drops at %s', function (point) {
		expect(profileDropTarget(point, { width: 300, height: 336 })).toBeUndefined();
	});
});
