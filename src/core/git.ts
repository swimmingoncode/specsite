// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado

import { execFileSync } from 'node:child_process';
import { dirname, relative, sep } from 'node:path';
import { remoteToHttps } from './links.js';

function git(cwd: string, args: string[]): string {
	try {
		return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

export interface CommitInfo {
	/** Abbreviated hash of the last commit that touched the file. */
	short: string;
	/** Full hash, for permalinks. */
	hash: string;
	date?: Date;
	/** The working tree differs from that commit. */
	dirty: boolean;
}

/** The last commit that touched `absPath`, or undefined outside a repository / for an untracked file. */
export function lastCommit(absPath: string): CommitInfo | undefined {
	const out = git(dirname(absPath), ['log', '-1', '--format=%H%x09%h%x09%cI', '--', absPath]);
	if (!out) return undefined;
	const [hash, short, iso] = out.split('\t');
	const dirty = !!git(dirname(absPath), ['status', '--porcelain', '--', absPath]);
	return { hash: hash!, short: short!, date: iso ? new Date(iso) : undefined, dirty };
}

/** Top-level directory of the repository holding `dir`. */
export function repoTop(dir: string): string | undefined {
	return git(dir, ['rev-parse', '--show-toplevel']) || undefined;
}

/** Path of `dir` inside its repository, as a prefix (`''` at the top level, else ending in `/`). */
export function repoPrefix(dir: string): string {
	const top = git(dir, ['rev-parse', '--show-toplevel']);
	if (!top) return '';
	const rel = relative(top, dir).split(sep).join('/');
	return rel ? rel + '/' : '';
}

/** `https://github.com/owner/repo` from the `origin` remote, when it is on github.com. */
export function detectRepoUrl(dir: string): string | undefined {
	const url = remoteToHttps(git(dir, ['remote', 'get-url', 'origin']));
	return url && /^https:\/\/github\.com\//.test(url) ? url : undefined;
}
