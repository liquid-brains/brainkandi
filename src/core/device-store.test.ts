import { describe, expect, it } from 'vitest';

import { decapsulateDeviceHistory, encapsulateDeviceHistory } from './device-store';

describe('device history serialization', function () {
	it('round-trips devices and the last selected device', function () {
		const history = {
			devices: [{ address: 'np1.local' }, { address: '192.168.1.42' }],
			lastUsedAddress: '192.168.1.42'
		};

		expect(decapsulateDeviceHistory(encapsulateDeviceHistory(history))).toEqual(history);
	});

	it('rejects a last-used device that was never saved', function () {
		expect(function (): void {
			encapsulateDeviceHistory({ devices: [], lastUsedAddress: 'np1.local' });
		}).toThrow('must be saved');
	});
});
