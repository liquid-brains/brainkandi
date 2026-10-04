import { describe, expect, it } from 'vitest';

import { decapsulateProfiles, decapsulateSharedProfile, encapsulateProfiles, encapsulateSharedProfile } from './profile-codec';
import type { StoredProfile } from './profiles';

describe('profile serialization', function () {
	it('round-trips every supported profile kind', function () {
		const profiles: StoredProfile[] = [
			{
				id: 'file-profile' as StoredProfile['id'],
				profile: { kind: 'file', name: 'Focus', fileName: 'focus.vnp0', fileData: { filename: 'focus' } }
			},
			{
				id: 'random-profile' as StoredProfile['id'],
				profile: { kind: 'random', name: 'Random', parameters: { duration: 20, frequency: { ranges: [{ min: 10, max: 40 }] }, power: { min: 1, max: 5 } } }
			},
			{
				id: 'ai-profile' as StoredProfile['id'],
				profile: { kind: 'ai', name: 'Future AI' }
			}
		];

		expect(decapsulateProfiles(encapsulateProfiles(profiles))).toEqual(profiles);
	});

	it('rejects unsupported durable formats', function () {
		expect(function (): void {
			decapsulateProfiles('{"version":2,"profiles":[]}');
		}).toThrow('unsupported format');
	});

	it('round-trips a portable shared profile without its local identifier', function () {
		const profile: StoredProfile['profile'] = {
			kind: 'random',
			name: 'Shared session',
			parameters: { duration: 20, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } }
		};

		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
	});

	it('transforms legacy locally saved random profiles to the current structure', function () {
		const serialized = JSON.stringify({
			version: 1,
			profiles: [{
				id: 'legacy-profile',
				profile: {
					kind: 'random',
					name: 'Legacy',
					parameters: {
						duration: 20,
						freqMin: 10,
						freqMax: 40,
						couplingMin: 15,
						couplingMax: 20,
						couplingRandomDistribution: 25,
						powerMin: 1,
						powerMax: 5
					}
				}
			}]
		});

		expect(decapsulateProfiles(serialized)[0]?.profile).toEqual({
			kind: 'random',
			name: 'Legacy',
			parameters: {
				duration: 20,
				frequency: { ranges: [{ min: 10, max: 40 }] },
				coupling: { min: 15, max: 20, distribution: 25 },
				power: { min: 1, max: 5 }
			}
		});
		expect(function (): void {
			decapsulateSharedProfile(JSON.stringify({ version: 1, profile: JSON.parse(serialized).profiles[0].profile }));
		}).toThrow('invalid required parameters');
	});
});
