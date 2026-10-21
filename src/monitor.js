// -----------------------------------------------------------------------------
// The monitor: where the home is, what Géorisques says about its commune, the
// states published to Gladys and the "new natural catastrophe decree" trigger.
// Everything the SDK handlers, the action and the widget need goes through it
// (src/app.js wires it).
//
// Locations (configuration `position`):
//   - house    the house chosen in the configuration (its selector), or else
//              EVERY house of Gladys that has a location; the commune of a
//              house comes from the address service of IGN (reverse geocoding).
//              Houses in the same commune share one place (one device, one
//              read): its position, for clay and the Seveso sites within
//              5 km, is the one of the first of them (houses sorted by name);
//   - address  the address typed, geocoded the same way. A commune name alone
//              is found as a commune, without a position;
//   - commune  an INSEE code: no position, so no clay exposure and no
//              "Seveso sites within 5 km".
// One place per commune (`this.places`), the first one being the primary
// place: the one of a single-location setup, of the widget without a house
// setting and of the logs. The positions are kept in memory only, resolved
// again at each daily read.
//
// Scheduling: the device is published with should_poll: false (the core does
// not poll external devices reliably, GladysAssistant/Gladys#3198). A timer
// ticks every hour: once a day per commune (and at the start, and when the
// configuration changes) it reads Géorisques again; a part that failed is asked
// again at the next tick, alone. Every tick publishes the states, only those that changed
// plus a heartbeat every 12 hours. onPoll is only a fallback.
//
// Trigger: a decree whose identifier was not in the previous read of the same
// commune, published in the last 180 days, fires `catnat_decree`. The first
// read of a commune only learns the decrees, and fires nothing.
//
// Logs: at info, only the lifecycle (start, commune change, a new decree, the
// user's "Read now"). A failure that repeats is logged once, then at debug until
// it recovers, with one line at recovery. LOG_LEVEL=debug shows every read.
// The position and the address of the home are never logged.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { communeOfDistrict } from './config.js';
import { FEATURE_KEYS, buildDevice, communeIds, inseeOfId } from './devices.js';
import { Geocoder } from './geocoder.js';
import { Georisques, readReport } from './georisques.js';
import {
  CHECK,
  FLOOD,
  KIND_NAMES,
  PART_NAMES,
  STATUS,
  floodKey,
  formatDay,
  join,
  latestText,
  render,
} from './messages.js';

const logger = createLogger({ name: 'georisques' });

export const WIDGET_KEY = 'risks';
export const TRIGGER_KEY = 'catnat_decree';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_TIMINGS = {
  // The data changes a few times a year: one read a day is plenty.
  readEveryMs: DAY,
  // A failed part, or the address service, is asked again at the next tick.
  retryMs: HOUR,
  tickMs: HOUR,
  heartbeatMs: 12 * HOUR,
  // "Read now" pressed twice within this delay reads once.
  manualMinMs: MINUTE,
  // A decree published longer ago than this fires no trigger (a late import).
  newDecreeMaxAgeMs: 180 * DAY,
  // Events fired by one read at most: a bulk import is not news.
  maxEventsPerRead: 5,
  // Pause between two Géorisques requests, to stay polite.
  requestSpacingMs: 300,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
};

// The parts that need a position (src/georisques.js readReport).
const POSITION_PARTS = ['clay', 'sevesoNearby'];

const dayMs = (day) => (day ? Date.parse(`${day}T00:00:00Z`) : NaN);

