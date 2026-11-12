#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export JAVA_HOME

scripts/cap.sh
(cd android && ./gradlew assembleRelease)

build_tools="$(ls -d "${ANDROID_HOME:?set ANDROID_HOME}"/build-tools/* | sort -V | tail -1)"
release_dir="android/app/build/outputs/apk/release"
signed_apk="$release_dir/flarebot.apk"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sec get FLAREBOT_ANDROID_KEYSTORE_B64 | base64 --decode > "$work/release.jks"
"$build_tools/zipalign" -f -p 4 "$release_dir/app-release-unsigned.apk" "$work/aligned.apk"
sec run -- bash -c '"$0" sign --ks "$1" --ks-key-alias flarebot --ks-pass env:FLAREBOT_ANDROID_KEYSTORE_PASSWORD --out "$2" "$3"' \
  "$build_tools/apksigner" "$work/release.jks" "$signed_apk" "$work/aligned.apk"
"$build_tools/apksigner" verify "$signed_apk"

echo "$signed_apk"
