// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the documentation. German says "du", never the
// polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import {
  CATNAT,
  CHECK,
  CLAY_LEVELS,
  FLOOD,
  KIND_NAMES,
  PART_NAMES,
  RADON_CATEGORIES,
  SEISMIC_ZONES,
  STATUS,
} from '../src/messages.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

// Renders a function entry with plausible long parameters.
const SAMPLE = {
  kind: 'Inondations et/ou Coulées de Boue',
  date: '29/09/2026',
  value: 'Toulouse centre',
  parts: 'radon, zone sismique, installations classées',
  commune: 'Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson (51517)',
  count: 120,
  communes: 'Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson (51517), Chevilly-Larue (94021)',
  name: 'Résidence secondaire du bord du lac',
};
const renderSample = (value) => (typeof value === 'function' ? value(SAMPLE) : value);

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, and the catalog description long enough', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

// A list indexed by level (index 0 unused for radon and seismic zones) as a table.
const listTable = (lists) =>
  Object.fromEntries(
    Object.entries(lists).map(([lang, list]) => [
      lang,
      Object.fromEntries(
        list.map((text, index) => [index, text]).filter(([, text]) => text !== null),
      ),
    ]),
  );

test('every message table of the code has the four languages', () => {
  const found = [
    ...tableProblems(listTable(CLAY_LEVELS), 'CLAY_LEVELS', MAX.short),
    ...tableProblems(listTable(RADON_CATEGORIES), 'RADON_CATEGORIES', MAX.short - 12),
    ...tableProblems(listTable(SEISMIC_ZONES), 'SEISMIC_ZONES', MAX.short - 8),
    ...tableProblems(FLOOD, 'FLOOD', MAX.short),
    ...tableProblems(KIND_NAMES, 'KIND_NAMES', MAX.short),
    ...tableProblems(CATNAT, 'CATNAT', MAX.short + 20, renderSample),
    ...tableProblems(PART_NAMES, 'PART_NAMES', MAX.short),
    ...tableProblems(STATUS, 'STATUS', MAX.message, renderSample),
    ...tableProblems(CHECK, 'CHECK', MAX.message, renderSample),
  ];
  assert.deepEqual(found, []);
});

test('the radon and seismic levels have their words for every level', () => {
  for (const lang of LANGS) {
    assert.deepEqual(
      RADON_CATEGORIES[lang].map((text) => text === null),
      [true, false, false, false],
    );
    assert.deepEqual(
      SEISMIC_ZONES[lang].map((text) => text === null),
      [true, false, false, false, false, false],
    );
    assert.equal(CLAY_LEVELS[lang].length, 4);
  }
});

test('the widget texts have the four languages and fit their component', () => {
  const longTexts = new Set(['empty', 'waiting', 'widgetHouseGone', 'notFollowed']);
  const found = Object.entries(TEXT).flatMap(([key, value]) =>
    problems(value, `TEXT.${key}`, longTexts.has(key) ? MAX.message : MAX.short - 10),
  );
  assert.deepEqual(found, []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Online', fr: 'En ligne', de: 'Online' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.config_schema[4].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.config_schema[4].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);
const headingLevels = (text) =>
  text
    .split('\n')
    .filter((line) => /^#{1,4} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the documentation exists in the four languages, with the same sections', () => {
  const reference = headingLevels(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'the template sections');
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
    assert.deepEqual(headingLevels(docs[lang]), reference, `docs/${lang}.md sections`);
  }
});

// The prose of a document on one line: Prettier wraps it anywhere, quotes included.
const flat = (text) => text.replace(/\s*\n>?\s*/g, ' ');

test('the documentation says what the integration is not, and German says "du"', () => {
  const flatDocs = Object.fromEntries(LANGS.map((lang) => [lang, flat(docs[lang])]));
  assert.match(flatDocs.en, /not a safety alert system/);
  assert.match(flatDocs.fr, /pas un système d'alerte de sécurité/);
  assert.match(flatDocs.de, /kein Sicherheitswarnsystem/);
  assert.match(flatDocs.es, /no es un sistema de alerta de seguridad/i);
  assert.match(flatDocs.en, /not affiliated with the French Ministry/);
  assert.match(flatDocs.fr, /non affiliée au ministère/i);
  assert.match(flatDocs.de, /nicht mit dem französischen Ministerium für den ökologischen Wandel/i);
  assert.match(flatDocs.es, /sin afiliación con el Ministerio/i);
  // Developed without reaching the live service (see test/fixtures/README.md).
  assert.match(flatDocs.en, /Developed without a live connection to Géorisques: feedback welcome/);
  assert.match(
    docs.fr,
    /Développée sans connexion réelle à Géorisques : vos retours sont bienvenus/,
  );
  assert.match(
    flatDocs.de,
    /Ohne echte Verbindung zu Géorisques entwickelt: Rückmeldungen willkommen/,
  );
  assert.match(
    docs.es,
    /Desarrollada sin conexión real con Géorisques: sus comentarios son bienvenidos/,
  );
  const politeLines = docs.de.split('\n').filter((line) => POLITE_GERMAN.test(line));
  assert.deepEqual(politeLines, []);
});
