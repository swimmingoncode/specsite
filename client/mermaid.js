// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// Renders <pre class="mermaid"> blocks in the browser. Mermaid is loaded only on pages that have a diagram,
// from the site's own bundle (no external request), and re-rendered when Starlight's theme changes.

const blocks = [...document.querySelectorAll('pre.mermaid')];
if (blocks.length) {
	const sources = blocks.map((b) => b.textContent ?? '');
	const { default: mermaid } = await import('mermaid');
	const render = async () => {
		const dark = document.documentElement.dataset.theme === 'dark';
		mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
		blocks.forEach((b, i) => {
			b.removeAttribute('data-processed');
			b.textContent = sources[i];
		});
		try {
			await mermaid.run({ nodes: blocks });
		} catch (e) {
			console.warn('specsite: a Mermaid diagram failed to render', e);
		}
	};
	await render();
	new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
