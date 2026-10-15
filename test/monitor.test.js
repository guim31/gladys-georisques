// -----------------------------------------------------------------------------
// The monitor end to end, on the SDK's fake Gladys and the fake services of
// test/helpers/world.js: location, daily reads on its own timer, states,
// heartbeat, the decree trigger, the connection status and "Read now".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEVILLY,
  HOUR,
  HOUSE,
  PARIS,
  START,
  create,
  createApi,
  createWorld,
  decreeRow,
  discovered,
  featureId,
  lastValue,
  tick,
} from './helpers/world.js';

const georisquesCalls = (world) =>
  world.api.requests.filter((url) => url.host === 'www.georisques.gouv.fr').length;

const NEW_DECREE = [
  'IOMI2627001A',
  'Inondations et/ou Coulées de Boue',
  '02/10/2026',
  '12/10/2026',
];

test('the house: one device for its commune, every value once created', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = discovered(world);
  assert.equal(device.name, 'Risques de ma commune (Chevilly-Larue)');
  assert.equal(device.external_id, `ext:test-integration:commune:${CHEVILLY}`);
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'INSEE_CODE', value: CHEVILLY },
    { name: 'COMMUNE', value: 'Chevilly-Larue' },
  ]);
  // Nothing is published before the device exists in Gladys.
  assert.equal(world.fake.states.length, 0);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });

  await create(world);
  const values = Object.fromEntries(
    world.fake.states.map((s) => [
      s.device_feature_external_id.split(':').pop(),
      s.state ?? s.text,
    ]),
  );
  assert.deepEqual(values, {
    clay: 3,
    seveso_nearby: 2,
    radon: 1,
    seismic: 1,
    flood: 'Plan de prévention inondation',
    installations: 7,
    seveso: 1,
    cavities: 3,
    ground_movements: 1,
    catnat_count: 6,
    catnat_latest: 'Sécheresse, 01/07/2022',
  });
  assert.ok(world.fake.widgetRefreshes.includes('risks'));
});

test('the states refresh on the integration timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: START });
  const world = await createWorld({
    timers: true,
    clock: { now: () => Date.now(), sleep: async () => {} },
  });
  t.after(() => world.app.stop());
  const device = await create(world);
  const poll = t.mock.method(world.app.monitor, 'poll');
  assert.equal(lastValue(world, device, 'radon'), 1);

  world.api.communes[CHEVILLY].radon.data[0].classe_potentiel = '2';
  world.api.communes[CHEVILLY].catnat.push(decreeRow(...NEW_DECREE));
  for (let hour = 0; hour < 24; hour += 1) {
    t.mock.timers.tick(HOUR);
    await world.monitor.running;
  }
  assert.equal(poll.mock.callCount(), 0, 'onPoll was never needed');
  assert.equal(lastValue(world, device, 'radon'), 2);
  assert.equal(lastValue(world, device, 'catnat_count'), 7);
  assert.equal(
    lastValue(world, device, 'catnat_latest'),
    'Inondations et/ou Coulées de Boue, 02/10/2026',
  );
  assert.equal(world.fake.sceneEvents.length, 1);
});

test('Géorisques is read once a day, not at every hourly tick', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await create(world);
  const first = georisquesCalls(world);
  assert.equal(first, 14, 'one read: 14 Géorisques requests (2 pages of decrees)');
  for (let hour = 1; hour < 24; hour += 1) {
    await tick(world, 1);
  }
  assert.equal(georisquesCalls(world), first, 'nothing more within the day');
  assert.equal(world.api.requests.filter((url) => url.host === 'data.geopf.fr').length, 1);
  await tick(world, 1);
  assert.equal(georisquesCalls(world), 2 * first, 'the daily read');
});

