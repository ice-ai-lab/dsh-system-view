/**
 * dsh-system-view — Node half.
 *
 * The System tab is a pure browser-side conversation view: it derives
 * everything it shows from durable session events (`system/message` and
 * `request/header`) that the harness already records. This Node half
 * therefore registers nothing; it exists so the bundle row in
 * `cordis.patch.yml` resolves to a loadable module and so the `dsh.client`
 * declaration in package.json rides an entry the Loader actually scans.
 *
 * @module dsh-system-view
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'system-view'

/** No host services are needed; the client half consumes the data. */
export const inject = []

/**
 * Plugin activation: intentionally empty.
 * @param {import('@deepseek-ai/cordis').Context} _ctx host context (unused)
 */
export function apply(_ctx) {}
