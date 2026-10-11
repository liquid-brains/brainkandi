import { describe, expect, it } from 'vitest';

import { createSequenceStep, resolveSequenceProfile, runnableProfileSteps, sequenceExternalProfiles, sequenceStepHasChanged } from './sequences';
import { decapsulateSharedProfile, encapsulateProfiles, encapsulateSharedProfile } from './profile-codec';
import { validateProfile } from './profiles';
import type { FileProfile, ProfileID, SequenceProfile, StoredProfile } from './profiles';

const file: FileProfile = { kind: 'file', name: 'File', fileName: 'file.vnp0', fileData: { nested: { value: 1 } } };
const source: StoredProfile = { id: 'file' as ProfileID, profile: file };

function nestedSequence(depth: number): SequenceProfile {
	let profile: SequenceProfile = { kind: 'sequence', name: 'Level 1', steps: [createSequenceStep(source, 'value')] };
	for (let index = 1; index < depth; index++) {
		profile = { kind: 'sequence', name: `Level ${index + 1}`, steps: [createSequenceStep({ id: `level-${index}` as ProfileID, profile: profile }, 'value')] };
	}
	return(profile);
}

describe('sequence profiles', function () {
	it('stores independent step snapshots for both inclusion modes', function () {
		const original: StoredProfile = JSON.parse(JSON.stringify(source));
		const reference = createSequenceStep(original, 'reference');
		const value = createSequenceStep(original, 'value');
		original.profile.name = 'Edited';
		expect(reference.profile.name).toBe('File');
		expect(value.profile.name).toBe('File');
		expect(value.profile).not.toBe(original.profile);
	});

	it('follows reference edits but not value edits', function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Mixed', steps: [createSequenceStep(source, 'reference'), createSequenceStep(source, 'value')] };
		const changed = { ...source, profile: { ...file, name: 'Changed', fileName: 'changed.vnp0' } };
		const resolved = runnableProfileSteps(sequence, [changed]);
		expect(resolved.map(function (step): string { return(step.name); })).toEqual(['Changed', 'File']);
		expect(sequence.steps.map(function (step): string { return(step.profile.name); })).toEqual(['File', 'File']);
	});

	it.each(['reference', 'value'] as const)('marks changed or missing source profiles for %s steps', function (mode) {
		const step = createSequenceStep(source, mode);
		expect(sequenceStepHasChanged(step, [source])).toBe(false);
		expect(sequenceStepHasChanged(step, [{ ...source, profile: { ...file, name: 'Changed' } }])).toBe(true);
		expect(sequenceStepHasChanged(step, [])).toBe(true);
	});

	it('does not mark identical file data with a different property order as changed', function () {
		const step = createSequenceStep({ ...source, profile: { ...file, fileData: { first: 1, second: 2 } } }, 'value');
		expect(sequenceStepHasChanged(step, [{ ...source, profile: { ...file, fileData: { second: 2, first: 1 } } }])).toBe(false);
	});

	it('uses the snapshot when a referenced profile is missing', function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Missing', steps: [createSequenceStep(source, 'reference')] };
		expect(runnableProfileSteps(sequence)).toEqual([file]);
	});

	it('allows finite snapshots with repeated missing reference IDs', function () {
		const inner: StoredProfile = { id: source.id, profile: { kind: 'sequence', name: 'Snapshot', steps: [createSequenceStep(source, 'reference')] } };
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Missing', steps: [createSequenceStep(inner, 'reference')] };
		expect(runnableProfileSteps(sequence)).toEqual([file]);
	});

	it('runs nested Random, File, and Sequence steps in order', function () {
		const random: StoredProfile = { id: 'random' as ProfileID, profile: { kind: 'random', name: 'Random', parameters: { duration: 1, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } } };
		const nested: StoredProfile = { id: 'nested' as ProfileID, profile: { kind: 'sequence', name: 'Nested', steps: [createSequenceStep(random, 'value'), createSequenceStep(source, 'reference')] } };
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Outer', steps: [createSequenceStep(source, 'value'), createSequenceStep(nested, 'value')] };
		expect(runnableProfileSteps(sequence, [source, random, nested]).map(function (step): string { return(step.name); })).toEqual(['File', 'Random', 'File']);
	});

	it('retains reference semantics inside a sequence copied by value', function () {
		const nested: StoredProfile = { id: 'nested' as ProfileID, profile: { kind: 'sequence', name: 'Nested', steps: [createSequenceStep(source, 'reference')] } };
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Outer', steps: [createSequenceStep(nested, 'value')] };
		const changedNested = { ...nested, profile: { kind: 'sequence' as const, name: 'Changed structure', steps: [] } };
		const changedFile = { ...source, profile: { ...file, name: 'Changed file' } };
		expect(runnableProfileSteps(sequence, [changedNested, changedFile]).map(function (step): string { return(step.name); })).toEqual(['Changed file']);
	});

	it('permits exactly 10 sequence levels, including persistence and sharing', function () {
		const sequence = nestedSequence(10);
		expect(function (): void { validateProfile(sequence); }).not.toThrow();
		expect(runnableProfileSteps(sequence)).toEqual([file]);
		expect(decapsulateSharedProfile(encapsulateSharedProfile(sequence))).toEqual(sequence);
	});

	it('rejects 11 sequence levels in validation, execution, saving, and importing', function () {
		const sequence = nestedSequence(11);
		expect(function (): void { validateProfile(sequence); }).toThrow('at most 10');
		expect(function (): void { runnableProfileSteps(sequence); }).toThrow('at most 10');
		expect(function (): void { encapsulateProfiles([{ id: 'deep' as ProfileID, profile: sequence }]); }).toThrow('at most 10');
		expect(function (): void { decapsulateSharedProfile(JSON.stringify({ version: 1, profile: sequence })); }).toThrow('at most 10');
	});

	it('enforces nesting through references as well as embedded values', function () {
		const deep = { id: 'deep' as ProfileID, profile: nestedSequence(10) };
		const shallow = { id: deep.id, profile: nestedSequence(1) };
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Outer', steps: [createSequenceStep(shallow, 'reference')] };
		expect(function (): void { runnableProfileSteps(sequence, [deep]); }).toThrow('at most 10');
	});

	it('rejects circular references without rejecting repeated sibling references', function () {
		const id = 'circular' as ProfileID;
		const snapshot: SequenceProfile = { kind: 'sequence', name: 'Circular', steps: [] };
		const circular: SequenceProfile = { ...snapshot, steps: [createSequenceStep({ id: id, profile: snapshot }, 'reference')] };
		expect(function (): void { resolveSequenceProfile(circular, [{ id: id, profile: circular }]); }).toThrow('circular reference');
		expect(runnableProfileSteps({ kind: 'sequence', name: 'Repeated', steps: [createSequenceStep(source, 'reference'), createSequenceStep(source, 'reference')] }, [source])).toEqual([file, file]);
	});

	it('allows saving an empty sequence but blocks running it', function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Draft', steps: [] };
		expect(function (): void { encapsulateSharedProfile(sequence); }).not.toThrow();
		expect(function (): void { runnableProfileSteps(sequence); }).toThrow('at least one step');
	});

	it('validates all random steps before execution starts', function () {
		const invalid: StoredProfile = { id: 'invalid' as ProfileID, profile: { kind: 'random', name: 'Invalid', parameters: { duration: 61, frequency: { ranges: [{ min: 10 }] }, power: { min: 1 } } } };
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Invalid tail', steps: [createSequenceStep(source, 'value'), createSequenceStep(invalid, 'value')] };
		expect(function (): void { runnableProfileSteps(sequence); }).toThrow('Duration');
		expect(function (): void { encapsulateSharedProfile(sequence); }).not.toThrow();
	});

	it('includes only references as external profiles, including references inside copied sequences', function () {
		const nested: StoredProfile = { id: 'nested' as ProfileID, profile: { kind: 'sequence', name: 'Nested', steps: [createSequenceStep(source, 'reference')] } };
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Outer', steps: [createSequenceStep(nested, 'value'), createSequenceStep(source, 'value'), createSequenceStep(source, 'reference')] };
		expect(sequenceExternalProfiles(sequence, [source, nested])).toEqual([source]);
		const document = JSON.parse(encapsulateSharedProfile(sequence, [source, nested]));
		expect(document.external).toEqual([source]);
		expect(document.profile.steps[0].profile).toEqual(nested.profile);
	});

	it('exports a reference current value externally while keeping its original step snapshot', function () {
		const sequence: SequenceProfile = { kind: 'sequence', name: 'Changed', steps: [createSequenceStep(source, 'reference')] };
		const changed = { ...source, profile: { ...file, name: 'Changed file' } };
		const document = JSON.parse(encapsulateSharedProfile(sequence, [changed]));
		expect(document.external[0]).toEqual(changed);
		expect(document.profile.steps[0].profile).toEqual(file);
	});

	it.each([
		{ mode: 'unknown', profileID: 'file', profile: file },
		{ mode: 'reference', profileID: '', profile: file },
		{ mode: 'value', profileID: 'ai', profile: { kind: 'ai', name: 'AI' } },
		{ mode: 'value', profileID: 'missing' }
	])('rejects malformed sequence steps: %j', function (step) {
		expect(function (): void { decapsulateSharedProfile(JSON.stringify({ version: 1, profile: { kind: 'sequence', name: 'Bad', steps: [step] } })); }).toThrow();
	});
});