test('a part that failed is asked again at the next tick, alone', async (t) => {
  const api = createApi();
  api.downPaths.add('radon');
  const world = await createWorld({ api });
  t.after(() => world.app.stop());
  const device = await create(world);
  assert.equal(world.fake.lastState(featureId(device, 'radon')), undefined);
  assert.equal(lastValue(world, device, 'seismic'), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.match(world.fake.connectionStatus.message.fr, /Géorisques n'a pas répondu pour : radon/);

  const before = georisquesCalls(world);
  api.downPaths.clear();
  await tick(world, 1);
  assert.equal(georisquesCalls(world) - before, 1, 'only radon');
  assert.equal(lastValue(world, device, 'radon'), 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('Géorisques down: one status, tried again every hour, values back with it', async (t) => {
  const api = createApi();
  api.down.georisques = 503;
  const world = await createWorld({ api });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /Géorisques does not answer/);
  const device = await create(world);
  assert.equal(world.fake.states.length, 0);
  const tries = georisquesCalls(world);
  await tick(world, 0.5);
  assert.equal(georisquesCalls(world), tries, 'not before an hour');
  api.down.georisques = false;
  await tick(world, 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(lastValue(world, device, 'catnat_count'), 6);
});

test('the heartbeat sends the unchanged values again every 12 hours', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const world = await createWorld({ clock: { now: () => Date.now(), sleep: async () => {} } });
  t.after(() => world.app.stop());
  const device = await create(world);
  const radonId = featureId(device, 'radon');
  const sent = () => world.fake.states.filter((s) => s.device_feature_external_id === radonId);
  assert.equal(sent().length, 1);
  for (let hour = 0; hour < 11; hour += 1) {
    t.mock.timers.tick(HOUR);
    await world.monitor.runCycle();
  }
  assert.equal(sent().length, 1, 'unchanged: not sent again within 12 hours');
  t.mock.timers.tick(2 * HOUR);
  await world.monitor.runCycle();
  assert.equal(sent().length, 2, 'heartbeat');
});

test('a device created after the read gets every value, and the widget a nudge', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await tick(world, 3);
  const refreshes = world.fake.widgetRefreshes.length;
  await create(world);
  assert.equal(world.fake.states.length, 11);
  assert.equal(world.fake.widgetRefreshes.length, refreshes + 1);
});

test('onPoll, if Gladys polls anyway, publishes without reading again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await create(world);
  const before = georisquesCalls(world);
  const ack = await world.fake.poll(device);
  assert.equal(ack.success, true);
  assert.equal(georisquesCalls(world), before);
});

test('a new decree fires the trigger once, with its kind and dates', async (t) => {
  const world = await createWorld({ config: { language: 'en' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, 'the first read only learns the decrees');
  world.api.communes[CHEVILLY].catnat.push(decreeRow(...NEW_DECREE));
  await tick(world, 24);
  await tick(world, 24);
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: 'catnat_decree',
      data: {
        kind: 'flood',
        kind_name: 'Flood',
        label: 'Inondations et/ou Coulées de Boue',
        event_start: '02/10/2026',
        event_end: '02/10/2026',
        published: '12/10/2026',
        commune: 'Chevilly-Larue',
        insee: CHEVILLY,
        count: 7,
      },
    },
  ]);
});

test('an old decree appearing late, or a bulk import, is not news', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const catnat = world.api.communes[CHEVILLY].catnat;
  catnat.push(decreeRow('INTE1900001A', 'Sécheresse', '01/07/2018', '15/06/2019'));
  for (let i = 0; i < 8; i += 1) {
    catnat.push(decreeRow(`IOMI26270${10 + i}A`, 'Tempête', '01/10/2026', '10/10/2026'));
  }
  await tick(world, 24);
  assert.equal(world.fake.sceneEvents.length, 5, 'five events at most per read');
  assert.ok(world.fake.sceneEvents.every((event) => event.data.kind === 'storm'));
});

test('a decree published while the integration was stopped fires at the restart', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const api = createApi();
  api.communes[CHEVILLY].catnat.push(decreeRow(...NEW_DECREE));
  const world = await createWorld({ api, dataDir: first.dataDir });
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 1);
  assert.equal(world.fake.sceneEvents[0].data.kind, 'flood');
});

test('an address in Paris: the commune 75056, the radon of its arrondissement', async (t) => {
  const world = await createWorld({
    config: { position: 'address', address: '13 rue Yves Toudic 75010 Paris' },
  });
  t.after(() => world.app.stop());
  const device = await create(world);
  assert.equal(device.external_id, `ext:test-integration:commune:${PARIS}`);
  assert.equal(device.name, 'Risques de ma commune (Paris)');
  assert.equal(lastValue(world, device, 'radon'), 1);
  assert.equal(lastValue(world, device, 'flood'), 'PPR inondation et TRI');
  assert.equal(world.api.calls('radon')[0].searchParams.get('code_insee'), '75110');
  assert.equal(world.api.calls('gaspar/catnat')[0].searchParams.get('code_insee'), PARIS);
  assert.ok(featureId(device, 'clay'), 'a precise address has a position');
});

