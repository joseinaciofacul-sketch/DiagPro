const DEFAULT_SCAN_MODE_KEY = 'diagpro_default_scan_mode'
const VALID_SCAN_MODES = new Set(['quick', 'complete', 'custom'])

export function getDefaultScanMode() {
  try {
    const storedMode = localStorage.getItem(DEFAULT_SCAN_MODE_KEY)
    return VALID_SCAN_MODES.has(storedMode) ? storedMode : 'quick'
  } catch {
    return 'quick'
  }
}

export function saveDefaultScanMode(mode) {
  if (!VALID_SCAN_MODES.has(mode)) {
    throw new Error('Modo padrão de diagnóstico inválido.')
  }
  localStorage.setItem(DEFAULT_SCAN_MODE_KEY, mode)
  return mode
}
