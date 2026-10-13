// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pablo Dorado
//
// The Starlight plugin (configured in astro.config) hands its resolved options to the content loader
// (declared in content.config.ts). Both run in the same Node process during `astro build` / `astro dev`.

import type { ResolvedOptions } from './core/project.js';

const KEY = Symbol.for('specsite.options');

export function setShared(r: ResolvedOptions): void {
	(globalThis as Record<symbol, unknown>)[KEY] = r;
}

export function getShared(): ResolvedOptions | undefined {
	return (globalThis as Record<symbol, unknown>)[KEY] as ResolvedOptions | undefined;
}
