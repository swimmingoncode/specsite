// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// Opt-in sanitising (`sanitize: true`, `--sanitize`) for documents the repository owner did not write, such as
// docs contributed in pull requests. By default raw HTML in the Markdown is published as written: see
// SECURITY.md. The allowlist is rehype-sanitize's GitHub-style default schema, plus `id` (kept as written,
// not prefixed), `data-*`, and the classes specsite and the site generator emit. Scripts, event handlers,
// `style` and `javascript:` URLs are dropped.

import type { Element, Root } from 'hast';
import { randomUUID } from 'node:crypto';
import { unified } from 'unified';
import rehypeSanitize, { defaultSchema, type Options as Schema } from 'rehype-sanitize';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';

type Definition = NonNullable<Schema['attributes']>[string][number];
type ClassValue = string | RegExp;

/** Extend a schema: these classes, ids as written, any `data-*`; plus extra tags and per-tag attributes. */
function extend(base: Schema, classes: ClassValue[], tags: string[] = [], attributes: Record<string, Definition[]> = {}): Schema {
	const attrs: Record<string, Definition[]> = {};
	for (const [tag, defs] of Object.entries(base.attributes ?? {})) attrs[tag] = [...defs];
	// A tag's own className rule shadows the one on '*', so the extra classes go into every className rule.
	for (const [tag, defs] of Object.entries(attrs)) {
		attrs[tag] = defs.map((d) =>
			Array.isArray(d) && d[0] === 'className' ? (['className', ...d.slice(1), ...classes] as Definition) : d,
		);
	}
	const star = attrs['*'] ?? [];
	attrs['*'] = [...star.filter((d) => d !== 'id'), 'id', 'data*', ['className', ...classes] as Definition];
	for (const [tag, defs] of Object.entries(attributes)) attrs[tag] = [...(attrs[tag] ?? []), ...defs];
	return {
		...base,
		tagNames: [...(base.tagNames ?? []), ...tags],
		attributes: attrs,
		// Keep ids (and the references to them) as written, so heading and ID anchors stay stable.
		clobber: [],
	};
}

/** For `specsite html`: classes `specsite-*`, and `mermaid` (diagrams). */
export const snapshotSchema: Schema = extend(defaultSchema, [/^specsite-/, 'mermaid']);

/** For the site: also the markup Starlight wraps headings and asides in (`sl-*`, `starlight-*`, icons). */
export const siteSchema: Schema = extend(
	defaultSchema,
	[/^specsite-/, 'mermaid', /^sl-/, /^starlight-/, /^level-h[1-6]$/, 'sr-only'],
	['svg', 'path', 'aside'],
	{
		'*': ['ariaHidden', 'ariaLabel'],
		svg: ['viewBox', 'fill', 'stroke', 'width', 'height'],
		path: ['d', 'fill', 'fillRule', 'clipRule', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin'],
	},
);

/** Code blocks (fenced or indented) in a page's Markdown: the frames the site generator should render. */
export function codeBlockCount(markdown: string): number {
	let n = 0;
	visit(fromMarkdown(markdown), 'code', () => {
		n++;
	});
	return n;
}

/** Sanitise a tree in place. */
export function sanitizeTree(tree: Root, schema: Schema): Root {
	const out = unified().use(rehypeSanitize, schema).runSync(tree) as Root;
	tree.children = out.children;
	return tree;
}

const isCodeFrame = (n: Root['children'][number]): boolean =>
	n.type === 'element' &&
	Array.isArray(n.properties?.className) &&
	(n.properties.className as unknown[]).includes('expressive-code');

/**
 * Sanitise a page the site generator rendered. Code blocks it rendered (Expressive Code frames, which carry
 * their own styles and script) are kept as they are when there is exactly one per code block in the source,
 * since their content comes from code fences and is escaped. When the counts differ, a document is imitating
 * one, and every frame is sanitised with the rest.
 */
export function sanitizeRendered(tree: Root, codeBlocks: number): Root {
	const frames: Element[] = [];
	const find = (parent: Root | Element) => {
		for (const c of parent.children) {
			if (c.type !== 'element') continue;
			if (isCodeFrame(c)) frames.push(c);
			else find(c);
		}
	};
	find(tree);
	if (frames.length !== codeBlocks || !frames.length) return sanitizeTree(tree, siteSchema);
	// Swap each frame for a placeholder, sanitise, and put the frames back. The nonce keeps a document from
	// forging a placeholder.
	const nonce = randomUUID();
	const holders = frames.map((_, i): Element => ({ type: 'element', tagName: 'div', properties: { dataSpecsiteFrame: `${nonce}:${i}` }, children: [] }));
	const swap = (parent: Root | Element, from: Element[], to: Element[]) => {
		parent.children = parent.children.map((c) => {
			const i = from.indexOf(c as Element);
			if (i >= 0) return to[i]!;
			if (c.type === 'element') swap(c, from, to);
			return c;
		}) as typeof parent.children;
	};
	swap(tree, frames, holders);
	sanitizeTree(tree, siteSchema);
	const kept: Element[] = [];
	const collect = (parent: Root | Element) => {
		for (const c of parent.children) {
			if (c.type !== 'element') continue;
			const at = c.properties?.dataSpecsiteFrame;
			const i = typeof at === 'string' && at.startsWith(nonce + ':') ? Number(at.slice(nonce.length + 1)) : -1;
			if (i >= 0 && i < frames.length) kept[i] = c;
			else collect(c);
		}
	};
	collect(tree);
	swap(tree, kept, kept.map((_, i) => frames[i]!));
	return tree;
}
