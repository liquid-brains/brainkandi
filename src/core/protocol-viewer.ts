import type { Journey, JourneyFile } from './journey-store';

export const protocolModules = [
	{ name: 'C1', number: 7 },
	{ name: 'C2', number: 5 },
	{ name: 'C3', number: 3 },
	{ name: 'C4', number: 12 },
	{ name: 'L1', number: 8 },
	{ name: 'L2', number: 9 },
	{ name: 'L3', number: 10 },
	{ name: 'R1', number: 6 },
	{ name: 'R2', number: 4 },
	{ name: 'R3', number: 1 },
	{ name: 'NR', number: 2 },
	{ name: 'NL', number: 11 }
] as const;

export const protocolDiagramRows = [
	['NL', 'NR'],
	['L1', 'C1', 'R1'],
	['L2', 'C2', 'R2'],
	['L3', 'C3', 'R3'],
	['C4']
] as const;

export type ProtocolModuleView = {
	name: string;
	number: number;
	inactive: boolean;
	phase: 'A' | 'B';
	frequency: string;
	power: string;
	crossFrequency: string;
	runTime: number;
	delay: number;
	saturation: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function numericValue(value: unknown, fallback = 0): number {
	const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
	return(Number.isFinite(numeric) ? numeric : fallback);
}

export function normalizePhase(phase: unknown): 'A' | 'B' {
	const normalized = String(phase ?? 'A').trim().toUpperCase();
	return(normalized === '1' || normalized.includes('B') ? 'B' : 'A');
}

function sweepMinutes(section: Record<string, unknown>, startKey: string, endKey: string, stepKey: string, fallbackDuration?: unknown): number | undefined {
	const start = numericValue(section[startKey]);
	const end = numericValue(section[endKey]);
	const step = numericValue(section[stepKey]);
	const duration = numericValue(section.stepDuration || fallbackDuration);
	if (section.active !== false && start > 0 && end >= start && step > 0 && duration > 0) {
		const minutes = (Math.floor((end - start) / step) + 1) * duration / 60;
		return(Number.isFinite(minutes) ? minutes : undefined);
	}
	return(undefined);
}

export function journeyProtocolFiles(journey: Journey): JourneyFile[] {
	if (journey.files.length > 0) {
		return(journey.files);
	}
	if (journey.profile.kind === 'file') {
		return([{ fileName: journey.profile.fileName, data: journey.profile.fileData }]);
	}
	return([]);
}

export function protocolModuleViews(data: Record<string, unknown>): ProtocolModuleView[] | undefined {
	if (!Array.isArray(data.modules) || data.modules.some(function (module): boolean {
		return(!isRecord(module) || typeof module.module_no !== 'number' || !Number.isFinite(module.module_no));
	})) {
		return(undefined);
	}
	const modules = data.modules.filter(isRecord);
	const frequency = isRecord(data.frequency) ? data.frequency : {};
	const power = isRecord(data.power) ? data.power : {};
	const cross = isRecord(data.cross) ? data.cross : {};
	const durations = [
		sweepMinutes(frequency, 'startFreq', 'endFreq', 'freqStepSize'),
		sweepMinutes(power, 'startPower', 'endPower', 'powerStepSize', frequency.stepDuration)
	].filter(function (duration): duration is number { return(duration !== undefined); });
	const sweepDuration = durations.length > 0 ? Math.max(...durations) : undefined;
	const sweepFrequency = frequency.active !== false && numericValue(frequency.startFreq) > 0 && numericValue(frequency.endFreq) > 0;
	const sweepPower = power.active !== false && numericValue(power.startPower) > 0 && numericValue(power.endPower) > 0;
	const views = protocolModules.map(function (info): ProtocolModuleView {
		const module = modules.find(function (module): boolean { return(module.module_no === info.number); });
		const control = isRecord(module?.moduleControl) ? module.moduleControl : {};
		const active = module !== undefined && module.active !== false;
		const modulePower = numericValue(module?.power ?? control.power, 100);
		const effectivePower = sweepPower ? (numericValue(power.startPower) + numericValue(power.endPower)) / 2 : modulePower;
		const runTime = active && sweepDuration !== undefined ? sweepDuration : numericValue(module?.activeRunTime ?? module?.runTime);
		const inactive = !active || effectivePower <= 0;
		return({
			...info,
			inactive: inactive,
			phase: normalizePhase(control.phase ?? module?.phase),
			frequency: !active ? '0' : sweepFrequency ? `${numericValue(frequency.startFreq)}-${numericValue(frequency.endFreq)}` : String(numericValue(module?.freq ?? control.freq, 40)),
			power: !active ? '0' : sweepPower ? `${numericValue(power.startPower)}-${numericValue(power.endPower)}` : String(modulePower),
			crossFrequency: !inactive && module?.applyCross === true && cross.active !== false ? `${numericValue(cross.freq)} Hz` : 'off',
			runTime: runTime,
			delay: numericValue(module?.delayStartTime),
			saturation: active ? effectivePower * runTime : 0
		});
	});
	const referenceMinutes = Math.max(0, ...views.map(function (view): number { return(view.runTime); }));
	return(views.map(function (view): ProtocolModuleView {
		return({
			...view,
			runTime: Math.round(view.runTime * 10) / 10,
			saturation: referenceMinutes <= 0 ? 0 : Math.min(1, Math.max(0, view.saturation / (140 * referenceMinutes)))
		});
	}));
}

export function protocolTint(color: string, surface: string, saturation: number): string {
	const expand = function (hex: string): string {
		return(hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex);
	};
	const baseColor = expand(surface);
	const phaseColor = expand(color);
	const channels = [1, 3, 5].map(function (index): number {
		const base = Number.parseInt(baseColor.slice(index, index + 2), 16);
		const phase = Number.parseInt(phaseColor.slice(index, index + 2), 16);
		return(Math.round(base + (phase - base) * saturation));
	});
	return(`rgb(${channels.join(',')})`);
}
