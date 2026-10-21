// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Géorisques and a fake
// address service (Géoplateforme) serving the answers of test/fixtures, a
// manual clock, a temporary /data, and the integration wired on top through
// registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export const START = Date.parse('2026-10-15T08:00:00Z');
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

// A house in Chevilly-Larue, at the public position of the address of the
// recorded reverse geocoding answer.
export const HOUSE = {
  id: 'house-1',
  name: 'Maison',
  selector: 'maison',
  latitude: 48.770639,
  longitude: 2.364375,
};

// More houses (sorted by name, as getHouses() gives them): a flat in Paris
// 10e at the public position of the recorded search answer, a chalet without
// a location, a garage in Chevilly-Larue too, a little south of the house.
export const FLAT = {
  id: 'house-2',
  name: 'Appartement',
  selector: 'appartement',
  latitude: 48.870131,
  longitude: 2.363473,
};
export const CHALET = {
  id: 'house-3',
  name: 'Chalet',
  selector: 'chalet',
  latitude: null,
  longitude: null,
};
export const GARAGE = {
  id: 'house-4',
  name: 'Garage',
  selector: 'garage',
  latitude: 48.765,
  longitude: 2.36,
};

export const CHEVILLY = '94021';
export const PARIS = '75056';
export const PARIS_10 = '75110';

/** The paginated envelope of the Géorisques services. */
export function envelope(rows, { results = rows.length, page = 1, totalPages = 1 } = {}) {
  return {
    results,
    page,
    total_pages: totalPages,
    data: rows,
    response_code: 200,
    message: '',
    next: null,
    previous: null,
  };
}

/** A decree row, in the shape of the recorded ones. */
export function decreeRow(code, label, start, published, insee = CHEVILLY) {
  return {
    code_national_catnat: code,
    code_insee: insee,
    libelle_commune: insee === CHEVILLY ? 'Chevilly-Larue' : 'Paris',
    libelle_risque_jo: label,
    date_debut_evt: start,
    date_fin_evt: start,
    date_publication_arrete: published,
    date_publication_jo: published,
  };
}

/**
 * Fake Géorisques and address service. `api.down.georisques` /
 * `api.down.geocoder`: 'network' (connection refused), a status (503) or
 * false; `api.downPaths`: Géorisques paths failing alone ('radon', 'mvt'…).
 */
