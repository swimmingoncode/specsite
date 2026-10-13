// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// `specsite html`: one document as one self-contained HTML page (contents rail, light and dark, inline CSS),
// through the same identifier and link pipeline as the site. Ported from a pandoc-based md2artifact.py so
// that there is one implementation.

import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import GithubSlugger from 'github-slugger';
import { toHtml } from 'hast-util-to-html';
import { toString as hastToString } from 'hast-util-to-string';
import type { Root, Element, ElementContent } from 'hast';
import { createIdMatcher, walk } from '../core/ids.js';
import { DEFAULT_RULES, definesFilter, type CheckMode, type IdOptions } from '../core/options.js';
import { parseDocument, type DocInfo, type PageSpec } from '../core/source.js';
import { processPages, report, type Problem, type RenderedPage } from '../core/engine.js';
import { detectRepoUrl, repoPrefix, repoTop } from '../core/git.js';
import { basisBlock, basisRows, buildInfo } from '../core/basis.js';
import { snapshotSchema } from '../core/sanitize.js';
import { pageTemplate } from './template.js';

export interface SnapshotOptions {
	/** The Markdown file to render. */
	file: string;
	/** Directory relative links may reach (default: the file's git repository, else its directory). */
	root?: string;
	title?: string;
	summary?: string;
	/** SVG markup of a brand mark for the header (light theme), and optionally its dark-theme variant. */
	brand?: string;
	brandDark?: string;
	/** Accessible name of the brand mark. */
	brandLabel?: string;
	/** Accent colour (`#rrggbb`), replacing the default theme's. */
	accent?: string;
	/** Other documents whose IDs and anchors this one links to, at the URL where each is published. */
	with?: { file: string; url: string }[];
	repoUrl?: string | false;
	branch?: string;
	ids?: IdOptions;
	check?: CheckMode;
	/** Load the default theme's faces from Google Fonts (the only external request). Default `true`. */
	googleFonts?: boolean;
	/** Heading depth of the contents rail: 2 (default) or 3. */
	tocDepth?: 2 | 3;
	warn?: (message: string) => void;
	/**
	 * Sanitise the document's HTML (no scripts, event handlers, `style` or `javascript:` URLs). Turn it on for
	 * documents you did not write. Default `false` (see SECURITY.md).
	 */
	sanitize?: boolean;
	/** The render time shown in the basis block. Default: now. */
	renderedAt?: Date;
}

export interface SnapshotResult {
	html: string;
	problems: Problem[];
	identifiers: number;
	links: number;
}

async function renderTree(markdown: string, sanitize: boolean): Promise<Root> {
	const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
	if (sanitize) processor.use(rehypeSanitize, snapshotSchema);
	const tree = (await processor.run(processor.parse(markdown))) as Root;
	const slugger = new GithubSlugger();
	walk(tree, (n) => {
		if (n.type === 'element' && /^h[1-6]$/.test(n.tagName)) n.properties.id = slugger.slug(hastToString(n));
	});
	return tree;
}

function toc(tree: Root, depth: number): string {
	const items: { level: number; id: string; text: string }[] = [];
	walk(tree, (n) => {
		if (n.type !== 'element') return;
		const m = /^h([2-6])$/.exec(n.tagName);
		if (m && Number(m[1]) <= depth && typeof n.properties.id === 'string')
			items.push({ level: Number(m[1]), id: n.properties.id, text: hastToString(n) });
		return m ? 'skip' : undefined;
	});
	if (!items.length) return '';
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
	let out = '<ul>';
	let level = items[0]!.level;
	let open = false;
	for (const it of items) {
		if (it.level > level) {
			out += '<ul>';
			level = it.level;
		} else {
			if (open) out += '</li>';
			while (it.level < level) {
				out += '</ul></li>';
				level--;
			}
		}
		out += `<li><a href="#${esc(it.id)}">${esc(it.text)}</a>`;
		open = true;
	}
	out += '</li>';
	while (level > items[0]!.level) {
		out += '</ul></li>';
		level--;
	}
	return out + '</ul>';
}

/** Wrap tables so they scroll sideways on narrow screens. */
function wrapTables(tree: Root): void {
	walk(tree, (n, anc) => {
		if (n.type !== 'element' || n.tagName !== 'table') return;
		const parent = anc[anc.length - 1]!;
		const i = parent.children.indexOf(n);
		const wrap: Element = { type: 'element', tagName: 'div', properties: { className: ['scroll'] }, children: [n] };
		(parent.children as ElementContent[])[i] = wrap;
		return 'skip';
	});
}

export async function renderSnapshot(o: SnapshotOptions): Promise<SnapshotResult> {
	const abs = resolve(o.file);
	// Relative links resolve inside the repository that holds the file (or its directory, outside git).
	const root = o.root ? resolve(o.root) : (repoTop(dirname(abs)) ?? dirname(abs));
	const ids = createIdMatcher(o.ids);
	const parse = (file: string, slug: string, defines = true): DocInfo => {
		const a = resolve(file);
		return parseDocument(readFileSync(a, 'utf8'), {
			file: relative(root, a).split(sep).join('/'),
			absPath: a,
			slug,
			title: a === abs ? o.title : undefined,
			defines: defines ? definesFilter(true) : definesFilter(false),
			ids,
		});
	};
	const main = parse(abs, '');
	const others = (o.with ?? []).map((w, i) => ({ doc: parse(w.file, `with-${i}`), url: w.url }));

	const pages: RenderedPage[] = [];
	const clean = o.sanitize ?? false;
	for (const spec of main.pages) pages.push({ spec, tree: await renderTree(spec.markdown, clean) });
	for (const { doc } of others) for (const spec of doc.pages) pages.push({ spec, tree: await renderTree(spec.markdown, clean) });

	const urlOf = new Map<DocInfo, string>(others.map((x) => [x.doc, x.url]));
	const repoUrl = o.repoUrl === false ? undefined : (o.repoUrl ?? detectRepoUrl(root));
	const repo = { url: repoUrl?.replace(/\/$/, ''), branch: o.branch ?? 'main', prefix: repoPrefix(root) };
	const result = processPages(pages, {
		ids,
		rules: o.ids?.definitions && o.ids.definitions !== 'auto' ? o.ids.definitions : DEFAULT_RULES,
		linkText: o.ids?.linkText ?? true,
		repo,
		pageUrl: (p: PageSpec) => urlOf.get(p.doc) ?? '',
		readOnly: (p: PageSpec) => p.doc !== main,
	});
	report(result.problems, o.check ?? 'warn', o.warn ?? ((m) => console.warn(`specsite: ${m}`)));

	const tree = pages[0]!.tree;
	wrapTables(tree);
	const fm = main.frontmatter;
	const build = buildInfo(root, repo, o.renderedAt);
	const basis = toHtml(basisBlock(basisRows(main, build), ['meta', 'specsite-basis']));

	const html = pageTemplate({
		title: main.title,
		kicker: basename(abs),
		summary: o.summary ?? (typeof fm.summary === 'string' ? fm.summary : typeof fm.description === 'string' ? fm.description : undefined),
		basis,
		toc: toc(tree, o.tocDepth ?? 2),
		body: toHtml(tree),
		brand: o.brand,
		brandDark: o.brandDark,
		brandLabel: o.brandLabel,
		accent: o.accent,
		googleFonts: o.googleFonts ?? true,
	});
	return { html, problems: result.problems, identifiers: result.index.size, links: result.linked };
}
