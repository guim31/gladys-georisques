# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-georisques/commits/main
