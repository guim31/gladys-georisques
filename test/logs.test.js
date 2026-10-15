// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (the start, a commune change, a new decree, "Read now"), never one line per
// read or per tick; a failure that repeats is logged once, plus one line when
// it is over. Never the position nor the address of the home: the
// configuration holds no secret, the location of the home is the sensitive
// data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHEVILLY,
  HOUSE,
  captureLogs,
  create,
  createApi,
  createWorld,
  decreeRow,
  tick,
} from './helpers/world.js';

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');
const ADDRESS = '13 rue Yves Toudic 75010 Paris';

test('the start is one info line', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(lines.map(strip), [
    '[INFO] [georisques] Started: commune 94021 (Chevilly-Larue), Géorisques read once a day',
  ]);
});

test('two normal days of ticks and reads write nothing at info', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await create(world);
  const lines = captureLogs(t, 'info');
  world.api.communes[CHEVILLY].radon.data[0].classe_potentiel = '2';
  for (let hour = 0; hour < 48; hour += 1) {
    await tick(world, 1);
  }
  await world.fake.widgetGet('risks', { language: 'fr' });
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the reads, never the position nor the address', async (t) => {
  const lines = captureLogs(t, 'debug');
  for (const config of [{}, { position: 'address', address: ADDRESS }]) {
    const world = await createWorld({ config });
    t.after(() => world.app.stop());
    await create(world);
    world.api.down.georisques = 'network';
    await tick(world, 24);
    world.api.down.georisques = false;
    world.api.down.geocoder = 503;
    await tick(world, 24);
  }
  assert.ok(
    lines.some((line) => /Géorisques read for 94021: 9 part\(s\), 0 failed/.test(line.text)),
  );
  const all = lines.map((line) => line.text).join('\n');
  for (const secret of [
    String(HOUSE.latitude),
    String(HOUSE.longitude),
    '48.87',
    'Toudic',
    ADDRESS,
  ]) {
    assert.ok(!all.includes(secret), `${secret} is not logged`);
  }
});

test('Géorisques down at every tick: one warning, then one line at recovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t, 'info');
  world.api.down.georisques = 503;
  await tick(world, 24);
  for (let hour = 0; hour < 5; hour += 1) {
    await tick(world, 1);
  }
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[georisques] Géorisques unreachable: www.georisques.gouv.fr: HTTP 503']],
  );
  world.api.down.georisques = false;
  await tick(world, 1);
  assert.deepEqual(lines.slice(1).map(strip), ['[INFO] [georisques] Géorisques answers again']);
});

test('the address service down: one warning, then one line at recovery', async (t) => {
  const api = createApi();
  api.down.geocoder = 'network';
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ api });
  t.after(() => world.app.stop());
  for (let hour = 0; hour < 4; hour += 1) {
    await tick(world, 1);
  }
  const warnings = lines.filter((line) => line.level === 'warn');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].text, /Address service unreachable: data\.geopf\.fr: fetch failed/);
  api.down.geocoder = false;
  await tick(world, 1);
  assert.match(lines.at(-1).text, /\[INFO\].*The address service of IGN answers again/);
});

test('states refused at every tick: one warning, then one line at recovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await create(world);
  const lines = captureLogs(t, 'info');
  world.gladys.forgetPublishedStates();
  const publish = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let hour = 0; hour < 3; hour += 1) {
    await tick(world, 1);
  }
  assert.ok(publish.mock.callCount() >= 3);
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[georisques] Publishing the states failed: Gladys unreachable']],
  );
  publish.mock.restore();
  await tick(world, 1);
  assert.match(lines.at(-1).text, /\[INFO\].*Publishing the states works again/);
});

test('a new decree and "Read now" are one info line each', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t, 'info');
  world.api.communes[CHEVILLY].catnat.push(
    decreeRow('IOMI2627001A', 'Inondations et/ou Coulées de Boue', '02/10/2026', '12/10/2026'),
  );
  await world.fake.action('read_now');
  assert.deepEqual(lines.map(strip), [
    '[INFO] [georisques] New natural catastrophe decree for Chevilly-Larue: Inondations et/ou Coulées de Boue (2026-10-02)',
    '[INFO] [georisques] Read now: Géorisques read again on request',
  ]);
});
