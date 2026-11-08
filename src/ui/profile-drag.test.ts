import { describe, expect, it } from 'vitest';

import { profileDragPosition, profileDropDestination, stepDropIndex } from './profile-drag';

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
});

describe('profile drop destinations', function () {
	const items = [{ id: 'a', rect: { x: 0, y: 100, width: 300, height: 100 } }, { id: 'b', rect: { x: 0, y: 200, width: 300, height: 100 } }];
	const zones = [{ folderID: 'f', rect: { x: 0, y: 50, width: 300, height: 300 } }, { folderID: undefined, rect: { x: 0, y: 400, width: 300, height: 100 } }];

	it('drops before or after the profile under the pointer', function () {
		expect(profileDropDestination({ x: 10, y: 120 }, 'z', items, zones)).toEqual({ kind: 'item', id: 'a', after: false });
		expect(profileDropDestination({ x: 10, y: 180 }, 'z', items, zones)).toEqual({ kind: 'item', id: 'a', after: true });
	});

	it('ignores dropping a profile on itself', function () {
		expect(profileDropDestination({ x: 10, y: 120 }, 'a', items, zones)).toBeUndefined();
	});

	it('falls back to the folder or unfiled area under the pointer', function () {
		expect(profileDropDestination({ x: 10, y: 60 }, 'z', items, zones)).toEqual({ kind: 'zone', folderID: 'f' });
		expect(profileDropDestination({ x: 10, y: 450 }, 'z', items, zones)).toEqual({ kind: 'zone', folderID: undefined });
	});

	it('returns nothing outside every target', function () {
		expect(profileDropDestination({ x: 10, y: 10 }, 'z', items, zones)).toBeUndefined();
		expect(profileDropDestination({ x: Number.NaN, y: 10 }, 'z', items, zones)).toBeUndefined();
	});
});

describe('step drop index', function () {
	const layouts = [{ y: 0, height: 50 }, { y: 58, height: 50 }, { y: 116, height: 50 }];
	it('stays put for small drags', function () {
		expect(stepDropIndex(layouts, 1, 5)).toBe(1);
	});
	it('moves to the step under the dragged center', function () {
		expect(stepDropIndex(layouts, 0, 70)).toBe(1);
		expect(stepDropIndex(layouts, 0, 120)).toBe(2);
		expect(stepDropIndex(layouts, 2, -100)).toBe(0);
	});
	it('clamps beyond the ends', function () {
		expect(stepDropIndex(layouts, 0, 900)).toBe(2);
		expect(stepDropIndex(layouts, 2, -900)).toBe(0);
	});
});
