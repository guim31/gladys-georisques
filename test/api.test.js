// -----------------------------------------------------------------------------
// The clients of Géorisques and of the address service, on the answers of
// test/fixtures: parsing, pagination, empty answers, errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communeOfDistrict, isCommuneCode, normalizeConfig } from '../src/config.js';
import { Geocoder, parseFeature } from '../src/geocoder.js';
import {
  Georisques,
  countOf,
  kindOf,
  latlonOf,
  parseCatnat,
  parseClay,
  parseDate,
  parseRadon,
  parseSeismic,
  readReport,
  reportUrl,
} from '../src/georisques.js';
import { HttpError, USER_AGENT } from '../src/http.js';
import { CHEVILLY, HOUSE, createApi, envelope, fixture } from './helpers/world.js';

const client = (api) => new Georisques({ fetch: api.fetch, spacingMs: 0 });

test('radon, seismic zone and clay exposure are read from their answers', () => {
  assert.deepEqual(parseRadon(fixture('georisques/radon-94021.synthetic.json')), { category: 1 });
  assert.equal(parseRadon(fixture('georisques/empty.synthetic.json')), null);
  assert.deepEqual(parseSeismic(fixture('georisques/zonage_sismique-94021.synthetic.json')), {
    zone: 1,
  });
  assert.deepEqual(parseSeismic(envelope([{ zone_sismicite: '4 - MOYENNE' }])), { zone: 4 });
  assert.deepEqual(parseClay(fixture('georisques/rga-forte.synthetic.json')), { level: 3 });
  assert.deepEqual(parseClay({ exposition: 'Exposition moyenne' }), { level: 2 });
  assert.deepEqual(parseClay({ exposition: 'Exposition a priori nulle', codeExposition: '0' }), {
    level: 0,
  });
  assert.equal(parseClay(null), null);
  assert.equal(parseClay({}), null);
  assert.equal(parseRadon(envelope([{ classe_potentiel: '7' }])), null);
});

test('a count is the `results` of the envelope, else the rows it holds', () => {
  assert.equal(countOf(envelope([{}], { results: 42 })), 42);
  assert.equal(countOf({ data: [{}, {}] }), 2);
  assert.equal(countOf(null), 0);
});

test('dates of the API come as "dd/mm/yyyy" or ISO', () => {
  assert.equal(parseDate('13/03/2024'), '2024-03-13');
  assert.equal(parseDate('2024-03-13T00:00:00'), '2024-03-13');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
});

test('the kind of a decree comes from its label in the Journal officiel', () => {
  assert.equal(kindOf('Inondations et/ou Coulées de Boue'), 'flood');
  assert.equal(kindOf('Inondations par remontées de nappe phréatique'), 'flood');
  assert.equal(kindOf('Chocs Mécaniques liés à l’action des Vagues'), 'flood');
  assert.equal(kindOf('Sécheresse'), 'drought');
  assert.equal(
    kindOf(
      'Mouvements de terrain différentiels consécutifs à la sécheresse et à la réhydratation des sols',
    ),
    'drought',
  );
  assert.equal(kindOf('Mouvements de Terrain'), 'ground_movement');
  assert.equal(kindOf('Effondrement et/ou Affaissement'), 'ground_movement');
  assert.equal(kindOf('Séisme'), 'earthquake');
  assert.equal(kindOf('Vents Cycloniques'), 'storm');
  assert.equal(kindOf('Tempête'), 'storm');
  assert.equal(kindOf('Avalanche'), 'avalanche');
  assert.equal(kindOf('Poids de la Neige'), 'other');
  // The 1999 storm decree names the flood first.
  assert.equal(kindOf('Inondations, coulées de boue et mouvements de terrain'), 'flood');
});

test('the decrees are sorted newest first, by publication date', () => {
  const decrees = parseCatnat(fixture('georisques/catnat-94021.synthetic.json').data);
  assert.equal(decrees.length, 6);
  assert.deepEqual(decrees[0], {
    code: 'IOMI2309672A',
    label: 'Sécheresse',
    kind: 'drought',
    start: '2022-07-01',
    end: '2022-09-30',
    decree: '2023-05-03',
    published: '2023-05-05',
  });
  assert.equal(decrees.at(-1).code, 'INTE8300012A');
  // Duplicated rows count once; a row without identifier keeps a stable code.
  const rows = fixture('georisques/catnat-94021.synthetic.json').data;
  const twice = parseCatnat([...rows, rows[0], { ...rows[1], code_national_catnat: null }]);
  assert.equal(twice.length, 7);
  assert.match(
    twice.find((d) => d.code.includes('|')).code,
    /^Mouvements de terrain.*\|1989-05-01\|1991-03-13$/,
  );
});

