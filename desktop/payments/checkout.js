function isMercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    return url.protocol === 'https:' && (
      hostname === 'mercadopago.com'
      || hostname === 'mercadopago.com.br'
      || hostname.endsWith('.mercadopago.com')
      || hostname.endsWith('.mercadopago.com.br')
    )
  } catch {
    return false
  }
}

module.exports = { isMercadoPagoCheckoutUrl }
