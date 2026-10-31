import type { FileProfile, RandomProfile, RestProfile, SequenceStep, SessionProfile, StoredProfile } from './profiles';
import { maximumSequenceDepth, validateProfile } from './profiles';
import { randomParametersFromProfile } from './random-profile-form';

export function createSequenceStep(storedProfile: StoredProfile, mode: SequenceStep['mode']): SequenceStep {
	if (storedProfile.profile.kind === 'ai') {
		throw(new Error('Sequences can contain only generated session profiles, File profiles, or Sequence profiles.'));
	}
	return({
		mode: mode,
		profileID: storedProfile.id,
		profile: JSON.parse(JSON.stringify(storedProfile.profile)) as SequenceStep['profile']
	});
}

export function createRestStep(seconds: number): SequenceStep {
	if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) {
		throw(new Error('A rest interval must be a whole number from 1 through 86400 seconds.'));
	}
	return({ mode: 'value', profileID: `rest_${seconds}` as SequenceStep['profileID'], profile: { kind: 'rest', name: `Rest for ${seconds} second(s)`, seconds: seconds } });
}

export function sequenceStepProfile(step: SequenceStep, profiles: StoredProfile[]): SequenceStep['profile'] {
	if (step.mode === 'reference') {
		const stored = profiles.find(function (profile): boolean { return(profile.id === step.profileID); });
		if (stored !== undefined) {
			if (stored.profile.kind === 'ai') {
				throw(new Error(`Referenced profile "${stored.profile.name}" is not supported in a sequence.`));
			}
			return(stored.profile);
		}
	}
	return(step.profile);
}

function comparableJSON(value: unknown): string {
	return(JSON.stringify(value, function (_, item: unknown): unknown {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			return(item);
		}
		const ordered: Record<string, unknown> = {};
		for (const key of Object.keys(item).sort()) {
			ordered[key] = Reflect.get(item, key);
		}
		return(ordered);
	}));
}

export function sequenceStepHasChanged(step: SequenceStep, profiles: StoredProfile[]): boolean {
	const stored = profiles.find(function (profile): boolean { return(profile.id === step.profileID); });
	return(stored === undefined || comparableJSON(stored.profile) !== comparableJSON(step.profile));
}

export function synchronizeSequenceStep(step: SequenceStep, profiles: StoredProfile[]): SequenceStep {
	const stored = profiles.find(function (profile): boolean { return(profile.id === step.profileID); });
	if (stored === undefined) {
		throw(new Error(`Referenced profile "${step.profile.name}" no longer exists.`));
	}
	if (stored.profile.kind === 'ai') {
		throw(new Error(`Referenced profile "${stored.profile.name}" is not supported in a sequence.`));
	}
	return({
		mode: step.mode,
		profileID: stored.id,
		profile: JSON.parse(JSON.stringify(stored.profile)) as SequenceStep['profile']
	});
}

export function resolveSequenceProfile(profile: SessionProfile, profiles: StoredProfile[], sequenceDepth = 0, referencePath = new Set<string>()): SessionProfile {
	if (profile.kind !== 'sequence') {
		return(profile);
	}
	if (sequenceDepth >= maximumSequenceDepth) {
		throw(new Error(`Sequences may nest at most ${maximumSequenceDepth} levels deep.`));
	}
	return({
		...profile,
		steps: profile.steps.map(function (step): SequenceStep {
			const path = new Set(referencePath);
			if (step.mode === 'reference' && profiles.some(function (item): boolean { return(item.id === step.profileID); })) {
				if (path.has(step.profileID)) {
					throw(new Error(`Sequence contains a circular reference to "${step.profile.name}".`));
				}
				path.add(step.profileID);
			}
			const resolved = resolveSequenceProfile(sequenceStepProfile(step, profiles), profiles, sequenceDepth + 1, path);
			if (resolved.kind === 'ai') {
				throw(new Error('Sequences can contain only generated session profiles, File profiles, or Sequence profiles.'));
			}
			return({ ...step, profile: resolved });
		})
	});
}

export function runnableProfileSteps(profile: SessionProfile, profiles: StoredProfile[] = []): (FileProfile | RandomProfile | RestProfile)[] {
	const resolved = resolveSequenceProfile(profile, profiles);
	validateProfile(resolved);
	const steps: (FileProfile | RandomProfile | RestProfile)[] = [];
	function collect(current: SessionProfile): void {
		switch (current.kind) {
			case 'sequence':
				if (current.steps.length === 0) {
					throw(new Error(`Sequence "${current.name}" needs at least one step before it can run.`));
				}
				for (const step of current.steps) {
					collect(step.profile);
				}
				return;
			case 'random':
				randomParametersFromProfile(current);
				steps.push(current);
				return;
			case 'file':
				steps.push(current);
				return;
			case 'rest':
				steps.push(current);
				return;
			case 'ai':
				throw(new Error('This profile type is not supported.'));
		}
	}
	collect(resolved);
	return(steps);
}

export function sequenceExternalProfiles(profile: SessionProfile, profiles: StoredProfile[]): StoredProfile[] {
	validateProfile(profile);
	resolveSequenceProfile(profile, profiles);
	const external = new Map<string, StoredProfile>();
	function collect(current: SessionProfile): void {
		if (current.kind !== 'sequence') {
			return;
		}
		for (const step of current.steps) {
			if (step.mode === 'reference') {
				if (!external.has(step.profileID)) {
					const source = sequenceStepProfile(step, profiles);
					external.set(step.profileID, { id: step.profileID, profile: source });
					collect(source);
				}
			} else {
				collect(step.profile);
			}
		}
	}
	collect(profile);
	return([...external.values()]);
}
