import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const withSessionBackground = require('./with-session-background.js');

describe('Android session background configuration', function () {
	it('declares a private connected-device service and required permissions idempotently', async function () {
		const config = withSessionBackground({ name: 'Brain Kandi', slug: 'brainkandi' });
		const manifest = {
			manifest: {
				$: {},
				application: [{ $: { 'android:name': '.MainApplication' } }]
			}
		};
		const mod = { ...config, modResults: manifest, modRequest: { nextMod: function (value: unknown): unknown { return(value); } } };
		await config.mods.android.manifest(mod);
		await config.mods.android.manifest(mod);
		expect(mod.modResults.manifest).toMatchObject({
			'uses-permission': [
				{ $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } },
				{ $: { 'android:name': 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE' } },
				{ $: { 'android:name': 'android.permission.CHANGE_WIFI_STATE' } },
				{ $: { 'android:name': 'android.permission.WAKE_LOCK' } }
			],
			application: [{
				service: [{
					$: {
						'android:name': 'com.asterinet.react.bgactions.RNBackgroundActionsTask',
						'android:foregroundServiceType': 'connectedDevice',
						'android:exported': 'false'
					}
				}]
			}]
		});
	});
});
