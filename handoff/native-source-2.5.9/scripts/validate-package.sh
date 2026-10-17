#!/bin/bash
set -euo pipefail
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
for name in ios-polyfill ios-policy ios-engine ios-theme profile-reader background page-executor mobile-bridge keepalive-shim hardening followcheck; do
  test -s "FollowCheckIOS/Extension/$name.js"
  node --check "FollowCheckIOS/Extension/$name.js"
done
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync("FollowCheckIOS/Extension/manifest.json","utf8"));if(m.version!=="10.20.8")throw Error("Unexpected upstream engine");'
node tests/bootstrap-policy.mjs
node tests/original-core.cjs
node --test tests/runtime-regression.mjs
python3 - <<'PY'
from pathlib import Path
import hashlib, plistlib, xml.etree.ElementTree as ET
plistlib.loads(Path('FollowCheckIOS/Info.plist').read_bytes())
for p in Path('FollowCheckIOS.xcodeproj').rglob('*.xcscheme'): ET.parse(p)
files=sorted(p for root in ['FollowCheckIOS','FollowCheckIOS.xcodeproj','scripts','tests','.github'] for p in Path(root).rglob('*') if p.is_file() and p.name!='.DS_Store')
Path('PACKAGE-SHA256.txt').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.as_posix()}\n' for p in files))
print(f'Package manifest: {len(files)} files')
PY
printf '%s\n' 'PASS: package and JavaScript regression checks. Swift compilation and device QA are separate gates.'
