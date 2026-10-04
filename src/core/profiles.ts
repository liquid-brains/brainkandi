export type RandomSessionParameters = {
	basename?: string;
	duration: number;
	frequency: {
		ranges: FrequencyRange[];
		perChannel?: boolean;
	};
	coupling?: CouplingParameters;
	power: {
		min: number;
		max?: number;
		perChannel?: boolean;
	};
};

export type FrequencyRange = {
	min: number;
	max?: number;
};

export type CouplingParameters = {
	min: number;
	max?: number;
	distribution?: number;
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
	if (parameters.frequency.ranges.length === 0) {
		throw(new Error('At least one frequency range is required.'));
	}
	for (const range of parameters.frequency.ranges) {
		if (!Number.isFinite(range.min)) {
			throw(new Error('Frequency minimum must be a finite number.'));
		}
		if (range.max !== undefined && (!Number.isFinite(range.max) || range.min > range.max)) {
			throw(new Error('Frequency minimum must not exceed frequency maximum.'));
		}
	}
	if (!Number.isFinite(parameters.power.min)) {
		throw(new Error('Power minimum must be a finite number.'));
	}
	if (parameters.power.max !== undefined && (!Number.isFinite(parameters.power.max) || parameters.power.min > parameters.power.max)) {
		throw(new Error('Power minimum must not exceed power maximum.'));
	}
	if (parameters.coupling !== undefined && parameters.coupling.max !== undefined && parameters.coupling.min > parameters.coupling.max) {
		throw(new Error('Cross-coupling minimum must not exceed maximum.'));
	}
	if (parameters.coupling?.distribution !== undefined && (!Number.isInteger(parameters.coupling.distribution) || parameters.coupling.distribution < 0 || parameters.coupling.distribution > 100)) {
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
