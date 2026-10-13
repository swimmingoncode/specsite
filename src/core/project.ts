// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// Resolve the configured allowlist into parsed documents. Only listed files (and glob matches inside
// `root`) are ever read.

import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { globSync } from 'tinyglobby';
import { createIdMatcher, type IdMatcher } from './ids.js';
import {
	DEFAULT_RULES, definesFilter, isGlobDocument, validateSlug,
	type CheckMode, type DefinitionRule, type SidebarOptions, type SpecsiteOptions,
} from './options.js';
import { parseDocument, type DocInfo } from './source.js';
import { detectRepoUrl, repoPrefix } from './git.js';
import type { RepoInfo } from './links.js';

export interface ResolvedOptions {
	/** Absolute directory the document paths are relative to. */
	root: string;
	options: SpecsiteOptions;
	ids: IdMatcher;
	rules: DefinitionRule[];
	linkText: boolean;
	repo: RepoInfo;
	check: CheckMode;
	mermaid: boolean;
	sourceLine: boolean;
	sidebar: SidebarOptions | false;
}

export function resolveOptions(options: SpecsiteOptions, projectRoot: string): ResolvedOptions {
	if (!options || !Array.isArray(options.documents) || !options.documents.length)
		throw new Error('specsite: `documents` must list at least one document');
	const root = resolve(projectRoot, options.root ?? '.');
	const seen = new Set<string>();
	for (const d of options.documents) {
		validateSlug(d.slug);
		if (seen.has(d.slug)) throw new Error(`specsite: slug "${d.slug}" is used twice`);
		seen.add(d.slug);
		const p = isGlobDocument(d) ? d.glob : d.file;
		if (!p || p.split(/[\\/]/).includes('..')) throw new Error(`specsite: "${p}" must be a path inside root`);
	}
	const rules = !options.ids?.definitions || options.ids.definitions === 'auto' ? DEFAULT_RULES : options.ids.definitions;
	const url = options.repoUrl === false ? undefined : (options.repoUrl ?? detectRepoUrl(root));
	return {
		root,
		options,
		ids: createIdMatcher(options.ids),
		rules,
		linkText: options.ids?.linkText ?? true,
		repo: { url: url?.replace(/\/$/, ''), branch: options.branch ?? 'main', prefix: repoPrefix(root) },
		check: options.check ?? 'warn',
		mermaid: options.mermaid ?? true,
		sourceLine: options.sourceLine ?? true,
		sidebar: options.sidebar ?? {},
	};
}

const toPosix = (p: string) => p.split(sep).join('/');
const fileSlug = (file: string) =>
	file.replace(/^.*\//, '').replace(/\.mdx?$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** One entry per configured document; a glob expands to one document per matching file, sorted by path. */
export function loadDocuments(
	r: ResolvedOptions,
	imageUrl?: (doc: string, relativeToDoc: string) => string | undefined,
): DocInfo[] {
	const docs: DocInfo[] = [];
	for (const d of r.options.documents) {
		const files = isGlobDocument(d)
			? globSync(d.glob, { cwd: r.root, onlyFiles: true }).map(toPosix).sort()
			: [toPosix(d.file).replace(/^\.\//, '')];
		if (isGlobDocument(d) && !files.length) throw new Error(`specsite: glob "${d.glob}" matched no file in ${r.root}`);
		for (const file of files) {
			const absPath = resolve(r.root, file);
			if (relative(r.root, absPath).startsWith('..')) throw new Error(`specsite: "${file}" is outside root`);
			let text: string;
			try {
				text = readFileSync(absPath, 'utf8');
			} catch {
				throw new Error(`specsite: cannot read ${file} (resolved to ${absPath})`);
			}
			docs.push(
				parseDocument(text, {
					file,
					absPath,
					slug: isGlobDocument(d) ? `${d.slug}/${fileSlug(file)}` : d.slug,
					title: isGlobDocument(d) ? undefined : d.title,
					split: isGlobDocument(d) ? false : d.split,
					defines: definesFilter(d.defines),
					ids: r.ids,
					imageUrl: imageUrl ? (u) => imageUrl(file, u) : undefined,
				}),
			);
		}
	}
	return docs;
}
