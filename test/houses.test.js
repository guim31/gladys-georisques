// -----------------------------------------------------------------------------
// Several houses in Gladys (forum t/11313): with no house chosen, every house
// that has a location is followed, one device per commune, each read once a
// day; the widget shows the house of its setting. A house chosen in the
// configuration, an address or a commune still follow one location only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WIDGET_KEY, loadData } from '../src/monitor.js';
import {
  CHALET,
  CHEVILLY,
  DAY,
  FLAT,
  GARAGE,
  HOUSE,
  PARIS,
  START,
  captureLogs,
  createApi,
  createWorld,
  decreeRow,
  featureId,
  tick,
} from './helpers/world.js';

// getHouses() sorts the houses by name.
const HOUSES = [FLAT, CHALET, GARAGE, HOUSE];

const deviceOf = (world, insee) =>
  world.fake.discoveredDevices.find(
    (device) => device.external_id === `ext:test-integration:commune:${insee}`,
  );

const valueOf = (world, device, key) => world.fake.lastState(featureId(device, key));

const reverseCalls = (world) =>
  world.api.requests.filter((url) => url.pathname.endsWith('/reverse')).length;

async function widget(world, house, language = 'fr') {
  const settings = house === undefined ? {} : { house };
  const ack = await world.fake.widgetGet(WIDGET_KEY, { language, settings });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
}

const heading = (content) => content.components[0].text;
const labels = (content) =>
  content.components.find((component) => component.type === 'status').items.map((i) => i.label);

test('no house chosen: every located house, one device per commune, each with its values', async (t) => {
  const world = await createWorld({ houses: HOUSES });
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Risques de ma commune (Paris)', 'Risques de ma commune (Chevilly-Larue)'],
  );
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  // The chalet has no location: not geocoded, not followed.
  assert.equal(reverseCalls(world), 3);

  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  const paris = deviceOf(world, PARIS);
  const chevilly = deviceOf(world, CHEVILLY);
  assert.equal(valueOf(world, paris, 'catnat_count'), 1);
  assert.equal(valueOf(world, paris, 'installations'), 120);
  assert.equal(valueOf(world, paris, 'flood'), 'PPR inondation et TRI');
  assert.equal(valueOf(world, chevilly, 'catnat_count'), 6);
  assert.equal(valueOf(world, chevilly, 'installations'), 7);
  assert.equal(valueOf(world, chevilly, 'clay'), 3);
});

test('each commune is read once a day, however many houses it has', async (t) => {
  const world = await createWorld({ houses: HOUSES });
  t.after(() => world.app.stop());
  const communesRead = () =>
    world.api.calls('zonage_sismique').map((url) => url.searchParams.get('code_insee'));
  assert.deepEqual(communesRead(), [PARIS, CHEVILLY]);
  // One clay read per commune (the garage and the house share Chevilly-Larue).
  assert.equal(world.api.calls('rga').length, 2);
  for (let hour = 1; hour < 24; hour += 1) {
    await tick(world, 1);
  }
  assert.deepEqual(communesRead(), [PARIS, CHEVILLY], 'nothing more within the day');
  await tick(world, 1);
  assert.deepEqual(communesRead(), [PARIS, CHEVILLY, PARIS, CHEVILLY], 'the daily reads');
});

