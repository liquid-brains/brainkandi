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

});
