// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado

/** Where an identifier counts as defined, in priority order (the first rule that finds an ID wins). */
export type DefinitionRule =
	/** `**\`REQ-1\`** ...` at the start of a paragraph, list item or table cell. */
	| 'bold'
	/** `| \`INV-3\` | ... |`: the first cell of a table body row. */
	| 'table'
	/** `### \`CTR-LEDGER\` ...` or `### CTR-LEDGER ...`: an ID in a heading. */
	| 'heading'
	/** `- \`AC-A1.2\` ...`: a list item that opens with an ID. */
	| 'list';

export const DEFAULT_RULES: DefinitionRule[] = ['bold', 'table', 'heading', 'list'];

export const DEFAULT_PREFIXES = [
	'REQ', 'INV', 'NFR', 'OQ', 'DEF', 'DEC', 'ERR', 'US', 'AC', 'CTR', 'CND', 'T', 'F',
];

export interface IdOptions {
	/** ID families. An ID is `<PREFIX>-<part>[-.<part>]*`, e.g. `REQ-AU-8`, `AC-A1.2`, `ERR-NotFound`. */
	prefixes?: string[];
	/** A regular expression source that replaces the one built from `prefixes` (no anchors, no flags). */
	pattern?: string;
	/** `'auto'` (all rules, default) or the rules to apply, in priority order. */
	definitions?: 'auto' | DefinitionRule[];
	/** Also link IDs that appear in plain text, not only in `code`. Unknown plain-text IDs are ignored. Default `true`. */
	linkText?: boolean;
}

export interface FileDocument {
	/** Path of the Markdown file, relative to `root`. */
	file: string;
	/** URL segment(s) the document is published under, e.g. `spec` or `reference/spec`. */
	slug: string;
	/** Page title. Default: front matter `title`, else the document's leading H1, else the file name. */
	title?: string;
	/** `'h2'` publishes one page per H2 section (plus an index page); otherwise the document is one page. */
	split?: 'h2' | false;
	/** Whether IDs may be defined here (`true`, default), never (`false`), or only these prefixes. */
	defines?: boolean | string[];
}

export interface GlobDocument {
	/** A glob relative to `root`, e.g. `amendments/*.md`. Each match is one page under `slug`. */
	glob: string;
	slug: string;
	/** Sidebar label for the group. Default: the slug. */
	title?: string;
	defines?: boolean | string[];
}

export type DocumentConfig = FileDocument | GlobDocument;

export type CheckMode = 'warn' | 'error';

export interface SidebarOptions {
	/** Label of the sidebar group holding the documents. Default `'Specification'`. */
	label?: string;
	/** Where the group goes in an existing sidebar. Default `'end'`. */
	position?: 'start' | 'end';
	collapsed?: boolean;
}

export interface SpecsiteOptions {
	/** Directory the document paths are relative to, resolved from the Astro project root. Default `'.'`. */
	root?: string;
	/** The allowlist of documents to publish. Nothing else from the repository is read. */
	documents: DocumentConfig[];
	ids?: IdOptions;
	/**
	 * Base URL of the repository on GitHub (or a compatible host), used for edit links, the source line and
	 * links to files that are not published. Default: derived from the `origin` remote when it is a GitHub URL;
	 * `false` disables all repository links.
	 */
	repoUrl?: string | false;
	/** Branch for edit links and links to unpublished files. Default `'main'`. */
	branch?: string;
	/** Sidebar group added to an explicit Starlight `sidebar`; `false` adds none. */
	sidebar?: SidebarOptions | false;
	/** Render ```mermaid fences in the browser (bundled, loaded only on pages that have a diagram). Default `true`. */
	mermaid?: boolean;
	/**
	 * Show the basis block at the top of each page: repository, the commit the site was built from, the
	 * document's version and status (front matter), the render time, and the commit that last changed the file.
	 * Default `true`.
	 */
	sourceLine?: boolean;
	/**
	 * `'error'` fails the build on a reference to an undefined ID, a duplicate definition, or a link to a
	 * fragment that is not an anchor in a listed document. Default `'warn'`.
	 */
	check?: CheckMode;
}

export function isGlobDocument(d: DocumentConfig): d is GlobDocument {
	return 'glob' in d && typeof d.glob === 'string';
}

export function definesFilter(defines: boolean | string[] | undefined): (id: string) => boolean {
	if (defines === false) return () => false;
	if (Array.isArray(defines)) {
		const set = new Set(defines);
		return (id) => set.has(id.slice(0, id.indexOf('-')));
	}
	return () => true;
}

export function validateSlug(slug: string): string {
	if (!slug || slug.startsWith('/') || slug.endsWith('/') || /\s/.test(slug))
		throw new Error(`specsite: invalid slug "${slug}" (no leading or trailing slash, no spaces)`);
	return slug;
}
