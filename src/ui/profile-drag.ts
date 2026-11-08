type Point = { x: number; y: number };
type DragEvent = { nativeEvent: { pageX?: number; pageY?: number; changedTouches?: ArrayLike<{ pageX: number; pageY: number }> } };

export type DropRect = { x: number; y: number; width: number; height: number };
export type DropDestination = { kind: 'item'; id: string; after: boolean } | { kind: 'zone'; folderID: string | undefined };

export function profileDragPosition(event: DragEvent, origin: Point, fallback: Point): Point {
	const point = event.nativeEvent.changedTouches?.[0] ?? event.nativeEvent;
	return({
		x: point.pageX === undefined ? fallback.x : point.pageX - origin.x,
		y: point.pageY === undefined ? fallback.y : point.pageY - origin.y
	});
}

function contains(rect: DropRect, point: Point): boolean {
	return(point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height);
}

// Finds where a dragged profile lands: on another profile (before or after it) or at the end of a folder.
export function profileDropDestination(point: Point, draggedID: string, items: { id: string; rect: DropRect }[], zones: { folderID: string | undefined; rect: DropRect }[]): DropDestination | undefined {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		return(undefined);
	}
	const item = items.find(function (candidate): boolean { return(contains(candidate.rect, point)); });
	if (item !== undefined) {
		if (item.id === draggedID) {
			return(undefined);
		}
		return({ kind: 'item', id: item.id, after: point.y > item.rect.y + item.rect.height / 2 });
	}
	const zone = zones.find(function (candidate): boolean { return(contains(candidate.rect, point)); });
	return(zone === undefined ? undefined : { kind: 'zone', folderID: zone.folderID });
}
