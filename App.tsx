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
import type { SavedDevice } from './src/core/device-store';
import { decapsulateSharedProfile, encapsulateSharedProfile } from './src/core/profile-codec';
import type { ProfileID, RandomSessionParameters, SessionProfile, StoredProfile } from './src/core/profiles';
import { validateRandomSessionParameters } from './src/core/profiles';

const profileStore = new AsyncStorageProfileStore();
const deviceStore = new AsyncStorageDeviceStore();
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
	freqMin: string;
	freqMax: string;
	couplingMin: string;
	couplingMax: string;
	couplingRandomDistribution: string;
	powerMin: string;
	powerMax: string;
};

const defaultFormValues: FormValues = {
	basename: 'random',
	duration: '20',
	freqMin: '10',
	freqMax: '',
	couplingMin: '',
	couplingMax: '',
	couplingRandomDistribution: '50',
	powerMin: '1',
	powerMax: ''
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
	const freqMax = optionalNumber(values.freqMax);
	const powerMax = optionalNumber(values.powerMax);
	const parameters: RandomSessionParameters = {
		duration: requiredNumber(values.duration, 'Duration'),
		freqMin: requiredNumber(values.freqMin, 'Frequency minimum'),
		powerMin: requiredNumber(values.powerMin, 'Power minimum')
	};
	if (values.basename.trim() !== '') {
		parameters.basename = values.basename.trim();
	}
	if (freqMax !== undefined) {
		parameters.freqMax = freqMax;
	}
	if (couplingMin !== undefined) {
		parameters.couplingMin = couplingMin;
	}
	if (couplingMax !== undefined) {
		parameters.couplingMax = couplingMax;
	}
	if (couplingRandomDistribution !== undefined) {
		parameters.couplingRandomDistribution = couplingRandomDistribution;
	}
	if (powerMax !== undefined) {
		parameters.powerMax = powerMax;
	}
	validateRandomSessionParameters(parameters);
	return(parameters);
}

function formValuesFromRandomParameters(parameters: RandomSessionParameters): FormValues {
	return({
		basename: parameters.basename ?? 'random',
		duration: String(parameters.duration),
		freqMin: String(parameters.freqMin),
		freqMax: parameters.freqMax === undefined ? '' : String(parameters.freqMax),
		couplingMin: parameters.couplingMin === undefined ? '' : String(parameters.couplingMin),
		couplingMax: parameters.couplingMax === undefined ? '' : String(parameters.couplingMax),
		couplingRandomDistribution: parameters.couplingRandomDistribution === undefined ? '' : String(parameters.couplingRandomDistribution),
		powerMin: String(parameters.powerMin),
		powerMax: parameters.powerMax === undefined ? '' : String(parameters.powerMax)
	});
}

