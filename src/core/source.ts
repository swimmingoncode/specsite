// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// Reads one Markdown document and cuts it into pages. Everything here works on the source text by offset
// (from an mdast parse), so the Markdown each page renders is a verbatim slice of the original, never a
// re-serialisation.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';
import { load as loadYaml } from 'js-yaml';
import type { Root, Heading, Nodes, Code, Image, Definition } from 'mdast';
import { posix } from 'node:path';
import { SECTION_NUMBER, type IdMatcher } from './ids.js';

export interface DocInfo {
	/** Path relative to `root`, posix separators. */
	file: string;
	/** Absolute path on disk. */
	absPath: string;
	/** Base slug, e.g. `spec`. */
	slug: string;
	title: string;
	frontmatter: Record<string, unknown>;
	/** The whole file, for line lookups in reports. */
	text: string;
	defines: (id: string) => boolean;
	/** Global (GitHub-style) heading anchor → the page that holds it. */
	anchors: Map<string, PageSpec>;
	pages: PageSpec[];
}

export interface PageSpec {
	/** Site id/slug of the page, e.g. `spec/3-architecture`; `''` for a stand-alone snapshot. */
	id: string;
	doc: DocInfo;
	title: string;
	/** Order inside the document (0 = index or only page). */
	order: number;
	/** The Markdown this page renders. */
	markdown: string;
	/** Global anchors of the headings in `markdown`, in order; used to give rendered headings stable ids. */
	headingSlugs: string[];
	/** Global anchor of the heading this page was cut at (it became the page title). */
	titleSlug?: string;
	/** IDs that the title heading defines (they anchor at the top of the page). */
	titleIds: string[];
	/** Range of the page in `doc.text` (character offsets), for line reports. */
	range: [number, number];
}

export interface ParseOptions {
	file: string;
	absPath: string;
	slug: string;
	title?: string;
	split?: 'h2' | false;
	defines: (id: string) => boolean;
	ids: IdMatcher;
	/** Rewrites the URL of a relative image (site mode: images must not point at the virtual page path). */
	imageUrl?: (relativeToDoc: string) => string | undefined;
}

interface Edit {
	start: number;
	end: number;
	text: string;
}

export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string; offset: number } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return { data: {}, body: text, offset: 0 };
	let data: Record<string, unknown> = {};
	try {
		const parsed = loadYaml(m[1]!);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
	} catch {
		// Front matter that is not YAML is shown as nothing rather than failing the build.
	}
	return { data, body: text.slice(m[0].length), offset: m[0].length };
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isRelativeUrl(url: string): boolean {
	return !!url && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//') && !url.startsWith('/') && !url.startsWith('#');
}

function applyEdits(body: string, start: number, end: number, edits: Edit[]): string {
	let out = '';
	let at = start;
	for (const e of edits) {
		if (e.start < start || e.end > end) continue;
		out += body.slice(at, e.start) + e.text;
		at = e.end;
	}
	return out + body.slice(at, end);
}

