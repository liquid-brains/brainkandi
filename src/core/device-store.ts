import AsyncStorage from '@react-native-async-storage/async-storage';

export type SavedDevice = {
	address: string;
};

export type DeviceHistory = {
	devices: SavedDevice[];
	lastUsedAddress?: string;
};

type StoredDeviceHistory = {
	version: 1;
	devices: SavedDevice[];
	lastUsedAddress?: string;
};

const deviceStorageKey = 'brainkandy.devices.v1';

function validateAddress(address: string): string {
	const normalizedAddress = address.trim();
	if (normalizedAddress === '') {
		throw(new Error('A device address is required.'));
	}
	if (/\s/.test(normalizedAddress)) {
		throw(new Error('A device address cannot contain whitespace.'));
	}
	return(normalizedAddress);
}

export function encapsulateDeviceHistory(history: DeviceHistory): string {
	const devices = history.devices.map(function (device): SavedDevice {
		return({ address: validateAddress(device.address) });
	});
	const addresses = new Set<string>();
	for (const device of devices) {
		if (addresses.has(device.address)) {
			throw(new Error('Saved device addresses must be unique.'));
		}
		addresses.add(device.address);
	}
	if (history.lastUsedAddress !== undefined && !addresses.has(history.lastUsedAddress)) {
		throw(new Error('The last used device must be saved.'));
	}
	const storedHistory: StoredDeviceHistory = { version: 1, devices: devices };
	if (history.lastUsedAddress !== undefined) {
		storedHistory.lastUsedAddress = history.lastUsedAddress;
	}
	return(JSON.stringify(storedHistory));
}

export function decapsulateDeviceHistory(serialized: string): DeviceHistory {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw(new Error('Saved devices are not valid JSON.'));
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw(new Error('Saved devices have an unsupported format.'));
	}
	const storedHistory = value as Partial<StoredDeviceHistory>;
	if (storedHistory.version !== 1 || !Array.isArray(storedHistory.devices)) {
		throw(new Error('Saved devices have an unsupported format.'));
	}
	const devices = storedHistory.devices.map(function (device): SavedDevice {
		if (typeof device !== 'object' || device === null || Array.isArray(device) || typeof device.address !== 'string') {
			throw(new Error('Saved device has an invalid format.'));
		}
		return({ address: validateAddress(device.address) });
	});
	const history: DeviceHistory = { devices: devices };
	if (storedHistory.lastUsedAddress !== undefined) {
		if (typeof storedHistory.lastUsedAddress !== 'string') {
			throw(new Error('Saved last-used device has an invalid format.'));
		}
		history.lastUsedAddress = validateAddress(storedHistory.lastUsedAddress);
	}
	encapsulateDeviceHistory(history);
	return(history);
}

export class AsyncStorageDeviceStore {
	public async load(): Promise<DeviceHistory> {
		const serialized = await AsyncStorage.getItem(deviceStorageKey);
		if (serialized === null) {
			return({ devices: [] });
		}
		return(decapsulateDeviceHistory(serialized));
	}

	public async addAndSelect(address: string): Promise<DeviceHistory> {
		const normalizedAddress = validateAddress(address);
		const history = await this.load();
		const devices = history.devices.filter(function (device): boolean {
			return(device.address !== normalizedAddress);
		});
		devices.push({ address: normalizedAddress });
		const updatedHistory: DeviceHistory = { devices: devices, lastUsedAddress: normalizedAddress };
		await AsyncStorage.setItem(deviceStorageKey, encapsulateDeviceHistory(updatedHistory));
		return(updatedHistory);
	}

	public async select(address: string): Promise<DeviceHistory> {
		const normalizedAddress = validateAddress(address);
		const history = await this.load();
		const exists = history.devices.some(function (device): boolean {
			return(device.address === normalizedAddress);
		});
		if (!exists) {
			throw(new Error('Device must be saved before it can be selected.'));
		}
		const updatedHistory: DeviceHistory = { devices: history.devices, lastUsedAddress: normalizedAddress };
		await AsyncStorage.setItem(deviceStorageKey, encapsulateDeviceHistory(updatedHistory));
		return(updatedHistory);
	}
}
