import { useEffect, useRef, useState } from 'react';
import { Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';

import { dropProfileTile, moveProfileOut } from '../core/profile-layout';
import type { ProfileFolder, ProfileLayout, ProfileTile } from '../core/profile-layout';
import { createProfileID } from '../core/profiles';
import type { ProfileID, StoredProfile } from '../core/profiles';
import type { AppColors } from './colors';
import { profileDragPosition, profileDropTarget } from './profile-drag';
import type { ProfileRowBounds } from './profile-drag';

type Drag = { from: number; x: number; y: number };

export function ProfileLauncher(props: {
	profiles: StoredProfile[];
	layout: ProfileLayout;
	colors: AppColors;
	disabled: boolean;
	onChange: (layout: ProfileLayout) => void;
	renderProfile: (profile: StoredProfile) => React.JSX.Element;
	onDragging: (dragging: boolean) => void;
}): React.JSX.Element {
	const [folderID, setFolderID] = useState<string>();
	const [folderName, setFolderName] = useState('');
	const [drag, setDrag] = useState<Drag>();
	const [selected, setSelected] = useState<number>();
	const grid = useRef<View>(null);
	const bounds = useRef({ x: 0, y: 0, width: 0, height: 0 });
	const rows = useRef<ProfileRowBounds[]>([]);
	const activeDrag = useRef<Drag | undefined>(undefined);
	const folder = props.layout.find(function (slot): slot is ProfileFolder { return(slot?.kind === 'folder' && slot.id === folderID); });
	const slots = folder === undefined ? props.layout.filter(function (slot) { return(slot !== null); }) : folder.profiles.map(function (id): ProfileTile { return({ kind: 'profile', profileID: id }); });
	const styles = makeStyles(props.colors);

	useEffect(function () {
		return(function (): void { props.onDragging(false); });
	}, [props.onDragging]);

	useEffect(function (): void {
		setSelected(undefined);
	}, [folderID, props.layout]);

	function cancelDrag(): void {
		activeDrag.current = undefined;
		setDrag(undefined);
		props.onDragging(false);
	}

	function startDrag(index: number, event: GestureResponderEvent): void {
		if (props.disabled) {
			return;
		}
		const pending = { from: index, x: -1, y: -1 };
		activeDrag.current = pending;
		props.onDragging(true);
		const { pageX, pageY } = event.nativeEvent;
		grid.current?.measureInWindow(function (x, y, width, height): void {
			if (activeDrag.current !== pending) {
				return;
			}
			bounds.current = { x: x, y: y, width: width, height: height };
			const started = { from: index, x: pageX - x, y: pageY - y };
			activeDrag.current = started;
			setDrag(started);
		});
	}

	function moveDrag(event: GestureResponderEvent): void {
		if (activeDrag.current === undefined) {
			return;
		}
		const moved = {
			from: activeDrag.current.from,
			x: event.nativeEvent.pageX - bounds.current.x,
			y: event.nativeEvent.pageY - bounds.current.y
		};
		activeDrag.current = moved;
		setDrag(moved);
	}

	function changeSlots(updated: ProfileLayout): void {
		if (folder === undefined) {
			props.onChange(updated);
		} else {
			const profiles = updated.flatMap(function (slot): ProfileID[] { return(slot?.kind === 'profile' ? [slot.profileID] : []); });
			props.onChange(props.layout.map(function (slot) { return(slot === folder ? { ...folder, profiles: profiles } : slot); }));
		}
	}

	function place(from: number, to: number, group: boolean): void {
		changeSlots(dropProfileTile(slots, from, to, folder === undefined && group, createProfileID()));
		setSelected(undefined);
	}

	function finishDrag(event: Parameters<typeof profileDragPosition>[0]): void {
		const current = activeDrag.current === undefined ? undefined : {
			from: activeDrag.current.from,
			...profileDragPosition(event, bounds.current, activeDrag.current)
		};
		cancelDrag();
		if (current === undefined || props.disabled) {
			return;
		}
		const target = profileDropTarget(current, bounds.current, rows.current.slice(0, slots.length));
		if (target !== undefined) {
			place(current.from, target.index, target.group);
		}
	}

	function label(slot: ProfileTile | ProfileFolder): string {
		if (slot.kind === 'folder') {
			return(slot.name);
		}
		return(props.profiles.find(function (profile): boolean { return(profile.id === slot.profileID); })?.profile.name ?? 'Profile');
	}

	const draggedSlot = drag === undefined ? undefined : slots[drag.from];
	const selectedSlot = selected === undefined ? undefined : slots[selected];
	return(
		<View>
			{folder !== undefined && <View style={styles.controls}>
				<Button title="Back to profiles" onPress={function (): void { cancelDrag(); setFolderID(undefined); }} />
				<TextInput accessibilityLabel="Folder name" value={folderName} onChangeText={setFolderName} editable={!props.disabled} style={styles.input} />
				<Button title="Rename folder" disabled={props.disabled || folderName.trim() === ''} onPress={function (): void {
					props.onChange(props.layout.map(function (slot) { return(slot === folder ? { ...folder, name: folderName.trim() } : slot); }));
				}} />
			</View>}
			<Text style={styles.help}>{folder === undefined
				? 'Hold a profile or folder to drag it. Drop near the top or bottom of an item to reorder, or in its center to create or join a folder.'
				: 'Hold a profile to drag and reorder it. To move a profile out of this folder, choose Move, then Move to home.'}</Text>
			{selected !== undefined && <View style={styles.controls}>
				<Text style={styles.help}>{folder === undefined ? 'Choose a destination. Use “Group here” to create or join a folder.' : 'Choose a destination, or move this profile to home.'}</Text>
				<Button title="Cancel move" onPress={function (): void { setSelected(undefined); }} />
				{folder !== undefined && selectedSlot?.kind === 'profile' && <Button title="Move to home" disabled={props.disabled} onPress={function (): void { props.onChange(moveProfileOut(props.layout, folder.id, selectedSlot.profileID)); }} />}
			</View>}
			<View
				ref={grid}
				style={styles.grid}
				onMoveShouldSetResponderCapture={function (): boolean { return(activeDrag.current !== undefined); }}
				onResponderGrant={moveDrag}
				onResponderMove={moveDrag}
				onResponderRelease={finishDrag}
				onResponderTerminate={cancelDrag}
				onResponderTerminationRequest={function (): boolean { return(false); }}
				onTouchEnd={finishDrag}
				onTouchCancel={cancelDrag}
				onPointerUp={finishDrag}
			>
				{slots.map(function (slot, index): React.JSX.Element {
					const profile = slot.kind === 'profile' ? props.profiles.find(function (item): boolean { return(item.id === slot.profileID); }) : undefined;
					return(
						<View key={index} style={styles.cell} onLayout={function (event): void {
							const { y, height } = event.nativeEvent.layout;
							rows.current[index] = { y: y, height: height };
						}}>
							<Pressable
								accessibilityRole={slot.kind === 'folder' || selected !== undefined ? 'button' : undefined}
								accessibilityLabel={`${slot.kind === 'folder' ? 'Folder: ' : ''}${label(slot)}`}
								accessibilityHint="Hold to drag, or use the Move button."
								accessible={slot.kind === 'folder' || selected !== undefined}
								disabled={props.disabled}
								delayLongPress={400}
								onLongPress={function (event): void { startDrag(index, event); }}
								onPress={function (): void {
									if (activeDrag.current !== undefined) { return; }
									if (selected !== undefined) {
										place(selected, index, false);
									} else if (slot.kind === 'folder') {
										setFolderID(slot.id);
										setFolderName(slot.name);
									}
								}}
								style={[styles.tile, (drag?.from === index || selected === index) && styles.moving]}
							>
								{slot.kind === 'folder' ? <View style={styles.folder}>
									<Text style={styles.name}>{slot.name}</Text>
									<Text style={styles.help}>{slot.profiles.length} profiles</Text>
								</View> : profile !== undefined && props.renderProfile(profile)}
							</Pressable>
							{selected === undefined && <Pressable accessibilityRole="button" accessibilityLabel={`Move ${label(slot)}`} disabled={props.disabled} onPress={function (): void { setSelected(index); }}><Text style={styles.move}>Move</Text></Pressable>}
							{selected !== undefined && selected !== index && folder === undefined && selectedSlot?.kind === 'profile' && <Pressable accessibilityRole="button" accessibilityLabel={`Group in ${label(slot)}`} disabled={props.disabled} onPress={function (): void { place(selected, index, true); }}><Text style={styles.move}>Group here</Text></Pressable>}
						</View>
					);
				})}
				{drag !== undefined && draggedSlot !== undefined && draggedSlot !== null && <View pointerEvents="none" style={[styles.floating, {
					left: Math.max(0, Math.min(bounds.current.width - 90, drag.x - 45)),
					top: Math.max(0, Math.min(bounds.current.height - 70, drag.y - 35))
				}]}><Text numberOfLines={2} style={styles.name}>{label(draggedSlot)}</Text></View>}
			</View>
		</View>
	);
}

function makeStyles(colors: AppColors) {
	return(StyleSheet.create({
		grid: { position: 'relative' },
		cell: { width: '100%' },
		tile: { width: '100%', userSelect: 'none' },
		folder: { marginTop: 2, padding: 14, borderRadius: 8, backgroundColor: colors.surface },
		moving: { opacity: 0.4, borderColor: colors.accent },
		name: { color: colors.text, fontSize: 17, fontWeight: '700' },
		help: { color: colors.text, fontSize: 12, marginVertical: 4 },
		move: { color: colors.title, textAlign: 'center', padding: 4, textDecorationLine: 'underline' },
		controls: { gap: 6, marginVertical: 8 },
		input: { color: colors.inputText, backgroundColor: colors.surface, padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
		floating: { position: 'absolute', width: 90, height: 70, padding: 8, backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
	}));
}
