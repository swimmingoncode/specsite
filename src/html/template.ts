// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// The page around a snapshot. The default theme is Swimming on Code's (palette, roles and contrast rules from
// its Brand Application Guidelines); a project replaces the accent with --accent and adds its own mark with
// --brand. Layout: a contents rail beside one reading column (at most ~70 characters); the rail folds on phones.

export interface TemplateInput {
	title: string;
	kicker: string;
	summary?: string;
	/** The basis block, already rendered (a `<dl class="meta">`). */
	basis: string;
	toc: string;
	body: string;
	brand?: string;
	brandDark?: string;
	brandLabel?: string;
	accent?: string;
	googleFonts: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Swimming on Code palette (Brand Application Guidelines, "Color"). */
const SOC = {
	violet: '#865CEC',
	deepViolet: '#6A3FD9',
	charcoal: '#333333',
	white: '#FFFFFF',
	lime: '#B8FFA2',
	pink: '#F89ABA',
	grey1: '#F2F2F2',
	grey2: '#E5E5E5',
};

// Typography: pairing A of the guidelines (Barlow Condensed / Barlow / JetBrains Mono), still a proposal there.
const FONTS_URL =
	'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=Barlow:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap';

function brandSvg(svg: string, cls: string, label: string): string {
	const clean = svg.replace(/<\?xml[^>]*>\s*/i, '').replace(/<!DOCTYPE[^>]*>\s*/i, '').trim();
	return clean.replace(/<svg\b/i, `<svg class="brand ${cls}" role="img" aria-label="${esc(label)}"`);
}

export function pageTemplate(t: TemplateInput): string {
	const accentLight = t.accent ?? SOC.deepViolet;
	const accentDark = t.accent ? `color-mix(in srgb, ${t.accent} 55%, #ffffff)` : SOC.lime;
	const ring = t.accent ?? SOC.violet;
	const label = t.brandLabel ?? 'Brand';
	const brand = t.brand
		? brandSvg(t.brand, t.brandDark ? 'brand-light' : '', label) + (t.brandDark ? '\n' + brandSvg(t.brandDark, 'brand-dark', label) : '')
		: '';
	const fonts = t.googleFonts
		? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_URL}">`
		: '';
	const dark = `
  --paper:${SOC.charcoal}; --sheet:color-mix(in srgb, ${SOC.white} 6%, ${SOC.charcoal}); --ink:${SOC.white};
  --muted:color-mix(in srgb, ${SOC.white} 78%, ${SOC.charcoal}); --rule:color-mix(in srgb, ${SOC.white} 20%, ${SOC.charcoal});
  --accent:${accentDark}; --accent-soft:color-mix(in srgb, ${accentDark} 16%, ${SOC.charcoal});
  --code:color-mix(in srgb, ${SOC.white} 9%, ${SOC.charcoal}); --ring:${t.accent ? accentDark : SOC.lime}; color-scheme:dark`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="specsite">
<title>${esc(t.title)}</title>
${fonts}
<style>
:root{
  --paper:${SOC.white}; --sheet:${SOC.grey1}; --ink:${SOC.charcoal}; --muted:color-mix(in srgb, ${SOC.charcoal} 78%, ${SOC.white});
  --rule:${SOC.grey2}; --accent:${accentLight}; --accent-soft:color-mix(in srgb, ${accentLight} 10%, ${SOC.white});
  --code:${SOC.grey1}; --ring:${ring}; color-scheme:light;
  --f-display:"Barlow Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif;
  --f-body:"Barlow",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  --f-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}
:root[data-theme="dark"]{${dark}}
*{box-sizing:border-box}
html{scroll-padding-top:calc(env(safe-area-inset-top,0px) + 12px)}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 var(--f-body)}
.brand{display:block;height:40px;width:auto;max-width:100%;margin-bottom:14px}.brand-dark{display:none}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .brand-light{display:none}:root:not([data-theme="light"]) .brand-dark{display:block}}
:root[data-theme="dark"] .brand-light{display:none}:root[data-theme="dark"] .brand-dark{display:block}
.page{max-width:1180px;margin:0 auto;padding:28px 16px 80px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:40px}
@media (max-width:900px){.page{grid-template-columns:minmax(0,1fr);gap:16px}}
.rail{position:sticky;top:calc(env(safe-area-inset-top,0px) + 16px);align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:14px;line-height:1.45}
@media (max-width:900px){.rail{position:static;max-height:none}}
.rail summary{font:500 12px/1 var(--f-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);cursor:pointer;padding:6px 0}
.rail ul{list-style:none;margin:0;padding-left:0}.rail ul ul{padding-left:12px}
.rail li{margin:4px 0}.rail a{color:var(--muted);text-decoration:none}.rail a:hover{color:var(--accent)}
main{min-width:0;max-width:72ch}
header.doc{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:8px;position:relative}
header.doc .kicker{font:500 13px/1 var(--f-mono);letter-spacing:.04em;color:var(--muted)}
h1,h2,h3,h4{font-family:var(--f-display);font-weight:600;text-wrap:balance;line-height:1.15}
h5,h6{font-family:var(--f-body);font-weight:600}
header.doc h1{font-size:44px;margin:10px 0 8px}
.summary{font-size:18px;color:var(--muted);margin:0 0 14px}
dl.meta{display:flex;flex-wrap:wrap;gap:6px 22px;margin:0;font:13px/1.5 var(--f-mono)}
dl.meta div{display:flex;gap:6px;min-width:0}dl.meta dt{color:var(--muted)}dl.meta dd{margin:0;overflow-wrap:anywhere}
dl.meta a{color:inherit}dl.meta code{background:none;padding:0;font-size:inherit}
dl.meta [data-specsite-basis=source]{flex-basis:100%;color:var(--muted)}
main h1{font-size:34px;margin:40px 0 12px}
main h2{font-size:30px;margin:44px 0 12px;padding-top:14px;border-top:1px solid var(--rule)}
main h3{font-size:23px;margin:30px 0 8px}main h4{font-size:19px;margin:22px 0 6px}
p,li{overflow-wrap:anywhere}
a{color:var(--accent)}
code{font-family:var(--f-mono);font-size:.84em;background:var(--code);padding:1px 4px;border-radius:4px}
a.specsite-ref{text-decoration:none}a.specsite-ref code{background:var(--accent-soft);color:var(--accent)}
a.specsite-ref:hover code{text-decoration:underline}
.specsite-def{scroll-margin-top:16px;font-weight:600;color:var(--ink)}
.specsite-def:target, tr:has(.specsite-def:target){outline:2px solid var(--ring);outline-offset:2px}
blockquote{margin:16px 0;padding:12px 18px;border:2px solid var(--ink);border-radius:14px;background:var(--sheet)}
blockquote p{margin:6px 0}
.scroll{overflow-x:auto;margin:12px 0 18px}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{border:1px solid var(--rule);padding:7px 9px;text-align:left;vertical-align:top}
th{font-weight:600;background:var(--sheet)}
td code{white-space:nowrap}
pre{overflow-x:auto;background:var(--code);padding:14px 16px;border-radius:12px;font:13.5px/1.5 var(--f-mono)}
pre code{background:none;padding:0;font-size:inherit}
pre.mermaid{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:12px;text-align:center;font-family:var(--f-mono)}
hr{border:0;border-top:1px solid var(--rule);margin:28px 0}
img{max-width:100%}
:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.theme{position:absolute;top:0;right:0;font:500 12px/1 var(--f-mono);color:var(--ink);background:var(--paper);border:2px solid var(--ink);border-radius:8px;padding:7px 10px;cursor:pointer;box-shadow:3px 3px 0 var(--ink)}
.theme:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--ink)}
</style>
</head>
<body>
<div class="page">
  <nav class="rail" aria-label="Contents"><details open><summary>Contents</summary>${t.toc}</details></nav>
  <main>
    <header class="doc">
      <button class="theme" type="button" aria-label="Switch colour theme">auto</button>
      ${brand}
      <div class="kicker">{ ${esc(t.kicker)} }</div>
      <h1>${esc(t.title)}</h1>
      ${t.summary ? `<p class="summary">${esc(t.summary)}</p>` : ''}
      ${t.basis}
    </header>
    ${t.body}
  </main>
</div>
<script>
// Fold the contents rail on phones so the text comes first; honour a deep link; cycle the theme.
try { if (matchMedia("(max-width: 900px)").matches) document.querySelector(".rail details").open = false; } catch (e) {}
try { var h = decodeURIComponent(location.hash.slice(1)); var t = h && document.getElementById(h); if (t) setTimeout(function () { t.scrollIntoView(); }, 50); } catch (e) {}
(function () {
  var b = document.querySelector(".theme"), modes = ["auto", "light", "dark"], i = 0;
  b.addEventListener("click", function () {
    i = (i + 1) % 3; b.textContent = modes[i];
    if (i === 0) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", modes[i]);
  });
})();
</script>
</body>
</html>
`;
}
