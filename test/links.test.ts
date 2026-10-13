// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';
import { processPages } from '../src/core/engine.js';
import { remoteToHttps, resolveRelative, splitHref } from '../src/core/links.js';
import { doc, ids, render } from './helpers.js';

const repo = { url: 'https://github.com/acme/widget', branch: 'main', prefix: 'docs/' };
const pageUrl = (p: { id: string }) => `/site/${p.id}/`;

describe('link helpers', () => {
	it('splits and resolves', () => {
		expect(splitHref('a/b.md?x=1#frag')).toEqual({ path: 'a/b.md', query: '?x=1', fragment: 'frag' });
		expect(resolveRelative('SPEC.md', './amendments/0001.md')).toBe('amendments/0001.md');
		expect(resolveRelative('amendments/0001.md', '../PLAN.md')).toBe('PLAN.md');
		expect(resolveRelative('SPEC.md', '../outside.md')).toBeUndefined();
	});
	it('normalises remotes', () => {
		expect(remoteToHttps('git@github.com:acme/widget.git')).toBe('https://github.com/acme/widget');
		expect(remoteToHttps('https://github.com/acme/widget.git')).toBe('https://github.com/acme/widget');
		expect(remoteToHttps('https://token@github.com/acme/widget')).toBe('https://github.com/acme/widget');
	});
});

describe('link rewriting', () => {
	it('maps links between published documents to site URLs, keeping anchors on split pages', async () => {
		const spec = doc('SPEC.md', '# Spec\n\n## 1. Scope\n\nSee [errors](#2-errors).\n\n## 2. Errors\n\n### Detail\n\nx\n', {
			split: 'h2',
		});
		const plan = doc(
			'PLAN.md',
			'# Plan\n\n[spec](SPEC.md), [errors](SPEC.md#2-errors), [detail](./SPEC.md#detail), [readme](README.md), [src](src/lib.rs#L4), [site](https://example.com/x), [abs](/abs)\n',
		);
		const pages = await render(spec, plan);
		processPages(pages, { ids, repo, pageUrl });
		const html = (id: string) => toHtml(pages.find((p) => p.spec.id === id)!.tree);
		expect(html('spec/1-scope')).toContain('href="/site/spec/2-errors/"');
		const p = html('plan');
		expect(p).toContain('href="/site/spec/"');
		expect(p).toContain('href="/site/spec/2-errors/"');
		expect(p).toContain('href="/site/spec/2-errors/#detail"');
		expect(p).toContain('href="https://github.com/acme/widget/blob/main/docs/README.md"');
		expect(p).toContain('href="https://github.com/acme/widget/blob/main/docs/src/lib.rs#L4"');
		expect(p).toContain('href="https://example.com/x"');
		expect(p).toContain('href="/abs"');
	});

	it('keeps GitHub-style heading anchors when a document is split', async () => {
		const spec = doc('SPEC.md', '# Spec\n\n## A\n\n### Notes\n\n## B\n\n### Notes\n', { split: 'h2' });
		const pages = await render(spec);
		processPages(pages, { ids, repo, pageUrl });
		// GitHub numbers the second "Notes" as notes-1, and so does the split page.
		expect(toHtml(pages[2]!.tree)).toContain('id="notes-1"');
		expect(spec.anchors.get('notes-1')?.id).toBe('spec/b');
	});

	it('promotes headings on section pages and leaves rewrites to unknown files alone without a repo URL', async () => {
		const d = doc('SPEC.md', '# Spec\n\n## A\n\n### Sub\n\n[x](other.md)\n', { split: 'h2' });
		expect(d.pages[1]!.markdown).toContain('\n## Sub');
		const pages = await render(d);
		const res = processPages(pages, { ids, repo: { branch: 'main', prefix: '' }, pageUrl });
		expect(toHtml(pages[1]!.tree)).toContain('href="other.md"');
		expect(res.problems.map((p) => p.kind)).toEqual(['no-repo-url']);
	});
});

describe('document parsing', () => {
	it('uses front matter, then the leading H1, for the title, and turns mermaid fences into raw HTML', () => {
		const d = doc('X.md', '---\ntitle: From front matter\n---\n# Heading title\n\n```mermaid\ngraph LR; a-->b\n```\n');
		expect(d.title).toBe('From front matter');
		expect(d.pages[0]!.markdown).toContain('<pre class="mermaid">graph LR; a--&gt;b</pre>');
		expect(doc('Y.md', '# Only heading\n\ntext').title).toBe('Only heading');
	});
});
