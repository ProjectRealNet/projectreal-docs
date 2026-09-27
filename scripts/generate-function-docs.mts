import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorySummary, functionExamples, typeDefinitions } from '../../real-website/web-astro/src/data/executor-docs-extra';

type ApiArgument = { name: string; type: string; optional: boolean; description: string };
type ApiReturn = { name: string; type: string; description: string };
type ApiFunction = {
  category: string;
  group: string;
  name: string;
  aliases: string[];
  description: string;
  arguments: ApiArgument[];
  returns: ApiReturn[];
};

type LocalizedFunction = {
  description?: string;
  arguments?: Record<string, string>;
  returns?: Record<string, string>;
  exampleDescription?: string;
};

type LocalizedDocs = {
  categories?: Record<string, string>;
  functions?: Record<string, LocalizedFunction>;
  types?: Record<string, { description?: string; fields?: Record<string, string> }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const websiteRoot = resolve(repoRoot, '..', 'real-website', 'web-astro');
const api = JSON.parse(await readFile(join(websiteRoot, 'src/data/executor-api.json'), 'utf8')) as {
  categories: string[];
  functions: ApiFunction[];
};
const localized = JSON.parse(await readFile(join(websiteRoot, 'src/data/executor-api-i18n.json'), 'utf8')) as Record<string, LocalizedDocs>;

const locales = [
  ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
  ['ar', 'العربية'], ['id', 'Bahasa Indonesia'], ['ja', '日本語'], ['ko', '한국어'],
  ['pl', 'Polski'], ['pt-BR', 'Português (Brasil)'], ['ru', 'Русский'],
  ['th', 'ไทย'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'], ['zh-CN', '简体中文'],
] as const;

const nativeMintlifyLocales = new Set(locales.map(([code]) => code).filter((code) => code !== 'th'));
const messages: Record<string, Record<string, string>> = {};

for (const [locale] of locales) {
  messages[locale] = JSON.parse(await readFile(join(websiteRoot, `messages/${locale}.json`), 'utf8'));
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/::/g, '-').replace(/[:.]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function tr(locale: string, key: string, fallback: string): string {
  return messages[locale]?.[key] || messages.en?.[key] || fallback;
}

function mdxText(value: string): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

function tableText(value: string): string {
  return mdxText(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function yaml(value: string): string {
  return JSON.stringify(String(value ?? '').replace(/\r?\n/g, ' '));
}

function signature(fn: ApiFunction): string {
  const args = fn.arguments.map((arg) => `${arg.name}${arg.optional ? '?' : ''}: ${arg.type}`).join(', ');
  const returns = fn.returns.length ? `: ${fn.returns.map((ret) => ret.type).join(' | ')}` : '';
  return `${fn.name}(${args})${returns}`;
}

function localizedFunction(locale: string, fn: ApiFunction): LocalizedFunction {
  return localized[locale]?.functions?.[fn.name] ?? {};
}

function relatedTypes(fn: ApiFunction): Array<[string, any]> {
  return Object.entries(typeDefinitions).filter(([name]) =>
    fn.arguments.some((arg) => arg.type.includes(name)) || fn.returns.some((ret) => ret.type.includes(name)),
  );
}

async function output(path: string, content: string): Promise<void> {
  const absolute = join(repoRoot, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${content.trim()}\n`, 'utf8');
}

const functions = [...api.functions].sort((a, b) => a.name.localeCompare(b.name));
const categories = api.categories.filter((category) => functions.some((fn) => fn.category === category));

for (const [locale, languageName] of locales) {
  const localeDocs = localized[locale] ?? {};
  const categoryCards = categories.map((category) => {
    const title = localeDocs.categories?.[category] ? category : category;
    return `<Card title=${JSON.stringify(title)} icon="brackets-curly" href="./reference/${slug(category)}">\n${mdxText(localeDocs.categories?.[category] ?? categorySummary[category] ?? `${category} functions.`)}\n</Card>`;
  }).join('\n');

  await output(`${locale}/index.mdx`, `
---
title: ${yaml(tr(locale, 'docs_intro', 'Function reference'))}
description: ${yaml(tr(locale, 'docs_intro_desc', 'Reference documentation for every function supported by Real.'))}
icon: "book-open"
---

# ${mdxText(tr(locale, 'docs_available_functions', 'Available functions'))}

${mdxText(tr(locale, 'docs_intro_desc', 'Browse every function supported by Real. Each page includes its signature, arguments, return values, aliases, related types, and a working example.'))}

<CardGroup cols={2}>
${categoryCards}
</CardGroup>

<Info>
${mdxText(languageName)} · ${functions.length} ${mdxText(tr(locale, 'docs_functions_count', 'functions'))} · ${categories.length} ${mdxText(tr(locale, 'docs_category_label', 'categories'))}
</Info>
`);

  for (const category of categories) {
    const categoryFunctions = functions.filter((fn) => fn.category === category);
    const rows = categoryFunctions.map((fn) => {
      const details = localizedFunction(locale, fn);
      return `| [\`${tableText(fn.name)}\`](./${slug(fn.name)}) | ${tableText(details.description ?? fn.description)} |`;
    }).join('\n');

    await output(`${locale}/reference/${slug(category)}/index.mdx`, `
---
title: ${yaml(category)}
description: ${yaml(localeDocs.categories?.[category] ?? categorySummary[category] ?? `${category} functions supported by Real.`)}
icon: "folder-code"
---

${mdxText(localeDocs.categories?.[category] ?? categorySummary[category] ?? `${category} functions supported by Real.`)}

| ${mdxText(tr(locale, 'docs_function_nav_label', 'Function'))} | ${mdxText(tr(locale, 'docs_description', 'Description'))} |
| --- | --- |
${rows}
`);

    for (const fn of categoryFunctions) {
      const details = localizedFunction(locale, fn);
      const description = details.description ?? fn.description;
      const args = fn.arguments.length ? `
## ${mdxText(tr(locale, 'docs_arguments', 'Arguments'))}

| ${mdxText(tr(locale, 'docs_name', 'Name'))} | ${mdxText(tr(locale, 'docs_type', 'Type'))} | ${mdxText(tr(locale, 'docs_required', 'Required'))} | ${mdxText(tr(locale, 'docs_description', 'Description'))} |
| --- | --- | --- | --- |
${fn.arguments.map((arg) => `| \`${tableText(arg.name)}\` | \`${tableText(arg.type)}\` | ${arg.optional ? 'No' : 'Yes'} | ${tableText(details.arguments?.[arg.name] ?? arg.description)} |`).join('\n')}
` : '';
      const returns = fn.returns.length ? `
## ${mdxText(tr(locale, 'docs_returns', 'Returns'))}

| ${mdxText(tr(locale, 'docs_name', 'Name'))} | ${mdxText(tr(locale, 'docs_type', 'Type'))} | ${mdxText(tr(locale, 'docs_description', 'Description'))} |
| --- | --- | --- |
${fn.returns.map((ret) => `| \`${tableText(ret.name)}\` | \`${tableText(ret.type)}\` | ${tableText(details.returns?.[ret.name] ?? ret.description)} |`).join('\n')}
` : '';
      const aliases = fn.aliases.length ? `
## ${mdxText(tr(locale, 'docs_aliases', 'Aliases'))}

${fn.aliases.map((alias) => `- \`${tableText(alias)}\``).join('\n')}
` : '';
      const types = relatedTypes(fn);
      const typeSections = types.length ? `
## ${mdxText(tr(locale, 'docs_types', 'Types'))}

${types.map(([name, definition]) => {
  const translated = localeDocs.types?.[name];
  const fields = definition.fields.map((field: any) => `| \`${tableText(field.name)}\` | \`${tableText(field.type)}\` | ${field.optional ? 'No' : 'Yes'} | ${tableText(translated?.fields?.[field.name] ?? field.description)} |`).join('\n');
  return `### ${mdxText(name)}\n\n${mdxText(translated?.description ?? definition.description)}\n\n| ${mdxText(tr(locale, 'docs_name', 'Name'))} | ${mdxText(tr(locale, 'docs_type', 'Type'))} | ${mdxText(tr(locale, 'docs_required', 'Required'))} | ${mdxText(tr(locale, 'docs_description', 'Description'))} |\n| --- | --- | --- | --- |\n${fields}`;
}).join('\n\n')}
` : '';
      const example = (functionExamples as Record<string, { description: string; code: string }>)[fn.name];
      const exampleSection = example ? `
## ${mdxText(tr(locale, 'docs_example', 'Example'))}

${mdxText(details.exampleDescription ?? example.description)}

\`\`\`lua
${example.code}
\`\`\`
` : '';

      await output(`${locale}/reference/${slug(category)}/${slug(fn.name)}.mdx`, `
---
title: ${yaml(fn.name)}
sidebarTitle: ${yaml(fn.name)}
description: ${yaml(description)}
icon: "function"
keywords: ${JSON.stringify([fn.name, category, ...fn.aliases])}
---

${mdxText(description)}

## ${mdxText(tr(locale, 'docs_syntax', 'Syntax'))}

\`\`\`lua
${signature(fn)}
\`\`\`
${aliases}${args}${returns}${typeSections}${exampleSection}
`);
    }
  }
}

const languageNavigation = locales.filter(([code]) => nativeMintlifyLocales.has(code)).map(([locale]) => ({
  language: locale,
  groups: [
    { group: 'Overview', pages: [`${locale}/index`] },
    ...categories.map((category) => ({
      group: category,
      expanded: false,
      pages: [
        `${locale}/reference/${slug(category)}/index`,
        ...functions.filter((fn) => fn.category === category).map((fn) => `${locale}/reference/${slug(category)}/${slug(fn.name)}`),
      ],
    })),
  ],
}));

const config = {
  $schema: 'https://mintlify.com/docs.json',
  theme: 'willow',
  name: 'Real Function Reference',
  description: 'Complete multilingual function reference for Real.',
  colors: { primary: '#737373', light: '#171717', dark: '#f5f5f5' },
  favicon: '/favicon.png',
  logo: { light: '/logo/dark.svg', dark: '/logo/light.svg' },
  navigation: {
    languages: languageNavigation,
    global: {
      anchors: [
        { anchor: 'ไทย', href: '/th/index', icon: 'language' },
        { anchor: 'Guides', href: 'https://projectreal.gg/en/docs/guides', icon: 'book-open' },
        { anchor: 'Troubleshooting', href: 'https://projectreal.gg/en/docs/troubleshooting', icon: 'screwdriver-wrench' },
        { anchor: 'Release notes', href: 'https://projectreal.gg/en/docs/releases', icon: 'clock-rotate-left' },
      ],
    },
  },
  navbar: {
    links: [
      { label: 'Website', href: 'https://projectreal.gg' },
      { label: 'Status', href: 'https://status.projectreal.gg' },
      { label: 'Support', href: 'https://discord.gg/projectreal' },
    ],
    primary: { type: 'button', label: 'Download Real', href: 'https://projectreal.gg/en/download' },
  },
  contextual: { options: ['copy', 'view', 'chatgpt', 'claude', 'perplexity', 'mcp', 'cursor', 'vscode'] },
  footer: { socials: { github: 'https://github.com/ProjectRealNet', discord: 'https://discord.gg/projectreal' } },
  seo: { metatags: { canonical: 'https://docs.projectreal.gg' } },
};

await writeFile(join(repoRoot, 'docs.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
await rm(join(repoRoot, 'index.mdx'), { force: true });
await rm(join(repoRoot, 'quickstart.mdx'), { force: true });

const generated = locales.length * (functions.length + categories.length + 1);
console.log(`Generated ${generated} localized MDX pages for ${functions.length} functions in ${locales.length} languages.`);
