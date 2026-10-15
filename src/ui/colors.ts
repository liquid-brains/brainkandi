export const brandColors = {
	background: '#ff1493',
	section: '#ffde00',
	surface: '#fff',
	text: '#4e1430',
	title: '#75113d',
	inputText: '#280016',
	onBackground: '#fff',
	border: '#bd2b72',
	helpSurface: '#fff0f8',
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
			background: '#121212',
			section: '#1c1c1e',
			surface: '#2c2c2e',
			text: '#f2f2f7',
			title: '#fff',
			inputText: '#fff',
			onBackground: '#fff',
			border: '#636366',
			helpSurface: '#2c2c2e',
			error: '#ff8a80',
			errorSurface: '#442025',
			accent: '#0a84ff',
			button: '#0a84ff',
			destructive: '#ff6961'
		});
	}
	return({
		background: '#f2f2f7',
		section: '#fff',
		surface: '#fff',
		text: '#1c1c1e',
		title: '#000',
		inputText: '#000',
		onBackground: '#1c1c1e',
		border: '#8e8e93',
		helpSurface: '#fff',
		error: '#b00020',
		errorSurface: '#fff0f0',
		accent: '#0056b3',
		button: '#0056b3',
		destructive: '#b00020'
	});
}
