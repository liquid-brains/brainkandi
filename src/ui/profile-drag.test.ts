import { describe, expect, it } from 'vitest';

import { profileDragPosition, profileDropTarget } from './profile-drag';

describe('profile drag coordinates', function () {
	const rows = [{ y: 0, height: 100 }, { y: 100, height: 200 }, { y: 300, height: 36 }];
	it('uses release coordinates even when no move event arrived after responder handoff', function () {
		expect(profileDragPosition({ nativeEvent: { pageX: 250, pageY: 450 } }, { x: 10, y: 200 }, { x: 40, y: 40 })).toEqual({ x: 240, y: 250 });
	});

	it('reads web touch-end coordinates from changedTouches', function () {
		expect(profileDragPosition({ nativeEvent: { changedTouches: [{ pageX: 0, pageY: 450 }] } }, { x: 10, y: 200 }, { x: 40, y: 40 })).toEqual({ x: -10, y: 250 });
	});

	it('retains the last position if an event lacks coordinates', function () {
		expect(profileDragPosition({ nativeEvent: {} }, { x: 10, y: 200 }, { x: 40, y: 40 })).toEqual({ x: 40, y: 40 });
	});

	it('maps drops to variable-height list rows regardless of vertical position', function () {
		const bounds = { width: 300, height: 336 };
		expect(profileDropTarget({ x: 150, y: 200 }, bounds, rows)).toEqual({ index: 1 });
		expect(profileDropTarget({ x: 5, y: 200 }, bounds, rows)).toEqual({ index: 1 });
		expect(profileDropTarget({ x: 150, y: 110 }, bounds, rows)).toEqual({ index: 1 });
		expect(profileDropTarget({ x: 150, y: 290 }, bounds, rows)).toEqual({ index: 1 });
		expect(profileDropTarget({ x: 150, y: 300 }, bounds, rows)).toEqual({ index: 2 });
	});

	it('does not target unmeasured rows or gaps between cards', function () {
		expect(profileDropTarget({ x: 150, y: 50 }, { width: 300, height: 100 }, [])).toBeUndefined();
		expect(profileDropTarget({ x: 150, y: 50 }, { width: 300, height: 100 }, [undefined])).toBeUndefined();
		expect(profileDropTarget({ x: 150, y: 50 }, { width: 300, height: 100 }, [{ y: 60, height: 40 }])).toBeUndefined();
	});

	it.each([{ x: -1, y: 0 }, { x: 300, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 336 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }])('cancels out-of-bounds drops at %s', function (point) {
		expect(profileDropTarget(point, { width: 300, height: 336 }, rows)).toBeUndefined();
	});
});
