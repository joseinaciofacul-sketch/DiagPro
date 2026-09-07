import { joinApiUrl, normalizeApiBaseUrl } from './apiBase.mjs'

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_DIAGPRO_API_BASE_URL)

export function apiUrl(resourcePath) {
  return joinApiUrl(API_BASE_URL, resourcePath)
}
