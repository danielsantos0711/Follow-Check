#!/bin/bash
# Boots a simulator, installs the Debug build and captures the DEBUG preview
# screens (no Instagram session, no network). Usage: capture-screens.sh APP OUT
set -euo pipefail
app="$1"; out="$2"; mkdir -p "$out"
bundle=ch.dannysantos.followcheck.ios
device=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
c=[x for r,l in d.items() if "iOS" in r for x in l if x["name"].startswith("iPhone")]
pref=[x for x in c if "Pro" in x["name"] and "Max" not in x["name"]] or c
print(pref[-1]["udid"])')
xcrun simctl boot "$device" || true
xcrun simctl bootstatus "$device" -b
xcrun simctl status_bar "$device" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 || true
xcrun simctl install "$device" "$app"
shoot() { # name appearance args...
  local name="$1" appearance="$2"; shift 2
  xcrun simctl ui "$device" appearance "$appearance"
  xcrun simctl terminate "$device" "$bundle" >/dev/null 2>&1 || true
  xcrun simctl launch "$device" "$bundle" "$@" >/dev/null
  sleep "${SHOT_DELAY:-6}"
  xcrun simctl io "$device" screenshot "$out/$name-$appearance.png" >/dev/null
  echo "captured $name-$appearance"
}
while read -r name args; do
  [ -z "$name" ] && continue
  for appearance in ${APPEARANCES:-dark light}; do shoot "$name" "$appearance" $args; done
done < "${SCREENS_FILE:-$(dirname "$0")/screens.txt}"
