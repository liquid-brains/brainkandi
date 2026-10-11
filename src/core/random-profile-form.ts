import { BrainlightError, VielightDevice } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import type { RandomSessionField } from '@liquid-brains/brainlight/lib/neuropro/index.js';
import type { RandomProfile, RandomSessionParameters } from './profiles';

export type FormValues = {
	basename: string;
	duration: string;
	frequencyRanges: FrequencyRangeForm[];
	frequencyPerChannel: boolean;
	frequencyOffPercentage: string;
	couplingMin: string;
	couplingMax: string;
	couplingRandomDistribution: string;
	abCouplingDistribution: string;
	powerMin: string;
	powerMax: string;
	powerPerChannel: boolean;
};

export type FrequencyRangeForm = {
	min: string;
	max: string;
};

export const defaultFormValues: FormValues = {
	basename: 'random',
	duration: '5',
	frequencyRanges: [{ min: '10', max: '' }],
	frequencyPerChannel: false,
	frequencyOffPercentage: '0',
	couplingMin: '',
	couplingMax: '',
	couplingRandomDistribution: '50',
	abCouplingDistribution: '',
	powerMin: '1',
	powerMax: '',
	powerPerChannel: true
};

export function isRandomFormValues(value: unknown): value is FormValues {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return(false);
	}
	for (const [name, defaultValue] of Object.entries(defaultFormValues)) {
		if (name === 'frequencyRanges') {
			continue;
		}
		if (!(name in value) || typeof Reflect.get(value, name) !== typeof defaultValue) {
			return(false);
		}
	}
	if (!('frequencyRanges' in value) || !Array.isArray(value.frequencyRanges)) {
		return(false);
	}
	return(value.frequencyRanges.every(function (range: unknown): boolean {
		return(
			typeof range === 'object' && range !== null &&
			'min' in range && typeof range.min === 'string' &&
			'max' in range && typeof range.max === 'string'
		);
	}));
}

function optionalNumber(value: string, field: RandomSessionField, errors: BrainlightError[]): number | undefined {
	if (value.trim() === '') {
		return(undefined);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		errors.push(new BrainlightError(`"${value}" is not a finite number.`, field));
	}
	return(parsed);
}

function requiredNumber(value: string, name: string, field: RandomSessionField, errors: BrainlightError[]): number {
	const parsed = optionalNumber(value, field, errors);
	if (parsed === undefined) {
		errors.push(new BrainlightError(`${name} is required.`, field));
		return(NaN);
	}
	return(parsed);
}

function parseRandomForm(values: FormValues): { parameters: RandomSessionParameters; errors: BrainlightError[] } {
	const errors: BrainlightError[] = [];
	let couplingMin = optionalNumber(values.couplingMin, 'coupling.min', errors);
	const couplingMax = optionalNumber(values.couplingMax, 'coupling.max', errors);
	const couplingRandomDistribution = optionalNumber(values.couplingRandomDistribution, 'coupling.distribution', errors);
	const abCouplingDistribution = optionalNumber(values.abCouplingDistribution, 'abCoupling.distribution', errors);
	const powerMax = optionalNumber(values.powerMax, 'power.max', errors);
	const offPercentage = optionalNumber(values.frequencyOffPercentage, 'frequency.offPercentage', errors) ?? 0;
	if (couplingMax !== undefined && couplingMin === undefined) {
		errors.push(new BrainlightError('Cross-coupling minimum is required when its maximum is set.', 'coupling.min'));
		couplingMin = NaN;
	}
	const parameters: RandomSessionParameters = {
		duration: requiredNumber(values.duration, 'Duration', 'duration', errors),
		frequency: {
			ranges: values.frequencyRanges.map(function (range, index): RandomSessionParameters['frequency']['ranges'][number] {
				const decodedRange = { min: requiredNumber(range.min, 'Frequency minimum', `frequency.ranges.${index}.min`, errors) };
				const maximum = optionalNumber(range.max, `frequency.ranges.${index}.max`, errors);
				if (maximum !== undefined) {
					return({ ...decodedRange, max: maximum });
				}
				return(decodedRange);
			}),
			offPercentage: offPercentage,
			perChannel: values.frequencyPerChannel
		},
		power: {
			min: requiredNumber(values.powerMin, 'Power minimum', 'power.min', errors),
			perChannel: values.powerPerChannel
		}
	};
	parameters.basename = values.basename.trim();
	if (powerMax !== undefined) {
		parameters.power.max = powerMax;
	}
	if (couplingMin !== undefined) {
		parameters.coupling = { min: couplingMin };
		if (couplingMax !== undefined) {
			parameters.coupling.max = couplingMax;
		}
		if (couplingRandomDistribution !== undefined) {
			parameters.coupling.distribution = couplingRandomDistribution;
		}
	}
	if (abCouplingDistribution !== undefined) {
		parameters.abCoupling = { distribution: abCouplingDistribution };
	}
	return({ parameters: parameters, errors: errors });
}