export function createApi() {
  const chevillyRadon = fixture('georisques/radon-94021.synthetic.json');
  const chevillySeismic = fixture('georisques/zonage_sismique-94021.synthetic.json');
  const empty = fixture('georisques/empty.synthetic.json');
  const paris10Radon = envelope([
    { code_insee: PARIS_10, libelle_commune: 'Paris 10e Arrondissement', classe_potentiel: '1' },
  ]);
  const api = {
    communes: {
      [CHEVILLY]: {
        radon: chevillyRadon,
        seismic: chevillySeismic,
        catnat: fixture('georisques/catnat-94021.synthetic.json').data,
        ppr: 1,
        tri: 0,
        installations: 7,
        sevesoHigh: 0,
        sevesoLow: 1,
        cavities: 3,
        mvt: 1,
      },
      [PARIS]: {
        // Paris has its radon potential by arrondissement only.
        radon: empty,
        seismic: envelope([
          {
            code_insee: PARIS,
            libelle_commune: 'Paris',
            code_zone: '1',
            zone_sismicite: '1 - TRES FAIBLE',
          },
        ]),
        catnat: [
          decreeRow(
            'INTE9900627A',
            'Inondations, coulées de boue et mouvements de terrain',
            '25/12/1999',
            '30/12/1999',
            PARIS,
          ),
        ],
        ppr: 1,
        tri: 1,
        installations: 120,
        sevesoHigh: 0,
        sevesoLow: 0,
        cavities: 450,
        mvt: 12,
      },
      [PARIS_10]: { radon: paris10Radon },
    },
    clay: fixture('georisques/rga-forte.synthetic.json'),
    nearby: { high: 1, low: 1 },
    reverse: fixture('geocoder/reverse-chevilly-larue.json'),
    // Reverse answers by "lat,lon" (6 decimals); any other point gets `reverse`.
    reverseAt: {
      [`${FLAT.latitude.toFixed(6)},${FLAT.longitude.toFixed(6)}`]: fixture(
        'geocoder/search-paris-10.json',
      ),
    },
    // The page size Géorisques caps at (unknown for real: small enough to page).
    maxPageSize: 4,
    down: { georisques: false, geocoder: false },
    downPaths: new Set(),
    requests: [],

    count(results, pageSize) {
      const rows = Array.from({ length: Math.min(results, pageSize) }, () => ({}));
      return envelope(rows, { results, totalPages: Math.ceil(results / pageSize) || 1 });
    },

    georisques(url) {
      const path = url.pathname.replace(/^\/api\/v1\//, '');
      const params = url.searchParams;
      if (api.downPaths.has(path)) {
        return { status: 503 };
      }
      const commune = api.communes[params.get('code_insee')];
      const pageSize = Math.min(Number(params.get('page_size') ?? 10), api.maxPageSize);
      const page = Number(params.get('page') ?? 1);
      const tier = params.get('statutSeveso');
      switch (path) {
        case 'radon':
          return commune?.radon ?? empty;
        case 'zonage_sismique':
          return commune?.seismic ?? empty;
        case 'rga':
          return api.clay === null ? { status: 404 } : api.clay;
        case 'gaspar/catnat': {
          const rows = commune?.catnat ?? [];
          return envelope(rows.slice((page - 1) * pageSize, page * pageSize), {
            results: rows.length,
            page,
            totalPages: Math.ceil(rows.length / pageSize) || 1,
          });
        }
        case 'ppr':
          return api.count(params.get('code_risque') === '11' ? (commune?.ppr ?? 0) : 0, pageSize);
        case 'gaspar/tri':
          return api.count(commune?.tri ?? 0, pageSize);
        case 'installations_classees': {
          if (params.has('latlon')) {
            const value =
              tier === 'SEUIL_HAUT' ? api.nearby.high : tier === 'SEUIL_BAS' ? api.nearby.low : 0;
            return api.count(value, pageSize);
          }
          const value =
            tier === 'SEUIL_HAUT'
              ? commune?.sevesoHigh
              : tier === 'SEUIL_BAS'
                ? commune?.sevesoLow
                : tier
                  ? 0 // the real API answers 0 for any other code (1, 2…)
                  : commune?.installations;
          return api.count(value ?? 0, pageSize);
        }
        case 'cavites':
          return api.count(commune?.cavities ?? 0, pageSize);
        case 'mvt':
          return api.count(commune?.mvt ?? 0, pageSize);
        default:
          return { status: 404 };
      }
    },

    geocoder(url) {
      if (url.pathname.endsWith('/reverse')) {
        const point = `${url.searchParams.get('lat')},${url.searchParams.get('lon')}`;
        return api.reverseAt[point] ?? api.reverse;
      }
      const query = url.searchParams.get('q') ?? '';
      if (/toudic/i.test(query)) {
        return fixture('geocoder/search-paris-10.json');
      }
      if (/montpellier/i.test(query)) {
        return fixture('geocoder/search-montpellier.json');
      }
      return fixture('geocoder/search-no-results.json');
    },

    async fetch(input) {
      const url = new URL(input);
      api.requests.push(url);
      const service = url.host === 'data.geopf.fr' ? 'geocoder' : 'georisques';
      const down = api.down[service];
      if (down === 'network') {
        throw new TypeError('fetch failed');
      }
      if (down) {
        return { status: down, text: async () => 'Service Unavailable' };
      }
      const body = service === 'geocoder' ? api.geocoder(url) : api.georisques(url);
      if (body?.status && !body.data && !body.features) {
        return { status: body.status, text: async () => 'Error' };
      }
      return { status: 200, text: async () => JSON.stringify(body) };
    },

    /** The Géorisques requests to one path. */
    calls(path) {
      return api.requests.filter((url) => url.pathname === `/api/v1/${path}`);
    },
  };
  return api;
}

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    async sleep(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array} [options.houses] houses of Gladys
 * @param {object} [options.api] from createApi
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] true: the monitor's own timer runs (mock it)
 */
export async function createWorld({
  config = {},
  devices = [],
  houses = [HOUSE],
  api = createApi(),
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-georisques-')),
  timings = { requestSpacingMs: 0 },
} = {}) {
  const gladys = createFakeGladys({ config, devices, houses });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: api.fetch,
    timers,
    now: clock.now,
    sleep: clock.sleep,
    timings,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, api, clock, store, dataDir };
}

/** The device of the last discovery list. */
export const discovered = (world) => world.fake.discoveredDevices[0];

/** Create the discovered device in Gladys, as the user would. */
export async function create(world) {
  const device = discovered(world);
  if (!device) {
    throw new Error('no discovered device');
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** The last published value of one feature of a device. */
export const lastValue = (world, device, key) => world.fake.lastState(featureId(device, key));

/** Run one tick of the monitor, `hours` later. */
export async function tick(world, hours = 1) {
  world.clock.advance(hours * HOUR);
  await world.monitor.runCycle();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
