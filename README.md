# Géorisques for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings the
**natural and technological risks of your commune** in France into Gladys, from the open
[Géorisques](https://www.georisques.gouv.fr) API of the French Ministry of Ecological
Transition: the "Know the risks near me" report, as a device, a widget and a scene trigger.

> Not affiliated with the French Ministry of Ecological Transition, the BRGM or IGN. For
> information only: not a safety alert system, and not the official risk statement required for
> a sale or a rental.
>
> **Developed without a live connection to Géorisques: feedback welcome.** The API could not be
> reached from the development environment; see [Limitations](#limitations).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Features

- One device, **"Risks in my commune"**, for the commune of your home:
  - **clay shrink-swell** exposure at the home (none, low, medium, high);
  - **radon potential** of the commune (category 1 to 3);
  - **seismic zone** (1 to 5);
  - **flooding**: flood prevention plan (PPRI), territory at high flood risk (TRI), both or
    neither;
  - **classified industrial sites** (ICPE) of the commune, its **Seveso sites**, and the Seveso
    sites **within 5 km** of the home;
  - **underground cavities** and **ground movements** recorded;
  - **natural disaster decrees** (CatNat) since 1982, and the latest one with its kind and date.
- A scene trigger, **"New natural disaster decree"**, filtered by kind (flood, drought, ground
  movement, earthquake, storm, avalanche, other) — the one event of this data that really moves,
  and the one that matters for the home insurance.
- A dashboard widget summing the risks up in colours, with a link to the Géorisques report of
  the address.
- A **Read now** button in the configuration, to check which commune is found.
- The home is a **house of Gladys** (its location), an **address**, or a commune by its **INSEE
  code**. With no house chosen, **every house of Gladys that has a location** is followed: one
  device per commune, and a widget setting to pick the house shown. Feature names and texts in English, French, German or Spanish (French by default).

## Requirements

- Gladys Assistant **5.2.0** or later (the `houses` select of the configuration).
- Internet access from Gladys to `www.georisques.gouv.fr` and `data.geopf.fr` (address service
  of IGN). No account, no key.
- A home in France.

## Installation

In Gladys: **Integrations → Install from GitHub**, then paste
`https://github.com/guim31/gladys-georisques`. Open the integration's configuration, choose where
your home is (your house in Gladys by default), save, then create the device in the **Discover**
tab. Add the **Géorisques** widget to a dashboard if you like.

## How it works

- **Géorisques API v1** (`www.georisques.gouv.fr/api/v1`), open without a token: `radon`,
  `zonage_sismique`, `rga` (clay, at a point), `gaspar/catnat` (every page), `ppr` (flood plans,
  `code_risque=11`, not repealed), `gaspar/tri`, `installations_classees` (all, then
  `statutSeveso=1` and `2`, in the commune and within 5 km), `cavites`, `mvt`. Counts cost one
  request each (`page_size=1`, the `results` of the envelope). About 14 requests a day per
  commune followed, 0.3 s apart.
- **Géoplateforme geocoding** (`data.geopf.fr/geocodage`, successor of the Adresse API): reverse
  geocoding of the house location, or search of the address typed, to get the INSEE code. The
  arrondissements of Paris, Lyon and Marseille are filed under their commune (Géorisques does
  so), except for radon, published by arrondissement.
- **Its own timer**: the device is published with `should_poll: false` (the core does not poll
  external devices reliably, GladysAssistant/Gladys#3198). A tick every hour publishes the
  changed states (plus a heartbeat every 12 hours); Géorisques is read once a day, at startup and
  when the configuration is saved; a part that failed is asked again at the next tick, alone.
  `onPoll` stays as a fallback.
- **Trigger**: a decree not seen in the previous read of the same commune, published within the
  last 180 days, fires `catnat_decree` (five per read at most). The first read of a commune
  learns the decrees without firing.
- **Persistence**: `/data/georisques.json` holds the last report and the decree identifiers
  already seen. Never the position or the address of the home, which stay in memory and out of
  the logs.

## Limitations

- **Developed without a live connection to Géorisques.** The session that wrote the code could
  not reach the API (network policy). The response formats come from the official OpenAPI
  description of the API (version 1.8.2a), the geocoding answers are real recorded ones. Still
  to confirm on the live service, with [`scripts/probe.mjs`](scripts/probe.mjs): the date format
  of the decrees ("dd/mm/yyyy" assumed, ISO accepted too), the page size the API caps
  `gaspar/catnat` at, the meaning of the `statutSeveso` filter, what `rga` answers outside any
  clay zone, and the query string of the report page linked by the widget.
- Apart from clay and the Seveso sites within 5 km, the data is the commune's, not the plot's.
- Not tested on a real Gladys instance yet.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node scripts/probe.mjs 31555                                   # needs network access
node scripts/probe.mjs 31555 --address "1 place du Capitole, Toulouse"
```

The tests run against the fake Gladys of the SDK
(`@gladysassistant/integration-sdk/testing`) and fake Géorisques and address services serving
[`test/fixtures`](test/fixtures/README.md); they never touch the network.
`test/gladys-rules.test.js` checks every discovered device against the category/type table of
the Gladys core.

## Credits

- [Géorisques](https://www.georisques.gouv.fr) (French Ministry of Ecological Transition, BRGM)
  for the data and its open API.
- [Géoplateforme](https://geoservices.ign.fr) of IGN and the
  [Base Adresse Nationale](https://adresse.data.gouv.fr) for geocoding.
- [gpabois/georisques](https://github.com/gpabois/georisques) (MIT) for the copy of the official
  OpenAPI description of the API, read to write the client.
- [alexreisner/geocoder](https://github.com/alexreisner/geocoder) (MIT) for the recorded answers
  of the Adresse API reused as test fixtures.
- No Home Assistant integration for Géorisques was found to build on.

## License

[Apache-2.0](LICENSE).
