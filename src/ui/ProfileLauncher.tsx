import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';

import { addProfileFolder, deleteProfileFolder, moveProfileTo, moveProfileToFolderEnd, renameProfileFolder, toggleProfileFolder } from '../core/profile-layout';
import type { ProfileFolder, ProfileLayout } from '../core/profile-layout';
import { createProfileID } from '../core/profiles';
import type { ProfileID, StoredProfile } from '../core/profiles';
import type { AppColors } from './colors';
import { profileDragPosition, profileDropDestination } from './profile-drag';
import type { DropRect } from './profile-drag';

type Drag = { profileID: ProfileID; x: number; y: number };

export function ProfileLauncher(props: {
	profiles: StoredProfile[];
	layout: ProfileLayout;
	colors: AppColors;
	buttonComponent: (props: { title: string; color?: string; disabled?: boolean; onPress: () => void }) => React.JSX.Element;
	disabled: boolean;
	onChange: (layout: ProfileLayout) => void;
	renderProfile: (profile: StoredProfile) => React.JSX.Element;
	onDragging: (dragging: boolean) => void;
}): React.JSX.Element {
	const [drag, setDrag] = useState<Drag>();
	const [isNamingFolder, setIsNamingFolder] = useState(false);
	const [newFolderName, setNewFolderName] = useState('');
	const container = useRef<View>(null);
	const containerOrigin = useRef({ x: 0, y: 0 });
	const targets = useRef(new Map<string, View>());
	const itemRects = useRef<{ id: string; rect: DropRect }[]>([]);
	const zoneRects = useRef<{ folderID: string | undefined; rect: DropRect }[]>([]);
	const activeDrag = useRef<Drag | undefined>(undefined);
	const styles = makeStyles(props.colors);
	const ButtonComponent = props.buttonComponent;
	const folders = props.layout.filter(function (slot): slot is ProfileFolder { return(slot?.kind === 'folder'); });
	const unfiled = props.layout.flatMap(function (slot): ProfileID[] { return(slot?.kind === 'profile' ? [slot.profileID] : []); });

	useEffect(function () {
		return(function (): void { props.onDragging(false); });
	}, [props.onDragging]);

	function register(key: string): (view: View | null) => void {
		return(function (view): void {
			if (view === null) {
				targets.current.delete(key);
			} else {
				targets.current.set(key, view);
			}
		});
	}

	function measure(key: string): Promise<DropRect | undefined> {
		return(new Promise(function (resolve): void {
			const view = targets.current.get(key);
			if (view === undefined) {
				resolve(undefined);
				return;
			}
			view.measureInWindow(function (x, y, width, height): void { resolve({ x: x, y: y, width: width, height: height }); });
		}));
	}

	async function measureTargets(): Promise<void> {
		const items: { id: string; rect: DropRect }[] = [];
		const zones: { folderID: string | undefined; rect: DropRect }[] = [];
		for (const key of [...targets.current.keys()]) {
			const rect = await measure(key);
			if (rect === undefined) {
				continue;
			}
			if (key.startsWith('item:')) {
				items.push({ id: key.slice(5), rect: rect });
			} else {
				zones.push({ folderID: key === 'zone:' ? undefined : key.slice(5), rect: rect });
			}
		}
		itemRects.current = items;
		zoneRects.current = zones;
	}

	function cancelDrag(): void {
		activeDrag.current = undefined;
		setDrag(undefined);
		props.onDragging(false);
	}

	function startDrag(profileID: ProfileID, event: GestureResponderEvent): void {
		if (props.disabled) {
			return;
		}
		const pending: Drag = { profileID: profileID, x: -1, y: -1 };
		activeDrag.current = pending;
		props.onDragging(true);
		const { pageX, pageY } = event.nativeEvent;
		container.current?.measureInWindow(function (x, y): void {
			if (activeDrag.current !== pending) {
				return;
			}
			containerOrigin.current = { x: x, y: y };
			void measureTargets().then(function (): void {
				if (activeDrag.current !== pending) {
					return;
				}
				const started = { profileID: profileID, x: pageX - x, y: pageY - y };
				activeDrag.current = started;
				setDrag(started);
			});
		});
	}

	function moveDrag(event: GestureResponderEvent): void {
		if (activeDrag.current === undefined) {
			return;
		}
		const moved = {
			profileID: activeDrag.current.profileID,
			x: event.nativeEvent.pageX - containerOrigin.current.x,
			y: event.nativeEvent.pageY - containerOrigin.current.y
		};
		activeDrag.current = moved;
		setDrag(moved);
	}

	function finishDrag(event: Parameters<typeof profileDragPosition>[0]): void {
		const current = activeDrag.current;
		cancelDrag();
		if (current === undefined || props.disabled) {
			return;
		}
		const relative = profileDragPosition(event, { x: 0, y: 0 }, { x: current.x + containerOrigin.current.x, y: current.y + containerOrigin.current.y });
		const destination = profileDropDestination(relative, current.profileID, itemRects.current, zoneRects.current);
		if (destination === undefined) {
			return;
		}
		if (destination.kind === 'item') {
			props.onChange(moveProfileTo(props.layout, current.profileID, destination.id as ProfileID, destination.after));
		} else {
			props.onChange(moveProfileToFolderEnd(props.layout, current.profileID, destination.folderID));
		}
	}

	function createFolder(): void {
		const name = newFolderName.trim();
		if (name === '') {
			return;
		}
		props.onChange(addProfileFolder(props.layout, createProfileID(), name));
		setIsNamingFolder(false);
		setNewFolderName('');
	}

	function renderItem(profileID: ProfileID): React.JSX.Element | null {
		const profile = props.profiles.find(function (item): boolean { return(item.id === profileID); });
		if (profile === undefined) {
			return(null);
		}
		return(
			<View key={profileID} ref={register(`item:${profileID}`)} collapsable={false}>
				<Pressable
					accessibilityHint="Hold to drag."
					accessible={false}
					disabled={props.disabled}
					delayLongPress={400}
					onLongPress={function (event): void { startDrag(profileID, event); }}
					style={[styles.tile, drag?.profileID === profileID && styles.moving]}
				>
					{props.renderProfile(profile)}
				</Pressable>
			</View>
		);
	}

	const draggedProfile = drag === undefined ? undefined : props.profiles.find(function (item): boolean { return(item.id === drag.profileID); });
	return(
		<View
			ref={container}
			collapsable={false}
			style={styles.root}
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
			<ButtonComponent title="New folder" disabled={props.disabled} onPress={function (): void { setNewFolderName(''); setIsNamingFolder(true); }} />
			{folders.map(function (folder): React.JSX.Element {
				return(
					<View key={folder.id} ref={register(`zone:${folder.id}`)} collapsable={false} style={[styles.folder, drag !== undefined && styles.folderTarget]}>
						<Pressable accessibilityRole="button" accessibilityLabel={`Delete folder ${folder.name}`} disabled={props.disabled} onPress={function (): void { props.onChange(deleteProfileFolder(props.layout, folder.id)); }} style={styles.close}>
							<Text style={styles.glyph}>✕</Text>
						</Pressable>
						<View style={styles.folderHeader}>
							<Pressable accessibilityRole="button" accessibilityLabel={`${folder.collapsed === true ? 'Expand' : 'Collapse'} folder ${folder.name}`} accessibilityState={{ expanded: folder.collapsed !== true }} onPress={function (): void { props.onChange(toggleProfileFolder(props.layout, folder.id)); }} style={styles.toggle}>
								<Text style={styles.glyph}>{folder.collapsed === true ? '▶' : '▼'}</Text>
							</Pressable>
							<FolderNameInput key={folder.name} name={folder.name} styles={styles} disabled={props.disabled} onCommit={function (name): void { props.onChange(renameProfileFolder(props.layout, folder.id, name)); }} />
						</View>
						{folder.collapsed === true
							? <Text style={styles.help}>{folder.profiles.length} profile(s) hidden</Text>
							: folder.profiles.map(renderItem)}
						{folder.collapsed !== true && folder.profiles.length === 0 && <Text style={styles.help}>Empty folder. Press and hold a profile, then drag it here.</Text>}
					</View>
				);
			})}
			<View ref={register('zone:')} collapsable={false} style={[styles.unfiled, folders.length > 0 && styles.unfiledArea, folders.length > 0 && drag !== undefined && styles.unfiledTarget]}>
				{unfiled.map(renderItem)}
				{folders.length > 0 && drag !== undefined && <Text style={styles.help}>Drop here to take a profile out of its folder.</Text>}
			</View>
			{drag !== undefined && draggedProfile !== undefined && <View pointerEvents="none" style={[styles.floating, { left: Math.max(0, drag.x - 45), top: Math.max(0, drag.y - 35) }]}>
				<Text numberOfLines={2} style={styles.name}>{draggedProfile.profile.name}</Text>
			</View>}
			<Modal transparent animationType="fade" visible={isNamingFolder} onRequestClose={function (): void { setIsNamingFolder(false); }}>
				<View style={styles.backdrop}>
					<View style={styles.dialog}>
						<Text style={styles.name}>New folder</Text>
						<TextInput accessibilityLabel="Folder name" autoFocus placeholder="Folder name" placeholderTextColor={props.colors.text} value={newFolderName} onChangeText={setNewFolderName} onSubmitEditing={createFolder} style={styles.input} />
						<ButtonComponent title="Create folder" disabled={newFolderName.trim() === ''} onPress={createFolder} />
						<ButtonComponent title="Cancel" onPress={function (): void { setIsNamingFolder(false); }} />
					</View>
				</View>
			</Modal>
		</View>
	);
}

