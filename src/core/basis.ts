// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// The basis block (REQ-LD-2): what a published page was rendered from. The repository, the commit the build
// ran on, the document's version and status, and when it was rendered; then, as a secondary line, the
// commit that last changed the file. Both outputs render the same block from the same rows.

import { basename } from 'node:path';
import type { Element, ElementContent } from 'hast';
import { headCommit, lastCommit, repoTop, type CommitInfo } from './git.js';
import { repoFileUrl, type RepoInfo } from './links.js';
import type { DocInfo } from './source.js';

export interface BasisPart {
	text: string;
	href?: string;
	/** Show as code (a commit hash). */
	code?: boolean;
}

export interface BasisRow {
	key: 'repository' | 'commit' | 'version' | 'status' | 'rendered' | 'source';
	label: string;
	parts: BasisPart[];
}

/** What a build knows once, for every page it renders. */
export interface BuildInfo {
	repo: RepoInfo;
	/** The commit checked out when the build ran (`HEAD` of the docs repository). */
	head?: CommitInfo;
	/** `owner/name`, or the repository's directory name when there is no repository URL. */
	repoName?: string;
	renderedAt: Date;
}

/** `owner/name` from `https://host/owner/name`. */
export function repoNameOf(url: string | undefined): string | undefined {
	if (!url) return undefined;
	const m = /^[a-z]+:\/\/[^/]+\/(.+?)\/?$/i.exec(url);
	return m?.[1];
}

export function buildInfo(root: string, repo: RepoInfo, renderedAt = new Date()): BuildInfo {
	const top = repoTop(root);
	return {
		repo,
		head: headCommit(root),
		repoName: repoNameOf(repo.url) ?? (top ? basename(top) : undefined),
		renderedAt,
	};
}

/** ISO 8601, to the second, in UTC. */
export const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A front-matter value as one short line (`0.3 (draft); see …` → `0.3`). */
function fmValue(v: unknown): string | undefined {
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	if (typeof v === 'number') return String(v);
	if (typeof v === 'string' && v.trim()) return v.split(/; | \(/)[0]!.trim();
	return undefined;
}

/** The document's version: `spec_version`, else `version`, else any other `*_version` key. */
export function versionOf(fm: Record<string, unknown>): string | undefined {
	const key = ['spec_version', 'version'].find((k) => fmValue(fm[k])) ?? Object.keys(fm).find((k) => /_version$/.test(k) && fmValue(fm[k]));
	return key ? fmValue(fm[key]) : undefined;
}

const commitUrl = (repo: RepoInfo, hash: string) => (repo.url ? `${repo.url.replace(/\/$/, '')}/commit/${hash}` : undefined);

/** The rows of a document's basis block. Front-matter `date` is the author's, not the render time, and is not shown. */
export function basisRows(doc: DocInfo, build: BuildInfo, last: CommitInfo | undefined = lastCommit(doc.absPath)): BasisRow[] {
	const rows: BasisRow[] = [];
	const { repo, head } = build;
	if (build.repoName) rows.push({ key: 'repository', label: 'Repository', parts: [{ text: build.repoName, href: repo.url }] });
	if (head) {
		const parts: BasisPart[] = [{ text: head.short, href: commitUrl(repo, head.hash), code: true }];
		if (head.dirty) parts.push({ text: ' + local changes' });
		rows.push({ key: 'commit', label: 'Commit', parts });
	}
	const version = versionOf(doc.frontmatter);
	if (version) rows.push({ key: 'version', label: 'Version', parts: [{ text: version }] });
	const status = fmValue(doc.frontmatter.status);
	if (status) rows.push({ key: 'status', label: 'Status', parts: [{ text: status }] });
	rows.push({ key: 'rendered', label: 'Rendered', parts: [{ text: isoSeconds(build.renderedAt) }] });

	const fileHref = last && repo.url ? repoFileUrl({ ...repo, branch: last.hash }, doc.file) : repoFileUrl(repo, doc.file);
	const source: BasisPart[] = [{ text: doc.file, href: fileHref }];
	if (last) {
		source.push({ text: ', last changed in ' }, { text: last.short, href: commitUrl(repo, last.hash), code: true });
		if (last.dirty) source.push({ text: ' + local changes' });
	} else {
		source.push({ text: ', not committed' });
	}
	rows.push({ key: 'source', label: 'Source', parts: source });
	return rows;
}

const text = (value: string): ElementContent => ({ type: 'text', value });

function partNode(p: BasisPart): ElementContent {
	const inner: ElementContent = p.code
		? { type: 'element', tagName: 'code', properties: {}, children: [text(p.text)] }
		: text(p.text);
	return p.href ? { type: 'element', tagName: 'a', properties: { href: p.href }, children: [inner] } : inner;
}

/** The block as a `<dl>`: one `<div>` per row, with `data-specsite-basis` naming the field. */
export function basisBlock(rows: BasisRow[], className: string[]): Element {
	return {
		type: 'element',
		tagName: 'dl',
		properties: { className },
		children: rows.map((r) => ({
			type: 'element',
			tagName: 'div',
			properties: { dataSpecsiteBasis: r.key },
			children: [
				{ type: 'element', tagName: 'dt', properties: {}, children: [text(r.label)] },
				{ type: 'element', tagName: 'dd', properties: {}, children: r.parts.map(partNode) },
			],
		})),
	};
}
