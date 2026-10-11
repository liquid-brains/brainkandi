import { describe, expect, it } from 'vitest';

import { decapsulateProfiles, decapsulateSharedProfile, encapsulateProfiles, encapsulateSharedProfile } from './profile-codec';
import type { StoredProfile } from './profiles';
import { defaultFormValues, randomParametersFromProfile, randomProfileFromForm } from './random-profile-form';

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

	it('preserves Off % and Phase A probability in saved and shared profiles', function () {
		const profile: StoredProfile['profile'] = {
			kind: 'random',
			name: 'Weighted',
			parameters: {
				duration: 5,
				frequency: {
					ranges: [{ min: 10, max: 20 }, { min: 40 }, { min: 99 }],
					offPercentage: 10,
					perChannel: true
				},
				abCoupling: { distribution: 0 },
				power: { min: 1, perChannel: false }
			}
		};
		const stored = [{ id: 'weighted' as StoredProfile['id'], profile: profile }];

		expect(decapsulateProfiles(encapsulateProfiles(stored))).toEqual(stored);
		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
	});

	it('preserves the advanced random profile editor preference', function () {
		const profile: StoredProfile['profile'] = {
			kind: 'random',
			name: 'Advanced',
			advanced: true,
			parameters: { duration: 5, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } }
		};

		expect(decapsulateProfiles(encapsulateProfiles([{ id: 'advanced' as StoredProfile['id'], profile: profile }]))[0]?.profile).toEqual(profile);
		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
	});

	it('round-trips rest intervals in sequence profiles', function () {
		const profile: StoredProfile['profile'] = {
			kind: 'sequence',
			name: 'Resting',
			steps: [{
				mode: 'value',
				profileID: 'rest_30' as StoredProfile['id'],
				profile: { kind: 'rest', name: 'Rest for 30 second(s)', seconds: 30 }
			}]
		};

		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
	});

	it.each([
		{ off: false },
		{ off: 'true' },
		{ off: true, min: 10 },
		{ off: true, max: 20 },
		{ off: true, weight: '10' }
	])('rejects invalid shared frequency entry %j', function (range) {
		expect(function (): void {
			decapsulateSharedProfile(JSON.stringify({
				version: 1,
				profile: { kind: 'random', name: 'Invalid', parameters: { duration: 5, frequency: { ranges: [range] }, power: { min: 1 } } }
			}));
		}).toThrow();
	});

	it.each([null, false, { distribution: '50' }])('rejects invalid shared A/B coupling %j', function (abCoupling) {
		expect(function (): void {
			decapsulateSharedProfile(JSON.stringify({
				version: 1,
				profile: { kind: 'random', name: 'Invalid', parameters: { duration: 5, frequency: { ranges: [{ min: 10 }] }, abCoupling: abCoupling, power: { min: 1 } } }
			}));
		}).toThrow();
	});

	it('round-trips invalid numeric profiles without letting them run', function () {
		const profile = randomProfileFromForm('Invalid numeric', {
			...defaultFormValues,
			duration: '61',
			abCouplingDistribution: '101',
			frequencyOffPercentage: '101'
		});
		const stored = [{ id: 'invalid' as StoredProfile['id'], profile: profile }];

		expect(decapsulateProfiles(encapsulateProfiles(stored))).toEqual(stored);
		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
		expect(function (): void {
			randomParametersFromProfile(profile);
		}).toThrow();
	});

	it('round-trips exact unfinished input through saving and sharing', function () {
		const profile = randomProfileFromForm('Unfinished', {
			...defaultFormValues,
			duration: '',
			powerMin: 'bad value',
			frequencyRanges: [{ min: '', max: '' }],
			frequencyOffPercentage: 'bad percentage'
		});
		const stored = [{ id: 'draft' as StoredProfile['id'], profile: profile }];
		const serialized = encapsulateProfiles(stored);

		expect(serialized).not.toContain('null');
		expect(decapsulateProfiles(serialized)).toEqual(stored);
		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
	});

	it.each([
		{ ...defaultFormValues, duration: 5 },
		{ ...defaultFormValues, frequencyPerChannel: 'true' },
		{ ...defaultFormValues, frequencyRanges: [{ min: 10, max: '' }] },
		{ ...defaultFormValues, frequencyRanges: null },
		null
	])('rejects malformed draft input %j', function (input) {
		expect(function (): void {
			decapsulateSharedProfile(JSON.stringify({ version: 1, profile: { kind: 'random', name: 'Draft', input: input } }));
		}).toThrow('draft input is invalid');
	});

	it('rejects ambiguous profiles containing both parameters and draft input', function () {
		expect(function (): void {
			decapsulateSharedProfile(JSON.stringify({
				version: 1,
				profile: { kind: 'random', name: 'Ambiguous', input: defaultFormValues, parameters: { duration: 5, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } }
			}));
		}).toThrow('draft input is invalid');
	});

	it('rejects nonfinite canonical parameters rather than corrupting saved JSON', function () {
		expect(function (): void {
			encapsulateSharedProfile({ kind: 'random', name: 'Invalid', parameters: { duration: NaN, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } });
		}).toThrow();
	});

	it.each([0, 25, 100, -1, 101, 0.5])('preserves Off %% %s through saving and sharing, with validation deferred until running', function (offPercentage) {
		const profile = randomProfileFromForm('Off probability', { ...defaultFormValues, frequencyOffPercentage: String(offPercentage) });
		const stored = [{ id: 'off' as StoredProfile['id'], profile: profile }];
		expect(decapsulateProfiles(encapsulateProfiles(stored))).toEqual(stored);
		expect(decapsulateSharedProfile(encapsulateSharedProfile(profile))).toEqual(profile);
	});

	it('converts locally stored weighted off entries into a single Off %', function () {
		const profile = {
			kind: 'random',
			name: 'Legacy off',
			parameters: {
				duration: 5,
				frequency: {
					ranges: [{ min: 10, max: 20, weight: 60 }, { min: 40, weight: 30 }, { off: true, weight: 10 }],
					perChannel: false
				},
				power: { min: 1 }
			}
		};
		const decoded = decapsulateProfiles(JSON.stringify({ version: 1, profiles: [{ id: 'legacy-off', profile: profile }] }))[0]?.profile;
		expect(decoded).toEqual({
			...profile,
			parameters: { ...profile.parameters, frequency: { ranges: [{ min: 10, max: 20, weight: 60 }, { min: 40, weight: 30 }], perChannel: false, offPercentage: 10 } }
		});
		if (decoded?.kind !== 'random') {
			expect.fail('Migrated profile must remain random.');
		}
		expect(randomParametersFromProfile(decoded).frequency).toEqual({
			ranges: [{ min: 10, max: 20 }, { min: 40 }],
			perChannel: false,
			offPercentage: 10
		});
		expect(function (): void {
			decapsulateSharedProfile(JSON.stringify({ version: 1, profile: profile }));
		}).toThrow('off entry is invalid');
	});

	it('combines multiple legacy off entries and rounds their relative probability to a whole percentage', function () {
		const decoded = decapsulateProfiles(JSON.stringify({
			version: 1,
			profiles: [{
				id: 'multiple-off',
				profile: { kind: 'random', name: 'Multiple off', parameters: { duration: 5, frequency: { ranges: [{ min: 10 }, { off: true }, { off: true }] }, power: { min: 1 } } }
			}]
		}))[0]?.profile;
		if (decoded?.kind !== 'random') {
			expect.fail('Migrated profile must remain random.');
		}
		expect(decoded.parameters?.frequency).toEqual({ ranges: [{ min: 10 }], offPercentage: 67 });
	});

	it('retains an all-off legacy profile with a valid placeholder range required by Brainlight', function () {
		const decoded = decapsulateProfiles(JSON.stringify({
			version: 1,
			profiles: [{
				id: 'all-off',
				profile: { kind: 'random', name: 'All off', parameters: { duration: 5, frequency: { ranges: [{ off: true }] }, power: { min: 1 } } }
			}]
		}))[0]?.profile;
		if (decoded?.kind !== 'random') {
			expect.fail('Migrated profile must remain random.');
		}
		expect(randomParametersFromProfile(decoded).frequency).toEqual({ ranges: [{ min: 10 }], offPercentage: 100 });
	});

	it('migrates locally saved draft frequency controls while keeping unfinished input', function () {
		const { frequencyOffPercentage, ...legacyDefaults } = defaultFormValues;
		const decoded = decapsulateProfiles(JSON.stringify({
			version: 1,
			profiles: [{
				id: 'draft-off',
				profile: {
					kind: 'random',
					name: 'Legacy draft',
					input: {
						...legacyDefaults,
						duration: '',
						frequencyRanges: [
							{ off: false, min: '', max: '20', weight: '75' },
							{ off: true, min: '', max: '', weight: '25' }
						]
					}
				}
			}]
		}))[0]?.profile;
		expect(decoded).toEqual({
			kind: 'random',
			name: 'Legacy draft',
			input: { ...defaultFormValues, duration: '', frequencyOffPercentage: '25', frequencyRanges: [{ min: '', max: '20' }] }
		});
	});
});