test('two houses in one commune: one device, positioned at the first of them', async (t) => {
  const world = await createWorld({ houses: [GARAGE, HOUSE] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  const latlon = world.api.calls('rga').map((url) => url.searchParams.get('latlon'));
  assert.deepEqual(latlon, [`${GARAGE.longitude.toFixed(6)},${GARAGE.latitude.toFixed(6)}`]);

  // The garage's widget has its clay; the house's widget shows the commune
  // without the values read at the garage.
  const garage = await widget(world, 'garage');
  assert.equal(heading(garage), 'Chevilly-Larue (94021)');
  assert.ok(labels(garage).includes('Argiles'));
  const house = await widget(world, 'maison');
  assert.equal(heading(house), 'Chevilly-Larue (94021)');
  assert.ok(!labels(house).includes('Argiles'));
  assert.ok(!labels(house).includes('Seveso à moins de 5 km'));
  const link = new URL(house.components.at(-1).link.url);
  assert.equal(link.searchParams.get('typeForm'), 'commune');
});

test('the widget shows the house of its setting, the first one when empty', async (t) => {
  const world = await createWorld({ houses: HOUSES });
  t.after(() => world.app.stop());
  assert.equal(heading(await widget(world, 'maison')), 'Chevilly-Larue (94021)');
  assert.equal(heading(await widget(world, 'appartement')), 'Paris (75056)');
  assert.equal(heading(await widget(world)), 'Paris (75056)');
  assert.equal(heading(await widget(world, '')), 'Paris (75056)');

  const chalet = await widget(world, 'chalet');
  assert.equal(chalet.components.length, 1);
  assert.match(chalet.components[0].text, /La maison « Chalet » n'a pas de position/);
  const gone = await widget(world, 'grenier', 'en');
  assert.match(gone.components[0].text, /no longer exists in Gladys: choose another one/);
});

test('a house chosen in the configuration is still the only one followed', async (t) => {
  const world = await createWorld({ houses: HOUSES, config: { house: 'maison' } });
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.external_id),
    [`ext:test-integration:commune:${CHEVILLY}`],
  );
  assert.equal(reverseCalls(world), 1);
  assert.equal(heading(await widget(world)), 'Chevilly-Larue (94021)');
  assert.equal(heading(await widget(world, 'maison')), 'Chevilly-Larue (94021)');
  const other = await widget(world, 'appartement', 'de');
  assert.match(other.components[0].text, /Dieses Haus wird nicht verfolgt/);
});

test('an address or a commune ignores the houses, and the widget setting says so', async (t) => {
  const world = await createWorld({
    houses: HOUSES,
    config: { position: 'commune', commune: CHEVILLY },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(reverseCalls(world), 0);
  assert.equal(heading(await widget(world)), 'Chevilly-Larue (94021)');
  const flat = await widget(world, 'appartement', 'en');
  assert.match(flat.components[0].text, /This house is not followed/);
});

test('only houses without a location: the configuration says so, as before', async (t) => {
  const world = await createWorld({ houses: [CHALET] });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Indiquez la position de votre maison/);
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.match((await widget(world, 'chalet')).components[0].text, /n'a pas de position/);
});

test('a decree fires the trigger for its own commune', async (t) => {
  const world = await createWorld({ houses: HOUSES, config: { language: 'en' } });
  t.after(() => world.app.stop());
  world.api.communes[PARIS].catnat.push(
    decreeRow(
      'IOMI2627002A',
      'Inondations et/ou Coulées de Boue',
      '02/10/2026',
      '12/10/2026',
      PARIS,
    ),
  );
  await tick(world, 24);
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(world.fake.sceneEvents[0].data.insee, PARIS);
  assert.equal(world.fake.sceneEvents[0].data.commune, 'Paris');
  assert.equal(world.fake.sceneEvents[0].data.count, 2);
});

test('"Read now" and the start line name every commune', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ houses: HOUSES });
  t.after(() => world.app.stop());
  assert.match(
    lines[0].text,
    /Started: communes 75056 \(Paris\), 94021 \(Chevilly-Larue\), Géorisques read once a day/,
  );
  const ack = await world.fake.action('read_now');
  assert.equal(
    ack.data.message.fr,
    "Paris (75056), Chevilly-Larue (94021) : lu à l'instant. Créez ou mettez à jour les appareils dans l'onglet Découverte.",
  );
});

test('a house added or given a location is followed at the next daily read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1);
  world.fake.houses.push({ ...FLAT, name: 'Zénith', selector: 'zenith' });
  await tick(world, 24);
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.external_id),
    [`ext:test-integration:commune:${CHEVILLY}`, `ext:test-integration:commune:${PARIS}`],
  );
});

