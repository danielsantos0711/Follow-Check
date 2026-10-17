import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const swift = fs.readFileSync(new URL('../FollowCheckIOS/FollowCheckWebCoordinator.swift', import.meta.url), 'utf8');
const raw = swift.match(/source: """\n([\s\S]*?)\n\s*""",/)[1];
const source = raw.replace('\\(source)', 'globalThis.executed = true;').replaceAll('\\\\', '\\');
const cases = [
 ['https://www.instagram.com/', true],
 ['https://instagram.com/danny.r8/', true],
 ['https://www.instagram.com/accounts/login/', false],
 ['https://www.instagram.com/accounts/two_factor_authentication/', false],
 ['https://www.instagram.com/challenge/abc', false],
 ['https://www.instagram.com/checkpoint', false],
 ['https://www.instagram.com/oauth/', false],
 ['https://www.facebook.com/login/', false],
 ['https://instagram.com.evil.example/', false],
 ['http://www.instagram.com/', false],
 ['https://www.instagram.com/two_factor/', false],
 ['https://www.instagram.com/accounts/edit/', false],
];
for (const [url, expected] of cases) {
 const context = {location: new URL(url), executed: false};
 vm.runInNewContext(source, context);
 assert.equal(context.executed, expected, url);
}
console.log(`${cases.length} bootstrap isolation cases passed.`);
