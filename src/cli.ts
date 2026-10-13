// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { renderSnapshot } from './html/snapshot.js';
import type { CheckMode } from './core/options.js';

const USAGE = `Usage: specsite html <file.md> -o <out.html> [options]

Render one Markdown document as a single self-contained HTML page, with the same identifier
linking as the Starlight plugin.

Options:
  -o, --out <file>          Output file (required)
      --title <text>        Page title (default: front matter title, else the leading H1)
      --summary <text>      One-paragraph summary under the title
      --brand <svg>         Brand mark for the header (an SVG file, inlined)
      --brand-dark <svg>    Its dark-theme variant
      --brand-label <text>  Accessible name of the mark (default "Brand")
      --accent <hex>        Accent colour, e.g. #6a3cff (default: the built-in theme's)
      --with <file=url>     Another document whose IDs this one links to, published at <url>
                            (repeatable)
      --root <dir>          Directory relative links may reach (default: the file's git repository)
      --repo-url <url>      Repository URL for links to unpublished files (default: origin, if GitHub)
      --branch <name>       Branch for those links (default: main)
      --prefixes <list>     Comma-separated ID prefixes (default: REQ,INV,NFR,OQ,DEF,DEC,ERR,US,AC,CTR,CND,T,F)
      --check <warn|error>  Fail on unknown IDs, duplicate definitions or broken anchors with "error"
                            (default: warn)
      --toc-depth <2|3>     Headings in the contents rail (default: 2)
      --no-google-fonts     Use system fonts; the page then makes no external request
      --sanitize            Sanitise the document's HTML (for documents you did not write)
  -h, --help                Show this help
`;

export async function main(argv: string[]): Promise<number> {
	const [cmd, ...rest] = argv;
	if (!cmd || cmd === '-h' || cmd === '--help') {
		process.stdout.write(USAGE);
		return cmd ? 0 : 1;
	}
	if (cmd !== 'html') {
		process.stderr.write(`specsite: unknown command "${cmd}"\n\n${USAGE}`);
		return 1;
	}
	const { values, positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {
			out: { type: 'string', short: 'o' },
			title: { type: 'string' },
			summary: { type: 'string' },
			brand: { type: 'string' },
			'brand-dark': { type: 'string' },
			'brand-label': { type: 'string' },
			accent: { type: 'string' },
			with: { type: 'string', multiple: true },
			'repo-url': { type: 'string' },
			root: { type: 'string' },
			branch: { type: 'string' },
			prefixes: { type: 'string' },
			check: { type: 'string' },
			'toc-depth': { type: 'string' },
			'no-google-fonts': { type: 'boolean' },
			sanitize: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' },
		},
	});
	if (values.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	const file = positionals[0];
	if (!file || !values.out) {
		process.stderr.write(USAGE);
		return 1;
	}
	if (values.accent && !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(values.accent)) {
		process.stderr.write(`specsite: --accent must be a hex colour, got "${values.accent}"\n`);
		return 1;
	}
	const check = (values.check ?? 'warn') as CheckMode;
	if (check !== 'warn' && check !== 'error') {
		process.stderr.write(`specsite: --check must be "warn" or "error"\n`);
		return 1;
	}
	const withDocs = (values.with ?? []).map((w) => {
		const at = w.indexOf('=');
		if (at <= 0) throw new Error(`--with expects <file>=<url>, got "${w}"`);
		return { file: w.slice(0, at), url: w.slice(at + 1) };
	});
	try {
		const res = await renderSnapshot({
			file,
			title: values.title,
			summary: values.summary,
			brand: values.brand ? readFileSync(values.brand, 'utf8') : undefined,
			brandDark: values['brand-dark'] ? readFileSync(values['brand-dark'], 'utf8') : undefined,
			brandLabel: values['brand-label'],
			accent: values.accent,
			with: withDocs,
			repoUrl: values['repo-url'],
			root: values.root,
			branch: values.branch,
			ids: values.prefixes ? { prefixes: values.prefixes.split(',').map((s) => s.trim()).filter(Boolean) } : undefined,
			check,
			tocDepth: values['toc-depth'] === '3' ? 3 : 2,
			googleFonts: !values['no-google-fonts'],
			sanitize: values.sanitize ?? false,
			warn: (m) => process.stderr.write(`specsite: warning: ${m}\n`),
		});
		mkdirSync(dirname(values.out), { recursive: true });
		writeFileSync(values.out, res.html);
		process.stdout.write(
			`wrote ${values.out} · ${res.identifiers} identifiers anchored · ${res.links} links · ${Math.round(res.html.length / 1024)} KB\n`,
		);
		return 0;
	} catch (e) {
		process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
}
