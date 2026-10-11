import type { RandomSessionParameters, SequenceStep, SessionProfile, StoredProfile } from './profiles';
import { maximumSequenceDepth, validateProfile } from './profiles';
import { isRandomFormValues } from './random-profile-form';
import { resolveSequenceProfile, sequenceExternalProfiles } from './sequences';

type StoredProfilesDocument = {
	version: 1;
	profiles: StoredProfile[];
};

export type SharedProfileDocument = {
	version: 1;
	profile: SessionProfile;
	external?: StoredProfile[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function optionalNumber(value: unknown, name: string): number | undefined {
	if (value === undefined) {
		return(undefined);
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw(new Error(`Random profile parameter ${name} is invalid.`));
	}
	return(value);
}

function decodeRandomParameters(value: unknown, allowLegacy: boolean): RandomSessionParameters {
	if (!isRecord(value) || typeof value.duration !== 'number' || !Number.isFinite(value.duration)) {
		throw(new Error('Random profile has invalid required parameters.'));
	}
	if (isRecord(value.frequency) && isRecord(value.power) && Array.isArray(value.frequency.ranges) && typeof value.power.min === 'number' && Number.isFinite(value.power.min)) {
		let offWeight = 0;
		let totalWeight = 0;
		let hasOff = false;
		const ranges: RandomSessionParameters['frequency']['ranges'] = [];
		for (const range of value.frequency.ranges) {
			if (!isRecord(range)) {
				throw(new Error('Random profile frequency range is invalid.'));
			}
			const weight = optionalNumber(range.weight, 'frequency weight');
			totalWeight += weight ?? 100 / value.frequency.ranges.length;
			if ('off' in range) {
				if (!allowLegacy || range.off !== true || 'min' in range || 'max' in range) {
					throw(new Error('Random profile off entry is invalid.'));
				}
				hasOff = true;
				offWeight += weight ?? 100 / value.frequency.ranges.length;
			} else {
				if (typeof range.min !== 'number' || !Number.isFinite(range.min)) {
					throw(new Error('Random profile frequency range is invalid.'));
				}
				const decodedRange: RandomSessionParameters['frequency']['ranges'][number] = { min: range.min };
				const maximum = optionalNumber(range.max, 'frequency range maximum');
				if (maximum !== undefined) {
					decodedRange.max = maximum;
				}
				if (weight !== undefined) {
					decodedRange.weight = weight;
				}
				ranges.push(decodedRange);
			}
		}
		if (typeof value.frequency.perChannel !== 'undefined' && typeof value.frequency.perChannel !== 'boolean') {
			throw(new Error('Random profile frequency per-channel setting is invalid.'));
		}
		if (typeof value.power.perChannel !== 'undefined' && typeof value.power.perChannel !== 'boolean') {
			throw(new Error('Random profile power per-channel setting is invalid.'));
		}
		const parameters: RandomSessionParameters = {
			duration: value.duration,
			frequency: { ranges: ranges },
			power: { min: value.power.min }
		};
		const offPercentage = optionalNumber(value.frequency.offPercentage, 'off percentage');
		if (offPercentage !== undefined) {
			parameters.frequency.offPercentage = offPercentage;
		} else if (hasOff) {
			if (!Number.isFinite(totalWeight) || totalWeight <= 0 || offWeight < 0 || offWeight > totalWeight) {
				throw(new Error('Legacy random profile off distribution is invalid.'));
			}
			parameters.frequency.offPercentage = Math.round(100 * offWeight / totalWeight);
		}
		if (hasOff && ranges.length === 0) {
			parameters.frequency.ranges = [{ min: 10 }];
		}
		const basename = value.basename;
		if (typeof basename === 'string') {
			parameters.basename = basename;
		} else if (basename !== undefined) {
			throw(new Error('Random profile basename is invalid.'));
		}
		const powerMaximum = optionalNumber(value.power.max, 'power maximum');
		if (powerMaximum !== undefined) {
			parameters.power.max = powerMaximum;
		}
		if (typeof value.frequency.perChannel === 'boolean') {
			parameters.frequency.perChannel = value.frequency.perChannel;
		}
		if (typeof value.power.perChannel === 'boolean') {
			parameters.power.perChannel = value.power.perChannel;
		}
		if (value.coupling !== undefined) {
			if (!isRecord(value.coupling) || typeof value.coupling.min !== 'number' || !Number.isFinite(value.coupling.min)) {
				throw(new Error('Random profile coupling is invalid.'));
			}
			const coupling: NonNullable<RandomSessionParameters['coupling']> = { min: value.coupling.min };
			const maximum = optionalNumber(value.coupling.max, 'coupling maximum');
			const distribution = optionalNumber(value.coupling.distribution, 'coupling distribution');
			if (maximum !== undefined) {
				coupling.max = maximum;
			}
			if (distribution !== undefined) {
				coupling.distribution = distribution;
			}
			parameters.coupling = coupling;
		}
		if (value.abCoupling !== undefined) {
			if (!isRecord(value.abCoupling)) {
				throw(new Error('Random profile A/B coupling is invalid.'));
			}
			parameters.abCoupling = {};
			const distribution = optionalNumber(value.abCoupling.distribution, 'A/B coupling distribution');
			if (distribution !== undefined) {
				parameters.abCoupling.distribution = distribution;
			}
		}
		return(parameters);
	}
	if (!allowLegacy || typeof value.freqMin !== 'number' || !Number.isFinite(value.freqMin) || typeof value.powerMin !== 'number' || !Number.isFinite(value.powerMin)) {
		throw(new Error('Random profile has invalid required parameters.'));
	}
	const parameters: RandomSessionParameters = {
		duration: value.duration,
		frequency: { ranges: [{ min: value.freqMin }] },
		power: { min: value.powerMin }
	};
	const freqMaximum = optionalNumber(value.freqMax, 'freqMax');
	const powerMaximum = optionalNumber(value.powerMax, 'powerMax');
	const couplingMinimum = optionalNumber(value.couplingMin, 'couplingMin');
	const couplingMaximum = optionalNumber(value.couplingMax, 'couplingMax');
	const couplingDistribution = optionalNumber(value.couplingRandomDistribution, 'couplingRandomDistribution');
	if (typeof value.basename === 'string') {
		parameters.basename = value.basename;
	}
	if (freqMaximum !== undefined) {
		parameters.frequency.ranges[0] = { min: value.freqMin, max: freqMaximum };
	}
	if (powerMaximum !== undefined) {
		parameters.power.max = powerMaximum;
	}
	if (couplingMinimum !== undefined) {
		parameters.coupling = { min: couplingMinimum };
		if (couplingMaximum !== undefined) {
			parameters.coupling.max = couplingMaximum;
		}
		if (couplingDistribution !== undefined) {
			parameters.coupling.distribution = couplingDistribution;
		}
	}
	return(parameters);
}

function decodeProfile(value: unknown, allowLegacyRandomParameters: boolean, sequenceDepth = 0): SessionProfile {
	if (!isRecord(value) || typeof value.name !== 'string' || typeof value.kind !== 'string') {
		throw(new Error('Profile has an invalid format.'));
	}
	if (value.kind === 'file') {
		if (typeof value.fileName !== 'string' || !isRecord(value.fileData)) {
			throw(new Error('File profile has an invalid format.'));
		}
		return({ kind: 'file', name: value.name, fileName: value.fileName, fileData: value.fileData });
	}
	if (value.kind === 'sequence') {
		if (sequenceDepth >= maximumSequenceDepth) {
			throw(new Error(`Sequences may nest at most ${maximumSequenceDepth} levels deep.`));
		}
		if (!Array.isArray(value.steps)) {
			throw(new Error('Sequence profile has invalid steps.'));
		}
		const steps = value.steps.map(function (step): SequenceStep {
			if (!isRecord(step) || (step.mode !== 'reference' && step.mode !== 'value') || typeof step.profileID !== 'string' || step.profileID.trim() === '') {
				throw(new Error('Sequence step has an invalid format.'));
			}
			const profile = decodeProfile(step.profile, allowLegacyRandomParameters, sequenceDepth + 1);
			if (profile.kind === 'ai') {
				throw(new Error('Sequences can contain only Random, File, or Sequence profiles.'));
			}
			return({ mode: step.mode, profileID: step.profileID as StoredProfile['id'], profile: profile });
		});
		return({ kind: 'sequence', name: value.name, steps: steps });
	}
	if (value.kind === 'random') {
		if (value.advanced !== undefined && typeof value.advanced !== 'boolean') {
			throw(new Error('Random profile advanced setting is invalid.'));
		}
		const advanced = value.advanced === true ? { advanced: true } : {};
		if ('input' in value) {
			let input = value.input;
			if (allowLegacyRandomParameters && isRecord(input) && !('frequencyOffPercentage' in input) && Array.isArray(input.frequencyRanges)) {
				let offWeight = 0;
				let totalWeight = 0;
				const ranges = [];
				for (const range of input.frequencyRanges) {
					if (!isRecord(range) || typeof range.off !== 'boolean' || typeof range.min !== 'string' || typeof range.max !== 'string' || typeof range.weight !== 'string') {
						throw(new Error('Random profile draft input is invalid.'));
					}
					let weight = 100 / input.frequencyRanges.length;
					if (range.weight.trim() !== '') {
						weight = Number(range.weight);
					}
					totalWeight += weight;
					if (range.off) {
						offWeight += weight;
					} else {
						ranges.push({ min: range.min, max: range.max });
					}
				}
				let offPercentage = '0';
				if (offWeight !== 0) {
					if (!Number.isFinite(totalWeight) || totalWeight <= 0 || offWeight < 0 || offWeight > totalWeight) {
						offPercentage = 'Invalid legacy off distribution';
					} else {
						offPercentage = String(Math.round(100 * offWeight / totalWeight));
					}
				}
				if (ranges.length === 0 && input.frequencyRanges.length > 0) {
					ranges.push({ min: '10', max: '' });
				}
				input = { ...input, frequencyRanges: ranges, frequencyOffPercentage: offPercentage };
			}
			if ('parameters' in value || !isRandomFormValues(input)) {
				throw(new Error('Random profile draft input is invalid.'));
			}
			return({ kind: 'random', name: value.name, ...advanced, input: input });
		}
		return({ kind: 'random', name: value.name, ...advanced, parameters: decodeRandomParameters(value.parameters, allowLegacyRandomParameters) });
	}
	if (value.kind === 'rest') {
		if (typeof value.seconds !== 'number' || !Number.isSafeInteger(value.seconds) || value.seconds < 1 || value.seconds > 86400) {
			throw(new Error('Rest interval has an invalid duration.'));
		}
		return({ kind: 'rest', name: value.name, seconds: value.seconds });
	}
	if (value.kind === 'ai') {
		return({ kind: 'ai', name: value.name });
	}
	throw(new Error('Profile kind is not supported.'));
}

export function encapsulateProfiles(profiles: StoredProfile[]): string {
	for (const storedProfile of profiles) {
		validateProfile(decodeProfile(storedProfile.profile, true));
	}
	const document: StoredProfilesDocument = { version: 1, profiles: profiles };
	return(JSON.stringify(document));
}

export function encapsulateSharedProfile(profile: SessionProfile, profiles: StoredProfile[] = []): string {
	validateProfile(decodeProfile(profile, false));
	const document: SharedProfileDocument = { version: 1, profile: profile };
	const external = sequenceExternalProfiles(profile, profiles);
	if (external.length > 0) {
		for (const item of external) {
			validateProfile(decodeProfile(item.profile, false));
		}
		document.external = external;
	}
	return(JSON.stringify(document, undefined, 2));
}

export function decapsulateSharedProfileDocument(serialized: string): SharedProfileDocument {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw(new Error('Shared profile is not valid JSON.'));
	}
	if (!isRecord(value) || value.version !== 1 || !('profile' in value)) {
		throw(new Error('Shared profile has an unsupported format.'));
	}
	const profile = decodeProfile(value.profile, false);
	validateProfile(profile);
	const document: SharedProfileDocument = { version: 1, profile: profile };
	if (value.external !== undefined) {
		if (!Array.isArray(value.external)) {
			throw(new Error('Shared profile external profiles have an invalid format.'));
		}
		const identifiers = new Set<string>();
		document.external = value.external.map(function (item): StoredProfile {
			if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim() === '' || identifiers.has(item.id)) {
				throw(new Error('Shared profile external identifiers must be non-empty and unique.'));
			}
			identifiers.add(item.id);
			const externalProfile = decodeProfile(item.profile, false);
			if (externalProfile.kind === 'ai') {
				throw(new Error('Sequence external profiles must be Random, File, or Sequence profiles.'));
			}
			validateProfile(externalProfile);
			return({ id: item.id as StoredProfile['id'], profile: externalProfile });
		});
	}
	resolveSequenceProfile(profile, document.external ?? []);
	return(document);
}

export function decapsulateSharedProfile(serialized: string): SessionProfile {
	return(decapsulateSharedProfileDocument(serialized).profile);
}

export function decapsulateProfiles(serialized: string): StoredProfile[] {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw(new Error('Saved profiles are not valid JSON.'));
	}
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.profiles)) {
		throw(new Error('Saved profiles have an unsupported format.'));
	}
	return(value.profiles.map(function (storedProfile): StoredProfile {
		if (!isRecord(storedProfile) || typeof storedProfile.id !== 'string') {
			throw(new Error('Saved profile has an invalid identifier.'));
		}
		const profile = decodeProfile(storedProfile.profile, true);
		validateProfile(profile);
		return({ id: storedProfile.id as StoredProfile['id'], profile: profile });
	}));
}