const located = (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] fetch, for Géorisques and the geocoder
   * @param {boolean} [options.timers] false: no background timer (tests drive the ticks)
   * @param {Function} [options.now] clock in ms
   * @param {Function} [options.sleep] `(ms) => Promise`
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now, sleep, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.georisques = new Georisques({
      fetch: fetchImpl,
      sleep,
      spacingMs: this.timings.requestSpacingMs,
    });
    this.geocoder = new Geocoder({ fetch: fetchImpl });
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.data = emptyData();
    // One place per followed commune: `{ insee, radonInsee, city, label,
    // position, houses }`, `houses` being the selectors of the houses of Gladys
    // it stands for (the first one gives the position). Empty with `problem`.
    this.places = [];
    // Why a house of Gladys is not followed, by selector (widget setting).
    this.houseProblems = {};
    this.locationKey = null;
    this.problem = null;
    this.lastLocateAt = -Infinity;
    this.lastManualAt = -Infinity;
    this.statusKey = undefined;
    this.tickTimer = null;
    this.running = null;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.stopped = false;
    // Keys of the failures already logged, so a repeated one is not logged again.
    this.failing = new Set();
  }

  /** The primary place: the only one of a single-location setup, or null. */
  get location() {
    return this.places[0] ?? null;
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message, err) {
    const details = err ? [message, err] : [message];
    if (this.failing.has(key)) {
      logger.debug(...details);
      return;
    }
    this.failing.add(key);
    logger[level](...details);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    this.data = loadData(await this.store.load());
    await this.runCycle({ force: true });
    logger.info(`Started: ${this.describePlaces()}, Géorisques read once a day`);
    this.schedule();
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.config = config;
    this.statusKey = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.runCycle();
    await this.publishDiscovered();
    this.requestRefresh();
  }

  async reconfigure(config) {
    const before = this.communes();
    this.config = config;
    this.statusKey = undefined;
    await this.runCycle({ force: true });
    if (this.places.length > 0 && this.communes() !== before) {
      logger.info(`Configuration saved: ${this.describePlaces()}`);
    }
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.tickTimer);
    clearTimeout(this.refreshTimer);
    this.tickTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.runCycle(), this.timings.tickMs);
    this.tickTimer.unref?.();
  }

  save() {
    return this.store.save(this.data);
  }

  // --- Location --------------------------------------------------------------

  configKey() {
    const { position, houseSelector, address, communeCode, communeInvalid } = this.config;
    return JSON.stringify([position, houseSelector, address, communeCode, communeInvalid]);
  }

  /** The INSEE codes followed, as one comparable string. */
  communes() {
    return this.places.map((place) => place.insee).join(',');
  }

  /** "commune 94021 (Chevilly-Larue)", "communes 94021 (…), 75056 (Paris)": no position. */
  describePlaces() {
    if (this.places.length === 0) {
      return 'no location yet';
    }
    const names = this.places.map(
      (place) => `${place.insee}${place.city ? ` (${place.city})` : ''}`,
    );
    return `${names.length > 1 ? 'communes' : 'commune'} ${names.join(', ')}`;
  }

  /**
   * Resolve the configuration into places. The address service failing keeps
   * the previous places of the same configuration.
   */
  async locate() {
    this.lastLocateAt = this.now();
    const key = this.configKey();
    const previous = this.locationKey === key && this.places.length > 0 ? this.places : null;
    let result;
    try {
      result = await this.resolvePlaces();
      this.recovered('geocoder', 'The address service of IGN answers again');
    } catch (err) {
      this.failed('geocoder', 'warn', `Address service unreachable: ${err.message}`);
      result = previous
        ? { places: previous, houseProblems: this.houseProblems }
        : { problem: { key: 'geocoderDown' } };
    }
    const before = this.communes();
    this.places = result.places ?? [];
    this.problem = result.problem ?? null;
    this.houseProblems = result.houseProblems ?? {};
    this.locationKey = key;
    for (const place of this.places) {
      place.city ??= this.data.city[place.insee] ?? null;
    }
    if (this.places.length > 0) {
      this.forgetOtherCommunes();
      if (before !== '' && before !== this.communes()) {
        logger.info(`The home is now in ${this.describePlaces()}`);
      }
    }
  }

  /**
   * What is kept of a commune no longer followed: nothing. Coming back to it
   * later starts again by learning its decrees, like a new commune.
   */
  forgetOtherCommunes() {
    const followed = new Set(this.places.map((place) => place.insee));
    for (const table of [this.data.reports, this.data.decrees, this.data.city]) {
      for (const insee of Object.keys(table)) {
        if (!followed.has(insee)) {
          delete table[insee];
        }
      }
    }
  }

  async resolvePlaces() {
    const { position, address, communeCode, communeInvalid } = this.config;
    if (position === 'commune') {
      if (communeInvalid) {
        return { problem: { key: 'communeInvalid', value: communeInvalid } };
      }
      if (!communeCode) {
        return { problem: { key: 'communeMissing' } };
      }
      const place = {
        insee: communeOfDistrict(communeCode),
        radonInsee: communeCode,
        city: null,
        label: null,
        position: null,
        houses: [],
      };
      return { places: [place] };
    }
    if (position === 'address') {
      if (!address) {
        return { problem: { key: 'addressMissing' } };
      }
      const found = await this.geocoder.search(address);
      if (!found) {
        return { problem: { key: 'addressNotFound' } };
      }
      // A commune typed alone is found at its town hall: not the home.
      const precise = found.type !== 'municipality';
      const place = {
        insee: communeOfDistrict(found.citycode),
        radonInsee: found.citycode,
        city: found.city,
        label: precise ? found.label : null,
        position: precise ? { latitude: found.latitude, longitude: found.longitude } : null,
        houses: [],
      };
      return { places: [place] };
    }
    return this.resolveHouses();
  }

  /**
   * The house chosen in the configuration, or else every house of Gladys
   * that has a location (`getHouses()` sorts them by name): one place per
   * commune, the first house of a commune giving its position.
   */
  async resolveHouses() {
    let houses;
    try {
      houses = await this.gladys.getHouses();
      this.recovered('houses', 'The houses of Gladys can be read again');
    } catch (err) {
      this.failed('houses', 'warn', `Cannot read the houses of Gladys: ${err.message}`);
      return { problem: { key: 'noHouse' } };
    }
    const selector = this.config.houseSelector;
    if (selector) {
      const chosen = houses.find((house) => house.selector === selector);
      if (!chosen) {
        // Only the selector is left of a deleted house: it is the name shown.
        return { problem: { key: 'houseGone', name: selector } };
      }
      if (!located(chosen)) {
        return { problem: { key: 'houseUnlocated', name: chosen.name } };
      }
      houses = [chosen];
    }
    const places = [];
    const houseProblems = {};
    for (const house of houses) {
      if (!located(house)) {
        houseProblems[house.selector] = { key: 'houseUnlocated', name: house.name };
        continue;
      }
      const found = await this.geocoder.reverse(house.latitude, house.longitude);
      if (!found) {
        houseProblems[house.selector] = { key: 'outside' };
        continue;
      }
      const insee = communeOfDistrict(found.citycode);
      const same = places.find((place) => place.insee === insee);
      if (same) {
        same.houses.push(house.selector);
        continue;
      }
      places.push({
        insee,
        radonInsee: found.citycode,
        city: found.city,
        label: found.label,
        position: { latitude: house.latitude, longitude: house.longitude },
        houses: [house.selector],
      });
    }
    if (places.length === 0) {
      const problem = houses.some(located) ? { key: 'outside' } : { key: 'noHouse' };
      return { problem, houseProblems };
    }
    return { places, houseProblems };
  }

  /**
   * The place a widget shows, from its `house` setting: `{ location, problem }`.
   * No house: the primary place. Another house of a shared commune gets the
   * commune without its position: the clay and the Seveso sites within 5 km
   * read at the first house of the commune are not its own.
   */
  placeOf(selector) {
    if (!selector) {
      return { location: this.location, problem: this.problem };
    }
    const place = this.places.find((entry) => entry.houses.includes(selector));
    if (place) {
      const location =
        place.houses[0] === selector ? place : { ...place, label: null, position: null };
      return { location, problem: null };
    }
    if (this.houseProblems[selector]) {
      return { location: null, problem: this.houseProblems[selector] };
    }
    const { position, houseSelector } = this.config;
    if (position === 'house' && !houseSelector) {
      // Every house is followed: a house neither followed nor in trouble is gone.
      return {
        location: null,
        problem: this.places.length > 0 ? { key: 'widgetHouseGone' } : this.problem,
      };
    }
    return { location: null, problem: { key: 'notFollowed' } };
  }

  // --- Discovery and connection status -----------------------------------------

  discoveredDevices() {
    return this.places.map((place) => buildDevice(this.gladys, place, this.config.language));
  }

  async publishDiscovered() {
    const devices = this.discoveredDevices();
    this.discoveredKey = JSON.stringify(devices);
    await this.gladys.publishDiscoveredDevices(devices);
  }

  async updateConnectionStatus() {
    const parts = [];
    if (this.problem) {
      parts.push(render(STATUS, this.problem.key, this.problem));
    } else if (this.failing.has('geocoder')) {
      parts.push(render(STATUS, 'geocoderDown'));
    }
    const failedParts = [
      ...new Set(this.places.flatMap((place) => this.reportOf(place.insee)?.failed ?? [])),
    ];
    if (this.failing.has('georisques')) {
      parts.push(render(STATUS, 'georisquesDown'));
    } else if (failedParts.length > 0) {
      const names = Object.fromEntries(
        Object.entries(PART_NAMES).map(([language, table]) => [
          language,
          failedParts.map((part) => table[part]).join(', '),
        ]),
      );
      parts.push(
        Object.fromEntries(
          Object.keys(STATUS).map((language) => [
            language,
            STATUS[language].partial({ parts: names[language] }),
          ]),
        ),
      );
    }
    const message = parts.length > 0 ? join(...parts) : undefined;
    const connected = this.places.length > 0 && !this.failing.has('georisques');
    const key = JSON.stringify([connected, message]);
    if (key === this.statusKey) {
      return;
    }
    this.statusKey = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  // --- Gladys events -----------------------------------------------------------

  /** The device of a commune in Gladys, or undefined. */
  deviceOf(insee) {
    const id = communeIds(this.gladys, insee).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === id);
  }

  async onDeviceCreated(device) {
    const insee = inseeOfId(this.gladys, device.external_id);
    if (!insee) {
      return;
    }
    if (!this.reportOf(insee)) {
      await this.runCycle();
    }
    // The SDK forgot the states of the device: everything is published again.
    await this.publishStates();
    this.requestRefresh();
  }

  async onDeviceUpdated(device) {
    await this.onDeviceCreated(device);
  }

  async onDeviceDeleted() {
    this.requestRefresh();
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll(device) {
    if (!inseeOfId(this.gladys, device.external_id)) {
      return;
    }
    await this.runCycle();
  }

  /**
   * The "Read now" action: read Géorisques again, resolve the message shown
   * under the button (multi-language).
   */
  async readNow() {
    const now = this.now();
    const force = now - this.lastManualAt >= this.timings.manualMinMs;
    if (force) {
      this.lastManualAt = now;
    }
    await this.runCycle({ force });
    logger.info('Read now: Géorisques read again on request');
    if (this.places.length === 0) {
      const problem = this.problem ?? { key: 'geocoderDown' };
      return render(STATUS, problem.key, problem);
    }
    const reports = this.places.map((place) => this.reportOf(place.insee));
    if (reports.some((report) => !report) || this.failing.has('georisques')) {
      return render(CHECK, 'unavailable');
    }
    const names = this.places.map((place) =>
      place.city ? `${place.city} (${place.insee})` : place.insee,
    );
    if (names.length === 1) {
      return render(CHECK, 'summary', {
        commune: names[0],
        count: reports[0].parts.catnat?.count ?? 0,
      });
    }
    return render(CHECK, 'several', { communes: names.join(', ') });
  }

  // --- Cycles ------------------------------------------------------------------

  /** One tick; concurrent calls share the tick in progress. */
  runCycle({ force = false } = {}) {
    if (this.stopped) {
      return Promise.resolve();
    }
    if (this.running) {
      return force ? this.running.then(() => this.runCycle({ force })) : this.running;
    }
    this.running = this.cycle({ force })
      .then(() => this.recovered('cycle', 'Read cycles work again'))
      .catch((err) => this.failed('cycle', 'error', 'Read cycle failed', err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** The report of the primary place, or null. */
  report() {
    return this.location ? this.reportOf(this.location.insee) : null;
  }

  /** The last report of a commune: `{ insee, parts, failed, readAt, triedAt }`, or null. */
  reportOf(insee) {
    return this.data.reports[insee] ?? null;
  }

  /** Whether a read of a place is due: the daily one, or a retry of the failed parts. */
  readDue(place, now) {
    const report = this.reportOf(place.insee);
    if (
      this.fullReadDue(place, now) &&
      now - (report?.triedAt ?? -Infinity) >= this.timings.retryMs - MINUTE
    ) {
      return true;
    }
    return Boolean(report?.failed.length) && now - report.triedAt >= this.timings.retryMs - MINUTE;
  }

  /** Whether every part of a place is to be read again: once a day, or never read. */
  fullReadDue(place, now) {
    const readAt = this.reportOf(place.insee)?.readAt;
    return !readAt || now - readAt >= this.timings.readEveryMs - MINUTE;
  }

  async cycle({ force = false } = {}) {
    const now = this.now();
    const configChanged = this.locationKey !== this.configKey();
    const fullDue = this.places.some((place) => this.fullReadDue(place, now));
    if (
      force ||
      configChanged ||
      (this.places.length > 0 ? fullDue : now - this.lastLocateAt >= this.timings.retryMs - MINUTE)
    ) {
      await this.locate();
    }
    let changed = false;
    const outcomes = [];
    for (const place of this.places) {
      if (force || configChanged || this.readDue(place, now)) {
        const full = force || configChanged || this.fullReadDue(place, now);
        const outcome = await this.read(place, { full });
        changed ||= outcome.changed;
        outcomes.push(outcome);
      }
    }
    // Géorisques is down when no read of this tick got anything back.
    if (outcomes.length > 0) {
      const down = outcomes.find((outcome) => outcome.down);
      if (down && outcomes.every((outcome) => outcome.down)) {
        this.failed('georisques', 'warn', `Géorisques unreachable: ${down.error.message}`);
      } else {
        this.recovered('georisques', 'Géorisques answers again');
      }
    }
    if (this.discoveredKey !== JSON.stringify(this.discoveredDevices())) {
      await this.publishDiscovered();
    }
    await this.publishStates();
    await this.updateConnectionStatus();
    await this.save();
    if (changed) {
      this.requestRefresh();
    }
  }

  /**
   * Read Géorisques for one place: every part (`full`), or only the ones that
   * failed last time. Resolves `{ changed, down, error }`: whether a value
   * changed, whether nothing came back at all, and the first error.
   */
  async read(place, { full }) {
    const now = this.now();
    let report = this.reportOf(place.insee);
    if (!report) {
      report = { insee: place.insee, parts: {}, failed: [], readAt: null, triedAt: null };
      this.data.reports[place.insee] = report;
      full = true;
    }
    if (!place.position) {
      // Values of a former position (clay, Seveso nearby) do not apply any more.
      for (const part of POSITION_PARTS) {
        delete report.parts[part];
      }
    }
    const before = JSON.stringify(report.parts);
    const { parts, errors, name } = await readReport(
      this.georisques,
      place,
      full ? null : report.failed,
    );
    report.triedAt = now;
    Object.assign(report.parts, parts);
    report.failed = errors.map(({ part }) => part);
    if (full && Object.keys(parts).length > 0) {
      report.readAt = now;
    }
    for (const { part, error } of errors) {
      logger.debug(`Géorisques ${part} unavailable: ${error.message}`);
    }
    if (name && !place.city) {
      place.city = name;
    }
    if (place.city) {
      this.data.city[place.insee] = place.city;
    }
    if (parts.catnat) {
      await this.noteDecrees(place, parts.catnat.decrees);
    }
    logger.debug(
      `Géorisques read for ${place.insee}: ${Object.keys(parts).length} part(s), ${errors.length} failed`,
    );
    return {
      changed: JSON.stringify(report.parts) !== before,
      down: errors.length > 0 && Object.keys(parts).length === 0,
      error: errors[0]?.error ?? null,
    };
  }

  /** Fire the trigger for the decrees not seen in the previous read of the commune. */
  async noteDecrees(location, decrees) {
    const codes = decrees.map((decree) => decree.code);
    const known = this.data.decrees[location.insee] ?? null;
    this.data.decrees[location.insee] = codes;
    if (!known) {
      return;
    }
    const seen = new Set(known);
    const now = this.now();
    const fresh = decrees.filter((decree) => {
      const published = dayMs(decree.published ?? decree.decree);
      return (
        !seen.has(decree.code) &&
        Number.isFinite(published) &&
        now - published <= this.timings.newDecreeMaxAgeMs
      );
    });
    for (const decree of fresh.slice(0, this.timings.maxEventsPerRead)) {
      logger.info(
        `New natural catastrophe decree for ${location.city ?? location.insee}: ${decree.label} (${decree.start ?? '?'})`,
      );
      await this.gladys
        .publishSceneEvent(TRIGGER_KEY, this.eventOf(location, decree, decrees.length))
        .catch((err) => logger.warn(`${TRIGGER_KEY} event refused: ${err.message}`));
    }
  }

  eventOf(location, decree, count) {
    const language = this.config.language;
    return {
      kind: decree.kind,
      kind_name: KIND_NAMES[language][decree.kind],
      label: decree.label || KIND_NAMES.fr[decree.kind],
      event_start: formatDay(decree.start, language) || null,
      event_end: formatDay(decree.end, language) || null,
      published: formatDay(decree.published ?? decree.decree, language) || null,
      commune: location.city ?? location.insee,
      insee: location.insee,
      count,
    };
  }

  // --- States ------------------------------------------------------------------

  /** The states of the devices of the places, for those that exist in Gladys. */
  statesOf() {
    return this.places.flatMap((place) => this.statesOfPlace(place));
  }

  statesOfPlace(place) {
    const device = this.deviceOf(place.insee);
    const report = this.reportOf(place.insee);
    if (!device || !report) {
      return [];
    }
    const has = new Set((device.features ?? []).map((feature) => feature.external_id));
    const ids = communeIds(this.gladys, place.insee);
    const language = this.config.language;
    const { parts } = report;
    const states = [];
    const number = (key, value) => {
      if (Number.isFinite(value) && has.has(ids[key])) {
        states.push({ device_feature_external_id: ids[key], state: value });
      }
    };
    const text = (key, value) => {
      if (typeof value === 'string' && value !== '' && has.has(ids[key])) {
        states.push({ device_feature_external_id: ids[key], text: value });
      }
    };
    if (place.position) {
      number(FEATURE_KEYS.CLAY, parts.clay?.level);
      number(FEATURE_KEYS.SEVESO_NEARBY, parts.sevesoNearby);
    }
    number(FEATURE_KEYS.RADON, parts.radon?.category);
    number(FEATURE_KEYS.SEISMIC, parts.seismic?.zone);
    if (parts.flood) {
      text(FEATURE_KEYS.FLOOD, FLOOD[language][floodKey(parts.flood)]);
    }
    number(FEATURE_KEYS.INSTALLATIONS, parts.installations?.total);
    number(FEATURE_KEYS.SEVESO, parts.installations?.seveso);
    number(FEATURE_KEYS.CAVITIES, parts.cavities);
    number(FEATURE_KEYS.GROUND_MOVEMENTS, parts.groundMovements);
    if (parts.catnat) {
      number(FEATURE_KEYS.CATNAT_COUNT, parts.catnat.count);
      text(FEATURE_KEYS.CATNAT_LATEST, latestText(parts.catnat.decrees[0], language));
    }
    return states;
  }

  async publishStates() {
    const states = this.statesOf();
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      // Sent again at the next tick (the SDK forgets what Gladys refused).
      this.failed('publish', 'warn', `Publishing the states failed: ${err.message}`);
    }
  }

  // --- Widget -------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }
}

function emptyData() {
  return {
    version: 2,
    // The last report of each followed commune, by INSEE code:
    // `{ insee, parts, failed, readAt, triedAt }`.
    reports: {},
    // The decrees already seen, by INSEE code: their codes.
    decrees: {},
    // The name of each followed commune, by INSEE code.
    city: {},
  };
}

/**
 * The saved file. Version 1 (one commune: `report`, `decrees: { insee, codes }`)
 * is carried over, so an update neither reads again at once nor forgets the
 * decrees already seen.
 */
export function loadData(saved) {
  const data = emptyData();
  if (saved?.version === 2) {
    for (const key of ['reports', 'decrees', 'city']) {
      if (isObject(saved[key])) {
        data[key] = saved[key];
      }
    }
  } else if (saved?.version === 1) {
    if (isObject(saved.report) && saved.report.insee) {
      data.reports[saved.report.insee] = saved.report;
    }
    if (saved.decrees?.insee && Array.isArray(saved.decrees.codes)) {
      data.decrees[saved.decrees.insee] = saved.decrees.codes;
    }
    if (isObject(saved.city)) {
      data.city = saved.city;
    }
  }
  return data;
}
