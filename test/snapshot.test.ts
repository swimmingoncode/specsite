// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSnapshot } from '../src/html/snapshot.js';
import { basisRows } from '../src/core/basis.js';
import { doc } from './helpers.js';

describe('specsite html', () => {
	it('renders the fixture spec as one self-contained page, linking IDs into the plan', async () => {
		const warnings: string[] = [];
		const res = await renderSnapshot({
			file: 'example/SPEC.md',
			with: [{ file: 'example/PLAN.md', url: 'plan.html' }],
			repoUrl: 'https://github.com/swimmingoncode/specsite',
			googleFonts: false,
			warn: (m) => warnings.push(m),
		});
		const { html } = res;
		expect(html).toMatch(/^<!doctype html>/);
		expect(html).toContain('<title>Tidepool specification</title>');
		expect(html).toContain('<code id="req-kv-1" class="specsite-def"');
		expect(html).toContain('href="#req-log-1"');
		expect(html).toContain('href="plan.html#t-1"');
		expect(html).toContain('href="plan.html"');
		expect(html).toContain('<pre class="mermaid">');
		expect(html).toContain('href="https://github.com/swimmingoncode/specsite/blob/main/LICENSE"');
		expect(html).toContain('<a href="#2-requirements">2. Requirements</a>');
		// No external request without Google Fonts: no http(s) src/href except links in the text.
		expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
		expect(warnings).toEqual([]);
	});

	it('fails under check: error on an undefined ID, naming file and line', async () => {
		await expect(
			renderSnapshot({ file: 'example/PLAN.md', with: [{ file: 'example/SPEC.md', url: 'spec.html' }], check: 'error', warn: () => {} }),
		).rejects.toThrow(/REQ-KV-9 .*PLAN\.md:38/s);
	});

	it('takes an accent and a brand mark', async () => {
		const { html } = await renderSnapshot({
			file: 'example/OVERVIEW.md',
			accent: '#6a3cff',
			brand: '<?xml version="1.0"?><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
			brandLabel: 'Acme',
			warn: () => {},
		});
		expect(html).toContain('--accent:#6a3cff');
		expect(html).toContain('<svg class="brand " role="img" aria-label="Acme" viewBox="0 0 10 10">');
	});

	it('opens with a basis block: repository, build commit, version, status, render time, last change', async () => {
		const { html } = await renderSnapshot({
			file: 'example/SPEC.md',
			repoUrl: 'https://github.com/swimmingoncode/specsite',
			googleFonts: false,
			renderedAt: new Date('2026-01-02T03:04:05.678Z'),
			warn: () => {},
		});
		const block = /<dl class="meta specsite-basis">.*?<\/dl>/s.exec(html)?.[0] ?? '';
		const field = (k: string) => new RegExp(`data-specsite-basis="${k}"><dt>[^<]+</dt><dd>(.*?)</dd>`).exec(block)?.[1];
		expect(field('repository')).toBe('<a href="https://github.com/swimmingoncode/specsite">swimmingoncode/specsite</a>');
		expect(field('commit')).toMatch(/^<a href="https:\/\/github\.com\/swimmingoncode\/specsite\/commit\/[0-9a-f]{40}"><code>[0-9a-f]{7,}<\/code><\/a>/);
		expect(field('version')).toBe('0.3.0');
		expect(field('status')).toBe('Draft');
		expect(field('rendered')).toBe('2026-01-02T03:04:05Z');
		expect(field('source')).toMatch(/^<a href="[^"]+\/example\/SPEC\.md">example\/SPEC\.md<\/a>, last changed in <a href="[^"]+\/commit\/[0-9a-f]{40}"><code>/);
		// The front matter's date is the author's, not the render time.
		expect(block).not.toContain('2026-09-01');
	});

	it('lists basis fields in order and leaves out what is unknown', () => {
		const d = doc('NOTES.md', '---\nversion: 2\nstatus: Final\ndate: 2026-03-04\n---\n# Notes\n');
		const rows = basisRows(d, { repo: { url: undefined, branch: 'main', prefix: '' }, renderedAt: new Date(0) }, undefined);
		expect(rows.map((r) => [r.key, r.parts.map((p) => p.text).join('')])).toEqual([
			['version', '2'],
			['status', 'Final'],
			['rendered', '1970-01-01T00:00:00Z'],
			['source', 'NOTES.md, not committed'],
		]);
	});

	it('sanitises on request: no script, handlers or javascript: links; ids and data-* stay', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'specsite-'));
		const file = join(dir, 'T.md');
		writeFileSync(file, '# T\n\n**`REQ-1`** x <script>alert(1)</script> [a](javascript:alert(1)) <img src="i.png" onerror="alert(1)"> <span id="here" data-k="v" style="color:red">s</span>\n');
		const { html } = await renderSnapshot({ file, sanitize: true, repoUrl: false, googleFonts: false, warn: () => {} });
		const main = html.slice(html.indexOf('</header>'));
		expect(main).not.toMatch(/alert|onerror|javascript:|style="color/);
		expect(main).toContain('<span id="here" data-k="v">s</span>');
		expect(main).toContain('<code id="req-1" class="specsite-def"');
		const raw = await renderSnapshot({ file, repoUrl: false, googleFonts: false, warn: () => {} });
		expect(raw.html).toContain('<script>alert(1)</script>');
	});

	it('rejects an accent that is not a hex colour', async () => {
		await expect(renderSnapshot({ file: 'example/OVERVIEW.md', accent: 'red}</style><script>', warn: () => {} })).rejects.toThrow(
			/accent must be a hex colour/,
		);
	});
});
