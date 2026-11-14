const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

const marker = 'brainkandi tablet rotation';
const snippet = `
    // ${marker}: phones stay in portrait, tablets (smallest width 600dp or more) rotate freely.
    if (resources.configuration.smallestScreenWidthDp < 600) {
      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
`;

module.exports = function withTabletRotation(config) {
	config = withAndroidManifest(config, function (config) {
		for (const activity of config.modResults.manifest.application?.[0]?.activity ?? []) {
			delete activity.$['android:screenOrientation'];
		}
		return(config);
	});
	return(withMainActivity(config, function (config) {
		let contents = config.modResults.contents;
		if (!contents.includes(marker)) {
			const match = /super\.onCreate\([^)]*\)\n/.exec(contents);
			if (match === null) {
				throw(new Error('Could not find MainActivity.onCreate to add tablet rotation.'));
			}
			const end = match.index + match[0].length;
			contents = contents.slice(0, end) + snippet + contents.slice(end);
		}
		config.modResults.contents = contents;
		return(config);
	}));
};
