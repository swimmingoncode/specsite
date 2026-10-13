// SPDX-License-Identifier: MIT
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import GithubSlugger from 'github-slugger';
import { toString as hastToString } from 'hast-util-to-string';
import type { Root } from 'hast';
import { walk, createIdMatcher } from '../src/core/ids.js';
import { parseDocument, type DocInfo } from '../src/core/source.js';
import { definesFilter } from '../src/core/options.js';
import type { RenderedPage } from '../src/core/engine.js';

export const ids = createIdMatcher();

export async function md(markdown: string): Promise<Root> {
	const p = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
	const tree = (await p.run(p.parse(markdown))) as Root;
	const slugger = new GithubSlugger();
	walk(tree, (n) => {
		if (n.type === 'element' && /^h[1-6]$/.test(n.tagName)) n.properties.id = slugger.slug(hastToString(n));
	});
	return tree;
}

export function doc(file: string, text: string, opts: { slug?: string; split?: 'h2'; defines?: boolean | string[] } = {}): DocInfo {
	return parseDocument(text, {
		file,
		absPath: '/repo/' + file,
		slug: opts.slug ?? file.replace(/\.md$/, '').toLowerCase(),
		split: opts.split,
		defines: definesFilter(opts.defines),
		ids,
	});
}

export async function render(...docs: DocInfo[]): Promise<RenderedPage[]> {
	const out: RenderedPage[] = [];
	for (const d of docs) for (const spec of d.pages) out.push({ spec, tree: await md(spec.markdown) });
	return out;
}
