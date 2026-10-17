type Point = { x: number; y: number };
type DragEvent = { nativeEvent: { pageX?: number; pageY?: number; changedTouches?: ArrayLike<{ pageX: number; pageY: number }> } };

export type ProfileRowBounds = { y: number; height: number };

export function profileDragPosition(event: DragEvent, origin: Point, fallback: Point): Point {
	const point = event.nativeEvent.changedTouches?.[0] ?? event.nativeEvent;
	return({
		x: point.pageX === undefined ? fallback.x : point.pageX - origin.x,
		y: point.pageY === undefined ? fallback.y : point.pageY - origin.y
	});
}

export function profileDropTarget(point: Point, bounds: { width: number; height: number }, rows: (ProfileRowBounds | undefined)[]): { index: number; group: boolean } | undefined {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || bounds.width <= 0 || point.x < 0 || point.x >= bounds.width || point.y < 0 || point.y >= bounds.height) {
		return(undefined);
	}
	const index = rows.findIndex(function (row): boolean { return(row !== undefined && point.y >= row.y && point.y < row.y + row.height); });
	const row = rows[index];
	if (row === undefined) {
		return(undefined);
	}
	const fraction = (point.y - row.y) / row.height;
	return({
		index: index,
		group: fraction > 0.25 && fraction < 0.75
	});
}
