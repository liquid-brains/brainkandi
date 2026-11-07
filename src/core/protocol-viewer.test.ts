import { describe, expect, it } from 'vitest';

import type { Journey } from './journey-store';
import { feedbackCountsByFile, journeyProtocolFiles, normalizePhase, protocolDiagramRows, protocolModuleViews, protocolTint } from './protocol-viewer';

describe('protocol viewer', function () {
	it('uses Brain Broccoli anatomical positions and device channel numbers, not array order', function () {
		const modules = protocolModuleViews({ modules: [
			{ module_no: 11, active: true, freq: 25, power: 140, activeRunTime: 1, moduleControl: { phase: 1 } },
			{ module_no: 7, active: true, freq: 25, power: 140, activeRunTime: 1, moduleControl: { phase: 1 } },
			{ module_no: 10, active: true, freq: 25, power: 140, activeRunTime: 1, moduleControl: { phase: 0 } }
		] })!;
		expect(protocolDiagramRows).toEqual([['NL', 'NR'], ['L1', 'C1', 'R1'], ['L2', 'C2', 'R2'], ['L3', 'C3', 'R3'], ['C4']]);
		expect(modules).toHaveLength(12);
		expect(modules.find(function (module) { return(module.name === 'NL'); })).toMatchObject({ number: 11, phase: 'B', frequency: '25', power: '140', runTime: 1, inactive: false, saturation: 1 });
		expect(modules.find(function (module) { return(module.name === 'L3'); })).toMatchObject({ number: 10, phase: 'A', inactive: false });
		expect(modules.find(function (module) { return(module.name === 'NR'); })).toMatchObject({ inactive: true, power: '0', frequency: '0', saturation: 0 });
	});

	it('reads legacy module controls without changing the saved protocol', function () {
		const data = { modules: [{ module_no: 7, runTime: 2.25, delayStartTime: 1, moduleControl: { freq: 10, power: 70, phase: 'Phase B' } }] };
		const original = JSON.stringify(data);
		expect(protocolModuleViews(data)?.[0]).toMatchObject({ frequency: '10', power: '70', phase: 'B', runTime: 2.3, delay: 1, saturation: 0.5 });
		expect(JSON.stringify(data)).toBe(original);
	});

	it.each([1, '1', 'B', 'Phase B'])('normalizes phase %s', function (phase) {
		expect(normalizePhase(phase)).toBe('B');
		expect(normalizePhase(0)).toBe('A');
	});

	it('marks disabled and zero-power modules inactive, but not zero frequency alone', function () {
		const modules = protocolModuleViews({ modules: [
			{ module_no: 7, active: false, power: 140, freq: 25 },
			{ module_no: 5, power: 0, freq: 25 },
			{ module_no: 3, power: 70, freq: 0 }
		] })!;
		expect(modules.slice(0, 3).map(function (module) { return(module.inactive); })).toEqual([true, true, false]);
		expect(modules[0]).toMatchObject({ power: '0', frequency: '0' });
	});

	it('uses global sweeps for labels, runtime and delivered tint', function () {
		const modules = protocolModuleViews({
			frequency: { active: true, startFreq: 10, endFreq: 30, freqStepSize: 10, stepDuration: 60 },
			power: { active: true, startPower: 70, endPower: 140, powerStepSize: 70 },
			modules: [{ module_no: 7, activeRunTime: 1, power: 0, freq: 0 }]
		})!;
		expect(modules[0]).toMatchObject({ frequency: '10-30', power: '70-140', runTime: 3, saturation: 0.75, inactive: false });
		expect(modules[1]).toMatchObject({ inactive: true, runTime: 0 });
	});

	it('ignores disabled and invalid sweep durations', function () {
		expect(protocolModuleViews({
			frequency: { active: false, startFreq: 10, endFreq: 30, freqStepSize: 10, stepDuration: 60 },
			power: { startPower: 140, endPower: 70, powerStepSize: 10, stepDuration: 60 },
			modules: [{ module_no: 7, activeRunTime: 2 }]
		})?.[0]).toMatchObject({ frequency: '40', runTime: 2 });
	});

	it('only shows cross coupling when enabled globally and on an active channel', function () {
		const data = { cross: { active: true, freq: 10 }, modules: [
			{ module_no: 7, applyCross: true, power: 100 },
			{ module_no: 5, applyCross: true, power: 0 }
		] };
		expect(protocolModuleViews(data)?.[0]?.crossFrequency).toBe('10 Hz');
		expect(protocolModuleViews(data)?.[1]?.crossFrequency).toBe('off');
		expect(protocolModuleViews({ ...data, cross: { active: false, freq: 10 } })?.[0]?.crossFrequency).toBe('off');
	});

	it.each([{}, { modules: null }, { modules: [null] }, { modules: [{ module_no: '7' }] }])('handles unreadable saved data %j', function (data) {
		expect(protocolModuleViews(data)).toBeUndefined();
	});

	it('blends phase colors from the current theme surface', function () {
		expect(protocolTint('#ffde00', '#ffffff', 0)).toBe('rgb(255,255,255)');
		expect(protocolTint('#ffde00', '#ffffff', 1)).toBe('rgb(255,222,0)');
		expect(protocolTint('#ffde00', '#fff', 0.5)).toBe('rgb(255,239,128)');
		expect(protocolTint('#2196f3', '#2c2c2e', 0)).toBe('rgb(44,44,46)');
	});

	it('keeps recorded files in order, including repeated names, and falls back for old file journeys', function () {
		const journey: Journey = {
			id: 'test',
			startedAt: '2026-11-01T14:59:43Z',
			outcome: 'completed',
			profile: { kind: 'file', name: 'Saved', fileName: 'saved.vnp0', fileData: { modules: [] } },
			files: [{ fileName: 'part.vnp0', data: { modules: [] } }, { fileName: 'part.vnp0', data: { modules: [{ module_no: 7 }] } }]
		};
		expect(journeyProtocolFiles(journey)).toBe(journey.files);
		expect(journeyProtocolFiles({ ...journey, files: [] })).toEqual([{ fileName: 'saved.vnp0', data: { modules: [] } }]);
		expect(journeyProtocolFiles({ ...journey, files: [], profile: { kind: 'rest', name: 'Rest', seconds: 60 } })).toEqual([]);
	});
});

describe('feedback counts', function () {
	it('tallies thumbs per protocol file and ignores unknown files', function () {
		const journey: Journey = {
			id: 'j',
			profile: { kind: 'file', name: 'P', fileName: 'a.vnp0', fileData: {} },
			startedAt: '2026-10-04T21:00:00.000Z',
			outcome: 'completed',
			files: [{ fileName: 'a.vnp0', data: {} }, { fileName: 'b.vnp0', data: {} }],
			feedback: [
				{ at: '2026-10-04T21:00:01.000Z', value: 1, fileIndex: 1 },
				{ at: '2026-10-04T21:00:02.000Z', value: 1, fileIndex: 1 },
				{ at: '2026-10-04T21:00:03.000Z', value: -1, fileIndex: 0 },
				{ at: '2026-10-04T21:00:04.000Z', value: -1, fileIndex: 9 }
			]
		};
		expect(feedbackCountsByFile(journey)).toEqual([{ up: 0, down: 1 }, { up: 2, down: 0 }]);
	});
});
