// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, POSITIONS } from '../src/config.js';
import { CATNAT_KINDS } from '../src/georisques.js';
import { TRIGGER_KEY, WIDGET_KEY } from '../src/monitor.js';
import { WIDGETS } from '../src/widgets.js';
import { CHEVILLY, createWorld, decreeRow, tick } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('identity: name, image, cover, cloud transport, environment category', () => {
  assert.equal(manifest.name, 'Géorisques');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-georisques:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-georisques/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['environment']);
});

test('the house location is read from Gladys: the manifest declares it', () => {
  assert.equal(manifest.location, true);
});

test('Gladys 5.2.0 at least: widget, scene trigger and the houses source', () => {
  // `source: "houses"` is only accepted from 5.2.0 (store schema, enforced by the indexer).
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 2), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('no scene action: the device states and the trigger cover the use', () => {
  assert.equal(manifest.scene_actions, undefined);
  assert.deepEqual(handlerKeys('sceneAction:'), []);
});

test('the scene trigger the monitor fires is declared, with its filter and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), [TRIGGER_KEY]);
  const trigger = field(manifest.scene_triggers, TRIGGER_KEY);
  assert.deepEqual(optionValues(field(trigger.fields, 'kind')), CATNAT_KINDS);
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.api.communes[CHEVILLY].catnat.push(
    decreeRow('IOMI2627001A', 'Inondations et/ou Coulées de Boue', '02/10/2026', '12/10/2026'),
  );
  await tick(world, 24);
  assert.equal(world.fake.sceneEvents.length, 1);
  const [event] = world.fake.sceneEvents;
  assert.equal(event.key, TRIGGER_KEY);
  assert.deepEqual(
    Object.keys(event.data).sort(),
    [...new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)])].sort(),
    'exactly the declared keys',
  );
  for (const variable of trigger.variables) {
    const value = event.data[variable.key];
    assert.equal(typeof value, variable.type, `${variable.key} is a ${variable.type}`);
  }
  assert.ok(optionValues(field(trigger.fields, 'kind')).includes(event.data.kind));
});

test('every widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'position')), POSITIONS);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the only dynamic select is the house, without options nor default', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.deepEqual(
    dynamic.map((entry) => [entry.key, entry.source]),
    [['house', 'houses']],
  );
  for (const entry of dynamic) {
    assert.equal(entry.options, undefined, entry.key);
    assert.equal(entry.default, undefined, entry.key);
    assert.notEqual(entry.required, true, entry.key);
  }
});

test('no number field (the form has no step), no secret anywhere', () => {
  assert.deepEqual(
    allFields.filter((entry) => entry.type === 'number' || entry.type === 'secret'),
    [],
  );
});

test('actions: no field, so no default to miss (the core applies none)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of manifest.actions) {
    assert.equal(action.fields, undefined, action.key);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the sources section says it is not affiliated with the Ministry', () => {
  const about = field(manifest.config_schema, 'about');
  assert.match(about.description.en, /Not affiliated with the French Ministry/);
  assert.match(about.description.fr, /Non affiliée au ministère/);
});
