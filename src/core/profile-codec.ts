import type { RandomSessionParameters, SessionProfile, StoredProfile } from './profiles';
import { validateProfile } from './profiles';

type StoredProfilesDocument = {
	version: 1;
	profiles: StoredProfile[];
};

type SharedProfileDocument = {
	version: 1;
	profile: SessionProfile;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function optionalNumber(value: unknown, name: string): number | undefined {
	if (value === undefined) {
		return(undefined);
	}
	if (typeof value !== 'number') {
		throw(new Error(`Random profile parameter ${name} is invalid.`));
	}
	return(value);
}

function decodeRandomParameters(value: unknown, allowLegacy: boolean): RandomSessionParameters {
	if (!isRecord(value) || typeof value.duration !== 'number') {
		throw(new Error('Random profile has invalid required parameters.'));
	}
	if (isRecord(value.frequency) && isRecord(value.power) && Array.isArray(value.frequency.ranges) && typeof value.power.min === 'number') {
		const ranges = value.frequency.ranges.map(function (range): RandomSessionParameters['frequency']['ranges'][number] {
			if (!isRecord(range) || typeof range.min !== 'number') {
				throw(new Error('Random profile frequency range is invalid.'));
			}
			const decodedRange: RandomSessionParameters['frequency']['ranges'][number] = { min: range.min };
			const maximum = optionalNumber(range.max, 'frequency range maximum');
			if (maximum !== undefined) {
				decodedRange.max = maximum;
			}
			return(decodedRange);
		});
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
			if (!isRecord(value.coupling) || typeof value.coupling.min !== 'number') {
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
		return(parameters);
	}
	if (!allowLegacy || typeof value.freqMin !== 'number' || typeof value.powerMin !== 'number') {
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
		parameters.frequency.ranges[0]!.max = freqMaximum;
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

function decodeProfile(value: unknown, allowLegacyRandomParameters: boolean): SessionProfile {
	if (!isRecord(value) || typeof value.name !== 'string' || typeof value.kind !== 'string') {
		throw(new Error('Profile has an invalid format.'));
	}
	if (value.kind === 'file') {
		if (typeof value.fileName !== 'string' || !isRecord(value.fileData)) {
			throw(new Error('File profile has an invalid format.'));
		}
		return({ kind: 'file', name: value.name, fileName: value.fileName, fileData: value.fileData });
	}
	if (value.kind === 'random') {
		return({ kind: 'random', name: value.name, parameters: decodeRandomParameters(value.parameters, allowLegacyRandomParameters) });
	}
	if (value.kind === 'ai') {
		return({ kind: 'ai', name: value.name });
	}
	throw(new Error('Profile kind is not supported.'));
}

export function encapsulateProfiles(profiles: StoredProfile[]): string {
	for (const storedProfile of profiles) {
		validateProfile(storedProfile.profile);
	}
	const document: StoredProfilesDocument = { version: 1, profiles: profiles };
	return(JSON.stringify(document));
}

export function encapsulateSharedProfile(profile: SessionProfile): string {
	validateProfile(profile);
	const document: SharedProfileDocument = { version: 1, profile: profile };
	return(JSON.stringify(document, undefined, 2));
}

export function decapsulateSharedProfile(serialized: string): SessionProfile {
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
	return(profile);
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
