// Settings page shown in the Zepp phone app (Profile › Bip 6 › Apps › AEVUM › Settings).
import { DEFAULT_SERVER, KEYS } from '../shared/config'

const STATUS_TEXT = {
  unpaired: 'Not connected. Create a pairing code in the AEVUM app (Profile › Devices › Amazfit Bip 6) and enter it below.',
  pairing: 'Connecting…',
  paired: 'Connected to AEVUM ✓ Open the AEVUM app on your watch to sync.',
}

AppSettingsPage({
  build(props) {
    const s = props.settingsStorage
    const status = s.getItem(KEYS.status) || 'unpaired'
    const lastSync = s.getItem(KEYS.lastSync)
    const statusText = status.indexOf('error:') === 0 ? 'Pairing failed (' + status.slice(6) + '). Check the code and try again.' : STATUS_TEXT[status] || status

    return View({ style: { padding: '16px' } }, [
      Text({ style: { fontSize: '22px', fontWeight: '600', color: '#A8834A' } }, 'AEVUM'),
      Text({ paragraph: true, style: { marginTop: '8px', fontSize: '14px' } }, statusText),
      lastSync ? Text({ paragraph: true, style: { marginTop: '4px', fontSize: '12px', color: '#8D887B' } }, 'Last sync: ' + new Date(Number(lastSync)).toLocaleString()) : null,
      Section({ title: 'Pair' }, [
        TextInput({
          label: 'Pairing code',
          placeholder: 'e.g. 7KQ2XM',
          value: '',
          maxLength: 6,
          onChange: (val) => s.setItem(KEYS.pairCode, String(val).trim().toUpperCase()),
        }),
      ]),
      status === 'paired'
        ? Button({
            label: 'Disconnect',
            style: { marginTop: '12px' },
            onClick: () => {
              s.removeItem(KEYS.token)
              s.setItem(KEYS.status, 'unpaired')
            },
          })
        : null,
      Section({ title: 'Advanced' }, [
        TextInput({
          label: 'Server',
          value: s.getItem(KEYS.server) || DEFAULT_SERVER,
          onChange: (val) => s.setItem(KEYS.server, String(val).trim()),
        }),
      ]),
    ])
  },
})
