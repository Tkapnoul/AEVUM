// Runs inside the Zepp phone app. Bridges the watch to the AEVUM server:
//  - claims the pairing code the member typed in Settings and stores the device token
//  - forwards each sync payload from the watch with that token
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { DEFAULT_SERVER, KEYS } from '../shared/config'

const server = () => (settingsLib.getItem(KEYS.server) || DEFAULT_SERVER).replace(/\/$/, '')

function parse(body) {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch (e) {
    return null
  }
}

AppSideService(
  BaseSideService({
    onInit() {
      if (!settingsLib.getItem(KEYS.status)) settingsLib.setItem(KEYS.status, 'unpaired')
    },

    onSettingsChange({ key, newValue }) {
      if (key === KEYS.pairCode && newValue) this.pair(String(newValue).trim().toUpperCase())
    },

    pair(code) {
      settingsLib.setItem(KEYS.status, 'pairing')
      return this.fetch({
        url: server() + '/api/device/pair',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: 'Amazfit Bip 6' }),
      })
        .then((res) => {
          const body = parse(res.body)
          if (res.status === 200 && body && body.token) {
            settingsLib.setItem(KEYS.token, body.token)
            settingsLib.setItem(KEYS.status, 'paired')
          } else {
            settingsLib.setItem(KEYS.status, 'error:' + ((body && body.error) || res.status))
          }
        })
        .catch(() => settingsLib.setItem(KEYS.status, 'error:network'))
        .finally(() => settingsLib.removeItem(KEYS.pairCode))
    },

    onRequest(req, res) {
      if (req.method !== 'aevum.sync') return res('unknown_method')
      const token = settingsLib.getItem(KEYS.token)
      if (!token) return res(null, { ok: false, error: 'not_paired' })
      this.fetch({
        url: server() + '/api/device/ingest/zepp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(req.params),
      })
        .then((r) => {
          const body = parse(r.body) || {}
          if (r.status === 401) {
            // Token revoked from the app (disconnect / re-pair): ask for a new code.
            settingsLib.removeItem(KEYS.token)
            settingsLib.setItem(KEYS.status, 'unpaired')
            return res(null, { ok: false, error: 'not_paired' })
          }
          if (r.status !== 200) return res(null, { ok: false, error: body.error || 'http_' + r.status })
          settingsLib.setItem(KEYS.lastSync, String(Date.now()))
          res(null, { ok: true, stored: body.stored })
        })
        .catch(() => res(null, { ok: false, error: 'network' }))
    },
  }),
)
