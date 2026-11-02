// getCart() ante los 409 de checkout liberado: replicar, reintentar o dar por pagado; nunca vaciar en silencio.
import test from 'node:test'
import assert from 'node:assert/strict'
const makeStorage = () => {
  const map = new Map()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
  }
}
globalThis.localStorage = makeStorage()
globalThis.sessionStorage = makeStorage()
globalThis.document = { body: { dataset: { aliApi: 'https://ali.test/api/store/v1', aliPk: 'ali_pk_test_x' } }, querySelectorAll: () => [] }

let requests = []
const seen = []
globalThis.fetch = async (url, init = {}) => {
  const next = requests.shift()
  assert.ok(next, `request inesperado ${init.method ?? 'GET'} ${url}`)
  seen.push({ method: init.method ?? 'GET', path: new URL(url).pathname.replace('/api/store/v1', ''), token: init.headers?.['Ali-Cart-Token'] })
  assert.equal(init.method ?? 'GET', next.method)
  assert.equal(new URL(url).pathname.replace('/api/store/v1', ''), next.path)
  if (next.throws) throw new TypeError('network')
  return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json', ...(next.headers ?? {}) } })
}

const store = await import('../src/scripts/store.ts')
const old = { id: 'cart-old', token: 'tok-old' }
const cart = (id, lines = 2) => ({ id, lines: Array.from({ length: lines }, (_, i) => ({ variant_id: `v${i}`, quantity: 1 })), issues: [], fulfillment_mode: 'pickup', shipping_status: 'not_needed', shipping_quote: null, totals: { item_count: lines, subtotal: '0.00', shipping: '0.00', tax: '0.00', total: '0.00', currency: 'GTQ', display: 'Q0.00' } })
const released = { status: 409, code: 'cart-checkout-in-progress', recovery: 'replicate', detail: 'Tu pago anterior todavía puede confirmarse.' }

function start(steps) {
  localStorage.map.clear(); sessionStorage.map.clear(); seen.length = 0
  localStorage.setItem('ali.cart', JSON.stringify(old))
  requests = steps
}

test('recovery replicate: carrito nuevo con las mismas líneas, ref nuevo, contador y aviso', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 201, body: { id: 'cart-new', cart_token: 'tok-new', replicated: true, replicated_from_cart_id: 'cart-old', cart: cart('cart-new', 3) } },
  ])
  sessionStorage.setItem('ali.idem', JSON.stringify({ payload: '{}', key: 'k' }))
  const result = await store.getCart()
  assert.equal(result.id, 'cart-new')
  assert.equal(result.lines.length, 3)
  assert.equal(result.replicated, true)
  assert.deepEqual(store.readRef(), { id: 'cart-new', token: 'tok-new' })
  assert.equal(localStorage.getItem('ali.cart.count'), '3')
  assert.equal(seen[1].token, 'tok-old', 'replicate usa el token del carrito viejo')
  assert.equal(sessionStorage.getItem('ali.idem'), null, 'la llave de idempotencia del carrito viejo no se reusa')
  assert.deepEqual(store.cartNotice(result), { kind: 'replicated', cart: 'cart-new', empty: false })
  assert.match(store.cartNoticeHtml(store.cartNotice(result)), /Tu carrito sigue acá/)
  assert.match(store.cartNoticeHtml(store.cartNotice(result)), /No uses el enlace de pago anterior/)
  assert.equal(requests.length, 0)
})

test('el aviso sobrevive a recargar y se va al cerrarlo o al pagar', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 201, body: { id: 'cart-new', cart_token: 'tok-new', replicated: true, cart: cart('cart-new') } },
    { method: 'GET', path: '/carts/cart-new', status: 200, body: cart('cart-new') },
  ])
  await store.getCart()
  const reloaded = await store.getCart()
  assert.equal(store.cartNotice(reloaded)?.kind, 'replicated')
  store.dismissCartNotice()
  assert.equal(store.cartNotice(reloaded), null)
  sessionStorage.setItem('ali.cart.notice', JSON.stringify({ kind: 'replicated', cart: 'cart-new', empty: false }))
  store.rememberOrder('order-1', 'otok')
  assert.equal(store.cartNotice(reloaded), null)
})

test('sin el campo recovery, cart-checkout-changed también replica', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: { status: 409, code: 'cart-checkout-changed' } },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 201, body: { id: 'cart-new', cart_token: 'tok-new', replicated: true, cart: cart('cart-new') } },
  ])
  assert.equal((await store.getCart()).id, 'cart-new')
})

test('replicate 200 replicated:false conserva el mismo carrito y no muestra aviso', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 200, body: { id: 'cart-old', replicated: false, cart: cart('cart-old') } },
  ])
  const result = await store.getCart()
  assert.equal(result.id, 'cart-old')
  assert.deepEqual(store.readRef(), old)
  assert.equal(store.cartNotice(result), null)
})

