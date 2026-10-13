// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// The one pipeline both outputs share. Given every page already rendered to an HTML tree, it:
//   1. gives headings their document-wide (GitHub-style) anchors, so a section keeps its anchors when split;
//   2. finds where each ID is defined, across all pages and documents, and anchors it at the lower-cased ID;
//   3. links every other mention to its definition, and rewrites relative links between documents.
// The Starlight loader and the `specsite html` command differ only in how Markdown becomes the tree.

import type { Root, Element } from 'hast';
import { DEFAULT_RULES, type CheckMode, type DefinitionRule } from './options.js';
import {
	anchorOf, collectIds, findCandidates, linkMentions, markDefinition, walk, type IdMatcher,
} from './ids.js';
import { isExternal, repoFileUrl, resolveRelative, splitHref, type RepoInfo } from './links.js';
import { lineAt, type DocInfo, type PageSpec } from './source.js';

export interface RenderedPage {
	spec: PageSpec;
	tree: Root;
	/** Heading metadata to keep in step with the tree (Starlight's table of contents). */
	headings?: { depth: number; slug: string; text: string }[];
}

export interface Definition {
	id: string;
	page: PageSpec;
	/** `''` for an ID defined by the page's title heading. */
	anchor: string;
	rule: DefinitionRule | 'title';
	/** The element that holds it (identity only). */
	el?: unknown;
}

export interface Problem {
	kind: 'unknown-id' | 'duplicate-definition' | 'broken-anchor' | 'link-outside-root' | 'no-repo-url';
	message: string;
	/** `file:line` locations. */
	at: string[];
}

export interface EngineOptions {
	ids: IdMatcher;
	rules?: DefinitionRule[];
	linkText?: boolean;
	repo: RepoInfo;
	/** URL of a page, e.g. `/docs/spec/3-architecture/`; `''` means "this file" (a stand-alone snapshot). */
	pageUrl: (page: PageSpec) => string;
	/** Pages that are rendered only for their definitions and anchors (not rewritten). */
	readOnly?: (page: PageSpec) => boolean;
}

export interface EngineResult {
	index: Map<string, Definition>;
	problems: Problem[];
	linked: number;
}

/** Definition rules that conflict with each other (all but `list`). */
const isStrictRule = (r: Definition['rule']) => r !== 'list';

/** Rules that share a source shape, for counting the n-th match on a page. */
const shapeOf = (r: Definition['rule']) => (r === 'title' ? 'heading' : r);

/** Lines in a page's source range where `id` appears. */
function linesOf(page: PageSpec, id: string): number[] {
	const { text } = page.doc;
	const re = new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');
	re.lastIndex = page.range[0];
	const lines = new Set<number>();
	for (let m = re.exec(text); m && m.index < page.range[1]; m = re.exec(text)) lines.add(lineAt(text, m.index));
	return [...lines];
}

