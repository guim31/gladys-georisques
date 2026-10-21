# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Several houses: with no house chosen in the configuration, every house of
  Gladys that has a location is followed, one device per commune, each read
  once a day. Two houses in the same commune share its device; its clay
  exposure and Seveso sites within 5 km are read at the first of them, in
  alphabetical order. With one house, nothing changes. **If you have several
  located houses and left the House field empty**, you now get one device per
  commune (to create in the Discover tab) and one Géorisques read a day per
  commune instead of one: choose a house in the configuration to keep a single
  one.
- A **House** setting on the widget, to show the risks of one house per widget.

## [1.0.2] - 2026-10-16

### Fixed

- Seveso sites were always counted as 0, in the commune and within 5 km: the
  Géorisques API no longer accepts the codes 1 and 2 for the Seveso status, only
  `SEUIL_HAUT` and `SEUIL_BAS`.

## [1.0.1] - 2026-10-15

### Added

- A "Risks in my commune" device, from the open Géorisques data: clay
  shrink-swell exposure at the home, radon potential, seismic zone, flood
  prevention plan and high flood risk territory, classified industrial sites,
  Seveso sites in the commune and within 5 km, underground cavities, ground
  movements, natural disaster decrees since 1982 and the latest one.
- The home is your house in Gladys, an address or an INSEE code.
- Géorisques is read once a day, at startup and when the configuration is
  saved; a "Read now" button checks the commune found.
- A "New natural disaster decree" scene trigger, filtered by kind of disaster.
- A Géorisques dashboard widget summing the risks up, with a link to the
  Géorisques report of the address.
- Feature names and texts in English, French, German and Spanish, and the
  documentation in the four languages.

[Unreleased]: https://github.com/guim31/gladys-georisques/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-georisques/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-georisques/releases/tag/v1.0.1