function profileDescription(profile: SessionProfile): string {
	switch (profile.kind) {
		case 'file':
			return(`File: ${profile.fileName}`);
		case 'random':
			const frequencyMaximum = profile.parameters.freqMax ?? profile.parameters.freqMin;
			return(`Random: ${profile.parameters.duration} minute(s), ${profile.parameters.freqMin}-${frequencyMaximum} Hz`);
		case 'ai':
			return('Unsupported profile type');
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
	const [status, setStatus] = useState('Ready.');
	const [isRunning, setIsRunning] = useState(false);
	const sessionNotificationID = useRef<string | undefined>(undefined);
	const [randomName, setRandomName] = useState('My random session');
	const [randomForm, setRandomForm] = useState<FormValues>(defaultFormValues);
	const [fileName, setFileName] = useState('tmp1.vnp0');
	const [fileProfileName, setFileProfileName] = useState('My file session');
	const [fileJSON, setFileJSON] = useState(defaultFileProfileJSON);
	const [isFileJSONFocused, setIsFileJSONFocused] = useState(false);
	const [editingProfileID, setEditingProfileID] = useState<ProfileID | undefined>();
	const [profileEditor, setProfileEditor] = useState<ProfileEditorValues | undefined>();
	const [isImportingProfile, setIsImportingProfile] = useState(false);
	const [sharedProfileJSON, setSharedProfileJSON] = useState('');

	const loadProfiles = useCallback(async function (): Promise<void> {
		try {
			setProfiles(await profileStore.list());
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
		void loadDevices();
	}, [loadDevices, loadProfiles]);

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

	const run = useCallback(async function (operation: (setSessionStatus: (status: string) => void) => Promise<void>): Promise<void> {
		if (isRunning) {
			return;
		}
		setIsRunning(true);
		setStatus('Session running. Keeping this device awake.');
		try {
			await activateKeepAwakeAsync(keepAwakeTag);
			await operation(setStatus);
			setStatus('Session finished.');
		} catch (error) {
			setStatus(errorMessage(error));
		} finally {
			deactivateKeepAwake(keepAwakeTag);
			setIsRunning(false);
		}
	}, [isRunning]);

	function updateRandomField(name: keyof FormValues, value: string): void {
		setRandomForm(function (current): FormValues {
			return({ ...current, [name]: value });
		});
	}

	async function saveRandomProfile(): Promise<void> {
		try {
			setStatus('Saving random profile...');
			const profile: SessionProfile = {
				kind: 'random',
				name: randomName,
				parameters: randomParametersFromForm(randomForm)
			};
			await profileStore.save(profile);
			await loadProfiles();
			setStatus(`Saved ${profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function runExperiment(): void {
		void run(async function (setSessionStatus): Promise<void> {
			const parameters = randomParametersFromForm(randomForm);
			await sessionRunner.runExperiment(deviceAddress, parameters, setSessionStatus);
		});
	}

	function stopSession(): void {
		sessionRunner.stopCurrentSession();
		setStatus('Stopping session...');
	}

	async function saveFileProfile(): Promise<void> {
		try {
			setStatus('Saving file profile...');
			const data = parseFileData(fileJSON);
			const profile: SessionProfile = {
				kind: 'file',
				name: fileProfileName,
				fileName: fileName,
				fileData: data
			};
			await profileStore.save(profile);
			await loadProfiles();
			setStatus(`Saved ${profile.name}.`);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function runFileDirectly(): void {
		void run(async function (): Promise<void> {
			const profile: SessionProfile = {
				kind: 'file',
				name: fileProfileName,
				fileName: fileName,
				fileData: parseFileData(fileJSON)
			};
			await sessionRunner.runProfile(deviceAddress, profile);
		});
	}

	function runSavedProfile(profile: StoredProfile): void {
		void run(async function (setSessionStatus): Promise<void> {
			await sessionRunner.runProfile(deviceAddress, profile.profile, setSessionStatus);
		});
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

	function closeProfileDocumentModal(): void {
		setEditingProfileID(undefined);
		setProfileEditor(undefined);
		setIsImportingProfile(false);
		setSharedProfileJSON('');
	}

	async function saveEditedProfile(): Promise<void> {
		if (editingProfileID === undefined || profileEditor === undefined) {
			setStatus('No profile is selected for editing.');
			return;
		}
		try {
			let profile: SessionProfile;
			if (profileEditor.kind === 'file') {
				profile = {
					kind: 'file',
					name: profileEditor.name,
					fileName: profileEditor.fileName,
					fileData: parseFileData(profileEditor.fileJSON)
				};
			} else {
				profile = {
					kind: 'random',
					name: profileEditor.name,
					parameters: randomParametersFromForm(profileEditor.randomForm)
				};
			}
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

	function collapseFileJSON(): void {
		setIsFileJSONFocused(false);
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

						<Section title="Experiment">
							<Text style={styles.help}>Run randomized session settings without saving a profile.</Text>
							<Field label="Generated file name prefix" value={randomForm.basename} onChangeText={function (value): void { updateRandomField('basename', value); }} autoCapitalize="none" helpText="The beginning of each generated filename on the device." />
							<Field label="Duration (minutes)" value={randomForm.duration} onChangeText={function (value): void { updateRandomField('duration', value); }} keyboardType="numeric" helpText="The total session duration, in minutes." />
							<Field label="Frequency minimum (Hz)" value={randomForm.freqMin} onChangeText={function (value): void { updateRandomField('freqMin', value); }} keyboardType="numeric" helpText="The lowest stimulation frequency used during the session." />
							<Field label="Frequency maximum (Hz, optional)" value={randomForm.freqMax} onChangeText={function (value): void { updateRandomField('freqMax', value); }} keyboardType="numeric" helpText="The highest stimulation frequency available. Leave blank to use the frequency minimum throughout the session." />
							<Field label="Power minimum" value={randomForm.powerMin} onChangeText={function (value): void { updateRandomField('powerMin', value); }} keyboardType="numeric" helpText="The lowest power value used during the session." />
							<Field label="Power maximum (optional)" value={randomForm.powerMax} onChangeText={function (value): void { updateRandomField('powerMax', value); }} keyboardType="numeric" helpText="The highest power value available. Leave blank to use the power minimum throughout the session." />
							<Field label="Cross-coupling minimum (optional)" value={randomForm.couplingMin} onChangeText={function (value): void { updateRandomField('couplingMin', value); }} keyboardType="numeric" helpText="Enables cross-coupling and sets its lowest frequency. Leave both cross-coupling fields blank to disable cross-coupling." />
							<Field label="Cross-coupling maximum (optional)" value={randomForm.couplingMax} onChangeText={function (value): void { updateRandomField('couplingMax', value); }} keyboardType="numeric" helpText="The highest cross-coupling frequency. Leave blank to use the cross-coupling minimum." />
							<Field label="Cross-coupling distribution (%)" value={randomForm.couplingRandomDistribution} onChangeText={function (value): void { updateRandomField('couplingRandomDistribution', value); }} keyboardType="numeric" helpText="For each active module, the percentage chance that it applies the cross-coupling setting." />
							<Field label="Profile name" value={randomName} onChangeText={setRandomName} />
							<Button title="Run experiment" disabled={isRunning} onPress={runExperiment} />
							<Button title="Save profile" disabled={isRunning} onPress={function (): void { void saveRandomProfile(); }} />
						</Section>

						<Section title="File profile">
							<Text style={styles.help}>Running a file uploads it to the device, runs it, then leaves the uploaded file on the device.</Text>
							<Field label="Profile name" value={fileProfileName} onChangeText={setFileProfileName} />
							<Field label="Device filename" value={fileName} onChangeText={setFileName} autoCapitalize="none" />
							<Text style={styles.label}>Session JSON</Text>
							<TextInput
								multiline
								value={fileJSON}
								onBlur={function (): void { setIsFileJSONFocused(false); }}
								onChangeText={setFileJSON}
								onEndEditing={collapseFileJSON}
								onFocus={function (): void { setIsFileJSONFocused(true); }}
								scrollEnabled={isFileJSONFocused}
								style={[styles.jsonInput, isFileJSONFocused ? styles.jsonInputExpanded : styles.jsonInputCollapsed]}
								autoCapitalize="none"
							/>
							<Button title="Run file directly" disabled={isRunning} onPress={runFileDirectly} />
							<Button title="Save file profile" disabled={isRunning} onPress={function (): void { void saveFileProfile(); }} />
						</Section>

						<Section title="Saved profiles">
							<Text style={styles.help}>Share a profile to send it without a central server.</Text>
							<Button title="Import shared profile" disabled={isRunning} onPress={openProfileImport} />
							{profiles.map(function (profile): React.JSX.Element {
								return(renderProfile(profile));
							})}
							{renderEmptyProfiles()}
						</Section>
				</ScrollView>
				<ProfileEditorModal
					title="Edit profile"
					visible={editingProfileID !== undefined}
					values={profileEditor}
					onChangeValues={updateProfileEditor}
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
	onClose: () => void;
	onSave: () => void;
	saveTitle: string;
}): React.JSX.Element {
	function renderEditorFields(): React.ReactNode {
		if (props.values === undefined) {
			return(null);
		}
		if (props.values.kind === 'file') {
			return(
				<>
					<Field label="Profile name" value={props.values.name} onChangeText={function (name): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, name: name }); }); }} />
					<Field label="Device filename" value={props.values.fileName} onChangeText={function (fileName): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, fileName: fileName }); }); }} autoCapitalize="none" />
					<Text style={styles.label}>Session JSON</Text>
					<TextInput multiline value={props.values.fileJSON} onChangeText={function (fileJSON): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, fileJSON: fileJSON }); }); }} style={styles.jsonInput} autoCapitalize="none" />
				</>
			);
		}
		return(
			<>
				<Field label="Profile name" value={props.values.name} onChangeText={function (name): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, name: name }); }); }} />
				<Field label="Generated file name prefix" value={props.values.randomForm.basename} onChangeText={function (basename): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, basename: basename } }); }); }} autoCapitalize="none" />
				<Field label="Duration (minutes)" value={props.values.randomForm.duration} onChangeText={function (duration): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, duration: duration } }); }); }} keyboardType="numeric" />
				<Field label="Frequency minimum (Hz)" value={props.values.randomForm.freqMin} onChangeText={function (freqMin): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, freqMin: freqMin } }); }); }} keyboardType="numeric" />
				<Field label="Frequency maximum (Hz, optional)" value={props.values.randomForm.freqMax} onChangeText={function (freqMax): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, freqMax: freqMax } }); }); }} keyboardType="numeric" />
				<Field label="Power minimum" value={props.values.randomForm.powerMin} onChangeText={function (powerMin): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, powerMin: powerMin } }); }); }} keyboardType="numeric" />
				<Field label="Power maximum (optional)" value={props.values.randomForm.powerMax} onChangeText={function (powerMax): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, powerMax: powerMax } }); }); }} keyboardType="numeric" />
				<Field label="Cross-coupling minimum (optional)" value={props.values.randomForm.couplingMin} onChangeText={function (couplingMin): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, couplingMin: couplingMin } }); }); }} keyboardType="numeric" />
				<Field label="Cross-coupling maximum (optional)" value={props.values.randomForm.couplingMax} onChangeText={function (couplingMax): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, couplingMax: couplingMax } }); }); }} keyboardType="numeric" />
				<Field label="Cross-coupling distribution (%)" value={props.values.randomForm.couplingRandomDistribution} onChangeText={function (couplingRandomDistribution): void { props.onChangeValues(function (current): ProfileEditorValues { return({ ...current, randomForm: { ...current.randomForm, couplingRandomDistribution: couplingRandomDistribution } }); }); }} keyboardType="numeric" />
			</>
		);
	}

	return(
		<Modal animationType="slide" visible={props.visible} onRequestClose={props.onClose}>
			<SafeAreaView style={styles.documentModal}>
				<Text style={styles.documentModalTitle}>{props.title}</Text>
				<ScrollView contentContainerStyle={styles.editorForm} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
					{renderEditorFields()}
				</ScrollView>
				<Button title={props.saveTitle} onPress={props.onSave} />
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
	profileText: { flex: 1, gap: 3 },
	profileName: { color: '#4e1430', fontSize: 17, fontWeight: '700' },
	profileDescription: { color: '#4e1430' },
	profileButtons: { gap: 5 },
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
	editorForm: { gap: 10, paddingBottom: 8 }
});