export function getRandomFormValidationErrors(values: FormValues): BrainlightError[] {
	const parsed = parseRandomForm(values);
	const errors = parsed.errors;
	for (const error of VielightDevice.getRandomParamsValidationErrors(parsed.parameters)) {
		if (!errors.some(function (existing): boolean { return(existing.field === error.field); })) {
			errors.push(error);
		}
	}
	return(errors);
}

export function randomParametersFromForm(values: FormValues): RandomSessionParameters {
	const error = getRandomFormValidationErrors(values)[0];
	if (error !== undefined) {
		throw(error);
	}
	return(parseRandomForm(values).parameters);
}

export function randomProfileFromForm(name: string, values: FormValues): RandomProfile {
	const parsed = parseRandomForm(values);
	if (parsed.errors.length > 0) {
		return({ kind: 'random', name: name, input: values });
	}
	return({ kind: 'random', name: name, parameters: parsed.parameters });
}

export function randomFormFromProfile(profile: RandomProfile): FormValues {
	if (profile.input !== undefined) {
		return(profile.input);
	}
	return(formValuesFromRandomParameters(profile.parameters));
}

export function randomParametersFromProfile(profile: RandomProfile): RandomSessionParameters {
	if (profile.input !== undefined) {
		return(randomParametersFromForm(profile.input));
	}
	const parameters = {
		...profile.parameters,
		frequency: {
			...profile.parameters.frequency,
			ranges: profile.parameters.frequency.ranges.map(function (range): RandomSessionParameters['frequency']['ranges'][number] {
				if (range.max !== undefined) {
					return({ min: range.min, max: range.max });
				}
				return({ min: range.min });
			})
		}
	};
	VielightDevice.validateRandomParams(parameters);
	return(parameters);
}

export function formValuesFromRandomParameters(parameters: RandomSessionParameters): FormValues {
	return({
		basename: parameters.basename ?? 'random',
		duration: String(parameters.duration),
		frequencyRanges: parameters.frequency.ranges.map(function (range): FrequencyRangeForm {
			return({
				min: String(range.min),
				max: range.max === undefined ? '' : String(range.max)
			});
		}),
		frequencyPerChannel: parameters.frequency.perChannel ?? false,
		frequencyOffPercentage: String(parameters.frequency.offPercentage ?? 0),
		couplingMin: parameters.coupling === undefined ? '' : String(parameters.coupling.min),
		couplingMax: parameters.coupling?.max === undefined ? '' : String(parameters.coupling.max),
		couplingRandomDistribution: parameters.coupling?.distribution === undefined ? '50' : String(parameters.coupling.distribution),
		abCouplingDistribution: parameters.abCoupling?.distribution === undefined ? '' : String(parameters.abCoupling.distribution),
		powerMin: String(parameters.power.min),
		powerMax: parameters.power.max === undefined ? '' : String(parameters.power.max),
		powerPerChannel: parameters.power.perChannel ?? true
	});
}