test('todas las líneas agotadas: carrito nuevo vacío con el otro texto y «Ver productos»', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 201, body: { id: 'cart-new', cart_token: 'tok-new', replicated: true, cart: { ...cart('cart-new', 0), issues: [{ code: 'out_of_stock', line: { variant_id: 'v0', product_name: 'Vela' } }] } } },
  ])
  const result = await store.getCart()
  const html = store.cartNoticeHtml(store.cartNotice(result))
  assert.match(html, /los productos que tenías ya no están disponibles/)
  assert.match(html, /Ver productos/)
})

for (const status of [0, 429, 503]) {
  test(`replicate falla (${status || 'red'}): no se borra el carrito viejo y el error sube`, async () => {
    start([
      { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
      status === 0
        ? { method: 'POST', path: '/carts/cart-old/replicate', throws: true }
        : { method: 'POST', path: '/carts/cart-old/replicate', status, body: { status, code: 'x', detail: 'falló' } },
    ])
    await assert.rejects(store.getCart(), (problem) => problem.status === status)
    assert.deepEqual(store.readRef(), old)
  })
}

test('pagado: nunca se copia; se olvida y se muestra el pedido que el navegador conoce', async () => {
  start([{ method: 'GET', path: '/carts/cart-old', status: 409, body: { status: 409, code: 'cart-already-checked-out', recovery: 'new-cart' } }])
  localStorage.setItem('ali.order.cart.0a1b2c3d-0000-0000-0000-000000000000', JSON.stringify(old))
  assert.equal(await store.getCart(), null)
  assert.equal(store.readRef(), null)
  const notice = store.cartNotice(null)
  assert.deepEqual(notice, { kind: 'paid', order: '0a1b2c3d-0000-0000-0000-000000000000' })
  const html = store.cartNoticeHtml(notice)
  assert.match(html, /Tu pedido #0A1B2C ya está pagado/)
  assert.match(html, /href="\/pedido\/0a1b2c3d-0000-0000-0000-000000000000"/)
  assert.ok(!seen.some((r) => r.path.endsWith('/replicate')))
})

test('pagado sin pedido conocido: «Tu compra anterior ya se pagó»', async () => {
  start([{ method: 'GET', path: '/carts/cart-old', status: 409, body: { status: 409, code: 'cart-already-checked-out', recovery: 'new-cart' } }])
  assert.equal(await store.getCart(), null)
  assert.match(store.cartNoticeHtml(store.cartNotice(null)), /Tu compra anterior ya se pagó/)
})

test('pagado detectado por replicate (pago tardío) tampoco copia', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 409, body: { status: 409, code: 'cart-already-checked-out', recovery: 'new-cart' } },
  ])
  assert.equal(await store.getCart(), null)
  assert.equal(store.readRef(), null)
  assert.equal(store.cartNotice(null).kind, 'paid')
})

test('recovery retry: espera retry_after y reintenta una vez', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: { status: 409, code: 'cart-checkout-in-progress', recovery: 'retry', retry_after: 1 } },
    { method: 'GET', path: '/carts/cart-old', status: 200, body: cart('cart-old') },
  ])
  const t0 = Date.now()
  assert.equal((await store.getCart()).id, 'cart-old')
  assert.ok(Date.now() - t0 >= 900)
})

test('recovery retry que sigue igual: muestra el detail, no reintenta para siempre ni borra', async () => {
  const preparing = { status: 409, code: 'cart-checkout-in-progress', recovery: 'retry', retry_after: 1, detail: 'Tu checkout todavía se está preparando.' }
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: preparing },
    { method: 'GET', path: '/carts/cart-old', status: 409, body: preparing },
  ])
  await assert.rejects(store.getCart(), (problem) => store.problemMessage(problem) === preparing.detail)
  assert.deepEqual(store.readRef(), old)
})

test('otro 409 muestra su detail en vez de un carrito vacío', async () => {
  start([{ method: 'GET', path: '/carts/cart-old', status: 409, body: { status: 409, code: 'algo-nuevo', detail: 'Explicación de Ali' } }])
  await assert.rejects(store.getCart(), (problem) => store.problemMessage(problem) === 'Explicación de Ali')
  assert.deepEqual(store.readRef(), old)
})

test('404 y cart-mode-mismatch se olvidan como antes', async () => {
  start([{ method: 'GET', path: '/carts/cart-old', status: 404, body: { status: 404, code: 'not-found' } }])
  assert.equal(await store.getCart(), null)
  assert.equal(store.readRef(), null)
  start([{ method: 'GET', path: '/carts/cart-old', status: 409, body: { status: 409, code: 'cart-mode-mismatch' } }])
  assert.equal(await store.getCart(), null)
  assert.equal(store.readRef(), null)
})

test('addLine después de replicar agrega al carrito nuevo, con las líneas del viejo', async () => {
  start([
    { method: 'GET', path: '/carts/cart-old', status: 409, body: released },
    { method: 'POST', path: '/carts/cart-old/replicate', status: 201, body: { id: 'cart-new', cart_token: 'tok-new', replicated: true, cart: cart('cart-new', 2) } },
    { method: 'POST', path: '/carts/cart-new/lines', status: 200, body: cart('cart-new', 3) },
  ])
  const result = await store.addLine('v9', 1)
  assert.equal(result.totals.item_count, 3)
  assert.equal(seen[2].token, 'tok-new')
})
