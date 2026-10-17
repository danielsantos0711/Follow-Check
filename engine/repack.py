#!/usr/bin/env python3
"""Update the JS engine inside the supplied unsigned 2.5.7 IPA; no native compilation."""
import hashlib
import copy
import os
import plistlib
from pathlib import Path
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parent
if len(sys.argv) != 3:
    raise SystemExit('Usage: python3 repack.py BASE_2.5.7.ipa OUTPUT_2.5.11.ipa')
base, output = map(Path, sys.argv[1:])
if base.resolve() == output.resolve():
    raise SystemExit('The output must be a separate file.')
prefix = 'Payload/FollowCheck.app/'
output.parent.mkdir(parents=True, exist_ok=True)
# Do not expose a partially written .ipa. Validate a temporary file completely
# before publishing the final pathname used for delivery.
fd, staged_name = tempfile.mkstemp(prefix='.followcheck-', suffix='.partial', dir=output.parent)
os.close(fd)
staged = Path(staged_name)
updates = {prefix + 'Extension/' + name: (root / 'Extension' / name).read_bytes()
           for name in ['background.js', 'page-executor.js']}
with zipfile.ZipFile(base) as source:
    assert source.testzip() is None
    info = plistlib.loads(source.read(prefix + 'Info.plist'))
    if info.get('CFBundleShortVersionString') != '2.5.7' or str(info.get('CFBundleVersion')) != '27':
        raise SystemExit('Expected the unsigned 2.5.7 (27) base IPA.')
    info['CFBundleShortVersionString'] = '2.5.11'
    info['CFBundleVersion'] = '31'
    updates[prefix + 'Info.plist'] = plistlib.dumps(info, fmt=plistlib.FMT_BINARY)
    if any('/_CodeSignature/' in name or name.endswith('/embedded.mobileprovision') for name in source.namelist()):
        raise SystemExit('Expected the unsigned base, without signing/provisioning resources.')
    with zipfile.ZipFile(staged, 'w') as target:
        for entry in source.infolist():
            target.writestr(copy.copy(entry), updates.get(entry.filename, source.read(entry.filename)))
with zipfile.ZipFile(base) as source, zipfile.ZipFile(staged) as target:
    assert target.testzip() is None
    assert source.namelist() == target.namelist()
    changed = [name for name in source.namelist() if source.read(name) != target.read(name)]
    assert set(changed) == set(updates), changed
    for entry in source.infolist():
        assert target.getinfo(entry.filename).external_attr == entry.external_attr
    native = prefix + str(info['CFBundleExecutable'])
    assert hashlib.sha256(source.read(native)).digest() == hashlib.sha256(target.read(native)).digest()
expected_hash = hashlib.sha256(staged.read_bytes()).hexdigest()
expected_size = staged.stat().st_size
with staged.open('rb') as handle:
    os.fsync(handle.fileno())
os.replace(staged, output)
with zipfile.ZipFile(output) as delivered:
    assert delivered.testzip() is None
assert output.stat().st_size == expected_size
assert hashlib.sha256(output.read_bytes()).hexdigest() == expected_hash
print('Verified: only two engine scripts and Info.plist changed; native executable unchanged.')
print('Output:', output.resolve())
print('Bytes:', expected_size)
print('SHA256:', expected_hash)
