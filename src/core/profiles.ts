export type RandomSessionParameters = {
	basename?: string;
	duration: number;
	freqMin: number;
	freqMax?: number;
	couplingMin?: number;
	couplingMax?: number;
	couplingRandomDistribution?: number;
	powerMin: number;
	powerMax?: number;
};

export type FileProfile = {
	kind: 'file';
	name: string;
	fileName: string;
	fileData: Record<string, unknown>;
};

export type RandomProfile = {
	kind: 'random';
	name: string;
	parameters: RandomSessionParameters;
};

export type AIProfile = {
	kind: 'ai';
	name: string;
};

export type SessionProfile = FileProfile | RandomProfile | AIProfile;

export type ProfileID = string & { readonly ProfileID: unique symbol };

export type StoredProfile = {
	id: ProfileID;
	profile: SessionProfile;
};

export function createProfileID(): ProfileID {
	const timestamp = Date.now().toString(36);
	const randomPart = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
	return(`profile_${timestamp}_${randomPart}` as ProfileID);
}

export function validateRandomSessionParameters(parameters: RandomSessionParameters): void {
	if (!Number.isInteger(parameters.duration) || parameters.duration < 1) {
		throw(new Error('Duration must be a positive whole number of minutes.'));
	}
	if (!Number.isFinite(parameters.freqMin)) {
		throw(new Error('Frequency minimum must be a finite number.'));
	}
	if (parameters.freqMax !== undefined && (!Number.isFinite(parameters.freqMax) || parameters.freqMin > parameters.freqMax)) {
		throw(new Error('Frequency minimum must not exceed frequency maximum.'));
	}
	if (!Number.isFinite(parameters.powerMin)) {
		throw(new Error('Power minimum must be a finite number.'));
	}
	if (parameters.powerMax !== undefined && (!Number.isFinite(parameters.powerMax) || parameters.powerMin > parameters.powerMax)) {
		throw(new Error('Power minimum must not exceed power maximum.'));
	}
	if (parameters.couplingMax !== undefined && parameters.couplingMin === undefined) {
		throw(new Error('Cross-coupling minimum is required when a maximum is set.'));
	}
	if (parameters.couplingMin !== undefined && parameters.couplingMax !== undefined && parameters.couplingMin > parameters.couplingMax) {
		throw(new Error('Cross-coupling minimum must not exceed maximum.'));
	}
	if (parameters.couplingRandomDistribution !== undefined && (!Number.isInteger(parameters.couplingRandomDistribution) || parameters.couplingRandomDistribution < 0 || parameters.couplingRandomDistribution > 100)) {
		throw(new Error('Cross-coupling distribution must be a whole percentage from 0 through 100.'));
	}
}

export function validateProfile(profile: SessionProfile): void {
	if (profile.name.trim() === '') {
		throw(new Error('A profile name is required.'));
	}

	switch (profile.kind) {
		case 'file':
			if (profile.fileName.trim() === '') {
				throw(new Error('A device filename is required.'));
			}
			return;
		case 'random':
			validateRandomSessionParameters(profile.parameters);
			return;
		case 'ai':
			return;
	}
}
