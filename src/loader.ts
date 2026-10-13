// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// A content-layer loader for Starlight's `docs` collection. It runs the loader it wraps (normally
// Starlight's `docsLoader()`), then adds one entry per page of the configured documents. Each page's Markdown
// goes through the site's own Markdown processor (`renderMarkdown`, so Starlight's heading anchors, asides and
// Expressive Code apply as on any other page), and the resulting HTML through specsite's shared pipeline.
// The entries live only in Astro's data store: nothing is written to src/content/docs.

import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import type { Element, Root } from 'hast';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import { processPages, report, type RenderedPage } from './core/engine.js';
import { loadDocuments, type ResolvedOptions } from './core/project.js';
import { lastCommit, type CommitInfo } from './core/git.js';
import { repoFileUrl } from './core/links.js';
import type { DocInfo, PageSpec } from './core/source.js';
import { getShared } from './state.js';

// Structural types for the pieces of Astro's loader API used here, so this module has no runtime
// dependency on Astro.
interface RenderedContent {
	html: string;
	metadata?: {
		headings?: { depth: number; slug: string; text: string }[];
		imagePaths?: string[];
		frontmatter?: Record<string, unknown>;
		[k: string]: unknown;
	};
}
interface LoaderContextLike {
	collection: string;
	store: {
		set(entry: Record<string, unknown>): boolean;
		delete(id: string): void;
		has(id: string): boolean;
		keys(): string[];
	};
	meta: { get(k: string): string | undefined; set(k: string, v: string): void };
	logger: { warn(m: string): void; info(m: string): void };
	config: {
		root: URL;
		srcDir: URL;
		base: string;
		trailingSlash: 'always' | 'never' | 'ignore';
		build: { format: 'file' | 'directory' | 'preserve' };
	};
	parseData(p: { id: string; data: Record<string, unknown>; filePath?: string }): Promise<Record<string, unknown>>;
	renderMarkdown(content: string, options?: { fileURL?: URL }): Promise<RenderedContent>;
	generateDigest(data: Record<string, unknown> | string): string;
	watcher?: { add(p: string | string[]): void; on(e: string, cb: (p: string) => void): void };
}
interface LoaderLike {
	name: string;
	load: (ctx: never) => Promise<void>;
}

const META_KEY = 'specsite-entries';

/** URL of a page on the site, following Astro's `base`, `trailingSlash` and `build.format`. */
export function sitePageUrl(config: LoaderContextLike['config'], id: string): string {
	const base = config.base.endsWith('/') ? config.base : config.base + '/';
	if (config.build.format === 'file') return base + id + '.html';
	return base + id + (config.trailingSlash === 'never' ? '' : '/');
}

function sourceLine(doc: DocInfo, commit: CommitInfo | undefined, r: ResolvedOptions): Element {
	const name = doc.file;
	const fileHref = commit && r.repo.url ? repoFileUrl({ ...r.repo, branch: commit.hash }, doc.file) : repoFileUrl(r.repo, doc.file);
	const children: Element['children'] = [{ type: 'text', value: 'Source: ' }];
	children.push(
		fileHref
			? { type: 'element', tagName: 'a', properties: { href: fileHref }, children: [{ type: 'text', value: name }] }
			: { type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: name }] },
	);
	if (commit) {
		children.push({ type: 'text', value: ' @ ' });
		children.push({ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: commit.short }] });
		if (commit.dirty) children.push({ type: 'text', value: ' + local changes' });
	}
	return { type: 'element', tagName: 'p', properties: { className: ['specsite-source'] }, children };
}

