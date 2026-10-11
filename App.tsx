import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button as NativeButton,
	Image,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	Switch,
	Text,
	TextInput,
	View,
	useColorScheme
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';

import { SessionRunner, VielightDeviceFactory } from './src/core/device-client';
import { BrainlightError } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import type { RandomSessionField } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import { scanLocalSubnet } from './src/core/device-scanner';
import { AsyncStorageDeviceStore } from './src/core/device-store';
import { AsyncStorageProfileStore } from './src/core/profile-store';
import { AsyncStorageJourneyStore, createJourneyID } from './src/core/journey-store';
import { AsyncStorageSettingsStore, defaultSettings } from './src/core/settings-store';
import type { AppSettings } from './src/core/settings-store';
import { brandColors, getAppColors } from './src/ui/colors';
import type { AppColors } from './src/ui/colors';
import type { SavedDevice } from './src/core/device-store';
import type { Journey, JourneyFile, JourneyRating } from './src/core/journey-store';
import { encapsulateSharedProfile } from './src/core/profile-codec';
import type { ProfileID, SequenceStep, SessionProfile, StoredProfile } from './src/core/profiles';
import { maximumSequenceDepth } from './src/core/profiles';
import { createSequenceStep, resolveSequenceProfile, runnableProfileSteps, sequenceStepHasChanged, sequenceStepProfile } from './src/core/sequences';
import type { FormValues, FrequencyRangeForm } from './src/core/random-profile-form';
import { defaultFormValues, getRandomFormValidationErrors, randomFormFromProfile, randomParametersFromProfile, randomProfileFromForm } from './src/core/random-profile-form';

const profileStore = new AsyncStorageProfileStore();
const deviceStore = new AsyncStorageDeviceStore();
const journeyStore = new AsyncStorageJourneyStore();
const settingsStore = new AsyncStorageSettingsStore();
const ThemeContext = createContext({ colors: brandColors, styles: createStyles(brandColors) });
const sessionRunner = new SessionRunner(new VielightDeviceFactory());
const keepAwakeTag = 'brainkandi-session';
const addDevicePickerValue = '__add_new_device__';
const sessionNotificationCategoryID = 'brainkandi-session';
const stopSessionNotificationActionID = 'stop-session';

Notifications.setNotificationHandler({
	handleNotification: async function () {
		return({
			shouldPlaySound: false,
			shouldSetBadge: false,
			shouldShowBanner: true,
			shouldShowList: true
		});
	}
});

const defaultFileProfileJSON = JSON.stringify({
	defaultFile: false,
	secretFile: false,
	usedByBatch: 0,
	single: true,
	updateExisting: true,
	saveNew: false,
	filename: 'tmp1',
	notes: 'Delete',
	frequency: {
		active: false,
		startFreq: null,
		endFreq: null,
		freqStepSize: null,
		stepDuration: null
	},
	power: {
		active: false,
		startPower: null,
		endPower: null,
		powerStepSize: null,
		stepDuration: null
	},
	cross: {
		active: false,
		freq: null,
		couplingDelay: null,
		stopCoupling: null
	},
	modules: Array.from({ length: 12 }, function (_, index) {
		return({
			module_no: index + 1,
			active: true,
			activeRunTime: 1,
			delayStartTime: 9,
			moduleControl: {
				phase: 0,
				dutyCycle: 5
			},
			freq: 55,
			power: 94,
			applyCross: false
		});
	})
}, undefined, 2);

type ProfileEditorValues = {
	kind: 'file' | 'random' | 'sequence';
	name: string;
	fileName: string;
	fileJSON: string;
	randomForm: FormValues;
	steps: SequenceStep[];
};

function profileFromEditorValues(values: ProfileEditorValues): SessionProfile {
	if (values.kind === 'file') {
		return({
			kind: 'file',
			name: values.name,
			fileName: values.fileName,
			fileData: parseFileData(values.fileJSON)
		});
	}
	if (values.kind === 'sequence') {
		return({ kind: 'sequence', name: values.name, steps: values.steps });
	}
	return(randomProfileFromForm(values.name, values.randomForm));
}

function initialJourneyFiles(profile: SessionProfile): JourneyFile[] {
	if (profile.kind !== 'file') {
		return([]);
	}
	return([{
		fileName: profile.fileName,
		data: JSON.parse(JSON.stringify(profile.fileData)) as Record<string, unknown>
	}]);
}

function increaseJourneyRating(currentRating: JourneyRating | undefined): number {
	if (currentRating === undefined || currentRating < 0) {
		return(1);
	}
	if (currentRating === 5) {
		return(0);
	}
	return(currentRating + 1);
}

function decreaseJourneyRating(currentRating: JourneyRating | undefined): number {
	if (currentRating === undefined || currentRating > 0) {
		return(-1);
	}
	if (currentRating === -5) {
		return(0);
	}
	return(currentRating - 1);
}

function journeyThumbs(thumb: string, count: number): string {
	return(thumb.repeat(count));
}

