export const ACCESS_KEY = 'diagpro_access_token'
export const REFRESH_KEY = 'diagpro_refresh_token'
export const USERNAME_KEY = 'diagpro_username'

export function saveTokens(storage, access, refresh) {
  storage.setItem(ACCESS_KEY, access)
  storage.setItem(REFRESH_KEY, refresh)
}

export function clearSession(storage) {
  storage.removeItem(ACCESS_KEY)
  storage.removeItem(REFRESH_KEY)
  storage.removeItem(USERNAME_KEY)
}

export function readAccessToken(storage) {
  return storage.getItem(ACCESS_KEY)
}

export function readRefreshToken(storage) {
  return storage.getItem(REFRESH_KEY)
}
