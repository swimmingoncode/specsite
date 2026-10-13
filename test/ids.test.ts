// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';
import { createIdMatcher, findCandidates } from '../src/core/ids.js';
import { processPages, report } from '../src/core/engine.js';
import { doc, ids, md, render } from './helpers.js';

const repo = { url: 'https://github.com/acme/widget', branch: 'main', prefix: '' };
const pageUrl = (p: { id: string }) => `/docs/${p.id}/`;

describe('id matcher', () => {
	it('matches whole IDs and finds them in text', () => {
		expect(ids.exact('REQ-AU-8')).toBe(true);
		expect(ids.exact('AC-A1.2')).toBe(true);
		expect(ids.exact('ERR-NotFound')).toBe(true);
		expect(ids.exact('REQ-AU-*')).toBe(false);
		expect(ids.exact('XYZ-1')).toBe(false);
		const found = 'See REQ-AU-8, AC-A1.2. Not BT-1 or T-shirt-ish? T-3!'.match(ids.scan());
		expect(found).toEqual(['REQ-AU-8', 'AC-A1.2', 'T-shirt-ish', 'T-3']);
	});
	it('honours custom prefixes and patterns', () => {
		const m = createIdMatcher({ prefixes: ['RISK'] });
		expect(m.exact('RISK-4')).toBe(true);
		expect(m.exact('REQ-1')).toBe(false);
		const p = createIdMatcher({ pattern: 'R\\d+' });
		expect(p.exact('R12')).toBe(true);
	});
});

describe('definition detection', () => {
	it('finds each rule', async () => {
		const tree = await md(
			[
				'**`REQ-1`** bold at the start.',
				'',
				'Mid-paragraph **`REQ-9`** is not a definition.',
				'',
				'| ID | x |',
				'| --- | --- |',
				'| `INV-1` | row |',
				'',
				'### `CTR-A` Contract',
				'',
				'### OQ-2 plain heading',
				'',
				'- `AC-A1.1` list item',
				'- text then `AC-A1.9`',
			].join('\n'),
		);
		const got = (rule: Parameters<typeof findCandidates>[1]) => findCandidates(tree, rule, ids).map((c) => c.id);
		expect(got('bold')).toEqual(['REQ-1']);
		expect(got('table')).toEqual(['INV-1']);
		expect(got('heading')).toEqual(['CTR-A', 'OQ-2']);
		expect(got('list')).toEqual(['AC-A1.1']);
	});

	it('anchors at the lower-cased ID and links mentions on the same page', async () => {
		const d = doc('SPEC.md', '# Spec\n\n**`REQ-DI-4`** Defined.\n\nUses `REQ-DI-4` and REQ-DI-4 in text.\n');
		const pages = await render(d);
		const res = processPages(pages, { ids, repo, pageUrl });
		const html = toHtml(pages[0]!.tree);
		expect(html).toContain('<code id="req-di-4" class="specsite-def" data-specsite-id="REQ-DI-4" data-pagefind-weight="10">REQ-DI-4</code>');
		expect(html).toContain('<a href="#req-di-4" class="specsite-ref" data-specsite-ref="REQ-DI-4"><code>REQ-DI-4</code></a>');
		expect(html).toContain('<a href="#req-di-4" class="specsite-ref" data-specsite-ref="REQ-DI-4">REQ-DI-4</a> in text');
		expect(res.index.get('REQ-DI-4')?.anchor).toBe('req-di-4');
		expect(res.problems).toEqual([]);
	});

	it('links across documents and across split pages', async () => {
		const spec = doc(
			'SPEC.md',
			'# Spec\n\nIntro.\n\n## 1. Keys\n\n**`REQ-1`** Keys.\n\n## 2. Log\n\n**`REQ-2`** Log, after `REQ-1`.\n',
			{ split: 'h2' },
		);
		const plan = doc('PLAN.md', '# Plan\n\n**`DEC-1`** Covers `REQ-2` and REQ-1.\n');
		const pages = await render(spec, plan);
		processPages(pages, { ids, repo, pageUrl });
		const byId = Object.fromEntries(pages.map((p) => [p.spec.id, toHtml(p.tree)]));
		expect(Object.keys(byId)).toEqual(['spec', 'spec/1-keys', 'spec/2-log', 'plan']);
		expect(byId['spec/2-log']).toContain('href="/docs/spec/1-keys/#req-1"');
		expect(byId['plan']).toContain('href="/docs/spec/2-log/#req-2"');
		expect(byId['plan']).toContain('href="/docs/spec/1-keys/#req-1"');
	});

	it('leaves unknown IDs as text and reports them with file and line', async () => {
		const d = doc('PLAN.md', '# Plan\n\nSee `REQ-404`.\n\nPlain REQ-405 is ignored.\n');
		const pages = await render(d);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(toHtml(pages[0]!.tree)).toContain('<code>REQ-404</code>');
		expect(res.problems).toEqual([
			{ kind: 'unknown-id', message: 'REQ-404 is referenced but not defined in any published document', at: ['PLAN.md:3'] },
		]);
	});

	it('reports duplicate definitions, and fails under check: error', async () => {
		const a = doc('SPEC.md', '# Spec\n\n**`REQ-1`** First.\n');
		const b = doc('PLAN.md', '# Plan\n\nIntro.\n\n**`REQ-1`** Again.\n');
		const pages = await render(a, b);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(res.problems.map((p) => [p.kind, p.at])).toEqual([['duplicate-definition', ['SPEC.md:3', 'PLAN.md:5']]]);
		// The second one becomes a link to the first.
		expect(toHtml(pages[1]!.tree)).toContain('href="/docs/spec/#req-1"');
		const warnings: string[] = [];
		report(res.problems, 'warn', (m) => warnings.push(m));
		expect(warnings).toHaveLength(1);
		expect(() => report(res.problems, 'error', () => {})).toThrow(/REQ-1 is defined 2 times.*SPEC\.md:3, PLAN\.md:5/s);
	});

	it('respects documents that define nothing', async () => {
		const spec = doc('SPEC.md', '# Spec\n\n**`REQ-1`** Here.\n');
		const overview = doc('OVERVIEW.md', '# Overview\n\n**`REQ-1`** summarised.\n', { defines: false });
		const pages = await render(overview, spec);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(res.index.get('REQ-1')?.page.doc.file).toBe('SPEC.md');
		expect(res.problems).toEqual([]);
	});

	it('anchors IDs held by a split section title at the top of that page', async () => {
		const spec = doc('SPEC.md', '# Spec\n\n## `CTR-LEDGER` Ledger\n\nText.\n', { split: 'h2' });
		const plan = doc('PLAN.md', '# Plan\n\nUses `CTR-LEDGER`.\n');
		const pages = await render(spec, plan);
		processPages(pages, { ids, repo, pageUrl });
		expect(toHtml(pages[1]!.tree)).toMatch(/^<span id="ctr-ledger"/);
		expect(toHtml(pages[2]!.tree)).toContain('href="/docs/spec/ctr-ledger-ledger/#ctr-ledger"');
	});

	it('never touches code blocks', async () => {
		const d = doc('SPEC.md', '# Spec\n\n**`REQ-1`** x\n\n```\nREQ-1 `REQ-1`\n```\n');
		const pages = await render(d);
		processPages(pages, { ids, repo, pageUrl });
		expect(toHtml(pages[0]!.tree)).toContain('<pre><code>REQ-1 `REQ-1`\n</code></pre>');
	});
});

