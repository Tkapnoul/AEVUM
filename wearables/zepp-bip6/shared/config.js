// Default AEVUM server. Members can override it in the Zepp app settings page,
// but production builds should point here so nobody has to type a URL.
export const DEFAULT_SERVER = 'https://app.aevum.example'

export const KEYS = {
  server: 'server',
  token: 'token',
  pairCode: 'pairCode',
  status: 'status', // 'unpaired' | 'pairing' | 'paired' | 'error:<code>'
  lastSync: 'lastSync',
}
