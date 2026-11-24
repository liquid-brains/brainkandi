import type { RandomSessionParameters } from './profiles';

function span(min: number, max: number | undefined, unit: string): string {
	return(`${max === undefined ? String(min) : `${min}-${max}`}${unit}`);
}

export function randomParametersSummary(parameters: RandomSessionParameters): string {
	const frequency = parameters.frequency;
	const parts = [
		`${parameters.duration} minute(s)`,
		frequency.ranges.map(range => span(range.min, range.max, '')).join(', ') + ' Hz'
	];
	if (parameters.sessionDuration !== undefined && parameters.sessionDuration !== 1) {
		parts.push(`${parameters.sessionDuration} min per file`);
	}
	if (frequency.distributeRanges === true) {
		parts.push('ranges distributed evenly');
	}
	if (frequency.perChannel === true) {
		parts.push('frequency per channel');
	}
	if ((frequency.offPercentage ?? 0) !== 0) {
		parts.push(`Off ${frequency.offPercentage}%`);
	}
	if (parameters.coupling !== undefined) {
		const distribution = parameters.coupling.distribution ?? 50;
		parts.push(`Coupling ${span(parameters.coupling.min, parameters.coupling.max, '')} Hz${distribution === 50 ? '' : ` (${distribution}%)`}`);
	}
	if (parameters.abCoupling?.distribution !== undefined) {
		parts.push(`Phase A ${parameters.abCoupling.distribution}%`);
	}
	if (parameters.power.min !== 1 || parameters.power.max !== undefined) {
		parts.push(`Power ${span(parameters.power.min, parameters.power.max, '')}`);
	}
	if (parameters.power.perChannel === false) {
		parts.push('power shared across channels');
	}
	if (parameters.basename !== undefined && parameters.basename !== 'random') {
		parts.push(`Name ${parameters.basename}`);
	}
	return(parts.join(', '));
}