describe('duplicates', () => {
	it('treats a list item that opens with an ID defined in bold elsewhere as a reference', async () => {
		const d = doc('SPEC.md', '# Spec\n\n- `REQ-1` (in a traceability list)\n\n**`REQ-1`** The definition.\n');
		const pages = await render(d);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(res.problems).toEqual([]);
		expect(toHtml(pages[0]!.tree)).toContain('<li><a href="#req-1"');
	});
	it('reports two bold definitions on the same page with their lines', async () => {
		const d = doc('SPEC.md', '# Spec\n\n**`REQ-1`** One.\n\nText `REQ-1`.\n\n**`REQ-1`** Two.\n');
		const pages = await render(d);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(res.problems.map((p) => p.at)).toEqual([['SPEC.md:3', 'SPEC.md:7']]);
	});
});

describe('duplicates across strict kinds', () => {
	it('reports a table row defined twice', async () => {
		const a = doc('SPEC.md', '# Spec\n\n| ID | x |\n| --- | --- |\n| `INV-7` | one |\n');
		const b = doc('PLAN.md', '# Plan\n\n| ID | x |\n| --- | --- |\n| `INV-7` | two |\n');
		const res = processPages(await render(a, b), { ids, repo, pageUrl });
		expect(res.problems.map((p) => [p.kind, p.at])).toEqual([['duplicate-definition', ['SPEC.md:5', 'PLAN.md:5']]]);
	});
	it('reports a heading defined twice', async () => {
		const d = doc('SPEC.md', '# Spec\n\n### `CTR-ALPHA` First\n\nx\n\n### `CTR-ALPHA` Second\n');
		const res = processPages(await render(d), { ids, repo, pageUrl });
		expect(res.problems.map((p) => [p.kind, p.at])).toEqual([['duplicate-definition', ['SPEC.md:3', 'SPEC.md:7']]]);
	});
	it('reports a heading that repeats a split section title', async () => {
		const spec = doc('SPEC.md', '# Spec\n\n## `CTR-BETA` Beta\n\nText.\n', { split: 'h2' });
		const plan = doc('PLAN.md', '# Plan\n\n### `CTR-BETA` Again\n');
		const res = processPages(await render(spec, plan), { ids, repo, pageUrl });
		expect(res.index.get('CTR-BETA')?.rule).toBe('title');
		expect(res.problems.map((p) => [p.kind, p.at])).toEqual([['duplicate-definition', ['SPEC.md:3', 'PLAN.md:3']]]);
	});
	it('keeps list items lenient against a strict definition', async () => {
		const d = doc('SPEC.md', '# Spec\n\n- `REQ-5` traced\n\n| ID | x |\n| --- | --- |\n| `REQ-5` | defined |\n\n### `REQ-6` Heading\n\n- `REQ-6` traced\n');
		const pages = await render(d);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(res.problems).toEqual([]);
		expect(res.index.get('REQ-5')?.rule).toBe('table');
		expect(res.index.get('REQ-6')?.rule).toBe('heading');
	});
	it('gives bold priority over a table row in an earlier document', async () => {
		const spec = doc('SPEC.md', '# Spec\n\n| ID | x |\n| --- | --- |\n| `REQ-30` | summary |\n');
		const plan = doc('PLAN.md', '# Plan\n\n**`REQ-30`** The definition.\n');
		const pages = await render(spec, plan);
		const res = processPages(pages, { ids, repo, pageUrl });
		const def = res.index.get('REQ-30');
		expect([def?.rule, def?.page.doc.file]).toEqual(['bold', 'PLAN.md']);
		expect(toHtml(pages[0]!.tree)).toContain('href="/docs/plan/#req-30"');
		// Bold and table are one strict kind, so the table row is still reported, after the winner.
		expect(res.problems.map((p) => [p.kind, p.at])).toEqual([['duplicate-definition', ['PLAN.md:3', 'SPEC.md:5']]]);
	});
});

