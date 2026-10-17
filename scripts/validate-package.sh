#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
for name in ios-polyfill ios-policy ios-engine ios-theme profile-reader background page-executor mobile-bridge keepalive-shim hardening followcheck; do
  test -s "FollowCheckIOS/Extension/$name.js"
  node --check "FollowCheckIOS/Extension/$name.js"
done
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("FollowCheckIOS/Extension/manifest.json","utf8"));if(m.version!=="10.20.8")throw Error("Unexpected upstream engine");'
# Engine 2.5.11: pagination, stable-surplus validation, checkpoints v4.
node --test tests/engine/runtime-regression.mjs tests/engine/watchlist-pagination.mjs tests/engine/watchlist-partial.mjs
# Native 2.5.9 suites, run against the integrated engine.
node tests/native-2.5.9/bootstrap-policy.mjs
node tests/native-2.5.9/original-core.cjs
node tests/native-2.5.9/superseded.mjs
python3 - <<'PY'
from pathlib import Path
import plistlib, xml.etree.ElementTree as ET
plistlib.loads(Path('FollowCheckIOS/Info.plist').read_bytes())
for p in Path('FollowCheckIOS.xcodeproj').rglob('*.xcscheme'): ET.parse(p)
PY
printf '%s\n' 'PASS: package and JavaScript regression checks. Swift compilation and device QA are separate gates.'
