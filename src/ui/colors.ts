export const brandColors = {
	background: '#ff1493',
	section: '#ffde00',
	surface: '#fff',
	text: '#4e1430',
	title: '#75113d',
	inputText: '#280016',
	onBackground: '#fff',
	sectionBorder: 'transparent',
	border: '#bd2b72',
	helpSurface: '#fff0f8',
	folder: '#2196f3',
	stepCard: '#ff1493',
	stepCardText: '#fff',
	error: '#b00020',
	errorSurface: '#fff0f0',
	accent: '#2196f3',
	button: '#2196f3',
	destructive: '#75113d'
};

export type AppColors = typeof brandColors;

export function getAppColors(useSystemColors: boolean, colorScheme: 'light' | 'dark' | 'unspecified' | null | undefined): AppColors {
	if (!useSystemColors) {
		return(brandColors);
	}
	if (colorScheme === 'dark') {
		return({
			background: '#14171c',
			section: '#1d2128',
			surface: '#272c35',
			text: '#e6e8ec',
			title: '#f4f5f7',
			inputText: '#f4f5f7',
			onBackground: '#e6e8ec',
			sectionBorder: '#3a414d',
			border: '#4a525f',
			helpSurface: '#272c35',
			folder: '#2c3a4d',
			stepCard: '#272c35',
			stepCardText: '#e6e8ec',
			error: '#d9908f',
			errorSurface: '#3a2a2c',
			accent: '#7f9cc0',
			button: '#4f6d94',
			destructive: '#5b6573'
		});
	}
	return({
		background: '#e8eaed',
		section: '#ffffff',
		surface: '#f4f5f7',
		text: '#2b2f36',
		title: '#1f2430',
		inputText: '#1f2430',
		onBackground: '#2b2f36',
		sectionBorder: '#767d89',
		border: '#9aa1ac',
		helpSurface: '#ffffff',
		folder: '#dfe6ee',
		stepCard: '#f4f5f7',
		stepCardText: '#2b2f36',
		error: '#9b3b3b',
		errorSurface: '#f8ecec',
		accent: '#3d5a80',
		button: '#3d5a80',
		destructive: '#6b7685'
	});
}
