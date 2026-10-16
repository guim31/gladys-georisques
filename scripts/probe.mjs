#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of the real Géorisques API (and of the address service of
// IGN), through the very clients the integration uses. For a machine that has
// the network the development session lacked:
//
//   node scripts/probe.mjs 31555                    what would be published for a commune
//   node scripts/probe.mjs 31555 --address "1 place du Capitole, Toulouse"
//                                                   the same, with the clay exposure
//                                                   and the Seveso sites around the address
//   node scripts/probe.mjs 31555 --raw              the raw answers too, to record as fixtures
//
// Checks on the way what the code assumes and could not verify without the
// network: the page size cap of the decrees, their date format, the meaning of
// the `statutSeveso` filter, the answer of `rga` outside any clay zone, the
// report page link. GET requests only, nothing written anywhere; no key, no
// account. Neither the coordinates nor the address are printed.
// -----------------------------------------------------------------------------

import { communeOfDistrict, isCommuneCode } from '../src/config.js';
import { Geocoder } from '../src/geocoder.js';
import { API_BASE, Georisques, readReport, reportUrl } from '../src/georisques.js';
import { USER_AGENT, getJson } from '../src/http.js';
import { CLAY_LEVELS, FLOOD, floodKey, latestText } from '../src/messages.js';

const args = process.argv.slice(2);
const code = (args[0] ?? '').toUpperCase();
const addressAt = args.indexOf('--address');
const address = addressAt >= 0 ? args[addressAt + 1] : null;
const raw = args.includes('--raw');
if (!isCommuneCode(code)) {
  console.error('Usage: node scripts/probe.mjs <INSEE code> [--address "<address>"] [--raw]');
  process.exit(2);
}

const show = (title, value) => console.log(`${title.padEnd(28)} ${value}`);
const api = (path, params) => getJson(fetch, `${API_BASE}/${path}?${new URLSearchParams(params)}`);
const insee = communeOfDistrict(code);

let position = null;
let city = null;
let label = null;
if (address) {
  const found = await new Geocoder().search(address);
  if (!found) {
    console.error('Address not found by data.geopf.fr/geocodage');
    process.exit(1);
  }
  show('Address service', `type ${found.type}, score ${found.score}, citycode ${found.citycode}`);
  if (communeOfDistrict(found.citycode) !== insee) {
    console.log(`  ! the address is in ${found.citycode}, not in ${code}`);
  }
  position =
    found.type === 'municipality' ? null : { latitude: found.latitude, longitude: found.longitude };
  ({ city, label } = found);
}

console.log(`\nGéorisques for ${insee}${code !== insee ? ` (radon of ${code})` : ''}`);
const client = new Georisques();
const location = { insee, radonInsee: code, city, label, position };
const started = Date.now();
const { parts, errors, name } = await readReport(client, location);
show('Requests, time', `${client.requests}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
show('Commune name', name ?? '-');
for (const { part, error } of errors) {
  show(`  FAILED ${part}`, error.message);
}
show('Radon category', parts.radon?.category ?? 'none');
show('Seismic zone', parts.seismic?.zone ?? 'none');
show('Flood', parts.flood ? FLOOD.en[floodKey(parts.flood)] : '-');
show('Classified sites', JSON.stringify(parts.installations ?? null));
show('Cavities', parts.cavities ?? '-');
show('Ground movements', parts.groundMovements ?? '-');
show('Natural disaster decrees', parts.catnat?.count ?? '-');
show('Latest decree (fr)', parts.catnat ? latestText(parts.catnat.decrees[0], 'fr') : '-');
if (position) {
  show(
    'Clay exposure',
    parts.clay ? `${parts.clay.level} (${CLAY_LEVELS.en[parts.clay.level]})` : 'none',
  );
  show('Seveso within 5 km', parts.sevesoNearby ?? '-');
}

if (Object.keys(parts).length === 0) {
  console.error('\nGéorisques unreachable from this machine: nothing more to check.');
  process.exit(1);
}

console.log('\nAssumptions');
const decrees = await api('gaspar/catnat', { code_insee: insee, page: 1, page_size: 100 });
show(
  'Decrees, page_size=100',
  `${decrees?.data?.length ?? 0} rows of ${decrees?.results}, total_pages ${decrees?.total_pages}`,
);
const sample = decrees?.data?.[0];
if (sample) {
  show('  date format', `${sample.date_debut_evt} / ${sample.date_publication_jo}`);
  show('  label', sample.libelle_risque_jo);
}
for (const tier of ['SEUIL_HAUT', 'SEUIL_BAS', 'NON_SEVESO']) {
  const body = await api('installations_classees', {
    code_insee: insee,
    statutSeveso: tier,
    page: 1,
    page_size: 5,
  });
  const seen = [...new Set((body?.data ?? []).map((row) => row.statutSeveso))];
  show(
    `statutSeveso=${tier}`,
    `${body?.results ?? 0} sites, values seen: ${seen.join(', ') || '-'}`,
  );
}
const radon = await api('radon', { code_insee: code });
show('Radon row', JSON.stringify(radon?.data?.[0] ?? null));
const seismic = await api('zonage_sismique', { code_insee: insee });
show('Seismic row', JSON.stringify(seismic?.data?.[0] ?? null));
// A point in the sea, off Marseille: what `rga` answers outside any zone.
try {
  const sea = await getJson(fetch, `${API_BASE}/rga?latlon=5.300000,43.150000`);
  show('rga in the sea', JSON.stringify(sea));
} catch (err) {
  show('rga in the sea', err.message);
}
if (position) {
  const clay = await api('rga', {
    latlon: `${position.longitude.toFixed(6)},${position.latitude.toFixed(6)}`,
  });
  show('rga at the address', JSON.stringify(clay));
}
const page = reportUrl({ ...location, city: city ?? name });
const response = await fetch(page, { headers: { 'User-Agent': USER_AGENT } });
show('Report page', `HTTP ${response.status} (open it to check it shows the right commune)`);
if (!position) {
  console.log(`  ${page}`);
}

if (raw) {
  console.log('\nRaw answers');
  for (const [path, params] of [
    ['radon', { code_insee: code }],
    ['zonage_sismique', { code_insee: insee }],
    ['gaspar/catnat', { code_insee: insee, page: 1, page_size: 100 }],
    ['gaspar/tri', { code_insee: insee }],
    ['ppr', { code_insee: insee, code_risque: '11' }],
  ]) {
    console.log(`\n### ${path}?${new URLSearchParams(params)}`);
    console.log(JSON.stringify(await api(path, params), null, 2));
  }
}
