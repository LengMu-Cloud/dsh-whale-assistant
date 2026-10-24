#!/usr/bin/env node
/* build-market-index.js — keep market/market-index.json in step with releases.
 * After tagging a release, run:  node scripts/build-market-index.js
 * It merges the latest v* tag ({version, commit, publish timestamp} read from
 * git) into the index, then self-checks the result against the format-1 rules
 * that the official validator (@deepseek-ai/dsh-plugin-market-index) enforces.
 * The Host re-validates on fetch; this local pass only catches typos early. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'market', 'market-index.json');
const PKG_NAME = '@lengmu-cloud/dsh-whale-assistant';
const REPO_URL = 'https://github.com/LengMu-Cloud/dsh-whale-assistant';

function git(args) {
	const r = spawnSync('git', ['-C', ROOT].concat(args), { encoding: 'utf8' });
	if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + r.stderr);
	return r.stdout;
}

/* --- format-1 rules mirrored from the official validator (no semver dep) --- */
const NUMERIC = '(?:0|[1-9]\\d*)';
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER = new RegExp(`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`);
const COMMIT = /^[0-9a-f]{40}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const INDEX_URL_BASE = 'https://raw.githubusercontent.com/LengMu-Cloud/dsh-whale-assistant/main/market/market-index.json';

function fail(msg) { throw new Error('format-1 self-check: ' + msg); }
function checkLocalized(value, at) {
	if (typeof value === 'string') { if (!value.trim()) fail(at + ' empty string'); return; }
	if (typeof value !== 'object' || value === null) fail(at + ' must be string or localized object');
	if (!Object.hasOwn(value, 'en')) fail(at + ' must contain en');
	for (const [k, v] of Object.entries(value)) if (!/^[a-z]{2,8}(-[a-z0-9]{1,8})*$/.test(k) || !String(v).trim()) fail(at + '.' + k + ' bad language id or empty text');
}
function checkCanonicalRepoUrl(url, at) {
	let u;
	try { u = new URL(url); } catch (e) { fail(at + ' not an absolute URL'); }
	if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(at + ' must use http(s)');
	if (u.username || u.password) fail(at + ' must not contain credentials');
	if (u.href !== url) fail(at + ' must be a canonical URL (href === input)');
	if (!/^(?:\/[^/]+){2,}$/.test(u.pathname)) fail(at + ' must name a repository with >=2 path segments');
	if (/\.(?:tgz|tar\.gz)$/i.test(u.pathname)) fail(at + ' must name a repository, not a tarball');
}
function checkVersion(entry, at) {
	if (!SEMVER.test(entry.version)) fail(at + '.version must be an exact SemVer version');
	const ts = entry.publishTimestamp;
	if (!Number.isInteger(ts) || ts < 0 || ts >= 1e11) fail(at + '.publishTimestamp must be Unix seconds in [0, 1e11)');
	const s = entry.source;
	if (!s || (s.type !== 'git' && s.type !== 'npm')) fail(at + '.source.type must be "npm" or "git"');
	if (s.type === 'git') {
		checkCanonicalRepoUrl(s.url, at + '.source.url');
		if (!COMMIT.test(s.commit)) fail(at + '.source.commit must be a lowercase 40-hex commit SHA');
		for (const seg of String(s.path || '').split('/')) {
			if (seg === '' || seg === '.' || seg === '..' || !PATH_SEGMENT.test(seg)) fail(at + '.source.path has an invalid segment: ' + JSON.stringify(seg));
		}
	}
	const range = entry.engines && entry.engines.dsh;
	if (range !== undefined && (typeof range !== 'string' || range.startsWith('workspace:'))) fail(at + '.engines.dsh must be a non-workspace SemVer range');
}

function semverKey(v) {
	const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-zA-Z.-]+))?/);
	if (!m) return [0, 0, 0, 1, ''];
	return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : 0, m[4] || ''];
}
function rcompare(a, b) {
	const ka = semverKey(a), kb = semverKey(b);
	for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
	return ka[4] < kb[4] ? 1 : ka[4] > kb[4] ? -1 : 0;
}

/* --- 1. latest v* tag facts straight from git --- */
const tag = git(['describe', '--tags', '--abbrev=0']).trim();
const sha = git(['rev-list', '-1', tag]).trim();
const ts = Number(git(['log', '-1', '--format=%ct', tag]).trim());
const tagPkg = JSON.parse(git(['show', tag + ':whale-assistant/package.json']));
const version = tagPkg.version;
console.log('latest tag', tag, '->', version, '@', sha.slice(0, 10), 'ts', ts);