describe('heading definitions', () => {
	it('does not define an ID that only appears later in a heading', async () => {
		const tree = await md('## Replaces `REQ-2`\n\n### Also REQ-3 here\n\n## **`REQ-4`** Bold lead\n');
		expect(findCandidates(tree, 'heading', ids).map((c) => c.id)).toEqual(['REQ-4']);
		const spec = doc('SPEC.md', '# Spec\n\n## Replaces `REQ-2`\n\nText.\n', { split: 'h2' });
		expect(spec.pages[1]!.titleIds).toEqual([]);
		const res = processPages(await render(spec), { ids, repo, pageUrl });
		expect(res.index.has('REQ-2')).toBe(false);
	});
});

describe('heading definitions with a section number', () => {
	it('allows a section number before the ID, but not other words', async () => {
		const tree = await md(
			'### 7.B `CTR-X` \u2014 title\n\n## 3 `REQ-9`\n\n## \u00a73 `REQ-8`\n\n## Replaces `REQ-2`\n',
		);
		expect(findCandidates(tree, 'heading', ids).map((c) => c.id)).toEqual(['CTR-X', 'REQ-9', 'REQ-8']);
	});

	it('accepts only section numbers, not all-caps words', async () => {
		const tree = await md('## 12.3.4 `REQ-1`\n\n## A. `REQ-2`\n\n## NOTE `REQ-3`\n');
		expect(findCandidates(tree, 'heading', ids).map((c) => c.id)).toEqual(['REQ-1', 'REQ-2']);
	});

	it('applies the same rule to split page titles', () => {
		const spec = doc(
			'SPEC.md',
			'# Spec\n\n## 7.B `CTR-QRY` \u2014 title\n\nText.\n\n## \u00a73 `REQ-8` Tail\n\nText.\n\n## NOTE `REQ-3`\n\nText.\n',
			{ split: 'h2' },
		);
		expect(spec.pages[1]!.titleIds).toEqual(['CTR-QRY']);
		expect(spec.pages[2]!.titleIds).toEqual(['REQ-8']);
		expect(spec.pages[3]!.titleIds).toEqual([]);
	});
});

describe('broken anchors', () => {
	it('reports a fragment with no anchor in a listed document, and fails under check: error', async () => {
		const spec = doc(
			'SPEC.md',
			'# Spec\n\n## Keys\n\n[ok](PLAN.md#steps) [bad](PLAN.md#nope)\n\n[here](#keys) [gone](#missing)\n\n[notes](NOTES.md#anything)\n',
		);
		const plan = doc('PLAN.md', '# Plan\n\n## Steps\n\nx\n');
		const pages = await render(spec, plan);
		const res = processPages(pages, { ids, repo, pageUrl });
		expect(res.problems.map((p) => [p.kind, p.at])).toEqual([
			['broken-anchor', ['SPEC.md:5']],
			['broken-anchor', ['SPEC.md:7']],
		]);
		const html = toHtml(pages[0]!.tree);
		expect(html).toContain('href="/docs/plan/#steps"');
		expect(html).toContain('href="/docs/plan/#nope"');
		// Unlisted files become repository URLs, fragment and all, without a check.
		expect(html).toContain('href="https://github.com/acme/widget/blob/main/NOTES.md#anything"');
		expect(() => report(res.problems, 'error', () => {})).toThrow(/2 identifier problem/);
	});
});
