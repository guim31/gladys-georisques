# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored in `/data`** (`/data/georisques.json`): the last report read from Géorisques (INSEE
  code and name of the commune, the values, when they were read) and the identifiers of the
  natural disaster decrees already seen. No secret, no account, no token: the services need
  none. The **position of the house** is read from Gladys (manifest `location: true`) and the
  **address** typed in the configuration is geocoded; neither is stored nor logged.
- **Network**: HTTPS GET requests to two public services only, `www.georisques.gouv.fr` (the
  risks: INSEE code of the commune, and the position of the home for the clay exposure and the
  Seveso sites within 5 km) and `data.geopf.fr` (address service of IGN: the position of the
  house, or the address typed, to find the commune), about once a day. Nothing listens on the
  network.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), and the
Géorisques and Géoplateforme services.