/* --- 2. merge into the index --- */
const idx = fs.existsSync(INDEX)
	? JSON.parse(fs.readFileSync(INDEX, 'utf8'))
	: {
		format: 1,
		title: { en: 'LengMu-Cloud Plugin Index', zh: 'LengMu-Cloud 插件索引' },
		metadata: {
			categories: {
				companion: { title: { en: 'Companion', zh: '陪伴' } },
				tooling: { title: { en: 'Tooling', zh: '工具' } }
			}
		},
		plugins: []
	};

let plugin = idx.plugins.find((x) => x.name === PKG_NAME);
if (!plugin) {
	plugin = {
		name: PKG_NAME,
		title: { en: 'Whale Assistant', zh: '打工小鲸鱼' },
		description: {
			en: 'The companion whale for DeepSeek Harness: task notifications, three-line usage reports, history with session jump, reminders, weekly stats, sleep and moods. Read-only event stream, everything stays on your machine.',
			zh: 'DeepSeek Harness 的陪伴小鲸鱼：任务通知 / 用量三行报告 / 历史搜索与一键跳转 / 定时提醒 / 周报 / 睡眠与班味情绪——只读事件流，数据全在本机。'
		},
		icon: '../whale-logo.svg',
		author: 'LengMu-Cloud',
		homepage: REPO_URL + '#readme',
		repository: { url: REPO_URL, directory: 'whale-assistant' },
		metadata: { category: 'companion', keywords: ['whale', 'companion', 'notification', 'usage', 'report', 'jump', 'reminder'] },
		versions: []
	};
	idx.plugins.push(plugin);
}

if (!plugin.versions.some((v) => v.version === version)) {
	plugin.versions.push({
		version: version,
		publishTimestamp: ts,
		source: { type: 'git', url: REPO_URL, commit: sha, path: 'whale-assistant' },
		engines: (tagPkg.dsh && tagPkg.dsh.engines) || { dsh: '>=0.1.7' }
	});
	console.log('version appended:', version);
} else {
	console.log('version already present:', version, '(updating source commit if tag moved)');
	const hit = plugin.versions.find((v) => v.version === version);
	hit.publishTimestamp = ts;
	hit.source = { type: 'git', url: REPO_URL, commit: sha, path: 'whale-assistant' };
	hit.engines = (tagPkg.dsh && tagPkg.dsh.engines) || { dsh: '>=0.1.7' };
}

/* --- 3. self-check against format-1 rules --- */
if (idx.format !== 1) fail('$.format must be 1');
checkLocalized(idx.title, '$.title');
if (!Array.isArray(idx.plugins) || idx.plugins.length === 0) fail('$.plugins must be a non-empty array');
const names = new Set();
for (const p of idx.plugins) {
	if (!PACKAGE_NAME.test(p.name) || p.name.length > 214) fail(p.name + ' is not a valid npm package name');
	if (names.has(p.name)) fail('duplicate plugin name ' + p.name);
	names.add(p.name);
	checkLocalized(p.title, p.name + '.title');
	checkLocalized(p.description, p.name + '.description');
	if (p.repository) checkCanonicalRepoUrl(p.repository.url, p.name + '.repository.url');
	if (!Array.isArray(p.versions) || p.versions.length === 0) fail(p.name + '.versions must be non-empty');
	const seen = new Set();
	for (const v of p.versions) {
		if (seen.has(v.version)) fail(p.name + ' duplicate version ' + v.version);
		seen.add(v.version);
		checkVersion(v, p.name + '@' + v.version);
	}
	if (p.icon && !String(p.icon).startsWith('data:')) {
		let resolved;
		try { resolved = new URL(String(p.icon), INDEX_URL_BASE); } catch (e) { fail(p.name + '.icon is not a URL reference'); }
		if (resolved.protocol !== 'https:') fail(p.name + '.icon must resolve to https');
	}
}
for (const p of idx.plugins) p.versions.sort((a, b) => rcompare(a.version, b.version));

/* --- 4. write back --- */
fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2) + '\n');
console.log('index written:', path.relative(ROOT, INDEX), '| plugins:', idx.plugins.length, '| whale versions:', plugin.versions.length);
