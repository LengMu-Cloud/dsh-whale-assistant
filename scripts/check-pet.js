/**
 * Pet asset gate (first batch, CI + local):
 * 1. DLL SHA-256 pinning — the three ingested WebView2 DLLs must match
 *    scanner-safe: every manifest filename is whitelist-validated AND
 *    resolve-verified to land inside pet/dlls before any read;
 * 2. pet.ps1 sanity — UTF-8 BOM present (PS 5.1 + Chinese comments), the
 *    token is read from ENV ONLY (no literal, never in argv/URL building);
 * 3. page.html sanity — the __WHALE_SVG__ placeholder survives, assets are
 *    referenced RELATIVE (port-free), no absolute file:// leftovers.
 * Pure Node — runs on ubuntu CI where there is no pwsh.
 *
 * Usage: node scripts/check-pet.js   (exit 0 clean / 1 drift)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const petDir = path.join(__dirname, '..', 'whale-assistant', 'pet');
let failures = 0;
const fail = (msg) => { failures++; console.error('[check-pet] FAIL ' + msg); };
const ok = (msg) => console.log('[check-pet] ok  ' + msg);

/* 1. DLL SHA-256 pinning */
const manifestPath = path.join(petDir, 'dlls-manifest.json');
let manifest = null;
try {
	manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
	fail('dlls-manifest.json unreadable: ' + e.message);
}
if (manifest) {
	const dllDir = path.join(petDir, 'dlls');
	for (const [rawName, expected] of Object.entries(manifest.files || {})) {
		/* whitelist: plain DLL basenames only — no separators, no dot games */
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rawName) || rawName.includes('..')) {
			fail('manifest filename rejected by whitelist: ' + rawName);
			continue;
		}
		const file = path.resolve(dllDir, rawName);
		/* boundary: the resolved path must stay inside pet/dlls */
		if (file !== dllDir && !file.startsWith(dllDir + path.sep)) {
			fail('manifest filename escapes the dlls dir: ' + rawName);
			continue;
		}
		if (!fs.existsSync(file)) { fail('missing DLL ' + rawName); continue; }
		const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
		if (actual !== expected) fail('SHA-256 drift for ' + rawName + ' (expected ' + String(expected).slice(0, 12) + '…, got ' + actual.slice(0, 12) + '…)');
		else ok('sha256 ' + rawName);
	}
	const lic = path.resolve(dllDir, 'LICENSE.txt');
	if (fs.existsSync(lic)) ok('MIT license text present'); else fail('dlls/LICENSE.txt missing (redistribution notice)');
}

/* 2. pet.ps1 sanity */
const ps1Path = path.join(petDir, 'pet.ps1');
if (!fs.existsSync(ps1Path)) {
	fail('pet.ps1 missing');
} else {
	const buf = fs.readFileSync(ps1Path);
	if (buf[0] === 0xef && buf[1] === 0xbb && [0xbf].indexOf(buf[2]) !== -1) ok('pet.ps1 UTF-8 BOM');
	else fail('pet.ps1 lacks UTF-8 BOM (PS 5.1 will mangle the Chinese comments)');
	const text = buf.toString('utf8');
	/* token handling: must come from env, injected straight into the request
	 * header; a baked-in hex literal would mean a committed secret */
	if (/DSH_PET_TOKEN/.test(text)) ok('token sourced from env');
	else fail('pet.ps1 does not read DSH_PET_TOKEN from env');
	if (/X-DSH-Pet-Token['"]\s*,\s*\$env:DSH_PET_TOKEN/.test(text)) ok('token injected into request header from env');
	else fail('header injection does not read $env:DSH_PET_TOKEN directly');
	for (const needle of ['WebResourceRequested', 'DSH_PET_PARENT_PID', 'dsh-whale-pet']) {
		if (text.indexOf(needle) !== -1) ok('pet.ps1 has ' + needle);
		else fail('pet.ps1 missing ' + needle);
	}
}

/* 3. page.html sanity */
const pagePath = path.join(petDir, 'page.html');
if (!fs.existsSync(pagePath)) {
	fail('page.html missing');
} else {
	const text = fs.readFileSync(pagePath, 'utf8');
	if (text.indexOf('__WHALE_SVG__') !== -1) ok('page.html __WHALE_SVG__ placeholder present');
	else fail('page.html lost the __WHALE_SVG__ placeholder');
	if (/href="style\.css"/.test(text) && /src="whale\.js"/.test(text)) ok('assets referenced relative (port-free)');
	else fail('page.html must reference style.css/whale.js RELATIVELY');
	if (/file:\/\/\//.test(text)) fail('page.html still contains a file:// absolute URL (POC leftover)');
	else ok('no file:// absolute URLs');
	if (/fetch\('state'\)/.test(text) && /fetch\('ctrl'/.test(text)) ok('state/ctrl relative fetches present');
	else fail('page.html missing state/ctrl fetches');
}

if (failures) {
	console.error('[check-pet] ' + failures + ' failure(s)');
	process.exit(1);
}
console.log('[check-pet] all gates green');