test('every page of decrees is read, the server capping the page size', async () => {
  const api = createApi();
  api.maxPageSize = 4;
  const result = await client(api).catnat(CHEVILLY);
  assert.equal(result.count, 6);
  assert.equal(result.decrees.length, 6);
  assert.equal(result.name, 'Chevilly-Larue');
  assert.equal(api.calls('gaspar/catnat').length, 2);
});

test('a full report asks each service once, the position ones only with a position', async () => {
  const api = createApi();
  const location = {
    insee: CHEVILLY,
    radonInsee: CHEVILLY,
    position: { latitude: HOUSE.latitude, longitude: HOUSE.longitude },
  };
  const { parts, errors, name } = await readReport(client(api), location);
  assert.deepEqual(errors, []);
  assert.equal(name, 'Chevilly-Larue');
  assert.deepEqual(parts.radon, { category: 1 });
  assert.deepEqual(parts.seismic, { zone: 1 });
  assert.deepEqual(parts.clay, { level: 3 });
  assert.deepEqual(parts.flood, { ppri: true, tri: false });
  assert.deepEqual(parts.installations, { total: 7, seveso: 1, sevesoHigh: 0 });
  assert.equal(parts.sevesoNearby, 2);
  assert.equal(parts.cavities, 3);
  assert.equal(parts.groundMovements, 1);
  assert.equal(parts.catnat.count, 6);
  const rga = api.calls('rga')[0];
  assert.equal(rga.searchParams.get('latlon'), '2.364375,48.770639');
  const nearby = api
    .calls('installations_classees')
    .filter((url) => url.searchParams.has('latlon'));
  assert.deepEqual(
    nearby.map((url) => [url.searchParams.get('rayon'), url.searchParams.get('statutSeveso')]),
    [
      ['5000', 'SEUIL_HAUT'],
      ['5000', 'SEUIL_BAS'],
    ],
  );

  const commune = createApi();
  const withoutPosition = await readReport(client(commune), { insee: CHEVILLY, position: null });
  assert.equal(withoutPosition.parts.clay, undefined);
  assert.equal(withoutPosition.parts.sevesoNearby, undefined);
  assert.equal(commune.calls('rga').length, 0);
});

test('one failing service leaves its part out, the others still come back', async () => {
  const api = createApi();
  api.downPaths.add('radon');
  api.downPaths.add('mvt');
  const { parts, errors } = await readReport(client(api), { insee: CHEVILLY, position: null });
  assert.deepEqual(
    errors.map((error) => [error.part, error.error.message]),
    [
      ['radon', 'www.georisques.gouv.fr: HTTP 503'],
      ['groundMovements', 'www.georisques.gouv.fr: HTTP 503'],
    ],
  );
  assert.equal(parts.radon, undefined);
  assert.deepEqual(parts.seismic, { zone: 1 });

  // `only`: the parts that failed, nothing else.
  api.downPaths.clear();
  api.requests.length = 0;
  const again = await readReport(client(api), { insee: CHEVILLY, position: null }, [
    'radon',
    'groundMovements',
  ]);
  assert.deepEqual(Object.keys(again.parts).sort(), ['groundMovements', 'radon']);
  assert.equal(api.requests.length, 2);
});

test('a 404 is "no data", a network failure an error naming the host only', async () => {
  const api = createApi();
  api.clay = null;
  assert.equal(await client(api).clay({ latitude: 48.77, longitude: 2.36 }), null);
  api.down.georisques = 'network';
  await assert.rejects(client(api).radon(CHEVILLY), (err) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.message, 'www.georisques.gouv.fr: fetch failed');
    return true;
  });
});