async function loadSpecs(ctx: LoaderContextLike, r: ResolvedOptions): Promise<string[]> {
	const started = performance.now();
	const docsDir = fileURLToPath(new URL('content/docs/', ctx.config.srcDir));
	const docsDirRel = relative(fileURLToPath(ctx.config.root), docsDir).split(sep).join('/');
	const docs = loadDocuments(r, (file, url) => {
		const rel = relative(r.root, resolve(r.root, file, '..', decodeURI(url))).split(sep).join('/');
		return rel.startsWith('..') ? undefined : repoFileUrl(r.repo, rel, 'raw');
	});
	const pages = docs.flatMap((d) => d.pages);

	const previous = new Set<string>(JSON.parse(ctx.meta.get(META_KEY) ?? '[]'));
	for (const p of pages) {
		if (ctx.store.has(p.id) && !previous.has(p.id))
			throw new Error(`specsite: page "${p.id}" collides with an existing docs entry (src/content/docs/${p.id}.md?)`);
	}

	const rendered: (RenderedPage & { filePath: string })[] = [];
	for (const spec of pages) {
		const filePath = `${docsDirRel}/${spec.id}${spec.order === 0 && spec.doc.pages.length > 1 ? '/index' : ''}.md`;
		const out = await ctx.renderMarkdown(spec.markdown, { fileURL: pathToFileURL(resolve(fileURLToPath(ctx.config.root), filePath)) });
		const tree = fromHtml(out.html, { fragment: true }) as Root;
		rendered.push({
			spec,
			tree,
			headings: (out.metadata?.headings ?? []).map((h) => ({ ...h })),
			filePath,
		});
	}

	const result = processPages(rendered, {
		ids: r.ids,
		rules: r.rules,
		linkText: r.linkText,
		repo: r.repo,
		pageUrl: (p: PageSpec) => sitePageUrl(ctx.config, p.id),
	});
	report(result.problems, r.check, (m) => ctx.logger.warn(m));

	const commits = new Map<DocInfo, CommitInfo | undefined>(docs.map((d) => [d, lastCommit(d.absPath)]));
	const written: string[] = [];
	for (const page of rendered) {
		const { spec } = page;
		const commit = commits.get(spec.doc);
		if (r.sourceLine) page.tree.children.unshift(sourceLine(spec.doc, commit, r));
		const html = toHtml(page.tree);
		const editUrl = r.repo.url ? `${r.repo.url}/edit/${encodeURIComponent(r.repo.branch)}/${r.repo.prefix}${spec.doc.file}` : false;
		const data = await ctx.parseData({
			id: spec.id,
			data: {
				title: spec.title,
				editUrl,
				lastUpdated: commit?.date ?? false,
				sidebar: { order: spec.order },
			},
		});
		ctx.store.set({
			id: spec.id,
			data,
			filePath: page.filePath,
			digest: ctx.generateDigest(spec.markdown + html),
			rendered: {
				html,
				metadata: { headings: page.headings ?? [], imagePaths: [], frontmatter: {} },
			},
		});
		written.push(spec.id);
	}
	for (const id of previous) if (!written.includes(id) && ctx.store.has(id)) ctx.store.delete(id);
	ctx.meta.set(META_KEY, JSON.stringify(written));
	const ms = Math.round(performance.now() - started);
	ctx.logger.info(
		`specsite: ${written.length} pages from ${docs.length} documents, ${result.index.size} identifiers, ${result.linked} links (${ms} ms)`,
	);
	return docs.map((d) => d.absPath);
}

/**
 * Wrap the `docs` collection's loader so the configured documents are added to it:
 *
 * ```ts
 * // src/content.config.ts
 * import { docsLoader } from '@astrojs/starlight/loaders';
 * import { specsiteLoader } from 'specsite/loader';
 * export const collections = { docs: defineCollection({ loader: specsiteLoader(docsLoader()), schema: docsSchema() }) };
 * ```
 */
export function specsiteLoader<L extends LoaderLike>(inner?: L): L {
	return {
		...(inner ?? {}),
		name: 'specsite-loader',
		load: async (ctx: LoaderContextLike) => {
			if (inner) await inner.load(ctx as never);
			const r = getShared();
			if (!r) {
				throw new Error(
					'specsite: the loader found no configuration. Add `specsite({...})` to the `plugins` of Starlight in astro.config.',
				);
			}
			const files = await loadSpecs(ctx, r);
			if (ctx.watcher) {
				ctx.watcher.add(files);
				ctx.watcher.on('change', async (changed: string) => {
					if (!files.includes(resolve(changed))) return;
					try {
						await loadSpecs(ctx, r);
					} catch (e) {
						ctx.logger.warn(String(e instanceof Error ? e.message : e));
					}
				});
			}
		},
	} as unknown as L;
}
