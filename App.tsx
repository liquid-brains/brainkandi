import { useCallback, useEffect, useRef, useState } from 'react';
import {
	Button,
	Image,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	Text,
	TextInput,
	View
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';

import { SessionRunner, VielightDeviceFactory } from './src/core/device-client';
import { scanLocalSubnet } from './src/core/device-scanner';
import { AsyncStorageDeviceStore } from './src/core/device-store';
import { AsyncStorageProfileStore } from './src/core/profile-store';
import { AsyncStorageJourneyStore, createJourneyID } from './src/core/journey-store';
import type { SavedDevice } from './src/core/device-store';
import type { Journey, JourneyFile, JourneyRating } from './src/core/journey-store';
import { decapsulateSharedProfile, encapsulateSharedProfile } from './src/core/profile-codec';
import type { ProfileID, RandomSessionParameters, SessionProfile, StoredProfile } from './src/core/profiles';
import { validateRandomSessionParameters } from './src/core/profiles';

const profileStore = new AsyncStorageProfileStore();
const deviceStore = new AsyncStorageDeviceStore();
const journeyStore = new AsyncStorageJourneyStore();
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

type FormValues = {
	basename: string;
	duration: string;
	frequencyRanges: FrequencyRangeForm[];
	frequencyPerChannel: boolean;
	couplingMin: string;
	couplingMax: string;
	couplingRandomDistribution: string;
	powerMin: string;
	powerMax: string;
	powerPerChannel: boolean;
};

type FrequencyRangeForm = {
	min: string;
	max: string;
};

const defaultFormValues: FormValues = {
	basename: 'random',
	duration: '5',
	frequencyRanges: [{ min: '10', max: '' }],
	frequencyPerChannel: false,
	couplingMin: '',
	couplingMax: '',
	couplingRandomDistribution: '50',
	powerMin: '1',
	powerMax: '',
	powerPerChannel: true
};

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
	kind: 'file' | 'random';
	name: string;
	fileName: string;
	fileJSON: string;
	randomForm: FormValues;
};

function optionalNumber(value: string): number | undefined {
	if (value.trim() === '') {
		return(undefined);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw(new Error(`"${value}" is not a number.`));
	}
	return(parsed);
}

function requiredNumber(value: string, name: string): number {
	const parsed = optionalNumber(value);
	if (parsed === undefined) {
		throw(new Error(`${name} is required.`));
	}
	return(parsed);
}

function randomParametersFromForm(values: FormValues): RandomSessionParameters {
	const couplingMin = optionalNumber(values.couplingMin);
	const couplingMax = optionalNumber(values.couplingMax);
	const couplingRandomDistribution = optionalNumber(values.couplingRandomDistribution);
	const powerMax = optionalNumber(values.powerMax);
	const parameters: RandomSessionParameters = {
		duration: requiredNumber(values.duration, 'Duration'),
		frequency: {
			ranges: values.frequencyRanges.map(function (range): RandomSessionParameters['frequency']['ranges'][number] {
				const decodedRange: RandomSessionParameters['frequency']['ranges'][number] = {
					min: requiredNumber(range.min, 'Frequency minimum')
				};
				const maximum = optionalNumber(range.max);
				if (maximum !== undefined) {
					decodedRange.max = maximum;
				}
				return(decodedRange);
			}),
			perChannel: values.frequencyPerChannel
		},
		power: {
			min: requiredNumber(values.powerMin, 'Power minimum'),
			perChannel: values.powerPerChannel
		}
	};
	if (values.basename.trim() !== '') {
		parameters.basename = values.basename.trim();
	}
	if (powerMax !== undefined) {
		parameters.power.max = powerMax;
	}
	if (couplingMin !== undefined) {
		parameters.coupling = { min: couplingMin };
		if (couplingMax !== undefined) {
			parameters.coupling.max = couplingMax;
		}
		if (couplingRandomDistribution !== undefined) {
			parameters.coupling.distribution = couplingRandomDistribution;
		}
	}
	validateRandomSessionParameters(parameters);
	return(parameters);
}

