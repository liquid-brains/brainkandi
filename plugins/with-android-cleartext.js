const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidCleartext(config) {
	return(withAndroidManifest(config, function (config) {
		const application = config.modResults.manifest.application?.[0];
		if (application === undefined) {
			throw(new Error('Android manifest has no application element.'));
		}
		application.$['android:usesCleartextTraffic'] = 'true';
		return(config);
	}));
};
