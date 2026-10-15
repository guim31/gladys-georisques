// -----------------------------------------------------------------------------
// The monitor: where the home is, what Géorisques says about its commune, the
// states published to Gladys and the "new natural catastrophe decree" trigger.
// Everything the SDK handlers, the action and the widget need goes through it
// (src/app.js wires it).
//
// Location (configuration `position`):
//   - house    the house chosen in the configuration (its selector), or else
//              the first house of Gladys that has a location; its commune
//              comes from the address service of IGN (reverse geocoding);
//   - address  the address typed, geocoded the same way. A commune name alone
//              is found as a commune, without a position;
//   - commune  an INSEE code: no position, so no clay exposure and no
//              "Seveso sites within 5 km".
// The position is kept in memory only, resolved again at each daily read.
//
// Scheduling: the device is published with should_poll: false (the core does
// not poll external devices reliably, GladysAssistant/Gladys#3198). A timer
// ticks every hour: once a day (and at the start, and when the configuration
// changes) it reads Géorisques again; a part that failed is asked again at the
// next tick, alone. Every tick publishes the states, only those that changed
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
    // `{ insee, radonInsee, city, label, position }`, or null with `problem`.
    this.location = null;
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
    const saved = await this.store.load();
    if (saved?.version === 1) {
      this.data = { ...emptyData(), ...saved };
    }
    await this.runCycle({ force: true });
    const where = this.location
      ? `commune ${this.location.insee}${this.location.city ? ` (${this.location.city})` : ''}`
      : 'no location yet';
    logger.info(`Started: ${where}, Géorisques read once a day`);
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
    const before = this.location?.insee ?? null;
    this.config = config;
    this.statusKey = undefined;
    await this.runCycle({ force: true });
    if ((this.location?.insee ?? null) !== before && this.location) {
      logger.info(`Configuration saved: commune ${this.location.insee}`);
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

  /**
   * The house of the configuration (its selector, as `getHouses()` gives it),
   * or else the first house of Gladys that has a location. Without one,
   * `problem` says why: `noHouse`, `houseUnlocated` or `houseGone`.
   */
  async findHouse() {
    let houses;
    try {
      houses = await this.gladys.getHouses();
      this.recovered('houses', 'The houses of Gladys can be read again');
    } catch (err) {
      this.failed('houses', 'warn', `Cannot read the houses of Gladys: ${err.message}`);
      return { house: null, problem: { key: 'noHouse' } };
    }
    const located = (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude);
    const selector = this.config.houseSelector;
    if (!selector) {
      const house = houses.find(located) ?? null;
      return { house, problem: house ? null : { key: 'noHouse' } };
    }
    const chosen = houses.find((house) => house.selector === selector);
    if (!chosen) {
      // Only the selector is left of a deleted house: it is the name shown.
      return { house: null, problem: { key: 'houseGone', name: selector } };
    }
    if (!located(chosen)) {
      return { house: null, problem: { key: 'houseUnlocated', name: chosen.name } };
    }
    return { house: chosen, problem: null };
  }

  /**
   * Resolve the configuration into a location. The address service failing
   * keeps the previous location of the same configuration.
   */
  async locate() {
    this.lastLocateAt = this.now();
    const key = this.configKey();
    const previous = this.locationKey === key ? this.location : null;
    let result;
    try {
      result = await this.resolveLocation();
      this.recovered('geocoder', 'The address service of IGN answers again');
    } catch (err) {
      this.failed('geocoder', 'warn', `Address service unreachable: ${err.message}`);
      result = previous ? { location: previous } : { problem: { key: 'geocoderDown' } };
    }
    const before = this.location?.insee ?? null;
    this.location = result.location ?? null;
    this.problem = result.problem ?? null;
    this.locationKey = key;
    if (this.location) {
      this.location.city ??= this.data.city?.[this.location.insee] ?? null;
      if (before !== null && before !== this.location.insee) {
        logger.info(`The home is now in commune ${this.location.insee}`);
      }
    }
  }

  async resolveLocation() {
    const { position, address, communeCode, communeInvalid } = this.config;
    if (position === 'commune') {
      if (communeInvalid) {
        return { problem: { key: 'communeInvalid', value: communeInvalid } };
      }
      if (!communeCode) {
        return { problem: { key: 'communeMissing' } };
      }
      return {
        location: {
          insee: communeOfDistrict(communeCode),
          radonInsee: communeCode,
          city: null,
          label: null,
          position: null,
        },
      };
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
      return {
        location: {
          insee: communeOfDistrict(found.citycode),
          radonInsee: found.citycode,
          city: found.city,
          label: precise ? found.label : null,
          position: precise ? { latitude: found.latitude, longitude: found.longitude } : null,
        },
      };
    }
    const { house, problem } = await this.findHouse();
    if (!house) {
      return { problem };
    }
    const found = await this.geocoder.reverse(house.latitude, house.longitude);
    if (!found) {
      return { problem: { key: 'outside' } };
    }
    return {
      location: {
        insee: communeOfDistrict(found.citycode),
        radonInsee: found.citycode,
        city: found.city,
        label: found.label,
        position: { latitude: house.latitude, longitude: house.longitude },
      },
    };
  }

  // --- Discovery and connection status -----------------------------------------

  discoveredDevices() {
    return this.location ? [buildDevice(this.gladys, this.location, this.config.language)] : [];
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
    const report = this.report();
    const failedParts = report?.failed ?? [];
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
    const connected = Boolean(this.location) && !this.failing.has('georisques');
    const key = JSON.stringify([connected, message]);
    if (key === this.statusKey) {
      return;
    }
    this.statusKey = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  // --- Gladys events -----------------------------------------------------------

  /** The device of the current commune in Gladys, or undefined. */
  device() {
    if (!this.location) {
      return undefined;
    }
    const id = communeIds(this.gladys, this.location.insee).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === id);
  }

  async onDeviceCreated(device) {
    if (!inseeOfId(this.gladys, device.external_id)) {
      return;
    }
    if (!this.report()) {
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
    if (!this.location) {
      const problem = this.problem ?? { key: 'geocoderDown' };
      return render(STATUS, problem.key, problem);
    }
    const report = this.report();
    if (!report || this.failing.has('georisques')) {
      return render(CHECK, 'unavailable');
    }
    const commune = this.location.city
      ? `${this.location.city} (${this.location.insee})`
      : this.location.insee;
    return render(CHECK, 'summary', { commune, count: report.parts.catnat?.count ?? 0 });
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

  /** The report of the current commune, or null. */
  report() {
    const report = this.data.report;
    return report && this.location && report.insee === this.location.insee ? report : null;
  }

  /** Whether a read is due: the daily one, or a retry of the failed parts. */
  readDue(now) {
    const report = this.report();
    if (
      this.fullReadDue(now) &&
      now - (report?.triedAt ?? -Infinity) >= this.timings.retryMs - MINUTE
    ) {
      return true;
    }
    return Boolean(report?.failed.length) && now - report.triedAt >= this.timings.retryMs - MINUTE;
  }

  async cycle({ force = false } = {}) {
    const now = this.now();
    const configChanged = this.locationKey !== this.configKey();
    const fullDue = this.fullReadDue(now);
    if (
      force ||
      configChanged ||
      (this.location ? fullDue : now - this.lastLocateAt >= this.timings.retryMs - MINUTE)
    ) {
      await this.locate();
    }
    let changed = false;
    if (this.location && (force || configChanged || this.readDue(now))) {
      changed = await this.read({ full: force || configChanged || this.fullReadDue(now) });
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

  /** Whether every part is to be read again: once a day, or never read. */
  fullReadDue(now) {
    const readAt = this.report()?.readAt;
    return !readAt || now - readAt >= this.timings.readEveryMs - MINUTE;
  }

  /**
   * Read Géorisques for the current location: every part (`full`), or only
   * the ones that failed last time. Resolves true when a value changed.
   */
  async read({ full }) {
    const location = this.location;
    const now = this.now();
    let report = this.report();
    if (!report) {
      report = { insee: location.insee, parts: {}, failed: [], readAt: null, triedAt: null };
      this.data.report = report;
      full = true;
    }
    if (!location.position) {
      // Values of a former position (clay, Seveso nearby) do not apply any more.
      for (const part of POSITION_PARTS) {
        delete report.parts[part];
      }
    }
    const before = JSON.stringify(report.parts);
    const { parts, errors, name } = await readReport(
      this.georisques,
      location,
      full ? null : report.failed,
    );
    report.triedAt = now;
    Object.assign(report.parts, parts);
    report.failed = errors.map(({ part }) => part);
    if (full && Object.keys(parts).length > 0) {
      report.readAt = now;
    }
    if (errors.length > 0 && Object.keys(parts).length === 0) {
      this.failed('georisques', 'warn', `Géorisques unreachable: ${errors[0].error.message}`);
    } else {
      this.recovered('georisques', 'Géorisques answers again');
    }
    for (const { part, error } of errors) {
      logger.debug(`Géorisques ${part} unavailable: ${error.message}`);
    }
    if (name && !location.city) {
      location.city = name;
    }
    if (location.city) {
      this.data.city = { [location.insee]: location.city };
    }
    if (parts.catnat) {
      await this.noteDecrees(location, parts.catnat.decrees);
    }
    logger.debug(
      `Géorisques read for ${location.insee}: ${Object.keys(parts).length} part(s), ${errors.length} failed`,
    );
    return JSON.stringify(report.parts) !== before;
  }

  /** Fire the trigger for the decrees not seen in the previous read of the commune. */
  async noteDecrees(location, decrees) {
    const codes = decrees.map((decree) => decree.code);
    const known = this.data.decrees?.insee === location.insee ? this.data.decrees.codes : null;
    this.data.decrees = { insee: location.insee, codes };
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

  /** The states of the device of the commune, when it exists in Gladys. */
  statesOf() {
    const device = this.device();
    const report = this.report();
    if (!device || !report) {
      return [];
    }
    const has = new Set((device.features ?? []).map((feature) => feature.external_id));
    const ids = communeIds(this.gladys, this.location.insee);
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
    if (this.location.position) {
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
    version: 1,
    // The last report: `{ insee, parts, failed, readAt, triedAt }`.
    report: null,
    // The decrees already seen: `{ insee, codes }`.
    decrees: null,
    // The name of the commune, by INSEE code (one entry).
    city: {},
  };
}
