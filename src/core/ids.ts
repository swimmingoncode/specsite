// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// Requirement identifiers on HTML trees (hast): find where each ID is defined, give it an anchor, and turn
// every other mention into a link to that anchor.

import type { Root, Element, ElementContent, Text, Parents } from 'hast';
import { DEFAULT_PREFIXES, type DefinitionRule } from './options.js';

export interface IdMatcher {
	/** The whole string is one ID. */
	exact(s: string): boolean;
	/** The ID that opens `s` (after leading whitespace), if any. */
	leading(s: string): string | undefined;
	/** A fresh global regex that finds IDs in running text. */
	scan(): RegExp;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createIdMatcher(opts: { prefixes?: string[]; pattern?: string } = {}): IdMatcher {
	const prefixes = opts.prefixes?.length ? opts.prefixes : DEFAULT_PREFIXES;
	const core =
		opts.pattern ??
		`(?:${[...prefixes].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*`;
	const exact = new RegExp(`^(?:${core})$`);
	const leading = new RegExp(`^\\s*(${core})(?![A-Za-z0-9_])`);
	const scanSrc = `(?<![A-Za-z0-9_-])(?:${core})(?![A-Za-z0-9_])`;
	return {
		exact: (s) => exact.test(s),
		leading: (s) => leading.exec(s)?.[1],
		scan: () => new RegExp(scanSrc, 'g'),
	};
}

/** The anchor of an ID: the ID lower-cased (`REQ-DI-4` → `req-di-4`), so any tool can deep-link by ID alone. */
export const anchorOf = (id: string) => id.toLowerCase();

export const textOf = (n: ElementContent | Root): string =>
	n.type === 'text' ? n.value : 'children' in n ? (n.children as ElementContent[]).map(textOf).join('') : '';

const isWhitespace = (n: ElementContent) => n.type === 'text' && !n.value.trim();
const isComment = (n: ElementContent) => n.type === 'comment';

export function firstMeaningful(el: Element | Root): ElementContent | undefined {
	return (el.children as ElementContent[]).find((c) => !isWhitespace(c) && !isComment(c));
}

const isEl = (n: unknown, ...tags: string[]): n is Element =>
	!!n && (n as Element).type === 'element' && (tags.length === 0 || tags.includes((n as Element).tagName));

function classList(el: Element): string[] {
	const c: unknown = el.properties?.className;
	return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : [];
}

/** Inline `code` whose whole text is one ID (and that is not inside a code block). */
export function idCode(n: unknown, ids: IdMatcher): string | undefined {
	if (!isEl(n, 'code')) return undefined;
	if (n.children.some((c) => c.type === 'element')) return undefined;
	const t = textOf(n).trim();
	return ids.exact(t) ? t : undefined;
}

/** Depth-first walk with the ancestor chain. Return `'skip'` to skip a node's children. */
export function walk(
	tree: Root,
	fn: (node: ElementContent, ancestors: Parents[]) => void | 'skip',
): void {
	const go = (parent: Parents, ancestors: Parents[]) => {
		const chain = [...ancestors, parent];
		for (const child of [...(parent.children as ElementContent[])]) {
			if (fn(child, chain) === 'skip') continue;
			if (child.type === 'element') go(child, chain);
		}
	};
	go(tree, []);
}

/** Elements whose content is never touched: code blocks, links, diagrams, Expressive Code frames. */
export function isOpaque(el: Element): boolean {
	if (['pre', 'a', 'script', 'style', 'svg', 'math', 'textarea'].includes(el.tagName)) return true;
	const cls = classList(el);
	return cls.includes('expressive-code') || cls.includes('mermaid') || cls.includes('specsite-source');
}

/** A place that defines an ID: either an inline `code` element, or a run of text to wrap. */
export interface Candidate {
	id: string;
	rule: DefinitionRule;
	/** The `code` element to mark. */
	code?: Element;
	/** For a plain-text ID that opens a heading: the heading. */
	heading?: Element;
}

const BLOCKS = ['p', 'li', 'td', 'th', 'dt', 'dd'];

/** All candidates for one rule in one tree, in document order. */
export function findCandidates(tree: Root, rule: DefinitionRule, ids: IdMatcher): Candidate[] {
	const out: Candidate[] = [];
	walk(tree, (node, anc) => {
		if (node.type !== 'element') return;
		if (isOpaque(node)) return 'skip';
		const parent = anc[anc.length - 1];
		switch (rule) {
			case 'bold': {
				if (node.tagName !== 'strong' || !isEl(parent, ...BLOCKS)) return;
				if (firstMeaningful(parent) !== node) return;
				// A <p> that opens a list item still counts as "the start" only for its own paragraph.
				const code = firstMeaningful(node);
				const id = idCode(code, ids);
				if (id) out.push({ id, rule, code: code as Element });
				return;
			}
			case 'table': {
				if (node.tagName !== 'tr') return;
				if (anc.some((a) => isEl(a, 'thead'))) return 'skip';
				const cell = node.children.find((c) => isEl(c, 'td', 'th')) as Element | undefined;
				if (!cell || cell.tagName !== 'td') return;
				let f = firstMeaningful(cell);
				if (isEl(f, 'strong')) f = firstMeaningful(f);
				const id = idCode(f, ids);
				if (id) out.push({ id, rule, code: f as Element });
				return;
			}
			case 'heading': {
				if (!/^h[1-6]$/.test(node.tagName)) return;
				// Only an ID that opens the heading defines it (`## Replaces \`REQ-2\`` mentions REQ-2).
				let f = firstMeaningful(node);
				if (isEl(f, 'strong', 'em')) f = firstMeaningful(f);
				const id = idCode(f, ids);
				if (id) out.push({ id, rule, code: f as Element });
				else if (f?.type === 'text') {
					const lead = ids.leading(f.value);
					if (lead) out.push({ id: lead, rule, heading: node });
				}
				return 'skip';
			}
			case 'list': {
				if (node.tagName !== 'li') return;
				let f = firstMeaningful(node);
				if (isEl(f, 'p')) f = firstMeaningful(f);
				if (isEl(f, 'input')) {
					// A task-list item: look past the checkbox.
					const p = isEl(firstMeaningful(node), 'p') ? (firstMeaningful(node) as Element) : node;
					const kids = (p.children as ElementContent[]).filter((c) => !isWhitespace(c) && !isComment(c));
					f = kids[1];
				}
				const id = idCode(f, ids);
				if (id) out.push({ id, rule, code: f as Element });
				return;
			}
		}
	});
	return out;
}

/** Collect every `id` attribute in a tree. */
export function collectIds(tree: Root): Set<string> {
	const seen = new Set<string>();
	walk(tree, (n) => {
		if (n.type === 'element' && typeof n.properties?.id === 'string') seen.add(n.properties.id);
	});
	return seen;
}

/** Give a candidate its anchor (the lower-cased ID), unless another element on the page already has that id. */
export function markDefinition(c: Candidate, taken: Set<string>): void {
	const anchor = anchorOf(c.id);
	const own = !taken.has(anchor);
	if (own) taken.add(anchor);
	if (c.code) {
		c.code.properties = {
			...(own ? { id: anchor } : {}),
			...c.code.properties,
			className: [...classList(c.code), 'specsite-def'],
			dataSpecsiteId: c.id,
			// Rank the page that defines an ID above pages that only mention it.
			dataPagefindWeight: '10',
		};
		return;
	}
	if (c.heading) {
		// Wrap the leading plain-text ID of the heading in a span that carries the anchor.
		const h = c.heading;
		walk({ type: 'root', children: h.children }, (n, anc) => {
			if (n.type !== 'text') return;
			const at = n.value.indexOf(c.id);
			if (at < 0) return;
			const parent = anc[anc.length - 1] as Element | Root;
			const i = parent.children.indexOf(n);
			const span: Element = {
				type: 'element',
				tagName: 'span',
				properties: { ...(own ? { id: anchor } : {}), className: ['specsite-def'], dataSpecsiteId: c.id, dataPagefindWeight: '10' },
				children: [{ type: 'text', value: c.id }],
			};
			const parts: ElementContent[] = [];
			if (at > 0) parts.push({ type: 'text', value: n.value.slice(0, at) });
			parts.push(span);
			if (at + c.id.length < n.value.length) parts.push({ type: 'text', value: n.value.slice(at + c.id.length) });
			parent.children.splice(i, 1, ...(parts as typeof parent.children));
			c.heading = undefined;
			return 'skip';
		});
	}
}

export interface Mention {
	id: string;
	/** Found in inline code (`true`) or in running text. */
	code: boolean;
}

/**
 * Link every mention of an ID. `resolve` returns the href for a known ID, or undefined for an unknown one.
 * Unknown IDs in inline code are reported through `unknown`; unknown IDs in running text are left alone.
 */
export function linkMentions(
	tree: Root,
	ids: IdMatcher,
	resolve: (id: string) => string | undefined,
	opts: { linkText: boolean; unknown: (id: string) => void },
): number {
	let linked = 0;
	const link = (id: string, child: ElementContent): Element => ({
		type: 'element',
		tagName: 'a',
		properties: { href: resolve(id)!, className: ['specsite-ref'], dataSpecsiteRef: id },
		children: [child],
	});
	walk(tree, (node, anc) => {
		const parent = anc[anc.length - 1]!;
		if (node.type === 'element') {
			if (isOpaque(node)) return 'skip';
			if (node.tagName === 'code') {
				const id = idCode(node, ids);
				if (!id || node.properties?.dataSpecsiteId) return 'skip';
				if (resolve(id) === undefined) {
					opts.unknown(id);
					return 'skip';
				}
				const i = parent.children.indexOf(node);
				(parent.children as ElementContent[])[i] = link(id, node);
				linked++;
				return 'skip';
			}
			if (/^h[1-6]$/.test(node.tagName) || node.properties?.dataSpecsiteId) return opts.linkText ? undefined : 'skip';
			return;
		}
		if (node.type !== 'text' || !opts.linkText) return;
		if (anc.some((a) => a.type === 'element' && (/^h[1-6]$/.test(a.tagName) || !!a.properties?.dataSpecsiteId))) return;
		const re = ids.scan();
		const parts: ElementContent[] = [];
		let at = 0;
		for (let m = re.exec(node.value); m; m = re.exec(node.value)) {
			const id = m[0];
			if (resolve(id) === undefined) continue;
			if (m.index > at) parts.push({ type: 'text', value: node.value.slice(at, m.index) });
			parts.push(link(id, { type: 'text', value: id }));
			at = m.index + id.length;
			linked++;
		}
		if (!parts.length) return;
		if (at < node.value.length) parts.push({ type: 'text', value: node.value.slice(at) });
		const i = parent.children.indexOf(node);
		(parent.children as ElementContent[]).splice(i, 1, ...parts);
	});
	return linked;
}

export type { Text };