function formValuesFromRandomParameters(parameters: RandomSessionParameters): FormValues {
	return({
		basename: parameters.basename ?? 'random',
		duration: String(parameters.duration),
		frequencyRanges: parameters.frequency.ranges.map(function (range): FrequencyRangeForm {
			return({ min: String(range.min), max: range.max === undefined ? '' : String(range.max) });
		}),
		frequencyPerChannel: parameters.frequency.perChannel ?? false,
		couplingMin: parameters.coupling === undefined ? '' : String(parameters.coupling.min),
		couplingMax: parameters.coupling?.max === undefined ? '' : String(parameters.coupling.max),
		couplingRandomDistribution: parameters.coupling?.distribution === undefined ? '50' : String(parameters.coupling.distribution),
		powerMin: String(parameters.power.min),
		powerMax: parameters.power.max === undefined ? '' : String(parameters.power.max),
		powerPerChannel: parameters.power.perChannel ?? true
	});
}

function profileFromEditorValues(values: ProfileEditorValues): SessionProfile {
	if (values.kind === 'file') {
		return({
			kind: 'file',
			name: values.name,
			fileName: values.fileName,
			fileData: parseFileData(values.fileJSON)
		});
	}
	return({
		kind: 'random',
		name: values.name,
		parameters: randomParametersFromForm(values.randomForm)
	});
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
			const ranges = profile.parameters.frequency.ranges.map(function (range): string {
				return(range.max === undefined ? String(range.min) : `${range.min}-${range.max}`);
			});
			return(`Random: ${profile.parameters.duration} minute(s), ${ranges.join(', ')} Hz`);
		case 'ai':
			return('Unsupported profile type');
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
	const [editingProfileID, setEditingProfileID] = useState<ProfileID | undefined>();
	const [profileEditor, setProfileEditor] = useState<ProfileEditorValues | undefined>();
	const [isCreatingProfile, setIsCreatingProfile] = useState(false);
	const [isImportingProfile, setIsImportingProfile] = useState(false);
	const [sharedProfileJSON, setSharedProfileJSON] = useState('');
	const [journalEntryJourney, setJournalEntryJourney] = useState<Journey | undefined>();
	const [journalEntryText, setJournalEntryText] = useState('');
	const [parametersJourney, setParametersJourney] = useState<Journey | undefined>();

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
		void updateSessionNotification(isRunning, status, sessionNotificationID);
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
		void run(profile.profile, async function (setSessionStatus, onGeneratedFile): Promise<void> {
			await sessionRunner.runProfile(deviceAddress, profile.profile, setSessionStatus, onGeneratedFile);
		});
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
			setStatus(`Deleted journey for ${journey.profile.name}.`);
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
				randomForm: defaultFormValues
			});
			return;
		}
		setProfileEditor({
			kind: 'random',
			name: profile.profile.name,
			fileName: 'session.vnp0',
			fileJSON: '{}',
			randomForm: formValuesFromRandomParameters(profile.profile.parameters)
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
				randomForm: defaultFormValues
			});
			return;
		}
		setProfileEditor({
			kind: 'random',
			name: 'My random session',
			fileName: 'session.vnp0',
			fileJSON: '{}',
			randomForm: defaultFormValues
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
			const profile = decapsulateSharedProfile(sharedProfileJSON);
			await profileStore.save(profile);
			await loadProfiles();
			closeProfileDocumentModal();
			setStatus(`Imported ${profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function shareProfile(profile: StoredProfile): Promise<void> {
		const serializedProfile = encapsulateSharedProfile(profile.profile);
		try {
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
		return(
			<View style={styles.profile}>
				<View style={styles.profileText}>
					<Text style={styles.profileName}>{item.profile.name}</Text>
					<Text style={styles.profileDescription}>{profileDescription(item.profile)}</Text>
				</View>
				<View style={styles.profileButtons}>
					<Button title="Run" disabled={isRunning || item.profile.kind === 'ai'} onPress={function (): void { runSavedProfile(item); }} />
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

	return(
		<SafeAreaProvider>
			<SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
				<StatusBar style="light" />
				<ScrollView
					contentContainerStyle={styles.container}
				>
						<Image source={require('./logo/brainkandi.png')} style={styles.logo} resizeMode="contain" />
						<Text style={styles.status}>{status}</Text>
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

						<Section title="Journeys">
							<Text style={styles.help}>Each session keeps the profile settings it started with, even if that profile is later changed.</Text>
							{journeys.slice(0, visibleJourneyCount).map(renderJourney)}
							{journeys.length === 0 ? <Text style={styles.empty}>No journeys yet.</Text> : null}
							{journeys.length > visibleJourneyCount ? <Button title={`View ${Math.min(10, journeys.length - visibleJourneyCount)} more journeys`} onPress={function (): void { setVisibleJourneyCount(function (count): number { return(count + 10); }); }} /> : null}
						</Section>

						<Section title="Device">
							<Text style={styles.label}>Previously used device</Text>
							<Picker selectedValue={selectedDevicePickerValue()} onValueChange={function (address: string): void {
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
				<ProfileEditorModal
					title="New profile"
					visible={isCreatingProfile}
					values={profileEditor}
					onChangeValues={updateProfileEditor}
					onSelectKind={selectNewProfileKind}
					onClose={closeProfileDocumentModal}
					onSave={function (): void { void saveNewProfile(); }}
					saveTitle="Save profile"
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
		</SafeAreaProvider>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
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
}): React.JSX.Element {
	const [isShowingHelp, setIsShowingHelp] = useState(false);

	return(
		<View style={styles.field}>
			<View style={styles.labelRow}>
				<Text style={styles.label}>{props.label}</Text>
				{renderFieldHelp(props.label, props.helpText, isShowingHelp, setIsShowingHelp)}
			</View>
			<TextInput
				value={props.value}
				onChangeText={props.onChangeText}
				keyboardType={props.keyboardType}
				autoCapitalize={props.autoCapitalize}
				style={styles.input}
			/>
		</View>
	);
}

function renderFieldHelp(label: string, helpText: string | undefined, isShowingHelp: boolean, setIsShowingHelp: (visible: boolean) => void): React.ReactNode {
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

function ProfileEditorModal(props: {
	title: string;
	visible: boolean;
	values: ProfileEditorValues | undefined;
	onChangeValues: (change: (current: ProfileEditorValues) => ProfileEditorValues) => void;
	onSelectKind: (kind: ProfileEditorValues['kind']) => void;
	onClose: () => void;
	onSave: () => void;
	saveTitle: string;
}): React.JSX.Element {
	function updateRandomForm(change: (form: FormValues) => FormValues): void {
		props.onChangeValues(function (current): ProfileEditorValues {
			return({ ...current, randomForm: change(current.randomForm) });
		});
	}

	function updateFrequencyRange(index: number, name: keyof FrequencyRangeForm, value: string): void {
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
		return(
			<Section title="Random profile">
				<Field label="Profile name" value={props.values.name} onChangeText={function (name): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, name: name }); }); }} />
				<Field label="Generated file name prefix" value={props.values.randomForm.basename} onChangeText={function (basename): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, basename: basename } }); }); }} autoCapitalize="none" helpText="The beginning of each generated filename on the device." />
				<Field label="Duration (minutes)" value={props.values.randomForm.duration} onChangeText={function (duration): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, duration: duration } }); }); }} keyboardType="numeric" helpText="The total session duration, in minutes." />
				<Text style={styles.label}>Frequency ranges</Text>
				{props.values.randomForm.frequencyRanges.map(function (range, index): React.JSX.Element {
					return(
						<View key={index} style={styles.frequencyRange}>
							<Field label={`Range ${index + 1} minimum (Hz)`} value={range.min} onChangeText={function (min): void { updateFrequencyRange(index, 'min', min); }} keyboardType="numeric" helpText="The lowest frequency in this range." />
							<Field label={`Range ${index + 1} maximum (Hz, optional)`} value={range.max} onChangeText={function (max): void { updateFrequencyRange(index, 'max', max); }} keyboardType="numeric" helpText="The highest frequency in this range. Leave blank for one exact frequency." />
							{props.values!.randomForm.frequencyRanges.length > 1 ? <Button title="Remove frequency range" color="#75113d" onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyRanges: form.frequencyRanges.filter(function (_, rangeIndex): boolean { return(rangeIndex !== index); }) }); }); }} /> : null}
						</View>
					);
				})}
				<Button title="Add frequency range" onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyRanges: [...form.frequencyRanges, { min: '', max: '' }] }); }); }} />
				<Button title={`Frequency randomization: ${props.values.randomForm.frequencyPerChannel ? 'per channel' : 'per session'}`} onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, frequencyPerChannel: !form.frequencyPerChannel }); }); }} />
				<Field label="Power minimum" value={props.values.randomForm.powerMin} onChangeText={function (powerMin): void { updateRandomForm(function (form): FormValues { return({ ...form, powerMin: powerMin }); }); }} keyboardType="numeric" helpText="The lowest power value used during the session." />
				<Field label="Power maximum (optional)" value={props.values.randomForm.powerMax} onChangeText={function (powerMax): void { updateRandomForm(function (form): FormValues { return({ ...form, powerMax: powerMax }); }); }} keyboardType="numeric" helpText="The highest power value available. Leave blank to use the power minimum throughout the session." />
				<Button title={`Power randomization: ${props.values.randomForm.powerPerChannel ? 'per channel' : 'per session'}`} onPress={function (): void { updateRandomForm(function (form): FormValues { return({ ...form, powerPerChannel: !form.powerPerChannel }); }); }} />
				<Field label="Cross-coupling minimum (optional)" value={props.values.randomForm.couplingMin} onChangeText={function (couplingMin): void { updateRandomForm(function (form): FormValues { return({ ...form, couplingMin: couplingMin }); }); }} keyboardType="numeric" helpText="Enables cross-coupling and sets its lowest frequency. Leave both cross-coupling fields blank to disable cross-coupling." />
				<Field label="Cross-coupling maximum (optional)" value={props.values.randomForm.couplingMax} onChangeText={function (couplingMax): void { updateRandomForm(function (form): FormValues { return({ ...form, couplingMax: couplingMax }); }); }} keyboardType="numeric" helpText="The highest cross-coupling frequency. Leave blank to use the cross-coupling minimum." />
				<Field label="Cross-coupling distribution (%)" value={props.values.randomForm.couplingRandomDistribution} onChangeText={function (couplingRandomDistribution): void { updateRandomForm(function (form): FormValues { return({ ...form, couplingRandomDistribution: couplingRandomDistribution }); }); }} keyboardType="numeric" helpText="For each active module, the percentage chance that it applies the cross-coupling setting." />
			</Section>
		);
	}

	return(
		<Modal animationType="slide" visible={props.visible} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<Text style={styles.documentModalTitle}>{props.title}</Text>
				<ScrollView contentContainerStyle={styles.editorForm} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
					{renderEditorFields()}
				</ScrollView>
				{props.values === undefined ? null : <Button title={props.saveTitle} onPress={props.onSave} />}
				<Button title="Cancel" color="#75113d" onPress={props.onClose} />
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
	return(
		<Modal animationType="slide" visible={props.visible} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<Text style={styles.documentModalTitle}>{props.title}</Text>
				<Text style={styles.help}>Paste a shared profile document.</Text>
				<TextInput multiline value={props.value} onChangeText={props.onChangeText} style={styles.documentInput} autoCapitalize="none" />
				<Button title={props.saveTitle} onPress={props.onSave} />
				<Button title="Cancel" color="#75113d" onPress={props.onClose} />
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
	return(
		<Modal animationType="slide" visible={props.journey !== undefined} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<Text style={styles.documentModalTitle}>Journal entry</Text>
				<Text style={styles.help}>Optionally record how this journey felt. Leave it blank and save to remove an existing entry.</Text>
				<TextInput multiline value={props.value} onChangeText={props.onChangeText} style={styles.documentInput} textAlignVertical="top" />
				<Button title="Save journal entry" onPress={props.onSave} />
				<Button title="Cancel" color="#75113d" onPress={props.onClose} />
			</SafeAreaView>
		</Modal>
	);
}

function JourneyParametersModal(props: {
	journey: Journey | undefined;
	onClose: () => void;
}): React.JSX.Element {
	const serializedProfile = props.journey === undefined ? '' : JSON.stringify({
		profile: props.journey.profile,
		files: props.journey.files
	}, undefined, 2);
	return(
		<Modal animationType="slide" visible={props.journey !== undefined} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<Text style={styles.documentModalTitle}>Journey parameters</Text>
				<Text style={styles.help}>These are the exact profile settings and device files saved when this journey began.</Text>
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

async function updateSessionNotification(isRunning: boolean, status: string, notificationID: React.MutableRefObject<string | undefined>): Promise<void> {
	if (Platform.OS === 'web') {
		return;
	}
	if (notificationID.current !== undefined) {
		await Notifications.dismissNotificationAsync(notificationID.current);
		notificationID.current = undefined;
	}
	if (!isRunning) {
		return;
	}
	const permissions = await Notifications.getPermissionsAsync();
	if (permissions.status !== 'granted') {
		return;
	}
	notificationID.current = await Notifications.scheduleNotificationAsync({
		content: {
			title: 'Brain Kandi session',
			body: status,
			categoryIdentifier: sessionNotificationCategoryID,
			sticky: true
		},
		trigger: null
	});
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

const styles = StyleSheet.create({
	safeArea: { flex: 1, backgroundColor: '#ff1493' },
	container: { padding: 20, gap: 18 },
	list: { paddingBottom: 36 },
	logo: { alignSelf: 'center', height: 190, width: 240 },
	status: { color: '#fff', fontSize: 16, fontWeight: '600' },
	section: { backgroundColor: '#ffde00', borderRadius: 14, padding: 16, gap: 10 },
	sectionTitle: { color: '#75113d', fontSize: 21, fontWeight: '700' },
	help: { color: '#4e1430', lineHeight: 20 },
	field: { gap: 4 },
	labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
	label: { color: '#4e1430', flexShrink: 1, fontWeight: '600' },
	input: { backgroundColor: '#fff', borderColor: '#bd2b72', borderWidth: 1, borderRadius: 8, color: '#280016', minHeight: 42, paddingHorizontal: 10 },
	picker: { backgroundColor: '#fff', borderColor: '#bd2b72', borderRadius: 8, borderWidth: 1, color: '#280016' },
	jsonInput: { backgroundColor: '#fff', borderColor: '#bd2b72', borderWidth: 1, borderRadius: 8, color: '#280016', fontFamily: 'monospace', padding: 10, textAlignVertical: 'top' },
	jsonInputCollapsed: { height: 96, maxHeight: 96 },
	jsonInputExpanded: { minHeight: 320 },
	empty: { color: '#4e1430', fontSize: 16, fontStyle: 'italic' },
	profile: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 2, padding: 14 },
	journey: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 2, padding: 14 },
	profileText: { flex: 1, gap: 3 },
	profileName: { color: '#4e1430', fontSize: 17, fontWeight: '700' },
	profileDescription: { color: '#4e1430' },
	journalEntry: { color: '#4e1430', fontStyle: 'italic', lineHeight: 20, marginTop: 4 },
	profileButtons: { gap: 5 },
	ratingButton: { alignItems: 'center', borderRadius: 4, minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 },
	ratingButtonDisabled: { opacity: 0.4 },
	ratingThumbs: { color: '#fff', fontSize: 20, letterSpacing: -10 },
	addDevice: { gap: 10 },
	scannedDevice: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
	helpOverlay: { alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)', flex: 1, justifyContent: 'center', padding: 24 },
	helpDialog: { backgroundColor: '#fff0f8', borderRadius: 14, gap: 16, maxWidth: 480, padding: 22, width: '100%' },
	helpTitle: { color: '#75113d', fontSize: 22, fontWeight: '700' },
	helpDialogText: { color: '#4e1430', fontSize: 16, lineHeight: 23 },
	informationButton: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#2196f3', borderRadius: 13, height: 26, justifyContent: 'center', width: 26 },
	informationButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
	documentModal: { backgroundColor: '#ff1493', flex: 1, gap: 16, padding: 20 },
	documentModalTitle: { color: '#fff', fontSize: 26, fontWeight: '800' },
	documentInput: { backgroundColor: '#fff', borderColor: '#bd2b72', borderRadius: 8, borderWidth: 1, color: '#280016', flex: 1, fontFamily: 'monospace', padding: 12, textAlignVertical: 'top' },
	editorForm: { gap: 10, paddingBottom: 8 },
	profileTypeChoices: { gap: 10 },
	frequencyRange: { borderColor: '#bd2b72', borderRadius: 8, borderWidth: 1, gap: 8, padding: 10 }
});
