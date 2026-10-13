# Contributing to specsite

Thanks for helping. Issues and pull requests are welcome at
[swimmingoncode/specsite](https://github.com/swimmingoncode/specsite).

## Developer Certificate of Origin

Every commit must be signed off under the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO 1.1): by adding a `Signed-off-by` line you certify that you wrote the change, or otherwise have the
right to submit it under the project's licence (MIT).

```sh
git commit -s -m "Explain what changed and why"
```

This adds `Signed-off-by: Your Name <you@example.com>`, using the name and e-mail of your git
configuration. Pull requests with unsigned commits cannot be merged; `git commit --amend -s` or
`git rebase --signoff main` fixes them.

## Working on it

```sh
npm ci            # installs the library and the example site (an npm workspace)
npm test          # unit tests (vitest)
npm run typecheck
npm run example:build   # builds the library, then example/site with it
node bin/specsite.js html example/SPEC.md -o out/spec.html --with example/PLAN.md=plan.html
```

- Dependencies are pinned to exact versions, each at least two weeks old when added.
- The example under `example/` is invented content. Never add a real project's documents to it.
- Behaviour shared by the site and the CLI lives in `src/core/`; keep the two outputs on one pipeline.
