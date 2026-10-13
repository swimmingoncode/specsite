import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { specsiteLoader } from 'specsite/loader';

export const collections = {
	docs: defineCollection({ loader: specsiteLoader(docsLoader()), schema: docsSchema() }),
};
