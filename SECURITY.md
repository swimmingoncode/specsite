# Security policy

specsite runs at build time on documents you choose, and emits static HTML. If you find a security
issue (for example, a way for a document to inject script into the generated pages, or to make specsite
read files outside the configured allowlist), please do not open a public issue.

## Trust assumption

specsite assumes the Markdown it publishes is the repository owner's own. Raw HTML in a document,
including `<script>`, event handlers and `javascript:` links, is published as written, as it would be in
any Markdown site. This is the default because specs often carry deliberate HTML (anchors, `<details>`,
diagrams).

Documents the owner did not write, such as docs contributed in pull requests, or a snapshot shared as an
artifact, should be rendered with sanitising on: `sanitize: true` in the Starlight plugin, `--sanitize`
with `specsite html`. It applies rehype-sanitize with GitHub's allowlist, extended to keep element `id`s
(unprefixed, so anchors keep working), `data-*` attributes, and specsite's own `specsite-*` classes (plus
the classes Starlight puts on headings and asides). Scripts, event handlers, `style` attributes and
`javascript:` URLs are dropped.

The `brand` / `--brand` SVG of `specsite html` is configuration, not document content: it is inlined as
given, never sanitised, and must be trusted. `accent` is checked to be a hex colour wherever it is passed.

## Reporting

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/swimmingoncode/specsite/security/advisories/new)
for this repository. You will get an answer within a week.

This is a placeholder policy for v0.1; supported versions and a disclosure timeline will be set with the
first release.
