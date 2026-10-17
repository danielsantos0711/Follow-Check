#!/bin/bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
build_root="$project_root/build"
app_path="$build_root/Build/Products/Release-iphoneos/FollowCheck.app"
payload_path="$build_root/Payload"
ipa_path="$project_root/FollowCheck-iOS-unsigned.ipa"

xcodebuild \
  -project "$project_root/FollowCheckIOS.xcodeproj" \
  -scheme FollowCheckIOS \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath "$build_root" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  clean build

test -d "$app_path"
mkdir -p "$payload_path"
ditto "$app_path" "$payload_path/FollowCheck.app"

(
  cd "$build_root"
  /usr/bin/zip -qry "$ipa_path" Payload
)

shasum -a 256 "$ipa_path"
echo "$ipa_path"
