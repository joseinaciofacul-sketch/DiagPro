const path = require('path')
const { pathToFileURL } = require('url')

function isTrustedRendererUrl(rawUrl, target) {
  if (!rawUrl || !target?.kind || !target?.value) return false

  try {
    const current = new URL(rawUrl)
    if (target.kind === 'file') {
      const expected = new URL(pathToFileURL(path.resolve(target.value)).href)
      return current.protocol === 'file:'
        && current.host === expected.host
        && current.pathname === expected.pathname
    }

    if (target.kind === 'url') {
      const expected = new URL(target.value)
      return current.origin === expected.origin
    }
  } catch {
    return false
  }

  return false
}

module.exports = { isTrustedRendererUrl }
