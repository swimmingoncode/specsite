// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import specsite from 'specsite';

export default defineConfig({
	site: 'https://example.com',
	integrations: [
		starlight({
			title: 'Tidepool',
			description: 'A fixture for specsite: an invented project whose Markdown specs are published as pages.',
			favicon: '/favicon.png',
			customCss: [
				'@fontsource/barlow/400.css',
				'@fontsource/barlow/600.css',
				'@fontsource/barlow-condensed/600.css',
				'@fontsource/jetbrains-mono/400.css',
				'./src/styles/theme.css',
			],
			components: { Footer: './src/components/Footer.astro' },
			sidebar: [{ label: 'Start', items: [{ slug: 'index' }] }],
			plugins: [
				specsite({
					// The documents live one level up, at the root of the (invented) project.
					root: '..',
					documents: [
						{ file: 'SPEC.md', slug: 'spec', split: 'h2' },
						{ file: 'PLAN.md', slug: 'plan' },
						{ file: 'OVERVIEW.md', slug: 'overview', defines: false },
						{ glob: 'amendments/*.md', slug: 'amendments', title: 'Amendments', defines: false },
					],
					ids: {
						prefixes: ['REQ', 'INV', 'NFR', 'OQ', 'DEF', 'DEC', 'ERR', 'US', 'AC', 'CTR', 'CND', 'T', 'F'],
						definitions: 'auto',
					},
					repoUrl: 'https://github.com/swimmingoncode/specsite',
					branch: 'main',
					sidebar: { label: 'Specification' },
					// REQ-KV-9 in PLAN.md is undefined on purpose, so the fixture shows a warning; CI keeps 'warn'.
					check: 'warn',
				}),
			],
		}),
	],
});