/** Parse a document and cut it into pages. */
export function parseDocument(text: string, opts: ParseOptions): DocInfo {
	const { data: frontmatter, body, offset } = splitFrontmatter(text);
	const tree = fromMarkdown(body) as Root;

	const headings: { node: Heading; slug: string }[] = [];
	const edits: Edit[] = [];
	const definitions: string[] = [];
	const slugger = new GithubSlugger();

	const walk = (node: Nodes) => {
		if (node.type === 'heading') headings.push({ node, slug: slugger.slug(toString(node)) });
		if (node.type === 'code' && (node as Code).lang === 'mermaid' && node.position) {
			// A raw HTML block: Markdown renderers pass it through, so the diagram source reaches the browser intact.
			edits.push({
				start: node.position.start.offset!,
				end: node.position.end.offset!,
				text: `<pre class="mermaid">${escapeHtml((node as Code).value)}</pre>`,
			});
		}
		if (node.type === 'image' && opts.imageUrl && node.position && isRelativeUrl((node as Image).url)) {
			const img = node as Image;
			const to = opts.imageUrl(img.url);
			const s = node.position.start.offset!;
			const src = body.slice(s, node.position.end.offset!);
			const at = src.indexOf('](' + img.url);
			if (to && at >= 0) edits.push({ start: s + at + 2, end: s + at + 2 + img.url.length, text: to });
		}
		if (node.type === 'definition' && node.position) {
			definitions.push(body.slice(node.position.start.offset!, node.position.end.offset!));
		}
		if ('children' in node) for (const c of node.children as Nodes[]) walk(c);
	};
	walk(tree);

	// A leading H1 is the document's title, not part of its body.
	const first = tree.children[0];
	const h1 = first?.type === 'heading' && first.depth === 1 ? first : undefined;
	const bodyStart = h1 ? h1.position!.end.offset! : 0;
	const title =
		opts.title ??
		(typeof frontmatter.title === 'string' ? frontmatter.title : undefined) ??
		(h1 ? toString(h1) : undefined) ??
		posix.basename(opts.file).replace(/\.mdx?$/i, '');

	const doc: DocInfo = {
		file: opts.file,
		absPath: opts.absPath,
		slug: opts.slug,
		title,
		frontmatter,
		text,
		defines: opts.defines,
		anchors: new Map(),
		pages: [],
	};

	// Reference-style link definitions apply document-wide, so every page carries all of them.
	const refs = definitions.length ? '\n\n' + definitions.join('\n') + '\n' : '';
	const slugsIn = (start: number, end: number, except?: Heading) =>
		headings
			.filter((h) => h.node !== except && h.node !== h1)
			.filter((h) => h.node.position!.start.offset! >= start && h.node.position!.start.offset! < end)
			.map((h) => h.slug);
	const sorted = () => edits.sort((a, b) => a.start - b.start);

	const sections = opts.split === 'h2'
		? tree.children.filter((n): n is Heading => n.type === 'heading' && n.depth === 2)
		: [];

	if (!sections.length) {
		sorted();
		doc.pages.push({
			id: opts.slug,
			doc,
			title,
			order: 0,
			markdown: applyEdits(body, bodyStart, body.length, edits) + refs,
			headingSlugs: slugsIn(bodyStart, body.length),
			titleIds: [],
			range: [offset + bodyStart, offset + body.length],
		});
	} else {
		// Promote headings below H2 by one level on section pages: the H2 became the page title (H1).
		for (const h of headings) {
			if (h.node.depth < 3) continue;
			const s = h.node.position!.start.offset!;
			const hash = body.indexOf('#', s);
			if (hash >= 0 && hash < h.node.position!.end.offset! && /^ {0,3}$/.test(body.slice(s, hash)))
				edits.push({ start: hash, end: hash + 1, text: '' });
		}
		sorted();
		const introEnd = sections[0]!.position!.start.offset!;
		const sectionPages: PageSpec[] = sections.map((h2, i) => {
			const start = h2.position!.end.offset!;
			const end = i + 1 < sections.length ? sections[i + 1]!.position!.start.offset! : body.length;
			const slug = headings.find((h) => h.node === h2)!.slug;
			return {
				id: `${opts.slug}/${slug}`,
				doc,
				title: toString(h2),
				order: i + 1,
				markdown: applyEdits(body, start, end, edits) + refs,
				headingSlugs: slugsIn(start, end, h2),
				titleSlug: slug,
				titleIds: idsInHeading(h2, opts.ids),
				range: [offset + h2.position!.start.offset!, offset + end],
			};
		});
		const contents = sectionPages.map((p) => `- [${p.title.replace(/([\[\]])/g, '\\$1')}](#${p.titleSlug})`).join('\n');
		doc.pages.push({
			id: opts.slug,
			doc,
			title,
			order: 0,
			markdown: applyEdits(body, bodyStart, introEnd, edits) + '\n\n**Sections**\n\n' + contents + '\n' + refs,
			headingSlugs: slugsIn(bodyStart, introEnd),
			titleIds: [],
			range: [offset + bodyStart, offset + introEnd],
		});
		doc.pages.push(...sectionPages);
	}

	for (const page of doc.pages) {
		if (page.titleSlug) doc.anchors.set(page.titleSlug, page);
		for (const s of page.headingSlugs) if (!doc.anchors.has(s)) doc.anchors.set(s, page);
	}
	return doc;
}

/** The ID that opens a heading, if any (after an optional section number): an ID anywhere else in it is a mention, not a definition. */
function idsInHeading(h: Heading, ids: IdMatcher): string[] {
	const kids = h.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
	let f: Nodes | undefined = kids[0];
	if (f?.type === 'text' && SECTION_NUMBER.test(f.value) && kids.length > 1) f = kids[1];
	if (f && (f.type === 'strong' || f.type === 'emphasis')) f = f.children[0];
	if (f?.type === 'inlineCode') return ids.exact(f.value) ? [f.value] : [];
	if (f?.type === 'text') {
		const lead = ids.leading(f.value);
		return lead ? [lead] : [];
	}
	return [];
}

/** 1-based line of a character offset. */
export function lineAt(text: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}
