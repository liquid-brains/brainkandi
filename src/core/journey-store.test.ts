import { describe, expect, it } from 'vitest';

import { decapsulateJourneys, encapsulateJourneys } from './journey-store';
import type { Journey } from './journey-store';

describe('journey serialization', function () {
	it('round-trips a rated stopped session with its profile snapshot', function () {
		const journeys: Journey[] = [{
			id: 'journey-1',
			profile: { kind: 'random', name: 'Snapshot', parameters: { duration: 5, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } },
			startedAt: '2026-10-04T21:00:00.000Z',
			endedAt: '2026-10-04T21:02:00.000Z',
			outcome: 'stopped-early',
			rating: -3,
			journalEntry: 'Stopped because it was uncomfortable.',
			files: [{ fileName: 'Snapshot_0.vnp0', data: { filename: 'Snapshot_0', modules: [] } }]
		}];

		expect(decapsulateJourneys(encapsulateJourneys(journeys))).toEqual(journeys);
	});

	it('rejects a journey with an unsupported outcome', function () {
		expect(function (): void {
			decapsulateJourneys(JSON.stringify({
				version: 1,
				journeys: [{
					id: 'journey-1',
					profile: { kind: 'random', name: 'Snapshot', parameters: { duration: 5, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } },
					startedAt: '2026-10-04T21:00:00.000Z',
					outcome: 'unknown'
				}]
			}));
		}).toThrow('invalid outcome');
	});

	it('retains Off % and Phase A probability in journey snapshots', function () {
		const journeys: Journey[] = [{
			id: 'weighted-journey',
			profile: {
				kind: 'random',
				name: 'Weighted snapshot',
				parameters: {
					duration: 5,
					frequency: { ranges: [{ min: 10, max: 20 }], offPercentage: 40, perChannel: true },
					abCoupling: { distribution: 75 },
					power: { min: 1 }
				}
			},
			startedAt: '2026-10-10T22:00:00.000Z',
			outcome: 'completed',
			files: []
		}];

		expect(decapsulateJourneys(encapsulateJourneys(journeys))).toEqual(journeys);
	});

	it('keeps old journey snapshots with off frequency entries readable', function () {
		const decoded = decapsulateJourneys(JSON.stringify({
			version: 1,
			journeys: [{
				id: 'old-off',
				profile: {
					kind: 'random',
					name: 'Old off',
					parameters: { duration: 5, frequency: { ranges: [{ min: 10, weight: 75 }, { off: true, weight: 25 }] }, power: { min: 1 } }
				},
				startedAt: '2026-10-10T22:00:00.000Z',
				outcome: 'completed',
				files: []
			}]
		}))[0]?.profile;
		expect(decoded).toMatchObject({ kind: 'random', parameters: { frequency: { ranges: [{ min: 10, weight: 75 }], offPercentage: 25 } } });
	});
});
