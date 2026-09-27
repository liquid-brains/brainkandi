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

function decodeProfile(value: unknown): SessionProfile {
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
		if (!isRecord(value.parameters)) {
			throw(new Error('Random profile has invalid parameters.'));
		}
		const parameters = value.parameters;
		if (typeof parameters.duration !== 'number' || typeof parameters.freqMin !== 'number' || typeof parameters.powerMin !== 'number') {
			throw(new Error('Random profile has invalid required parameters.'));
		}
		const optionalNumberNames = ['freqMax', 'couplingMin', 'couplingMax', 'couplingRandomDistribution', 'powerMax'] as const;
		for (const name of optionalNumberNames) {
			if (parameters[name] !== undefined && typeof parameters[name] !== 'number') {
				throw(new Error(`Random profile parameter ${name} is invalid.`));
			}
		}
		if (parameters.basename !== undefined && typeof parameters.basename !== 'string') {
			throw(new Error('Random profile basename is invalid.'));
		}
		const randomParameters: RandomSessionParameters = {
			duration: parameters.duration,
			freqMin: parameters.freqMin,
			powerMin: parameters.powerMin
		};
		const basename = parameters.basename;
		const freqMax = parameters.freqMax;
		const couplingMin = parameters.couplingMin;
		const couplingMax = parameters.couplingMax;
		const couplingRandomDistribution = parameters.couplingRandomDistribution;
		const powerMax = parameters.powerMax;
		if (typeof basename === 'string') {
			randomParameters.basename = basename;
		}
		if (typeof freqMax === 'number') {
			randomParameters.freqMax = freqMax;
		}
		if (typeof couplingMin === 'number') {
			randomParameters.couplingMin = couplingMin;
		}
		if (typeof couplingMax === 'number') {
			randomParameters.couplingMax = couplingMax;
		}
		if (typeof couplingRandomDistribution === 'number') {
			randomParameters.couplingRandomDistribution = couplingRandomDistribution;
		}
		if (typeof powerMax === 'number') {
			randomParameters.powerMax = powerMax;
		}
		return({ kind: 'random', name: value.name, parameters: randomParameters });
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
	const profile = decodeProfile(value.profile);
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
		const profile = decodeProfile(storedProfile.profile);
		validateProfile(profile);
		return({ id: storedProfile.id as StoredProfile['id'], profile: profile });
	}));
}
