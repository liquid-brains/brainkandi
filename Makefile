SOURCES := $(shell find App.tsx src plugins logo -type f 2>/dev/null)
BUILD_TARGET ?=
NDK_VERSION ?= 27.1.12297006

# Set MAKE_SHELL (for example, from a Nix shellHook) to wrap build commands.
# Example: make MAKE_SHELL='nix-shell android-shell.nix' apk
define run-in-build-shell
$(if $(MAKE_SHELL),$(MAKE_SHELL) --run '$(1)',$(1))
endef

all: check $(BUILD_TARGET)

node_modules/.done: package-lock.json
	npm clean-install
	@touch node_modules/.done

node_modules: node_modules/.done
	@touch node_modules

typecheck: $(SOURCES) node_modules
	npm run typecheck

test: $(SOURCES) node_modules
	npm test

check: typecheck test

bundle-android: $(SOURCES) node_modules
	npm run bundle:android

bundle-linux: $(SOURCES) node_modules
	npm run bundle:linux

run-linux: bundle-linux
	npm run linux

apk: $(SOURCES) app.json android-shell.nix node_modules
	$(call run-in-build-shell,npx expo prebuild --platform android --no-install --non-interactive && mkdir -p .android-sdk/ndk && for entry in "$$ANDROID_HOME"/*; do ln -sfn "$$entry" ".android-sdk/$$(basename "$$entry")"; done && if [ -d "$$ANDROID_HOME/ndk/$(NDK_VERSION)" ]; then ln -sfn "$$ANDROID_HOME/ndk/$(NDK_VERSION)" ".android-sdk/ndk/$(NDK_VERSION)"; elif [ -d "$$ANDROID_HOME/ndk-bundle" ]; then ln -sfn "$$ANDROID_HOME/ndk-bundle" ".android-sdk/ndk/$(NDK_VERSION)"; else echo "Android NDK $(NDK_VERSION) is not installed" >&2; exit 1; fi && ANDROID_HOME="$$PWD/.android-sdk" ANDROID_SDK_ROOT="$$PWD/.android-sdk" GRADLE_USER_HOME="$$PWD/.gradle" CCACHE_DIR="$$PWD/.ccache" CCACHE_BASEDIR="$$PWD" CMAKE_C_COMPILER_LAUNCHER=ccache CMAKE_CXX_COMPILER_LAUNCHER=ccache ./android/gradlew --project-dir android --build-cache assembleRelease && printf "APK: %s\\n" "$$PWD/android/app/build/outputs/apk/release/app-release.apk")

ipa: $(SOURCES) app.json node_modules
	$(call run-in-build-shell,npx expo prebuild --platform ios --no-install --non-interactive && cd ios && pod install && xcodebuild -workspace BrainKandi.xcworkspace -scheme BrainKandi -configuration Release -sdk iphoneos -derivedDataPath ../.xcode-derived-data CODE_SIGNING_ALLOWED=NO build && printf "iOS app: %s\\n" "$$PWD/../.xcode-derived-data/Build/Products/Release-iphoneos/BrainKandi.app")

android-devices: android-shell.nix
	NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1 nix-shell android-shell.nix --run 'adb devices'

android-users: android-shell.nix
	NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1 nix-shell android-shell.nix --run 'adb shell pm list users'

android-crash-log: android-shell.nix
	NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1 nix-shell android-shell.nix --run 'adb shell am force-stop --user 0 org.brainkandi.app && adb logcat -c && adb shell am start --user 0 -n org.brainkandi.app/.MainActivity >/dev/null && sleep 3 && adb logcat -d -v brief "*:E"'

android-install: android-shell.nix
	NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1 nix-shell android-shell.nix --run 'adb install --user 0 -r android/app/build/outputs/apk/release/app-release.apk'

clean:
	rm -rf dist dist-linux android ios .xcode-derived-data

distclean: clean
	rm -rf node_modules .expo .android-sdk .gradle .ccache

.PHONY: all clean distclean typecheck test check bundle-android bundle-linux run-linux apk ipa android-devices android-users android-crash-log android-install