test('a commune typed alone, or an INSEE code: no position, no clay feature', async (t) => {
  for (const config of [
    { position: 'address', address: 'Montpellier' },
    { position: 'commune', commune: CHEVILLY },
  ]) {
    const world = await createWorld({ config });
    t.after(() => world.app.stop());
    const device = discovered(world);
    assert.equal(featureId(device, 'clay'), undefined);
    assert.equal(featureId(device, 'seveso_nearby'), undefined);
    assert.equal(world.api.calls('rga').length, 0);
  }
  const world = await createWorld({ config: { position: 'commune', commune: CHEVILLY } });
  t.after(() => world.app.stop());
  // The name comes from the Géorisques answers.
  assert.equal(discovered(world).name, 'Risques de ma commune (Chevilly-Larue)');
  assert.equal(world.api.requests.filter((url) => url.host === 'data.geopf.fr').length, 0);
});

test('the configuration screen says what is missing', async (t) => {
  const cases = [
    [{ config: {}, houses: [] }, /Indiquez la position de votre maison/],
    [
      { config: { house: 'maison' }, houses: [{ ...HOUSE, latitude: null, longitude: null }] },
      /La maison « Maison » n'a pas de position/,
    ],
    [{ config: { house: 'chalet' } }, /La maison « chalet » n'existe plus/],
    [{ config: { position: 'address' } }, /Tapez l'adresse/],
    [{ config: { position: 'address', address: 'oozpuip' } }, /Adresse introuvable/],
    [{ config: { position: 'commune' } }, /Tapez le code INSEE/],
    [
      { config: { position: 'commune', commune: '31000 Toulouse' } },
      /« 31000 Toulouse » n'est pas/,
    ],
  ];
  for (const [options, message] of cases) {
    const world = await createWorld(options);
    t.after(() => world.app.stop());
    assert.equal(world.fake.connectionStatus.connected, false, String(message));
    assert.match(world.fake.connectionStatus.message.fr, message);
    assert.deepEqual(world.fake.discoveredDevices, []);
  }
  const api = createApi();
  api.reverse = { type: 'FeatureCollection', features: [] };
  const sea = await createWorld({ api });
  t.after(() => sea.app.stop());
  assert.match(sea.fake.connectionStatus.message.en, /No commune at the location of the house/);
});

test('the address service down: tried again within the hour', async (t) => {
  const api = createApi();
  api.down.geocoder = 'network';
  const world = await createWorld({ api });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /address service of IGN does not answer/);
  api.down.geocoder = false;
  await tick(world, 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.fake.discoveredDevices.length, 1);
});

test('a new configuration reads the new commune at once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await create(world);
  await world.fake.configUpdated({ position: 'commune', commune: '75056' });
  assert.equal(discovered(world).external_id, `ext:test-integration:commune:${PARIS}`);
  assert.equal(world.fake.sceneEvents.length, 0, 'a new commune learns its decrees first');
  // Paris has no radon potential at the commune level: no value, not a stale one.
  assert.equal(world.monitor.report().parts.radon, null);
});

test('"Read now" reads again and says what was found', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = georisquesCalls(world);
  const ack = await world.fake.action('read_now');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /^Chevilly-Larue \(94021\) : lu à l'instant\. 6 arrêté/);
  assert.ok(georisquesCalls(world) > before);
  // Pressed again at once: no second read.
  const again = georisquesCalls(world);
  await world.fake.action('read_now');
  assert.equal(georisquesCalls(world), again);

  world.api.down.georisques = 503;
  world.clock.advance(2 * 60 * 1000);
  const down = await world.fake.action('read_now');
  assert.match(down.data.message.en, /Géorisques does not answer/);
});

test('"Read now" without a location says what is missing', async (t) => {
  const world = await createWorld({ config: { position: 'commune' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('read_now');
  assert.match(ack.data.message.de, /Gib den INSEE-Code deiner Gemeinde ein/);
});

test('the saved file holds no position and no address', async () => {
  const world = await createWorld({
    config: { position: 'address', address: '13 rue Yves Toudic 75010 Paris' },
  });
  await world.app.stop();
  const { readFile } = await import('node:fs/promises');
  const saved = await readFile(`${world.dataDir}/georisques.json`, 'utf8');
  assert.doesNotMatch(saved, /Toudic|48\.87|2\.363/);
  assert.match(saved, /75056/);
});
