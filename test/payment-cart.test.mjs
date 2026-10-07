import test from 'node:test'
import assert from 'node:assert/strict'
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.document = { body: { dataset: {} }, querySelectorAll: () => [] }
const { rememberOrder, completeOrderCart, readRef } = await import('../src/scripts/store.ts')
const ref = { id: 'cart-a', token: 'token-a' }
function start() { storage.clear(); localStorage.setItem('ali.cart', JSON.stringify(ref)); rememberOrder('order-a', 'order-token') }
for (const status of ['pending', 'cancelled']) {
  test(`${status} keeps the cart so payment can be retried`, () => {
    start(); completeOrderCart('order-a', status); assert.deepEqual(readRef(), ref)
    assert.equal(localStorage.getItem('ali.order.order-a'), 'order-token')
  })
}
for (const status of ['confirmed', 'fulfilled']) {
  test(`${status} consumes only the associated cart`, () => {
    start(); completeOrderCart('order-a', status); assert.equal(readRef(), null)
    assert.equal(localStorage.getItem('ali.cart.count'), '0')
    completeOrderCart('order-a', status); assert.equal(readRef(), null)
  })
}
test('a previous order does not clear a new cart', () => {
  start(); const newRef = { id: 'cart-b', token: 'token-b' }
  localStorage.setItem('ali.cart', JSON.stringify(newRef))
  completeOrderCart('order-a', 'confirmed'); assert.deepEqual(readRef(), newRef)
})
test('unassociated order does not clear a cart', () => {
  start(); completeOrderCart('other-order', 'confirmed'); assert.deepEqual(readRef(), ref)
})