function FolderNameInput(props: { name: string; disabled: boolean; styles: ReturnType<typeof makeStyles>; onCommit: (name: string) => void }): React.JSX.Element {
	const [draft, setDraft] = useState(props.name);
	function commit(): void {
		if (draft.trim() === '') {
			setDraft(props.name);
		} else if (draft.trim() !== props.name) {
			props.onCommit(draft);
		}
	}
	return(<TextInput accessibilityLabel="Folder name" value={draft} editable={!props.disabled} onChangeText={setDraft} onBlur={commit} onSubmitEditing={commit} style={[props.styles.input, props.styles.folderName]} />);
}

function makeStyles(colors: AppColors) {
	return(StyleSheet.create({
		root: { gap: 10, position: 'relative' },
		tile: { width: '100%', userSelect: 'none' },
		folder: { backgroundColor: colors.folder, borderColor: colors.folder, borderRadius: 10, borderWidth: 1, gap: 8, padding: 10 },
		folderTarget: { borderColor: colors.accent },
		folderHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingRight: 32 },
		folderName: { flex: 1 },
		toggle: { paddingHorizontal: 8, paddingVertical: 6 },
		close: { position: 'absolute', right: 4, top: 4, paddingHorizontal: 8, paddingVertical: 6, zIndex: 2 },
		glyph: { color: colors.text, fontSize: 16 },
		unfiled: { gap: 10 },
		unfiledArea: { borderColor: 'transparent', borderRadius: 10, borderStyle: 'dashed', borderWidth: 1, minHeight: 56, padding: 4 },
		unfiledTarget: { borderColor: colors.accent },
		moving: { opacity: 0.4 },
		name: { color: colors.text, fontSize: 17, fontWeight: '700' },
		help: { color: colors.text, fontSize: 12, marginVertical: 4 },
		input: { color: colors.inputText, backgroundColor: colors.surface, padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
		floating: { position: 'absolute', width: 90, height: 70, padding: 8, backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
		backdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, justifyContent: 'center', padding: 20 },
		dialog: { backgroundColor: colors.surface, borderRadius: 12, gap: 10, padding: 16, width: '100%', maxWidth: 420 }
	}));
}
