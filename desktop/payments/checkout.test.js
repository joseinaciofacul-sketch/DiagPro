const test = require('node:test')
const assert = require('node:assert/strict')

const { isMercadoPagoCheckoutUrl } = require('./checkout')

test('permite checkout sandbox oficial do Mercado Pago', () => {
  assert.equal(isMercadoPagoCheckoutUrl('https://sandbox.mercadopago.com.br/checkout/v1/test'), true)
})

test('permite checkout oficial de produção', () => {
  assert.equal(isMercadoPagoCheckoutUrl('https://www.mercadopago.com.br/checkout/v1/live'), true)
})

test('bloqueia domínio semelhante controlado por terceiro', () => {
  assert.equal(isMercadoPagoCheckoutUrl('https://mercadopago.com.br.evil.example/checkout'), false)
})

test('bloqueia protocolo inseguro e URL inválida', () => {
  assert.equal(isMercadoPagoCheckoutUrl('http://www.mercadopago.com.br/checkout'), false)
  assert.equal(isMercadoPagoCheckoutUrl('not-a-url'), false)
})
