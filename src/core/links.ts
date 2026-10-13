// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// Relative links between published documents become site URLs; links to any other repository file become
// links to the repository host. Absolute URLs, site-absolute paths and other schemes are left alone.

import { posix } from 'node:path';

export interface RepoInfo {
	/** e.g. `https://github.com/owner/repo`; undefined disables repository links. */
	url?: string;
	branch: string;
	/** Path of `root` inside the repository (`''` or ending in `/`). */
	prefix: string;
}

export interface SplitHref {
	path: string;
	query: string;
	fragment: string;
}

export function splitHref(href: string): SplitHref {
	const hash = href.indexOf('#');
	const beforeHash = hash >= 0 ? href.slice(0, hash) : href;
	const fragment = hash >= 0 ? href.slice(hash + 1) : '';
	const q = beforeHash.indexOf('?');
	return {
		path: q >= 0 ? beforeHash.slice(0, q) : beforeHash,
		query: q >= 0 ? beforeHash.slice(q) : '',
		fragment,
	};
}

/** A link that this tool should not rewrite: a scheme (`https:`, `mailto:`), protocol-relative, or site-absolute. */
export function isExternal(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/');
}

/**
 * Resolve a relative path written in `fromFile` (both relative to `root`) to a root-relative path.
 * Returns undefined when it leaves `root`.
 */
export function resolveRelative(fromFile: string, path: string): string | undefined {
	let decoded = path;
	try {
		decoded = decodeURI(path);
	} catch {
		// keep as written
	}
	const joined = posix.normalize(posix.join(posix.dirname(fromFile), decoded));
	if (joined === '..' || joined.startsWith('../') || posix.isAbsolute(joined)) return undefined;
	return joined.replace(/\/$/, '');
}

/** The repository URL of a file that is not published (blob view; hosts redirect directories to tree view). */
export function repoFileUrl(repo: RepoInfo, rootRelative: string, kind: 'blob' | 'raw' = 'blob'): string | undefined {
	if (!repo.url) return undefined;
	const path = (repo.prefix + rootRelative).split('/').map(encodeURIComponent).join('/');
	return `${repo.url.replace(/\/$/, '')}/${kind}/${encodeURIComponent(repo.branch)}/${path}`;
}

/** Normalise a git remote to an https URL, for GitHub-style hosts only. */
export function remoteToHttps(remote: string): string | undefined {
	const r = remote.trim();
	let m = /^git@([^:]+):(.+?)(?:\.git)?\/?$/.exec(r);
	if (m) return `https://${m[1]}/${m[2]}`;
	m = /^(?:ssh:\/\/git@|https?:\/\/(?:[^@/]+@)?)([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(r);
	if (m) return `https://${m[1]}/${m[2]}`;
	return undefined;
}