function locate(page: PageSpec, id: string, first = false): string[] {
	const lines = linesOf(page, id);
	if (!lines.length) return [page.doc.file];
	return (first ? lines.slice(0, 1) : lines).map((l) => `${page.doc.file}:${l}`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The line of a definition: the first line in the page where the ID appears in the shape its rule matched. */
function locateDefinition(def: Definition, nth = 0): string {
	const { page, id, rule } = def;
	const lines = page.doc.text.split('\n');
	const from = lineAt(page.doc.text, page.range[0]) - 1;
	const to = lineAt(page.doc.text, page.range[1]);
	const code = '`' + escapeRe(id) + '`';
	const shape: Record<string, RegExp> = {
		bold: new RegExp(`\\*\\*${code}\\*\\*`),
		table: new RegExp(`^\\s*\\|\\s*(?:\\*\\*)?${code}`),
		heading: new RegExp(`^\\s{0,3}#{1,6}\\s+[*_\`]*${escapeRe(id)}`),
		title: new RegExp(`^\\s{0,3}#{1,6}\\s+[*_\`]*${escapeRe(id)}`),
		list: new RegExp(`^\\s*(?:[-*+]|\\d+[.)])\\s+(?:\\[.\\]\\s+)?${code}`),
	};
	for (let i = from; i < to && i < lines.length; i++) {
		if (shape[rule]!.test(lines[i]!) && nth-- === 0) return `${page.doc.file}:${i + 1}`;
	}
	return locate(page, id, true)[0]!;
}

/** Step 1: rename rendered heading ids to the document-wide anchors computed from the source. */
export function remapHeadings(page: RenderedPage): boolean {
	const els: Element[] = [];
	walk(page.tree, (n) => {
		if (n.type === 'element' && /^h[1-6]$/.test(n.tagName) && typeof n.properties?.id === 'string') els.push(n);
	});
	const want = page.spec.headingSlugs;
	if (els.length !== want.length) return false;
	const map = new Map<string, string>();
	els.forEach((el, i) => {
		const from = el.properties.id as string;
		if (from !== want[i]) map.set(from, want[i]!);
		el.properties.id = want[i]!;
	});
	if (!map.size) return true;
	walk(page.tree, (n) => {
		if (n.type !== 'element' || n.tagName !== 'a' || typeof n.properties?.href !== 'string') return;
		const h = n.properties.href;
		if (h.startsWith('#') && map.has(h.slice(1))) n.properties.href = '#' + map.get(h.slice(1));
	});
	if (page.headings) {
		let i = 0;
		for (const h of page.headings) {
			const to = map.get(h.slug);
			if (to) h.slug = to;
			else if (want[i] && h.slug === want[i]) {
				// unchanged
			}
			i++;
		}
	}
	return true;
}

export function processPages(pages: RenderedPage[], opts: EngineOptions): EngineResult {
	const rules = opts.rules ?? DEFAULT_RULES;
	const problems: Problem[] = [];
	const index = new Map<string, Definition>();
	const duplicates = new Map<string, Definition[]>();
	const docs = new Map<string, DocInfo>();
	for (const p of pages) docs.set(p.spec.doc.file, p.spec.doc);

	for (const p of pages) remapHeadings(p);
	const taken = new Map<RenderedPage, Set<string>>(pages.map((p) => [p, collectIds(p.tree)]));

	const define = (def: Definition) => {
		const prev = index.get(def.id);
		if (!prev) {
			index.set(def.id, def);
			return true;
		}
		// Bold, table, heading and title definitions are one strict kind: a second one, by any of them, is a
		// duplicate. Only a list item is lenient: one that opens with an ID defined elsewhere (a traceability
		// list) is a reference. Two list items are still a duplicate.
		const conflict = prev.rule === def.rule || (isStrictRule(prev.rule) && isStrictRule(def.rule));
		if (conflict && (prev.page !== def.page || prev.el !== def.el)) {
			const list = duplicates.get(def.id) ?? [prev];
			list.push(def);
			duplicates.set(def.id, list);
		}
		return false;
	};

	// Step 2. IDs defined by a split page's title heading anchor at the top of that page.
	for (const p of pages) {
		for (const id of p.spec.titleIds) {
			if (!p.spec.doc.defines(id)) continue;
			if (define({ id, page: p.spec, anchor: anchorOf(id), rule: 'title' })) {
				const ids = taken.get(p)!;
				if (!ids.has(anchorOf(id))) {
					ids.add(anchorOf(id));
					p.tree.children.unshift({
						type: 'element',
						tagName: 'span',
						properties: { id: anchorOf(id), className: ['specsite-def', 'specsite-title-def'], dataSpecsiteId: id, dataPagefindWeight: '10' },
						children: [],
					});
				}
			}
		}
	}
	// Then each rule in priority order, across every page in order: the first definition of an ID wins.
	for (const rule of rules) {
		for (const p of pages) {
			for (const c of findCandidates(p.tree, rule, opts.ids)) {
				if (!p.spec.doc.defines(c.id)) continue;
				if (define({ id: c.id, page: p.spec, anchor: anchorOf(c.id), rule, el: c.code ?? c.heading })) markDefinition(c, taken.get(p)!);
			}
		}
	}
	for (const [id, defs] of duplicates) {
		problems.push({
			kind: 'duplicate-definition',
			message: `${id} is defined ${defs.length} times; the first wins`,
			at: defs.map((d, i) => locateDefinition(d, defs.slice(0, i).filter((e) => e.page === d.page && shapeOf(e.rule) === shapeOf(d.rule)).length)),
		});
	}

	const hrefFor = (from: PageSpec, def: Definition): string => {
		if (def.page === from || opts.pageUrl(def.page) === opts.pageUrl(from)) return '#' + def.anchor;
		return opts.pageUrl(def.page) + (def.anchor ? '#' + def.anchor : '');
	};
	const pagesOf = new Map<DocInfo, RenderedPage[]>();
	for (const p of pages) pagesOf.set(p.spec.doc, [...(pagesOf.get(p.spec.doc) ?? []), p]);
	/** The href of `doc#fragment` seen from `from`; a fragment with no anchor in `doc` is reported. */
	const anchorHref = (from: PageSpec, doc: DocInfo, fragment: string, href: string): string => {
		let key = fragment;
		try {
			key = decodeURIComponent(fragment);
		} catch {
			// a malformed escape: look it up as written
		}
		const target = doc.anchors.get(key) ?? doc.anchors.get(fragment);
		const byId = [...index.values()].find((d) => d.anchor === key.toLowerCase() && d.page.doc === doc);
		if (byId && !target) return hrefFor(from, byId);
		// Any other element id on one of the document's pages (raw HTML anchors, footnotes).
		const holder = target ? undefined : (pagesOf.get(doc) ?? []).find((p) => taken.get(p)?.has(key) || taken.get(p)?.has(fragment));
		if (!target && !holder) {
			problems.push({
				kind: 'broken-anchor',
				message: `link "${href}" points to #${fragment}, which is not an anchor in ${doc.file}; it links to the document instead`,
				at: locate(from, href, true),
			});
		}
		const page = target ?? holder?.spec ?? doc.pages[0]!;
		const frag = target && (page.titleSlug === key || page.titleSlug === fragment) ? '' : fragment;
		if (page === from || opts.pageUrl(page) === opts.pageUrl(from)) return frag ? '#' + frag : '#';
		return opts.pageUrl(page) + (frag ? '#' + frag : '');
	};

	// Step 3. Mentions and links.
	let linked = 0;
	const unknown = new Map<string, Set<PageSpec>>();
	let warnedNoRepo = false;
	for (const p of pages) {
		if (opts.readOnly?.(p.spec)) continue;
		linked += linkMentions(
			p.tree,
			opts.ids,
			(id) => {
				const def = index.get(id);
				return def ? hrefFor(p.spec, def) : undefined;
			},
			{
				linkText: opts.linkText ?? true,
				unknown: (id) => {
					const s = unknown.get(id) ?? new Set();
					s.add(p.spec);
					unknown.set(id, s);
				},
			},
		);
		walk(p.tree, (n) => {
			if (n.type !== 'element') return;
			const attr = n.tagName === 'a' ? 'href' : n.tagName === 'img' ? 'src' : undefined;
			if (!attr) return;
			const href = n.properties?.[attr];
			if (typeof href !== 'string' || !href || isExternal(href)) return;
			if (n.properties?.dataSpecsiteRef) return;
			const { path, query, fragment } = splitHref(href);
			if (!path) {
				if (attr === 'href' && fragment) n.properties.href = anchorHref(p.spec, p.spec.doc, fragment, href);
				return;
			}
			const rel = resolveRelative(p.spec.doc.file, path);
			if (rel === undefined && opts.repo.url) {
				// Outside root but maybe still inside the repository: link to it on the repository host.
				const inRepo = resolveRelative(opts.repo.prefix + p.spec.doc.file, path);
				if (inRepo !== undefined) {
					n.properties[attr] = repoFileUrl({ ...opts.repo, prefix: '' }, inRepo, attr === 'src' ? 'raw' : 'blob')! + query + (fragment ? '#' + fragment : '');
					return;
				}
			}
			if (rel === undefined) {
				problems.push({
					kind: 'link-outside-root',
					message: `link "${href}" leaves the repository (or root, without a repoUrl) and was left as written`,
					at: locate(p.spec, path, true),
				});
				return;
			}
			const doc = attr === 'href' ? docs.get(rel) : undefined;
			if (doc) {
				n.properties.href = fragment ? anchorHref(p.spec, doc, fragment, href) : opts.pageUrl(doc.pages[0]!) || '#';
				return;
			}
			// A file that is not published: a link to it on the repository host, fragment and all, unchecked.
			const url = repoFileUrl(opts.repo, rel, attr === 'src' ? 'raw' : 'blob');
			if (!url) {
				if (!warnedNoRepo) {
					warnedNoRepo = true;
					problems.push({
						kind: 'no-repo-url',
						message: `links to unpublished files (e.g. "${href}") are left as written: set repoUrl`,
						at: [p.spec.doc.file],
					});
				}
				return;
			}
			n.properties[attr] = url + query + (fragment ? '#' + fragment : '');
		});
	}
	for (const [id, where] of unknown) {
		problems.push({
			kind: 'unknown-id',
			message: `${id} is referenced but not defined in any published document`,
			at: [...where].flatMap((pg) => locate(pg, id)),
		});
	}
	return { index, problems, linked };
}

/** Problems that fail the build under `check: 'error'`. */
export function isStrictProblem(p: Problem): boolean {
	return p.kind === 'unknown-id' || p.kind === 'duplicate-definition' || p.kind === 'broken-anchor';
}

export function formatProblems(problems: Problem[]): string {
	return problems.map((p) => `  - ${p.message}${p.at.length ? ` (${p.at.join(', ')})` : ''}`).join('\n');
}

/** Report problems through `warn`, and throw under `check: 'error'` when any is strict. */
export function report(problems: Problem[], check: CheckMode, warn: (msg: string) => void): void {
	if (!problems.length) return;
	const strict = problems.filter(isStrictProblem);
	if (check === 'error' && strict.length) {
		throw new Error(`specsite: ${strict.length} identifier problem(s):\n${formatProblems(strict)}`);
	}
	for (const p of problems) warn(`${p.message}${p.at.length ? ` (${p.at.join(', ')})` : ''}`);
}