test('the saved file of 1.0 is carried over: no decree learnt again', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-georisques-'));
  const codes = createApi().communes[CHEVILLY].catnat.map((row) => row.code_national_catnat);
  const v1 = {
    version: 1,
    report: {
      insee: CHEVILLY,
      parts: { radon: { category: 1 } },
      failed: [],
      readAt: START - DAY / 2,
      triedAt: START - DAY / 2,
    },
    decrees: { insee: CHEVILLY, codes },
    city: { [CHEVILLY]: 'Chevilly-Larue' },
  };
  assert.deepEqual(loadData(v1), {
    version: 2,
    reports: { [CHEVILLY]: v1.report },
    decrees: { [CHEVILLY]: codes },
    city: v1.city,
  });
  writeFileSync(join(dataDir, 'georisques.json'), JSON.stringify(v1));
  const api = createApi();
  api.communes[CHEVILLY].catnat.push(
    decreeRow('IOMI2627001A', 'Inondations et/ou Coulées de Boue', '02/10/2026', '12/10/2026'),
  );
  const world = await createWorld({ api, dataDir });
  t.after(() => world.app.stop());
  // The decrees of 1.0 are known: only the new one fires.
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(world.fake.sceneEvents[0].data.kind, 'flood');
});

test('a commune no longer followed is forgotten from the saved file', async () => {
  const world = await createWorld({ houses: HOUSES });
  await world.fake.configUpdated({ house: 'maison' });
  await world.app.stop();
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile(join(world.dataDir, 'georisques.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.reports), [CHEVILLY]);
  // The decrees seen are kept (see the next test), not the reports.
  assert.deepEqual(Object.keys(saved.decrees).sort(), [PARIS, CHEVILLY].sort());
  // Still no position nor address in it.
  assert.doesNotMatch(JSON.stringify(saved), /48\.87|2\.363|Toudic|48\.765/);
});

test('a house missing for a while keeps its decrees: the ones published meanwhile fire', async (t) => {
  const world = await createWorld({ houses: HOUSES, config: { language: 'en' } });
  t.after(() => world.app.stop());
  const flat = world.fake.houses.find((house) => house.selector === 'appartement');
  const { latitude, longitude } = flat;
  Object.assign(flat, { latitude: null, longitude: null });
  await world.fake.configUpdated({ language: 'en' });
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.external_id),
    [`ext:test-integration:commune:${CHEVILLY}`],
  );
  world.api.communes[PARIS].catnat.push(
    decreeRow(
      'IOMI2627002A',
      'Inondations et/ou Coulées de Boue',
      '02/10/2026',
      '12/10/2026',
      PARIS,
    ),
  );
  Object.assign(flat, { latitude, longitude });
  await world.fake.configUpdated({ language: 'en' });
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(world.fake.sceneEvents[0].data.insee, PARIS);
});

test('Géorisques silent for a day: the houses are still geocoded once a day, not every hour', async (t) => {
  const api = createApi();
  api.down.georisques = 503;
  const world = await createWorld({ api, houses: HOUSES });
  t.after(() => world.app.stop());
  assert.equal(reverseCalls(world), 3);
  for (let hour = 1; hour < 24; hour += 1) {
    await tick(world, 1);
  }
  assert.equal(reverseCalls(world), 3, 'hourly retries of Géorisques only');
  assert.ok(world.api.calls('radon').length > 2, 'Géorisques is retried every hour');
  await tick(world, 1);
  assert.equal(reverseCalls(world), 6, 'the daily geocoding');
});

test('the widget of the configured house says why it is not shown', async (t) => {
  const unlocated = await createWorld({ houses: HOUSES, config: { house: 'chalet' } });
  t.after(() => unlocated.app.stop());
  assert.match(
    (await widget(unlocated, 'chalet')).components[0].text,
    /La maison « Chalet » n'a pas de position/,
  );
  const gone = await createWorld({ houses: HOUSES, config: { house: 'grenier' } });
  t.after(() => gone.app.stop());
  assert.match(
    (await widget(gone, 'grenier')).components[0].text,
    /La maison « grenier » n'existe plus dans Gladys : choisissez-en une autre dans la configuration/,
  );
});