test('requests name the integration and wait between them', async () => {
  const seen = [];
  const sleeps = [];
  const georisques = new Georisques({
    fetch: async (url, init) => {
      seen.push(init.headers['User-Agent']);
      return { status: 200, text: async () => JSON.stringify(envelope([])) };
    },
    sleep: async (ms) => sleeps.push(ms),
    spacingMs: 300,
  });
  await georisques.radon(CHEVILLY);
  await georisques.seismic(CHEVILLY);
  assert.deepEqual(seen, [USER_AGENT, USER_AGENT]);
  assert.deepEqual(sleeps, [300]);
});

test('the address service: a house position, an address, nothing found', async () => {
  assert.deepEqual(parseFeature(fixture('geocoder/reverse-chevilly-larue.json')), {
    label: '4 Rue du Lieutenant Alain le Coz 94550 Chevilly-Larue',
    citycode: '94021',
    city: 'Chevilly-Larue',
    type: 'housenumber',
    score: 0.9999997696809948,
    latitude: 48.770639,
    longitude: 2.364375,
  });
  assert.equal(parseFeature(fixture('geocoder/reverse-no-results.json')), null);
  const api = createApi();
  const geocoder = new Geocoder({ fetch: api.fetch });
  const paris = await geocoder.search('13 rue Yves Toudic 75010 Paris');
  assert.equal(paris.citycode, '75110');
  assert.equal(paris.type, 'housenumber');
  assert.equal(await geocoder.search('oozpuip'), null);
  const montpellier = await geocoder.search('Montpellier');
  assert.equal(montpellier.type, 'municipality');
  const reverse = await geocoder.reverse(HOUSE.latitude, HOUSE.longitude);
  assert.equal(reverse.citycode, CHEVILLY);
  const asked = api.requests.at(-1);
  assert.equal(asked.host, 'data.geopf.fr');
  assert.equal(asked.pathname, '/geocodage/reverse');
  assert.equal(asked.searchParams.get('index'), 'address');
});

test('an arrondissement of Paris, Lyon or Marseille belongs to its commune', () => {
  assert.equal(communeOfDistrict('75110'), '75056');
  assert.equal(communeOfDistrict('75101'), '75056');
  assert.equal(communeOfDistrict('75120'), '75056');
  assert.equal(communeOfDistrict('69382'), '69123');
  assert.equal(communeOfDistrict('13208'), '13055');
  assert.equal(communeOfDistrict('13216'), '13055');
  assert.equal(communeOfDistrict('75121'), '75121');
  assert.equal(communeOfDistrict('94021'), '94021');
  assert.equal(communeOfDistrict('2a004'), '2A004');
});

test('the configuration: an INSEE code, Corsica included, never a postcode by mistake', () => {
  assert.ok(isCommuneCode('31555'));
  assert.ok(isCommuneCode('2A004'));
  assert.ok(isCommuneCode('2b033'));
  assert.ok(!isCommuneCode('3155'));
  assert.ok(!isCommuneCode('Toulouse'));
  assert.deepEqual(normalizeConfig({ position: 'commune', commune: ' 2a004 ' }), {
    position: 'commune',
    houseSelector: null,
    address: '',
    communeCode: '2A004',
    communeInvalid: null,
    language: 'fr',
  });
  const bad = normalizeConfig({ position: 'nowhere', commune: 'Toulouse', language: 'it' });
  assert.equal(bad.position, 'house');
  assert.equal(bad.communeCode, null);
  assert.equal(bad.communeInvalid, 'Toulouse');
  assert.equal(bad.language, 'fr');
  assert.equal(normalizeConfig(null).position, 'house');
  assert.equal(normalizeConfig({ house: ' maison ' }).houseSelector, 'maison');
});

test('the report page: of the address with a position, of the commune otherwise', () => {
  const position = { latitude: 48.770639, longitude: 2.364375 };
  assert.equal(latlonOf(position), '2.364375,48.770639');
  const address = new URL(
    reportUrl({ insee: CHEVILLY, city: 'Chevilly-Larue', label: '4 Rue X', position }),
  );
  assert.equal(address.host, 'www.georisques.gouv.fr');
  assert.equal(address.searchParams.get('typeForm'), 'adresse');
  assert.equal(address.searchParams.get('codeInsee'), CHEVILLY);
  assert.equal(address.searchParams.get('lat'), '48.770639');
  const commune = new URL(reportUrl({ insee: '31555', city: 'Toulouse', position: null }));
  assert.equal(commune.searchParams.get('typeForm'), 'commune');
  assert.equal(commune.searchParams.has('lat'), false);
});
