// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { renderSnapshot } from '../src/html/snapshot.js';

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
});
