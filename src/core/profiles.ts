import { VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import type { VielightRandomParams } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import type { FormValues } from './random-profile-form';

export type RandomSessionParameters = VielightRandomParams;
export type FrequencyRange = RandomSessionParameters['frequency']['ranges'][number];
export type CouplingParameters = NonNullable<RandomSessionParameters['coupling']>;

export type FileProfile = {
	kind: 'file';
	name: string;
	fileName: string;
	fileData: Record<string, unknown>;
};

export type RandomProfile = {
	kind: 'random';
	name: string;
} & ({
	parameters: RandomSessionParameters;
	input?: never;
} | {
	parameters?: never;
	input: FormValues;
});

export type AIProfile = {
	kind: 'ai';
	name: string;
};

export type SequenceStep = {
	mode: 'reference' | 'value';
	profileID: ProfileID;
	profile: FileProfile | RandomProfile | SequenceProfile;
};

export type SequenceProfile = {
	kind: 'sequence';
	name: string;
	steps: SequenceStep[];
};

export type SessionProfile = FileProfile | RandomProfile | SequenceProfile | AIProfile;
export const maximumSequenceDepth = 10;

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
	VielightDevice.validateRandomParams(parameters);
}

export function validateProfile(profile: SessionProfile, sequenceDepth = 0): void {
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
			return;
		case 'sequence':
			if (sequenceDepth >= maximumSequenceDepth) {
				throw(new Error(`Sequences may nest at most ${maximumSequenceDepth} levels deep.`));
			}
			for (const step of profile.steps) {
				if (step.profileID.trim() === '' || (step.mode !== 'reference' && step.mode !== 'value')) {
					throw(new Error('Sequence step has an invalid inclusion mode or profile identifier.'));
				}
				validateProfile(step.profile, sequenceDepth + 1);
			}
			return;
		case 'ai':
			return;
	}
}
