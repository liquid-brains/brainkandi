const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withMainActivity, withMainApplication } = require('@expo/config-plugins');

function volumeKeysSource(packageName) {
	return(`package ${packageName}

import android.view.KeyEvent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object VolumeKeys {
  @Volatile var enabled = false
  @Volatile var reactContext: ReactApplicationContext? = null

  fun isVolumeKey(keyCode: Int): Boolean {
    return keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
  }

  fun consumes(keyCode: Int): Boolean {
    return enabled && isVolumeKey(keyCode)
  }

  fun handleKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (!consumes(keyCode)) {
      return false
    }
    if (event == null || event.repeatCount == 0) {
      val direction = if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) "up" else "down"
      reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("brainkandiVolumeKey", direction)
    }
    return true
  }
}
`);
}

function volumeKeysModuleSource(packageName) {
	return(`package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager

class VolumeKeysModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init {
    VolumeKeys.reactContext = context
  }

  override fun getName(): String = "BrainKandiVolumeKeys"

  @ReactMethod
  fun setEnabled(enabled: Boolean) {
    VolumeKeys.enabled = enabled
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  override fun invalidate() {
    VolumeKeys.enabled = false
    VolumeKeys.reactContext = null
    super.invalidate()
  }
}

class VolumeKeysPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(VolumeKeysModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`);
}

const activityMethods = `
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (VolumeKeys.handleKeyDown(keyCode, event)) {
      return true
    }
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
    if (VolumeKeys.consumes(keyCode)) {
      return true
    }
    return super.onKeyUp(keyCode, event)
  }
`;

function withVolumeKeys(config) {
	config = withAndroidManifest(config, function (config) {
		AndroidConfig.Permissions.ensurePermissions(config.modResults, ['android.permission.VIBRATE']);
		return(config);
	});
	config = withMainActivity(config, function (config) {
		let contents = config.modResults.contents;
		if (!contents.includes('VolumeKeys.handleKeyDown')) {
			if (!contents.includes('import android.view.KeyEvent')) {
				contents = contents.replace(/^(package .*\n)/m, '$1\nimport android.view.KeyEvent');
			}
			const classIndex = contents.indexOf('class MainActivity');
			const braceIndex = contents.indexOf('{', classIndex);
			if (classIndex === -1 || braceIndex === -1) {
				throw(new Error('Could not find MainActivity to add volume key handling.'));
			}
			contents = contents.slice(0, braceIndex + 1) + activityMethods + contents.slice(braceIndex + 1);
		}
		config.modResults.contents = contents;
		return(config);
	});
	config = withMainApplication(config, function (config) {
		let contents = config.modResults.contents;
		if (!contents.includes('VolumeKeysPackage()')) {
			if (!contents.includes('PackageList(this).packages.apply {')) {
				throw(new Error('Could not find the package list to register volume key handling.'));
			}
			contents = contents.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(VolumeKeysPackage())');
		}
		config.modResults.contents = contents;
		return(config);
	});
	return(withDangerousMod(config, ['android', function (config) {
		const packageName = config.android?.package;
		if (packageName === undefined) {
			throw(new Error('android.package is required for volume key handling.'));
		}
		const directory = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...packageName.split('.'));
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(path.join(directory, 'VolumeKeys.kt'), volumeKeysSource(packageName));
		fs.writeFileSync(path.join(directory, 'VolumeKeysModule.kt'), volumeKeysModuleSource(packageName));
		return(config);
	}]));
}

module.exports = withVolumeKeys;
