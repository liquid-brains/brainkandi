{ pkgs ? import <nixpkgs> {} }:

let
  androidComposition = pkgs.androidenv.composeAndroidPackages {
    buildToolsVersions = [ "35.0.0" "36.0.0" ];
    platformVersions = [ "36" ];
    includeNDK = true;
    ndkVersions = [ "27.1.12297006" ];
    includeCmake = true;
    cmakeVersions = [ "3.22.1" ];
  };
in
pkgs.mkShell {
  packages = [
    pkgs.ccache
    pkgs.jdk17
    androidComposition.androidsdk
  ];

  ANDROID_HOME = "${androidComposition.androidsdk}/libexec/android-sdk";
  ANDROID_SDK_ROOT = "${androidComposition.androidsdk}/libexec/android-sdk";
}
