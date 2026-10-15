// -----------------------------------------------------------------------------
// The one HTTP helper of the integration: GET a JSON document from a public
// service, with a timeout and an identifying User-Agent. Every service read is
// keyless: no header ever carries a secret.
// -----------------------------------------------------------------------------

export const USER_AGENT =
  'gladys-georisques (Gladys Assistant integration; +https://github.com/guim31/gladys-georisques)';

export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {number|null} status HTTP status, null for a network error or a bad body
   */
  constructor(message, status = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * GET `url` and parse its JSON body. `null` for an empty answer (204, or 200
 * without a body), which some Géorisques services send for "nothing here".
 * @param {Function} fetchImpl fetch
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number[]} [options.emptyStatuses] statuses that mean "no data", answered as null
 * @returns {Promise<unknown>}
 */
export async function getJson(fetchImpl, url, { timeoutMs = 30000, emptyStatuses = [] } = {}) {
  const host = new URL(url).host;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason =
      err?.name === 'TimeoutError' ? `no answer in ${timeoutMs / 1000} s` : err.message;
    throw new HttpError(`${host}: ${reason}`);
  }
  if (response.status === 204 || emptyStatuses.includes(response.status)) {
    return null;
  }
  if (response.status !== 200) {
    throw new HttpError(`${host}: HTTP ${response.status}`, response.status);
  }
  const body = await response.text();
  if (body.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(`${host}: the answer is not JSON`, response.status);
  }
}