function JourneyRatingButton(props: {
	thumb: string;
	count: number;
	color: string;
	disabled: boolean;
	onPress: () => void;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	return(
		<Pressable accessibilityRole="button" disabled={props.disabled} onPress={props.onPress} style={[styles.ratingButton, { backgroundColor: props.color }, props.disabled ? styles.ratingButtonDisabled : undefined]}>
			<Text style={styles.ratingThumbs}>{journeyThumbs(props.thumb, props.count)}</Text>
		</Pressable>
	);
}

function profileDescription(profile: SessionProfile): string {
	switch (profile.kind) {
		case 'file':
			return(`File: ${profile.fileName}`);
		case 'random':
			if (profile.input !== undefined) {
				return('Random: draft input; edit highlighted fields before running.');
			}
			const ranges = profile.parameters.frequency.ranges.map(function (range): string {
				return(`${range.max === undefined ? String(range.min) : `${range.min}-${range.max}`} Hz`);
			});
			const phase = profile.parameters.abCoupling?.distribution;
			return(`Random: ${profile.parameters.duration} minute(s), ${ranges.join(', ')}, Off ${profile.parameters.frequency.offPercentage ?? 0}%${phase === undefined ? '' : `, Phase A ${phase}%`}`);
		case 'ai':
			return('Unsupported profile type');
		case 'sequence':
			return(`Sequence: ${profile.steps.length} step(s)`);
	}
}

function journeyDescription(journey: Journey): string {
	const date = new Date(journey.startedAt).toLocaleString();
	switch (journey.outcome) {
		case 'running':
			return(`Started ${date}; currently running.`);
		case 'completed':
			return(`Started ${date}; completed.`);
		case 'stopped-early':
			return(`Started ${date}; stopped early.`);
		case 'failed':
			return(`Started ${date}; did not complete.`);
	}
}

export default function App(): React.JSX.Element {
	const colorScheme = useColorScheme();
	const [settings, setSettings] = useState<AppSettings>(defaultSettings);
	const [isLoadingSettings, setIsLoadingSettings] = useState(true);
	const [isSavingSettings, setIsSavingSettings] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const theme = useMemo(function () {
		const colors = getAppColors(settings.useSystemColors, colorScheme);
		return({ colors: colors, styles: createStyles(colors) });
	}, [settings.useSystemColors, colorScheme]);
	const { styles, colors } = theme;
	const [deviceAddress, setDeviceAddress] = useState('np1.local');
	const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
	const [newDeviceAddress, setNewDeviceAddress] = useState('np1.local');
	const [subnetPrefix, setSubnetPrefix] = useState('192.168.1');
	const [scannedAddresses, setScannedAddresses] = useState<string[]>([]);
	const [isAddingDevice, setIsAddingDevice] = useState(false);
	const [profiles, setProfiles] = useState<StoredProfile[]>([]);
	const [journeys, setJourneys] = useState<Journey[]>([]);
	const [visibleJourneyCount, setVisibleJourneyCount] = useState(3);
	const [status, setStatus] = useState('Ready.');
	const [isRunning, setIsRunning] = useState(false);
	const didStopCurrentSession = useRef(false);
	const sessionNotificationID = useRef<string | undefined>(undefined);
	const sessionNotificationVersion = useRef(0);
	const [editingProfileID, setEditingProfileID] = useState<ProfileID | undefined>();
	const [profileEditor, setProfileEditor] = useState<ProfileEditorValues | undefined>();
	const [isCreatingProfile, setIsCreatingProfile] = useState(false);
	const [isImportingProfile, setIsImportingProfile] = useState(false);
	const [sharedProfileJSON, setSharedProfileJSON] = useState('');
	const [journalEntryJourney, setJournalEntryJourney] = useState<Journey | undefined>();
	const [journalEntryText, setJournalEntryText] = useState('');
	const [parametersJourney, setParametersJourney] = useState<Journey | undefined>();

	useEffect(function (): void {
		void settingsStore.load().then(setSettings).catch(function (error: unknown): void {
			setStatus(errorMessage(error));
		}).finally(function (): void {
			setIsLoadingSettings(false);
		});
	}, []);

	useEffect(function (): void {
		void SystemUI.setBackgroundColorAsync(colors.background).catch(function (error: unknown): void {
			setStatus(errorMessage(error));
		});
	}, [colors.background]);

	async function changeUseSystemColors(useSystemColors: boolean): Promise<void> {
		if (isLoadingSettings || isSavingSettings) {
			return;
		}
		setIsSavingSettings(true);
		try {
			const updatedSettings = { ...settings, useSystemColors: useSystemColors };
			await settingsStore.save(updatedSettings);
			setSettings(updatedSettings);
		} catch (error) {
			setStatus(errorMessage(error));
		} finally {
			setIsSavingSettings(false);
		}
	}

	const loadProfiles = useCallback(async function (): Promise<void> {
		try {
			setProfiles(await profileStore.list());
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}, []);

	const loadJourneys = useCallback(async function (): Promise<void> {
		try {
			setJourneys(await journeyStore.list());
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}, []);

	const loadDevices = useCallback(async function (): Promise<void> {
		try {
			let history = await deviceStore.load();
			if (history.devices.length === 0) {
				history = await deviceStore.addAndSelect('np1.local');
			}
			setSavedDevices(history.devices);
			if (history.lastUsedAddress !== undefined) {
				setDeviceAddress(history.lastUsedAddress);
				setIsAddingDevice(false);
				return;
			}
			const firstDevice = history.devices[0];
			if (firstDevice !== undefined) {
				setDeviceAddress(firstDevice.address);
				setIsAddingDevice(false);
			}
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}, []);

	useEffect(function (): void {
		void loadProfiles();
		void loadJourneys();
		void loadDevices();
	}, [loadDevices, loadJourneys, loadProfiles]);

	useEffect(function (): (() => void) {
		void configureSessionNotifications();
		const subscription = Notifications.addNotificationResponseReceivedListener(function (response): void {
			if (response.actionIdentifier === stopSessionNotificationActionID) {
				stopSession();
			}
		});
		return(function (): void {
			subscription.remove();
		});
	}, []);

	useEffect(function (): void {
		sessionNotificationVersion.current++;
		void updateSessionNotification(isRunning, status, sessionNotificationID, sessionNotificationVersion);
	}, [isRunning, status]);

	const run = useCallback(async function (profile: SessionProfile, operation: (setSessionStatus: (status: string) => void, onGeneratedFile: (fileName: string, data: Record<string, unknown>) => void) => Promise<void>): Promise<void> {
		if (isRunning) {
			return;
		}
		const journey: Journey = {
			id: createJourneyID(),
			profile: JSON.parse(JSON.stringify(profile)) as SessionProfile,
			startedAt: new Date().toISOString(),
			outcome: 'running',
			files: initialJourneyFiles(profile)
		};
		setIsRunning(true);
		didStopCurrentSession.current = false;
		setStatus('Session running. Keeping this device awake.');
		try {
			await journeyStore.save(journey);
			await loadJourneys();
			await activateKeepAwakeAsync(keepAwakeTag);
			await operation(setStatus, function (fileName, data): void {
				journey.files.push({ fileName: fileName, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> });
			});
			journey.outcome = 'completed';
			setStatus('Session finished.');
		} catch (error) {
			journey.outcome = didStopCurrentSession.current ? 'stopped-early' : 'failed';
			setStatus(errorMessage(error));
		} finally {
			journey.endedAt = new Date().toISOString();
			await journeyStore.save(journey);
			await loadJourneys();
			deactivateKeepAwake(keepAwakeTag);
			setIsRunning(false);
		}
	}, [isRunning, loadJourneys]);

	function stopSession(): void {
		didStopCurrentSession.current = true;
		sessionRunner.stopCurrentSession();
		setStatus('Stopping session...');
	}

	function runSavedProfile(profile: StoredProfile): void {
		try {
			const resolved = resolveSequenceProfile(profile.profile, profiles);
			runnableProfileSteps(resolved);
			void run(resolved, async function (setSessionStatus, onGeneratedFile): Promise<void> {
				await sessionRunner.runProfile(deviceAddress, resolved, setSessionStatus, onGeneratedFile);
			});
		} catch (error) {
			setStatus(errorMessage(error));
			if (BrainlightError.isInstance(error) || profile.profile.kind === 'sequence') {
				openProfileEditor(profile);
			}
		}
	}

	async function rateJourney(journey: Journey, rating: JourneyRating): Promise<void> {
		try {
			const updatedJourney: Journey = { ...journey };
			const updatedRating = rating === 1 ? increaseJourneyRating(journey.rating) : decreaseJourneyRating(journey.rating);
			if (updatedRating === 0) {
				delete updatedJourney.rating;
			} else {
				updatedJourney.rating = updatedRating;
			}
			await journeyStore.save(updatedJourney);
			await loadJourneys();
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function deleteJourney(journey: Journey): Promise<void> {
		try {
			await journeyStore.remove(journey.id);
			await loadJourneys();
			setStatus(`Deleted journal record for ${journey.profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function openJournalEntry(journey: Journey): void {
		setJournalEntryJourney(journey);
		setJournalEntryText(journey.journalEntry ?? '');
	}

	async function saveJournalEntry(): Promise<void> {
		if (journalEntryJourney === undefined) {
			return;
		}
		try {
			const text = journalEntryText.trim();
			const updatedJourney: Journey = { ...journalEntryJourney };
			if (text === '') {
				delete updatedJourney.journalEntry;
			} else {
				updatedJourney.journalEntry = text;
			}
			await journeyStore.save(updatedJourney);
			await loadJourneys();
			setJournalEntryJourney(undefined);
			setJournalEntryText('');
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function deleteProfile(profile: StoredProfile): Promise<void> {
		try {
			await profileStore.remove(profile.id);
			await loadProfiles();
			setStatus(`Deleted ${profile.profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function openProfileEditor(profile: StoredProfile): void {
		if (profile.profile.kind === 'ai') {
			setStatus('This profile type cannot be edited.');
			return;
		}
		setEditingProfileID(profile.id);
		if (profile.profile.kind === 'file') {
			setProfileEditor({
				kind: 'file',
				name: profile.profile.name,
				fileName: profile.profile.fileName,
				fileJSON: JSON.stringify(profile.profile.fileData, undefined, 2),
				randomForm: defaultFormValues,
				steps: []
			});
			return;
		}
		if (profile.profile.kind === 'sequence') {
			setProfileEditor({
				kind: 'sequence',
				name: profile.profile.name,
				fileName: 'session.vnp0',
				fileJSON: '{}',
				randomForm: defaultFormValues,
				steps: profile.profile.steps
			});
			return;
		}
		setProfileEditor({
			kind: 'random',
			name: profile.profile.name,
			fileName: 'session.vnp0',
			fileJSON: '{}',
			randomForm: randomFormFromProfile(profile.profile),
			steps: []
		});
	}

	function openProfileImport(): void {
		setEditingProfileID(undefined);
		setSharedProfileJSON('');
		setIsImportingProfile(true);
	}

	function openProfileCreation(): void {
		setEditingProfileID(undefined);
		setProfileEditor(undefined);
		setIsCreatingProfile(true);
	}

	function selectNewProfileKind(kind: ProfileEditorValues['kind']): void {
		if (kind === 'file') {
			setProfileEditor({
				kind: 'file',
				name: 'My file session',
				fileName: 'tmp1.vnp0',
				fileJSON: defaultFileProfileJSON,
				randomForm: defaultFormValues,
				steps: []
			});
			return;
		}
		let name = 'My random session';
		if (kind === 'sequence') {
			name = 'My sequence';
		}
		setProfileEditor({
			kind: kind,
			name: name,
			fileName: 'session.vnp0',
			fileJSON: '{}',
			randomForm: defaultFormValues,
			steps: []
		});
	}

	function closeProfileDocumentModal(): void {
		setEditingProfileID(undefined);
		setProfileEditor(undefined);
		setIsCreatingProfile(false);
		setIsImportingProfile(false);
		setSharedProfileJSON('');
	}

	async function saveNewProfile(): Promise<void> {
		if (profileEditor === undefined) {
			setStatus('Select a profile type first.');
			return;
		}
		try {
			const profile = profileFromEditorValues(profileEditor);
			await profileStore.save(profile);
			await loadProfiles();
			closeProfileDocumentModal();
			setStatus(`Saved ${profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function saveEditedProfile(): Promise<void> {
		if (editingProfileID === undefined || profileEditor === undefined) {
			setStatus('No profile is selected for editing.');
			return;
		}
		try {
			const profile = profileFromEditorValues(profileEditor);
			await profileStore.save(profile, editingProfileID);
			await loadProfiles();
			closeProfileDocumentModal();
			setStatus(`Saved ${profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function updateProfileEditor(change: (current: ProfileEditorValues) => ProfileEditorValues): void {
		setProfileEditor(function (current): ProfileEditorValues | undefined {
			if (current === undefined) {
				return(undefined);
			}
			return(change(current));
		});
	}

	async function importSharedProfile(): Promise<void> {
		try {
			const imported = await profileStore.importSharedProfile(sharedProfileJSON);
			await loadProfiles();
			closeProfileDocumentModal();
			setStatus(`Imported ${imported.profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function shareProfile(profile: StoredProfile): Promise<void> {
		try {
			const serializedProfile = encapsulateSharedProfile(profile.profile, profiles);
			if (Platform.OS === 'web') {
				await Clipboard.setStringAsync(serializedProfile);
				setStatus(`${profile.profile.name} copied to the clipboard.`);
				return;
			}
			await Share.share({ title: profile.profile.name, message: serializedProfile });
			setStatus(`${profile.profile.name} is ready to share.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function selectDevice(address: string): Promise<void> {
		try {
			const history = await deviceStore.select(address);
			setSavedDevices(history.devices);
			setDeviceAddress(address);
			setIsAddingDevice(false);
			setStatus(`Using ${address}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function addDevice(): Promise<void> {
		await addDeviceAtAddress(newDeviceAddress);
	}

	async function addDeviceAtAddress(address: string): Promise<void> {
		try {
			const history = await deviceStore.addAndSelect(address);
			setSavedDevices(history.devices);
			if (history.lastUsedAddress !== undefined) {
				setDeviceAddress(history.lastUsedAddress);
			}
			setIsAddingDevice(false);
			setScannedAddresses([]);
			setStatus(`Added ${address.trim()} and selected it.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function scanDevices(): Promise<void> {
		try {
			setStatus(`Scanning ${subnetPrefix.trim()}.0/24 for responsive devices...`);
			const addresses = await scanLocalSubnet(subnetPrefix);
			setScannedAddresses(addresses);
			if (addresses.length === 0) {
				setStatus('No responsive addresses were found.');
				return;
			}
			setStatus(`Found ${addresses.length} responsive address(es). Select one to add it.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function renderProfile(item: StoredProfile): React.JSX.Element {
		let validationErrors: BrainlightError[] = [];
		if (item.profile.kind === 'random') {
			validationErrors = getRandomFormValidationErrors(randomFormFromProfile(item.profile));
		}
		let sequenceError: string | undefined;
		if (item.profile.kind === 'sequence') {
			try {
				runnableProfileSteps(item.profile, profiles);
			} catch (error) {
				sequenceError = errorMessage(error);
			}
		}
		return(
			<View style={styles.profile}>
				<View style={styles.profileText}>
					<Text style={styles.profileName}>{item.profile.name}</Text>
					<Text style={styles.profileDescription}>{profileDescription(item.profile)}</Text>
					{validationErrors.length > 0 && <Text style={styles.fieldError}>Cannot run: {validationErrors[0]?.message} Edit the highlighted fields.</Text>}
					{sequenceError !== undefined && <Text style={styles.fieldError}>Cannot run: {sequenceError}</Text>}
					{item.profile.kind === 'sequence' && <SequenceSteps steps={item.profile.steps} profiles={profiles} />}
				</View>
				<View style={styles.profileButtons}>
					<Button title="Run" disabled={isRunning || item.profile.kind === 'ai' || validationErrors.length > 0 || sequenceError !== undefined} onPress={function (): void { runSavedProfile(item); }} />
					<Button title="View / edit" disabled={isRunning} onPress={function (): void { openProfileEditor(item); }} />
					<Button title="Share / copy" disabled={isRunning} onPress={function (): void { void shareProfile(item); }} />
					<Button title="Delete" color="#75113d" disabled={isRunning} onPress={function (): void { void deleteProfile(item); }} />
				</View>
			</View>
		);
	}

	function renderJourney(journey: Journey): React.JSX.Element {
		return(
			<View key={journey.id} style={styles.journey}>
				<View style={styles.profileText}>
					<Text style={styles.profileName}>{journey.profile.name}</Text>
					<Text style={styles.profileDescription}>{profileDescription(journey.profile)}</Text>
					<Text style={styles.profileDescription}>{journeyDescription(journey)}</Text>
					<Text style={styles.profileDescription}>{journey.files.length} file(s) recorded.</Text>
					{journey.journalEntry === undefined ? null : <Text style={styles.journalEntry}>{journey.journalEntry}</Text>}
				</View>
				<View style={styles.profileButtons}>
					<JourneyRatingButton thumb="👍" count={journey.rating !== undefined && journey.rating > 0 ? journey.rating : 1} color={journey.rating !== undefined && journey.rating > 0 ? '#198754' : '#666'} disabled={journey.outcome === 'running'} onPress={function (): void { void rateJourney(journey, 1); }} />
					<JourneyRatingButton thumb="👎" count={journey.rating !== undefined && journey.rating < 0 ? Math.abs(journey.rating) : 1} color={journey.rating !== undefined && journey.rating < 0 ? '#c62828' : '#666'} disabled={journey.outcome === 'running'} onPress={function (): void { void rateJourney(journey, -1); }} />
					<Button title="Journal entry" disabled={journey.outcome === 'running'} onPress={function (): void { openJournalEntry(journey); }} />
					<Button title="View parameters" disabled={journey.outcome === 'running'} onPress={function (): void { setParametersJourney(journey); }} />
					<Button title="Delete" color="#75113d" disabled={journey.outcome === 'running'} onPress={function (): void { void deleteJourney(journey); }} />
				</View>
			</View>
		);
	}

	function renderAddDeviceForm(): React.ReactNode {
		if (!isAddingDevice) {
			return(null);
		}
		return(
			<View style={styles.addDevice}>
				<Field label="New device address" value={newDeviceAddress} onChangeText={setNewDeviceAddress} autoCapitalize="none" />
				<Button title="Add and select device" disabled={isRunning} onPress={function (): void { void addDevice(); }} />
				<Field label="Subnet to scan (first three IPv4 parts)" value={subnetPrefix} onChangeText={setSubnetPrefix} autoCapitalize="none" />
				<Button title="Scan local subnet" disabled={isRunning} onPress={function (): void { void scanDevices(); }} />
				{scannedAddresses.map(function (address): React.JSX.Element {
					return(
						<View key={address} style={styles.scannedDevice}>
							<Text style={styles.profileDescription}>{address}</Text>
							<Button title="Add and select" disabled={isRunning} onPress={function (): void { setNewDeviceAddress(address); void addDeviceAtAddress(address); }} />
						</View>
					);
				})}
			</View>
		);
	}

	function selectedDevicePickerValue(): string {
		if (isAddingDevice) {
			return(addDevicePickerValue);
		}
		return(deviceAddress);
	}

	function renderEmptyProfiles(): React.ReactNode {
		if (profiles.length === 0) {
			return(<Text style={styles.empty}>No saved profiles yet.</Text>);
		}
		return(null);
	}

	function renderStopSessionButton(): React.ReactNode {
		if (!isRunning) {
			return(null);
		}
		return(<Button title="Stop session" color="#75113d" onPress={stopSession} />);
	}

	let statusBarStyle: 'light' | 'dark' = 'light';
	if (settings.useSystemColors && colorScheme !== 'dark') {
		statusBarStyle = 'dark';
	}
	return(
		<SafeAreaProvider>
			<ThemeContext.Provider value={theme}>
			<SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
				<StatusBar style={statusBarStyle} />
				<View style={styles.appHeader}>
					<Pressable accessibilityRole="button" accessibilityLabel="Open menu" accessibilityState={{ expanded: isMenuOpen }} onPress={function (): void { setIsMenuOpen(true); }} style={styles.menuButton}>
						<View style={styles.menuLine} /><View style={styles.menuLine} /><View style={styles.menuLine} />
					</Pressable>
					<Text style={styles.headerTitle}>Brain Kandi</Text>
				</View>
				<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoidingView}>
					<ScrollView
						contentContainerStyle={styles.container}
						keyboardShouldPersistTaps="handled"
					>
						<Image source={require('./logo/brainkandi.png')} style={styles.logo} resizeMode="contain" />
						<Text style={styles.status}>{status}</Text>
						<Text style={styles.activeDevice}>Device: {deviceAddress}</Text>
						{renderStopSessionButton()}

						<Section title="Saved profiles">
							<Text style={styles.help}>Share a profile to send it without a central server.</Text>
							<Button title="New profile" disabled={isRunning} onPress={openProfileCreation} />
							<Button title="Import shared profile" disabled={isRunning} onPress={openProfileImport} />
							{profiles.map(function (profile): React.JSX.Element {
								return(renderProfile(profile));
							})}
							{renderEmptyProfiles()}
						</Section>

						<Section title="Journal">
							<Text style={styles.help}>Each session keeps the profile settings it started with, even if that profile is later changed.</Text>
							{journeys.slice(0, visibleJourneyCount).map(renderJourney)}
							{journeys.length === 0 ? <Text style={styles.empty}>No journal records yet.</Text> : null}
							{journeys.length > visibleJourneyCount ? <Button title={`View ${Math.min(10, journeys.length - visibleJourneyCount)} more journal records`} onPress={function (): void { setVisibleJourneyCount(function (count): number { return(count + 10); }); }} /> : null}
						</Section>

					</ScrollView>
				</KeyboardAvoidingView>
				<Modal transparent visible={isMenuOpen} animationType="fade" onRequestClose={function (): void { setIsMenuOpen(false); }}>
					<View style={styles.menuOverlay}>
						<Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss menu" onPress={function (): void { setIsMenuOpen(false); }} />
						<SafeAreaView style={styles.menuPanel}>
							<Text style={styles.sectionTitle}>Menu</Text>
							<Button title="Settings" onPress={function (): void { setIsMenuOpen(false); setIsSettingsOpen(true); }} />
							<Button title="Close menu" onPress={function (): void { setIsMenuOpen(false); }} />
						</SafeAreaView>
					</View>
				</Modal>
				<Modal visible={isSettingsOpen} animationType="slide" onRequestClose={function (): void { setIsSettingsOpen(false); }}>
					<SafeAreaView style={styles.documentModal}>
						<View style={styles.settingsHeader}>
							<Text style={styles.documentModalTitle}>Settings</Text>
							<Button title="Back" onPress={function (): void { setIsSettingsOpen(false); }} />
						</View>
						<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoidingView}>
							<ScrollView contentContainerStyle={styles.editorForm} keyboardShouldPersistTaps="handled">
								<Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
								<Section title="Appearance">
									<View style={styles.settingRow}>
										<Text style={styles.label}>Use system colors</Text>
										<Switch accessibilityLabel="Use system colors" value={settings.useSystemColors} disabled={isLoadingSettings || isSavingSettings} onValueChange={function (value): void { void changeUseSystemColors(value); }} />
									</View>
									<Text style={styles.help}>Follow the system light or dark appearance instead of Brain Kandi colors.</Text>
								</Section>
								<Section title="Devices">
									<Text style={styles.label}>Previously used device</Text>
									<Picker enabled={!isRunning} accessibilityLabel="Previously used device" selectedValue={selectedDevicePickerValue()} onValueChange={function (address: string): void {
										if (address === addDevicePickerValue) {
											setIsAddingDevice(true);
											return;
										}
										void selectDevice(address);
									}} style={styles.picker}>
										{savedDevices.map(function (device): React.JSX.Element {
											return(<Picker.Item key={device.address} label={device.address} value={device.address} />);
										})}
										<Picker.Item label="Add a new device…" value={addDevicePickerValue} />
									</Picker>
									{renderAddDeviceForm()}
								</Section>
							</ScrollView>
						</KeyboardAvoidingView>
					</SafeAreaView>
				</Modal>
				<ProfileEditorModal
					title="New profile"
					visible={isCreatingProfile}
					values={profileEditor}
					onChangeValues={updateProfileEditor}
					onSelectKind={selectNewProfileKind}
					onClose={closeProfileDocumentModal}
					onSave={function (): void { void saveNewProfile(); }}
					saveTitle="Save profile"
					profiles={profiles}
					editingProfileID={editingProfileID}
				/>
				<ProfileEditorModal
					title="Edit profile"
					visible={editingProfileID !== undefined}
					values={profileEditor}
					onChangeValues={updateProfileEditor}
					onSelectKind={selectNewProfileKind}
					onClose={closeProfileDocumentModal}
					onSave={function (): void { void saveEditedProfile(); }}
					saveTitle="Save changes"
					profiles={profiles}
					editingProfileID={editingProfileID}
				/>
				<ProfileDocumentModal
					title="Import shared profile"
					visible={isImportingProfile}
					value={sharedProfileJSON}
					onChangeText={setSharedProfileJSON}
					onClose={closeProfileDocumentModal}
					onSave={function (): void { void importSharedProfile(); }}
					saveTitle="Import profile"
				/>
				<JourneyJournalModal
					journey={journalEntryJourney}
					value={journalEntryText}
					onChangeText={setJournalEntryText}
					onClose={function (): void { setJournalEntryJourney(undefined); setJournalEntryText(''); }}
					onSave={function (): void { void saveJournalEntry(); }}
				/>
				<JourneyParametersModal journey={parametersJourney} onClose={function (): void { setParametersJourney(undefined); }} />
			</SafeAreaView>
			</ThemeContext.Provider>
		</SafeAreaProvider>
	);
}

function Button(props: React.ComponentProps<typeof NativeButton>): React.JSX.Element {
	const { colors } = useContext(ThemeContext);
	let color = props.color;
	if (color === '#75113d') {
		color = colors.destructive;
	} else if (color === undefined && colors !== brandColors) {
		color = colors.button;
	}
	return(<NativeButton {...props} color={color} />);
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	return(
		<View style={styles.section}>
			<Text style={styles.sectionTitle}>{title}</Text>
			{children}
		</View>
	);
}

function Field(props: {
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	keyboardType?: 'default' | 'numeric';
	autoCapitalize?: 'none';
	helpText?: string;
	error?: string | undefined;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	const [isShowingHelp, setIsShowingHelp] = useState(false);

	return(
		<View style={styles.field}>
			<View style={styles.labelRow}>
				<Text style={styles.label}>{props.label}</Text>
				{renderFieldHelp(props.label, props.helpText, isShowingHelp, setIsShowingHelp, styles)}
			</View>
			<TextInput
				value={props.value}
				onChangeText={props.onChangeText}
				keyboardType={props.keyboardType}
				autoCapitalize={props.autoCapitalize}
				style={[styles.input, props.error !== undefined && styles.invalidInput]}
				accessibilityLabel={props.label}
				accessibilityHint={props.error}
			/>
			{props.error !== undefined && <Text style={styles.fieldError} accessibilityLiveRegion="polite">{props.error}</Text>}
		</View>
	);
}

function renderFieldHelp(label: string, helpText: string | undefined, isShowingHelp: boolean, setIsShowingHelp: (visible: boolean) => void, styles: ReturnType<typeof createStyles>): React.ReactNode {
	if (helpText === undefined) {
		return(null);
	}
	return(
		<>
			<Pressable
				accessibilityLabel={`Information about ${label}`}
				accessibilityRole="button"
				onPress={function (): void { setIsShowingHelp(true); }}
				style={styles.informationButton}
			>
				<Text style={styles.informationButtonText}>i</Text>
			</Pressable>
			<Modal animationType="fade" transparent visible={isShowingHelp} onRequestClose={function (): void { setIsShowingHelp(false); }}>
				<View style={styles.helpOverlay}>
					<View style={styles.helpDialog}>
						<Text style={styles.helpTitle}>{label}</Text>
						<Text style={styles.helpDialogText}>{helpText}</Text>
						<Button title="Close" onPress={function (): void { setIsShowingHelp(false); }} />
					</View>
				</View>
			</Modal>
		</>
	);
}

function SequenceSteps(props: {
	steps: SequenceStep[];
	profiles: StoredProfile[];
	onChange?: (steps: SequenceStep[]) => void;
	depth?: number;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	const depth = props.depth ?? 1;
	function move(index: number, offset: number): void {
		const steps = [...props.steps];
		const current = steps[index];
		const other = steps[index + offset];
		if (current === undefined || other === undefined) {
			return;
		}
		steps[index] = other;
		steps[index + offset] = current;
		props.onChange?.(steps);
	}
	return(
		<View style={styles.sequenceSteps}>
			{props.steps.map(function (step, index): React.JSX.Element {
				const source = props.profiles.find(function (item): boolean { return(item.id === step.profileID); });
				let name = step.profile.name;
				let effectiveProfile = step.profile;
				if (step.mode === 'reference' && source !== undefined) {
					name = source.profile.name;
					if (source.profile.kind !== 'ai') {
						effectiveProfile = source.profile;
					}
				}
				let suffix = '';
				if (sequenceStepHasChanged(step, props.profiles)) {
					suffix = ' \u2022';
				}
				return(
					<View key={index} style={styles.sequenceStep}>
						<Text style={styles.profileDescription}>{index + 1}. {name}{suffix}</Text>
						<Text style={styles.help}>By {step.mode}</Text>
						{effectiveProfile.kind === 'sequence' && depth < maximumSequenceDepth && <View style={styles.sequenceNestedSteps}>
							<SequenceSteps steps={effectiveProfile.steps} profiles={props.profiles} depth={depth + 1} />
						</View>}
						{props.onChange !== undefined && <View style={styles.sequenceStepButtons}>
							<Button title="Move up" disabled={index === 0} onPress={function (): void { move(index, -1); }} />
							<Button title="Move down" disabled={index === props.steps.length - 1} onPress={function (): void { move(index, 1); }} />
							<Button title="Change inclusion" onPress={function (): void {
								let mode: SequenceStep['mode'] = 'reference';
								if (step.mode === 'reference') {
									mode = 'value';
								}
								const updated = createSequenceStep({ id: step.profileID, profile: sequenceStepProfile(step, props.profiles) }, mode);
								props.onChange?.(props.steps.map(function (item, itemIndex): SequenceStep {
									if (itemIndex === index) {
										return(updated);
									}
									return(item);
								}));
							}} />
							<Button title="Remove step" color="#75113d" onPress={function (): void {
								props.onChange?.(props.steps.filter(function (_, itemIndex): boolean { return(itemIndex !== index); }));
							}} />
						</View>}
					</View>
				);
			})}
		</View>
	);
}

function ProfileEditorModal(props: {
	title: string;
	visible: boolean;
	values: ProfileEditorValues | undefined;
	onChangeValues: (change: (current: ProfileEditorValues) => ProfileEditorValues) => void;
	onSelectKind: (kind: ProfileEditorValues['kind']) => void;
	onClose: () => void;
	onSave: () => void;
	saveTitle: string;
	profiles: StoredProfile[];
	editingProfileID: ProfileID | undefined;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	const [stepProfileID, setStepProfileID] = useState('');
	const [stepMode, setStepMode] = useState<SequenceStep['mode']>('reference');
	const [isShowingCopyHelp, setIsShowingCopyHelp] = useState(false);
	useEffect(function (): void {
		if (props.visible) {
			setStepProfileID('');
			setStepMode('reference');
			setIsShowingCopyHelp(false);
		}
	}, [props.visible]);
	let validationErrors: BrainlightError[] = [];
	if (props.values?.kind === 'random') {
		validationErrors = getRandomFormValidationErrors(props.values.randomForm);
	}
	function fieldError(field: RandomSessionField): string | undefined {
		return(validationErrors.find(function (error): boolean { return(error.field === field); })?.message);
	}
	function updateRandomForm(change: (form: FormValues) => FormValues): void {
		props.onChangeValues(function (current): ProfileEditorValues {
			return({ ...current, randomForm: change(current.randomForm) });
		});
	}

	function updateFrequencyRange<K extends keyof FrequencyRangeForm>(index: number, name: K, value: FrequencyRangeForm[K]): void {
		updateRandomForm(function (form): FormValues {
			const frequencyRanges = form.frequencyRanges.map(function (range, rangeIndex): FrequencyRangeForm {
				if (rangeIndex !== index) {
					return(range);
				}
				return({ ...range, [name]: value });
			});
			return({ ...form, frequencyRanges: frequencyRanges });
		});
	}

	function renderEditorFields(): React.ReactNode {
		if (props.values === undefined) {
			return(
				<Section title="Profile type">
					<Text style={styles.help}>Choose the type of profile to create.</Text>
					<View style={styles.profileTypeChoices}>
						<Button title="New random profile" onPress={function (): void { props.onSelectKind('random'); }} />
						<Button title="New file profile" onPress={function (): void { props.onSelectKind('file'); }} />
						<Button title="New sequence profile" onPress={function (): void { props.onSelectKind('sequence'); }} />
					</View>
				</Section>
			);
		}
		if (props.values.kind === 'file') {
			return(
				<Section title="File profile">
					<Field label="Profile name" value={props.values.name} onChangeText={function (name): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, name: name }); }); }} />
					<Field label="Device filename" value={props.values.fileName} onChangeText={function (fileName): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, fileName: fileName }); }); }} autoCapitalize="none" />
					<Text style={styles.label}>Session JSON</Text>
					<TextInput multiline value={props.values.fileJSON} onChangeText={function (fileJSON): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, fileJSON: fileJSON }); }); }} style={styles.jsonInput} autoCapitalize="none" />
				</Section>
			);
		}
		if (props.values.kind === 'sequence') {
			const eligible = props.profiles.filter(function (item): boolean {
				return(item.profile.kind !== 'ai' && item.id !== props.editingProfileID);
			});
			const selected = eligible.find(function (item): boolean { return(item.id === stepProfileID); });
			let sequenceError: string | undefined;
			try {
				const sequence = profileFromEditorValues(props.values);
				let candidates = props.profiles;
				if (props.editingProfileID !== undefined) {
					candidates = [...props.profiles.filter(function (item): boolean { return(item.id !== props.editingProfileID); }), { id: props.editingProfileID, profile: sequence }];
				}
				runnableProfileSteps(sequence, candidates);
			} catch (error) {
				sequenceError = errorMessage(error);
			}
			return(
				<Section title="Sequence profile">
					<Field label="Profile name" value={props.values.name} onChangeText={function (name): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, name: name }); }); }} />
					<Text style={styles.help}>Steps run in order. References follow edits to saved profiles; values keep independent copies. A dot after a step name means its stored copy differs from the source, or the source is missing. Nesting is limited to 10 sequence levels.</Text>
					{sequenceError !== undefined && <Text style={styles.fieldError}>Cannot run: {sequenceError}</Text>}
					<SequenceSteps steps={props.values.steps} profiles={props.profiles} onChange={function (steps): void {
						props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, steps: steps }); });
					}} />
					<Text style={styles.label}>Profile for next step</Text>
					<Picker accessibilityLabel="Profile for next step" selectedValue={stepProfileID} onValueChange={function (value: string): void { setStepProfileID(value); }} style={styles.picker}>
						<Picker.Item label="Select a saved profile" value="" />
						{eligible.map(function (item): React.JSX.Element { return(<Picker.Item key={item.id} label={item.profile.name} value={item.id} />); })}
					</Picker>
					<View style={styles.settingRow}>
						<View style={styles.labelRow}>
							<Text style={styles.label}>Copy into sequence</Text>
							{renderFieldHelp('Copy into sequence', 'On: copy the profile into this sequence (by value). Later edits to the saved profile do not change this copy. Off: include the saved profile by reference, so later edits apply to this sequence too. Copying a Sequence preserves any references within its steps.', isShowingCopyHelp, setIsShowingCopyHelp, styles)}
						</View>
						<Switch accessibilityLabel="Copy into sequence" value={stepMode === 'value'} onValueChange={function (copy): void {
							if (copy) {
								setStepMode('value');
							} else {
								setStepMode('reference');
							}
						}} />
					</View>
					<Button title="Add step" disabled={selected === undefined} onPress={function (): void {
						if (selected !== undefined) {
							const step = createSequenceStep(selected, stepMode);
							props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, steps: [...current.steps, step] }); });
						}
					}} />
					{eligible.length === 0 && <Text style={styles.help}>Save a Random, File, or Sequence profile first.</Text>}
				</Section>
			);
		}
		return(
			<Section title="Random profile">
				<Field label="Profile name" value={props.values.name} onChangeText={function (name): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, name: name }); }); }} />
				<Field label="Generated file name prefix" error={fieldError('basename')} value={props.values.randomForm.basename} onChangeText={function (basename): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, basename: basename } }); }); }} autoCapitalize="none" helpText="The beginning of each generated filename on the device. Must not contain a period." />
				<Field label="Duration (minutes)" error={fieldError('duration')} value={props.values.randomForm.duration} onChangeText={function (duration): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, duration: duration } }); }); }} keyboardType="numeric" helpText="The total session duration: a whole number from 1 through 60 minutes." />
				{validationErrors.length > 0 && <Text style={styles.fieldError}>This profile can be saved, but cannot run until the highlighted fields are corrected.</Text>}
				<Text style={styles.label}>Frequency ranges</Text>
				{fieldError('frequency.ranges') !== undefined && <Text style={styles.fieldError}>{fieldError('frequency.ranges')}</Text>}
				{props.values.randomForm.frequencyRanges.map(function (range, index): React.JSX.Element {
					return(
						<View key={index} style={styles.frequencyRange}>
								<Field label={`Range ${index + 1} minimum (Hz)`} error={fieldError(`frequency.ranges.${index}.min`)} value={range.min} onChangeText={function (min): void { updateFrequencyRange(index, 'min', min); }} keyboardType="numeric" helpText="The lowest frequency in this range: a whole number from 1 through 9999 Hz." />
								<Field label={`Range ${index + 1} maximum (Hz, optional)`} error={fieldError(`frequency.ranges.${index}.max`)} value={range.max} onChangeText={function (max): void { updateFrequencyRange(index, 'max', max); }} keyboardType="numeric" helpText="The highest frequency in this range, up to 9999 Hz. Leave blank for one exact frequency." />
							{props.values!.randomForm.frequencyRanges.length > 1 ? <Button title="Remove frequency range" color="#75113d" onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyRanges: form.frequencyRanges.filter(function (_, rangeIndex): boolean { return(rangeIndex !== index); }) }); }); }} /> : null}
						</View>
					);
				})}
				<Button title="Add frequency range" onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyRanges: [...form.frequencyRanges, { min: '', max: '' }] }); }); }} />
				<Field label="Off %" error={fieldError('frequency.offPercentage')} value={props.values.randomForm.frequencyOffPercentage} onChangeText={function (frequencyOffPercentage): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyOffPercentage: frequencyOffPercentage }); }); }} keyboardType="numeric" helpText="The percentage chance that each channel is off, independently of the selected frequency and other channels. Use a whole percentage from 0 through 100. Zero or blank means no channels are off; 100 means all channels are off. This is a probability, not a guaranteed exact proportion in each session part." />
				<Button title={`Frequency randomization: ${props.values.randomForm.frequencyPerChannel ? 'per channel' : 'per session'}`} onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyPerChannel: !form.frequencyPerChannel }); }); }} />
				<Field label="Power minimum" error={fieldError('power.min')} value={props.values.randomForm.powerMin} onChangeText={function (powerMin): void { updateRandomForm(function (form): FormValues { return({ ...form, powerMin: powerMin }); }); }} keyboardType="numeric" helpText="The lowest power value used during the session." />
				<Field label="Power maximum (optional)" error={fieldError('power.max')} value={props.values.randomForm.powerMax} onChangeText={function (powerMax): void { updateRandomForm(function (form): FormValues { return({ ...form, powerMax: powerMax }); }); }} keyboardType="numeric" helpText="The highest power value available. Leave blank to use the power minimum throughout the session." />
				<Button title={`Power randomization: ${props.values.randomForm.powerPerChannel ? 'per channel' : 'per session'}`} onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, powerPerChannel: !form.powerPerChannel }); }); }} />
				<Field label="Cross-coupling minimum (optional)" error={fieldError('coupling.min')} value={props.values.randomForm.couplingMin} onChangeText={function (couplingMin): void { updateRandomForm(function (form): FormValues { return({ ...form, couplingMin: couplingMin }); }); }} keyboardType="numeric" helpText="Enables cross-coupling and sets its lowest frequency. Leave both cross-coupling fields blank to disable cross-coupling." />
				<Field label="Cross-coupling maximum (optional)" error={fieldError('coupling.max')} value={props.values.randomForm.couplingMax} onChangeText={function (couplingMax): void { updateRandomForm(function (form): FormValues { return({ ...form, couplingMax: couplingMax }); }); }} keyboardType="numeric" helpText="The highest cross-coupling frequency. Leave blank to use the cross-coupling minimum." />
				<Field label="Cross-coupling distribution (%)" error={fieldError('coupling.distribution')} value={props.values.randomForm.couplingRandomDistribution} onChangeText={function (couplingRandomDistribution): void { updateRandomForm(function (form): FormValues { return({ ...form, couplingRandomDistribution: couplingRandomDistribution }); }); }} keyboardType="numeric" helpText="For each active module, the percentage chance that it applies the cross-coupling setting." />
				<Field label="Phase A probability (%, optional)" error={fieldError('abCoupling.distribution')} value={props.values.randomForm.abCouplingDistribution} onChangeText={function (abCouplingDistribution): void { updateRandomForm(function (form): FormValues { return({ ...form, abCouplingDistribution: abCouplingDistribution }); }); }} keyboardType="numeric" helpText="For each channel, the chance of selecting Phase A rather than Phase B, independent of cross-coupling. Use a whole percentage from 0 through 100. Leave blank for 50%; 0 selects only Phase B and 100 selects only Phase A." />
			</Section>
		);
	}

	return(
		<Modal animationType="slide" visible={props.visible} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoidingModal}>
					<Text style={styles.documentModalTitle}>{props.title}</Text>
					<ScrollView contentContainerStyle={styles.editorForm} keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
						{renderEditorFields()}
					</ScrollView>
					{props.values === undefined ? null : <Button title={props.saveTitle} onPress={props.onSave} />}
					<Button title="Cancel" color="#75113d" onPress={props.onClose} />
				</KeyboardAvoidingView>
			</SafeAreaView>
		</Modal>
	);
}

function ProfileDocumentModal(props: {
	title: string;
	visible: boolean;
	value: string;
	onChangeText: (value: string) => void;
	onClose: () => void;
	onSave: () => void;
	saveTitle: string;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	return(
		<Modal animationType="slide" visible={props.visible} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoidingModal}>
					<Text style={styles.documentModalTitle}>{props.title}</Text>
					<Text style={styles.help}>Paste a shared profile document.</Text>
					<TextInput multiline value={props.value} onChangeText={props.onChangeText} style={styles.documentInput} autoCapitalize="none" />
					<Button title={props.saveTitle} onPress={props.onSave} />
					<Button title="Cancel" color="#75113d" onPress={props.onClose} />
				</KeyboardAvoidingView>
			</SafeAreaView>
		</Modal>
	);
}

function JourneyJournalModal(props: {
	journey: Journey | undefined;
	value: string;
	onChangeText: (value: string) => void;
	onClose: () => void;
	onSave: () => void;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	return(
		<Modal animationType="slide" visible={props.journey !== undefined} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoidingModal}>
					<Text style={styles.documentModalTitle}>Journal entry</Text>
					<Text style={styles.help}>Optionally record how this session felt. Leave it blank and save to remove an existing entry.</Text>
					<TextInput multiline value={props.value} onChangeText={props.onChangeText} style={styles.documentInput} textAlignVertical="top" />
					<Button title="Save journal entry" onPress={props.onSave} />
					<Button title="Cancel" color="#75113d" onPress={props.onClose} />
				</KeyboardAvoidingView>
			</SafeAreaView>
		</Modal>
	);
}

function JourneyParametersModal(props: {
	journey: Journey | undefined;
	onClose: () => void;
}): React.JSX.Element {
	const { styles } = useContext(ThemeContext);
	const serializedProfile = props.journey === undefined ? '' : JSON.stringify({
		profile: props.journey.profile,
		files: props.journey.files
	}, undefined, 2);
	return(
		<Modal animationType="slide" visible={props.journey !== undefined} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<Text style={styles.documentModalTitle}>Journal record parameters</Text>
				<Text style={styles.help}>These are the exact profile settings and device files saved when this session began.</Text>
				<TextInput editable={false} multiline value={serializedProfile} style={styles.documentInput} textAlignVertical="top" />
				<Button title="Close" onPress={props.onClose} />
			</SafeAreaView>
		</Modal>
	);
}

async function configureSessionNotifications(): Promise<void> {
	if (Platform.OS === 'web') {
		return;
	}
	await Notifications.setNotificationCategoryAsync(sessionNotificationCategoryID, [
		{
			identifier: stopSessionNotificationActionID,
			buttonTitle: 'Stop session',
			options: { opensAppToForeground: true }
		}
	]);
	const permissions = await Notifications.getPermissionsAsync();
	if (permissions.status !== 'granted') {
		await Notifications.requestPermissionsAsync();
	}
}

async function updateSessionNotification(isRunning: boolean, status: string, notificationID: React.MutableRefObject<string | undefined>, notificationVersion: React.MutableRefObject<number>): Promise<void> {
	if (Platform.OS === 'web') {
		return;
	}
	const updateVersion = notificationVersion.current;
	if (notificationID.current !== undefined) {
		await Notifications.dismissNotificationAsync(notificationID.current);
		if (notificationVersion.current !== updateVersion) {
			return;
		}
		notificationID.current = undefined;
	}
	if (!isRunning) {
		return;
	}
	const permissions = await Notifications.getPermissionsAsync();
	if (permissions.status !== 'granted') {
		return;
	}
	if (notificationVersion.current !== updateVersion) {
		return;
	}
	const scheduledNotificationID = await Notifications.scheduleNotificationAsync({
		content: {
			title: 'Brain Kandi session',
			body: status,
			categoryIdentifier: sessionNotificationCategoryID,
			sticky: true
		},
		trigger: null
	});
	if (notificationVersion.current !== updateVersion) {
		await Notifications.dismissNotificationAsync(scheduledNotificationID);
		return;
	}
	notificationID.current = scheduledNotificationID;
}

function parseFileData(serialized: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw(new Error('Session JSON is invalid.'));
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw(new Error('Session JSON must contain an object.'));
	}
	return(value as Record<string, unknown>);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return(error.message);
	}
	return('An unknown error occurred.');
}

function createStyles(colors: AppColors) {
	return(StyleSheet.create({
	safeArea: { flex: 1, backgroundColor: colors.background },
	appHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
	headerTitle: { color: colors.onBackground, fontSize: 20, fontWeight: '700' },
	menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', gap: 5 },
	menuLine: { width: 24, height: 3, backgroundColor: colors.onBackground, borderRadius: 2 },
	menuOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
	menuPanel: { backgroundColor: colors.section, padding: 20, gap: 16, width: '80%', maxWidth: 320 },
	settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
	activeDevice: { color: colors.onBackground },
	keyboardAvoidingView: { flex: 1 },
	keyboardAvoidingModal: { flex: 1, gap: 16 },
	container: { padding: 20, gap: 18 },
	list: { paddingBottom: 36 },
	logo: { alignSelf: 'center', height: 190, width: 240 },
	status: { color: colors.onBackground, fontSize: 16, fontWeight: '600' },
	section: { backgroundColor: colors.section, borderRadius: 14, padding: 16, gap: 10 },
	sectionTitle: { color: colors.title, fontSize: 21, fontWeight: '700' },
	help: { color: colors.text, lineHeight: 20 },
	field: { gap: 4 },
	labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
	label: { color: colors.text, flexShrink: 1, fontWeight: '600' },
	input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, color: colors.inputText, minHeight: 42, paddingHorizontal: 10 },
	invalidInput: { backgroundColor: colors.errorSurface, borderColor: colors.error, borderWidth: 2 },
	fieldError: { color: colors.error, fontWeight: '600' },
	picker: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.inputText },
	jsonInput: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, color: colors.inputText, fontFamily: 'monospace', padding: 10, textAlignVertical: 'top' },
	jsonInputCollapsed: { height: 96, maxHeight: 96 },
	jsonInputExpanded: { minHeight: 320 },
	empty: { color: colors.text, fontSize: 16, fontStyle: 'italic' },
	profile: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 2, padding: 14 },
	journey: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 2, padding: 14 },
	profileText: { flex: 1, gap: 3 },
	profileName: { color: colors.text, fontSize: 17, fontWeight: '700' },
	profileDescription: { color: colors.text },
	journalEntry: { color: colors.text, fontStyle: 'italic', lineHeight: 20, marginTop: 4 },
	profileButtons: { gap: 5 },
	ratingButton: { alignItems: 'center', borderRadius: 4, minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 },
	ratingButtonDisabled: { opacity: 0.4 },
	ratingThumbs: { color: '#fff', fontSize: 20, letterSpacing: -10 },
	addDevice: { gap: 10 },
	scannedDevice: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
	helpOverlay: { alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)', flex: 1, justifyContent: 'center', padding: 24 },
	helpDialog: { backgroundColor: colors.helpSurface, borderRadius: 14, gap: 16, maxWidth: 480, padding: 22, width: '100%' },
	helpTitle: { color: colors.title, fontSize: 22, fontWeight: '700' },
	helpDialogText: { color: colors.text, fontSize: 16, lineHeight: 23 },
	informationButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: 13, height: 26, justifyContent: 'center', width: 26 },
	informationButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
	documentModal: { backgroundColor: colors.background, flex: 1, gap: 16, padding: 20 },
	documentModalTitle: { color: colors.onBackground, fontSize: 26, fontWeight: '800' },
	documentInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.inputText, flex: 1, fontFamily: 'monospace', padding: 12, textAlignVertical: 'top' },
	editorForm: { gap: 10, paddingBottom: 8 },
	profileTypeChoices: { gap: 10 },
	frequencyRange: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: 8, padding: 10 },
	sequenceSteps: { gap: 8 },
	sequenceNestedSteps: { marginLeft: 12 },
	sequenceStep: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, padding: 10, gap: 5 },
	sequenceStepButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }
	}));
}
