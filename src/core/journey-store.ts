import AsyncStorage from '@react-native-async-storage/async-storage';

import { decapsulateProfiles } from './profile-codec';
import type { SessionProfile } from './profiles';
import { validateProfile } from './profiles';

export type JourneyOutcome = 'running' | 'completed' | 'stopped-early' | 'failed';
export type JourneyRating = number;

export type JourneyFile = {
	fileName: string;
	data: Record<string, unknown>;
};

export type Journey = {
	id: string;
	profile: SessionProfile;
	startedAt: string;
	endedAt?: string;
	outcome: JourneyOutcome;
	rating?: JourneyRating;
	journalEntry?: string;
	files: JourneyFile[];
};

type StoredJourneysDocument = {
	version: 1;
	journeys: Journey[];
};

const journeysStorageKey = 'brainkandi.journeys.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function validateJourney(journey: Journey): void {
	if (journey.id.trim() === '' || Number.isNaN(Date.parse(journey.startedAt))) {
		throw(new Error('Journey has an invalid identifier or start time.'));
	}
	if (journey.endedAt !== undefined && Number.isNaN(Date.parse(journey.endedAt))) {
		throw(new Error('Journey has an invalid end time.'));
	}
	if (!['running', 'completed', 'stopped-early', 'failed'].includes(journey.outcome)) {
		throw(new Error('Journey has an invalid outcome.'));
	}
	if (journey.rating !== undefined && (!Number.isInteger(journey.rating) || journey.rating < -5 || journey.rating > 5 || journey.rating === 0)) {
		throw(new Error('Journey has an invalid rating.'));
	}
	if (journey.journalEntry !== undefined && typeof journey.journalEntry !== 'string') {
		throw(new Error('Journey has an invalid journal entry.'));
	}
	if (!Array.isArray(journey.files)) {
		throw(new Error('Journey has invalid files.'));
	}
	for (const file of journey.files) {
		if (file.fileName.trim() === '' || !isRecord(file.data)) {
			throw(new Error('Journey has an invalid file.'));
		}
	}
	validateProfile(journey.profile);
}

export function createJourneyID(): string {
	return(`journey_${Date.now().toString(36)}_${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36)}`);
}

export function encapsulateJourneys(journeys: Journey[]): string {
	for (const journey of journeys) {
		validateJourney(journey);
	}
	const document: StoredJourneysDocument = { version: 1, journeys: journeys };
	return(JSON.stringify(document));
}

export function decapsulateJourneys(serialized: string): Journey[] {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw(new Error('Saved journeys are not valid JSON.'));
	}
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.journeys)) {
		throw(new Error('Saved journeys have an unsupported format.'));
	}
	return(value.journeys.map(function (value): Journey {
		if (!isRecord(value) || typeof value.id !== 'string' || typeof value.startedAt !== 'string' || typeof value.outcome !== 'string' || !isRecord(value.profile)) {
			throw(new Error('Saved journey has an invalid format.'));
		}
		const filesValue = value.files ?? [];
		if (!Array.isArray(filesValue)) {
			throw(new Error('Saved journey files have an invalid format.'));
		}
		const files = filesValue.map(function (file): JourneyFile {
			if (!isRecord(file) || typeof file.fileName !== 'string' || !isRecord(file.data)) {
				throw(new Error('Saved journey file has an invalid format.'));
			}
			return({ fileName: file.fileName, data: file.data });
		});
		const profile = decapsulateProfiles(JSON.stringify({
			version: 1,
			profiles: [{ id: 'journey-profile', profile: value.profile }]
		}))[0]?.profile;
		if (profile === undefined) {
			throw(new Error('Saved journey has an invalid profile.'));
		}
		const journey: Journey = {
			id: value.id,
			profile: profile,
			startedAt: value.startedAt,
			outcome: value.outcome as JourneyOutcome,
			files: files
		};
		if (typeof value.endedAt === 'string') {
			journey.endedAt = value.endedAt;
		}
		if (typeof value.rating === 'number') {
			journey.rating = value.rating;
		} else if (value.rating !== undefined) {
			throw(new Error('Saved journey has an invalid rating.'));
		}
		if (typeof value.journalEntry === 'string') {
			journey.journalEntry = value.journalEntry;
		}
		validateJourney(journey);
		return(journey);
	}));
}

export class AsyncStorageJourneyStore {
	public async list(): Promise<Journey[]> {
		const serialized = await AsyncStorage.getItem(journeysStorageKey);
		if (serialized === null) {
			return([]);
		}
		return(decapsulateJourneys(serialized));
	}

	public async save(journey: Journey): Promise<void> {
		const journeys = await this.list();
		const index = journeys.findIndex(function (existing): boolean {
			return(existing.id === journey.id);
		});
		if (index === -1) {
			journeys.unshift(journey);
		} else {
			journeys[index] = journey;
		}
		await AsyncStorage.setItem(journeysStorageKey, encapsulateJourneys(journeys));
	}

	public async remove(journeyID: string): Promise<void> {
		const journeys = await this.list();
		const remainingJourneys = journeys.filter(function (journey): boolean {
			return(journey.id !== journeyID);
		});
		if (remainingJourneys.length === journeys.length) {
			throw(new Error('Journey does not exist.'));
		}
		await AsyncStorage.setItem(journeysStorageKey, encapsulateJourneys(remainingJourneys));
	}
}
