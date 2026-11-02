// Cliente de la Store API para el NAVEGADOR. Usa sólo la llave publicable
// (ali_pk_…), que el servidor deja en <body data-ali-pk>. El carrito vive en Ali;
// acá sólo guardamos su id y su token.

import { money } from "../lib/format.ts"

export interface CartLine {
  id: string
  variant_id: string
  product_id: string
  product_name: string
  variant_name: string
  quantity: number
  unit_price: string
  /** Total de la línea calculado por Ali (contrato nuevo). */
  line_total?: string
  line_total_display?: string
  currency: string
  image_url: string | null
  available: boolean
  stock: number | null
}

export interface Cart {
  id: string
  lines: CartLine[]
  /** Sólo en el carrito que devolvió replicate: true si es uno nuevo. */
  replicated?: boolean
  issues: { code: string; line?: { variant_id?: string; product_name?: string } | null; from?: string | null; to?: string | null }[]
  fulfillment_mode: "pickup" | "delivery"
  shipping_status: "not_needed" | "needs_quote" | "priced" | "coordinate" | "unavailable" | string
  shipping_quote: { status: string; cost?: string; note?: string | null; reason?: string | null; expires_at?: string } | null
  totals: { item_count: number; subtotal: string; shipping: string; tax: string; total: string; currency: string; display: string }
}

export interface Problem {
  status: number
  type?: string
  title?: string
  detail?: string
  /** Código estable de Ali («cart-checkout-in-progress»…). */
  code?: string
  /** Qué hacer ante un 409 de checkout: replicate | retry | new-cart. */
  recovery?: "replicate" | "retry" | "new-cart" | string
  errors?: { field: string; code: string }[]
  issues?: Cart["issues"]
  cart?: Cart
  retry_after?: number
}

const body = document.body.dataset
const API = body.aliApi ?? ""
const PK = body.aliPk ?? ""
export const CURRENCY = body.currency ?? "GTQ"

const CART_KEY = "ali.cart"
const COUNT_KEY = "ali.cart.count"
/** Aviso del carrito rescatado o pagado: dura hasta que el comprador lo cierra o paga (sobrevive a recargar). */
const NOTICE_KEY = "ali.cart.notice"

interface CartRef { id: string; token: string }

export function readRef(): CartRef | null {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "null") } catch { return null }
}
function writeRef(ref: CartRef | null) {
  if (ref) localStorage.setItem(CART_KEY, JSON.stringify(ref))
  else localStorage.removeItem(CART_KEY)
}

export function setCount(n: number) {
  try { localStorage.setItem(COUNT_KEY, JSON.stringify(n)) } catch {}
  document.querySelectorAll<HTMLElement>("[data-cart-count]").forEach((e) => { e.textContent = n ? String(n) : ""; e.dataset.count = String(n) })
}

export function problemMessage(problem: Problem): string {
  if (problem.status === 429) return `Hay mucho tráfico en este momento. Esperá ${problem.retry_after ? `${problem.retry_after} segundos` : "un momento"} y volvé a intentar.`
  if (problem.status === 0) return "No pudimos conectar con la tienda. Revisá tu conexión e intentá de nuevo."
  if (problem.type?.endsWith("origin-not-allowed")) return "Este sitio todavía no está autorizado para vender con esta tienda. Si sos quien administra el sitio, verificá el dominio en Ali (Integraciones)."
  return problem.detail || GENERIC_ERROR
}
const GENERIC_ERROR = "Algo salió mal. Intentá de nuevo."


export async function api<T>(path: string, init: RequestInit & { cart?: boolean } = {}): Promise<T> {
  if (!API || !PK) throw { status: 0, detail: "La tienda no tiene configurada su llave publicable (ALI_PUBLISHABLE_KEY)." } as Problem
  const headers: Record<string, string> = { Authorization: `Bearer ${PK}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) }
  const ref = readRef()
  if (init.cart && ref) headers["Ali-Cart-Token"] = ref.token
  let response: Response
  try {
    response = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } })
  } catch {
    throw { status: 0 } as Problem
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after")) || data.retry_after
    throw { ...data, status: response.status, retry_after: retry } as Problem
  }
  return data as T
}

/** El carrito actual, o null si no hay (o venció). */
export async function getCart(): Promise<Cart | null> {
  const ref = readRef()
  if (!ref) { setCount(0); return null }
  try {
    const cart = await api<Cart>(`/carts/${ref.id}`, { cart: true })
    setCount(cart.totals.item_count)
    return cart
  } catch (error) {
    const problem = error as Problem
    if (problem.status === 404 || problemCode(problem) === "cart-mode-mismatch") { forgetCart(); return null }
    if (problem.status === 409) return recoverCart(problem)
    throw error
  }
}

export const problemCode = (problem: Problem) => problem.code ?? problem.type?.split("/").pop() ?? ""

/** 409 que se arreglan replicando: con el campo `recovery` o, en un Ali sin el campo, por su código. */
export const replicable = (problem: Problem) =>
  problem.recovery === "replicate" || (!problem.recovery && ["cart-checkout-in-progress", "cart-checkout-changed"].includes(problemCode(problem)))

const paid = (problem: Problem) => problem.recovery === "new-cart" || problemCode(problem) === "cart-already-checked-out"
const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(seconds, 1), 10) * 1000))

/**
 * Un 409 de checkout ya no vacía el carrito en silencio. Ali dice qué hacer:
 * replicar (carrito nuevo con las mismas líneas), esperar y reintentar, o
 * empezar de cero porque ya se pagó. Cualquier otro 409 se muestra.
 */
export async function recoverCart(problem: Problem, retried = false): Promise<Cart | null> {
  if (paid(problem)) { settlePaidCart(); return null }
  if (problem.recovery === "retry" && !retried) {
    await wait(problem.retry_after ?? 2)
    const ref = readRef()
    if (!ref) return null
    try {
      const cart = await api<Cart>(`/carts/${ref.id}`, { cart: true })
      setCount(cart.totals.item_count)
      return cart
    } catch (error) {
      const again = error as Problem
      if (again.status === 409) return recoverCart(again, true)
      throw error
    }
  }
  if (replicable(problem)) return replicateCart()
  throw problem
}

interface Replicated { id: string; replicated: boolean; cart_token?: string; cart: Cart }

/**
 * POST /carts/:id/replicate. Si falla (red, 429, 5xx) NO se borra el carrito
 * viejo: el error sube para mostrarlo y dejar reintentar.
 */
export async function replicateCart(): Promise<Cart | null> {
  const ref = readRef()
  if (!ref) return null
  let result: Replicated
  try {
    result = await api<Replicated>(`/carts/${ref.id}/replicate`, { method: "POST", cart: true, body: "{}" })
  } catch (error) {
    const problem = error as Problem
    if (problem.status === 404) { forgetCart(); return null }
    if (problem.status === 409 && paid(problem)) { settlePaidCart(); return null }
    throw problem
  }
  if (result.replicated && result.cart_token) {
    writeRef({ id: result.id, token: result.cart_token })
    // La llave de idempotencia era del carrito viejo: con el nuevo, otro pedido.
    try { sessionStorage.removeItem("ali.idem") } catch {}
    // Los cambios de precio sólo vienen en ESTA respuesta (el GET siguiente ya trae el precio nuevo):
    // se guardan en el aviso para que el comprador los vea arriba hasta pagar o cerrarlo.
    const currency = result.cart.totals.currency
    const changes = result.cart.issues
      .filter((i) => i.code === "price_changed" && i.from && i.to)
      .map((i) => ({ variant_id: i.line?.variant_id ?? "", name: i.line?.product_name || "Un producto", from: i.from!, to: i.to!, currency }))
    saveNotice({ kind: "replicated", cart: result.id, empty: result.cart.lines.length === 0, ...(changes.length ? { changes } : {}) })
  }
  setCount(result.cart.totals.item_count)
  return { ...result.cart, replicated: result.replicated }
}

/** Carrito pagado: nunca se copia. Si el navegador conoce ese pedido, lo mostramos. */
function settlePaidCart() {
  const ref = readRef()
  let order: string | undefined
  try {
    const snapshot = ref && JSON.stringify(ref)
    for (let i = 0; snapshot && i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith("ali.order.cart.") && localStorage.getItem(key) === snapshot) order = key.slice("ali.order.cart.".length)
    }
  } catch {}
  forgetCart()
  saveNotice({ kind: "paid", order })
}

export interface PriceChange { variant_id: string; name: string; from: string; to: string; currency: string }

export type CartNotice =
  | { kind: "replicated"; cart: string; empty: boolean; changes?: PriceChange[] }
  | { kind: "paid"; order?: string }

function saveNotice(notice: CartNotice) {
  try { sessionStorage.setItem(NOTICE_KEY, JSON.stringify(notice)) } catch {}
}

/** El aviso vigente para este carrito (el de otro carrito ya no aplica). */
export function cartNotice(cart: Cart | null): CartNotice | null {
  let notice: CartNotice | null = null
  try { notice = JSON.parse(sessionStorage.getItem(NOTICE_KEY) || "null") } catch {}
  if (notice?.kind === "replicated" && notice.cart !== cart?.id) return null
  if (notice?.kind === "paid" && cart) return null
  return notice
}

export function dismissCartNotice() {
  try { sessionStorage.removeItem(NOTICE_KEY) } catch {}
}

/**
 * El «El pago no se completó» de volver por cancel_url sólo se muestra si no hay
 * otro aviso del carrito: con carrito replicado (o pagado) sería un segundo mensaje que lo contradice.
 */
export const paymentCancelledVisible = (search: string, notice: CartNotice | null) =>
  new URLSearchParams(search).get("pago") === "cancelado" && !notice

/** Variantes cuyo cambio de precio ya está en el banner (para no repetirlo abajo). */
export const noticeChangedVariants = (notice: CartNotice | null) =>
  notice?.kind === "replicated" ? (notice.changes ?? []).map((c) => c.variant_id) : []

/** Error al recuperar el carrito: nunca se lee como carrito vacío; los productos siguen guardados. */
export function recoverMessage(problem: Problem): string {
  const base = "No pudimos cargar tus productos (siguen guardados)."
  if (problem.status === 0) return `${base} Revisá tu conexión e intentá de nuevo.`
  const why = problemMessage(problem)
  return why === GENERIC_ERROR ? base : `${base} ${why}`
}

const orderNumber = (id: string) => id.replace(/-/g, "").slice(0, 6).toUpperCase()
const safeHref = (url: string | null | undefined) => (url && /^(https?:|mailto:|tel:)/i.test(url) ? url : null)

const ICON_INFO = '<svg class="icon" data-icon="info" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
const ICON_CHECK = '<svg class="icon" data-icon="check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m8 12.5 2.8 2.8L16.2 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function priceChangesText(changes: PriceChange[]): string {
  const list = changes.map((c) => `${c.name} ${money(c.from, c.currency)} → ${money(c.to, c.currency)}`).join(" · ")
  return changes.length === 1 ? `Cambió 1 precio: ${list}` : `Cambiaron ${changes.length} precios: ${list}`
}

/**
 * La franja de arriba del carrito: título en negrita, el porqué y un botón para cerrarla.
 * `contact` es el chat de la tienda (ALI_CONTACT_URL o chat_url de Ali), para «¿Ya pagaste?».
 */
export function cartNoticeHtml(notice: CartNotice | null, contact?: string | null): string {
  if (!notice) return ""
  const close = '<button type="button" class="cart-notice-close" data-cart-notice-close aria-label="Cerrar aviso"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>'
  let title: string, text: string, action = "", extra = "", tone = "", icon = ICON_INFO
  if (notice.kind === "paid") {
    tone = "ok"
    icon = ICON_CHECK
    title = notice.order ? `Tu pedido #${orderNumber(notice.order)} ya está pagado` : "Tu compra anterior ya se pagó"
    text = notice.order ? "No hace falta volver a pagar." : "Si querés comprar algo más, empezá un carrito nuevo."
    if (notice.order) action = `<a class="btn ghost small" href="/pedido/${esc(notice.order)}">Ver el pedido</a>`
  } else if (notice.empty) {
    title = "Tu carrito sigue acá"
    text = "Tu pago anterior no se completó y los productos que tenías ya no están disponibles."
    action = '<a class="btn ghost small" href="/">Ver productos</a>'
  } else {
    title = "Tu carrito sigue acá"
    text = "Tu pago anterior no se completó. Te armamos un carrito nuevo con tus productos; no uses el enlace anterior."
    const changes = notice.changes ?? []
    // Un precio que sube es lo que el comprador tiene que ver antes de pagar: ámbar. Si sólo bajan, neutro.
    if (changes.some((c) => Number(c.to) > Number(c.from))) tone = "warn"
    if (changes.length) extra += `<p class="cart-notice-change">${esc(priceChangesText(changes))}</p>`
    const href = safeHref(contact)
    extra += href
      ? `<p class="cart-notice-help">¿Ya pagaste? <a href="${esc(href)}" target="_blank" rel="noopener">Escribile a la tienda</a></p>`
      : `<p class="cart-notice-help">¿Ya pagaste? Escribile a la tienda antes de volver a pagar.</p>`
  }
  return `<div class="${tone ? `cart-notice ${tone}` : "cart-notice"}" role="status">${icon}<div class="cart-notice-body"><strong>${esc(title)}</strong><p>${esc(text)}</p>${extra}${action}</div>${close}</div>`
}

async function ensureCart(): Promise<string> {
  const current = await getCart()
  if (current) return current.id
  const created = await api<{ id: string; cart_token: string }>("/carts", { method: "POST", body: "{}" })
  writeRef({ id: created.id, token: created.cart_token })
  return created.id
}

export async function addLine(variantId: string, quantity: number): Promise<Cart> {
  const id = await ensureCart()
  const cart = await api<Cart>(`/carts/${id}/lines`, { method: "POST", cart: true, body: JSON.stringify({ variant_id: variantId, quantity }) })
  setCount(cart.totals.item_count)
  return cart
}

export async function setQuantity(variantId: string, quantity: number): Promise<Cart> {
  const ref = readRef()!
  const cart = quantity > 0
    ? await api<Cart>(`/carts/${ref.id}/lines/${variantId}`, { method: "PATCH", cart: true, body: JSON.stringify({ quantity }) })
    : await api<Cart>(`/carts/${ref.id}/lines/${variantId}`, { method: "DELETE", cart: true })
  setCount(cart.totals.item_count)
  return cart
}

export async function setFulfillment(mode: "pickup" | "delivery"): Promise<Cart> {
  const ref = readRef()!
  return api<Cart>(`/carts/${ref.id}/fulfillment`, { method: "PUT", cart: true, body: JSON.stringify({ mode }) })
}

export async function quoteShipping(address: string) {
  const ref = readRef()!
  return api<{ quote: NonNullable<Cart["shipping_quote"]>; cart: Cart }>(`/carts/${ref.id}/shipping-quote`, { method: "POST", cart: true, body: JSON.stringify({ address }) })
}

export interface CheckoutResult {
  order: { id: string; number: string; status: string }
  order_token: string
  checkout_url: string | null
  cash_instructions: string | null
}

export async function checkout(payload: Record<string, unknown>, idempotencyKey: string): Promise<CheckoutResult> {
  const ref = readRef()!
  return api<CheckoutResult>(`/carts/${ref.id}/checkout`, { method: "POST", cart: true, headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) })
}

/** Quita una línea por variante (también sirve para una que Ali ya marcó agotada o pausada). */
export async function removeVariant(variantId: string): Promise<Cart> {
  const ref = readRef()!
  const cart = await api<Cart>(`/carts/${ref.id}/lines/${variantId}`, { method: "DELETE", cart: true })
  setCount(cart.totals.item_count)
  return cart
}

/** Variantes que el comprador ya quitó: Ali las reporta una última vez en la misma respuesta. */
const dismissed = new Set<string>()
export function dismissIssue(variantId: string) { dismissed.add(variantId) }
export const visibleIssues = (cart: Cart) => cart.issues.filter((i) => !(i.line?.variant_id && dismissed.has(i.line.variant_id)))

export function forgetCart() { writeRef(null); setCount(0) }

export function rememberOrder(id: string, token: string) {
  try {
    localStorage.setItem(`ali.order.${id}`, token)
    const ref = readRef()
    if (ref) localStorage.setItem(`ali.order.cart.${id}`, JSON.stringify(ref))
    localStorage.setItem("ali.order.last", id)
    dropOtherCartSnapshots(id)
  } catch {}
  // Pagar (o reintentar el pago) cierra el aviso del carrito rescatado.
  dismissCartNotice()
}

/**
 * Sólo un carrito vive a la vez, así que la foto de cualquier pedido anterior
 * ya no puede coincidir con él. El comprador que abandona el enlace de pago
 * nunca vuelve a /pedido/:id, así que sin esta poda su foto quedaría para
 * siempre: una por intento.
 */
function dropOtherCartSnapshots(keep: string) {
  const stale: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith("ali.order.cart.") && key !== `ali.order.cart.${keep}`) stale.push(key)
  }
  for (const key of stale) localStorage.removeItem(key)
}

/** Un pedido vivo todavía puede cobrarse; sólo `pending` conserva su rastro. */
const SETTLED = ["confirmed", "fulfilled", "cancelled"]
/** El carrito se consume al cobrar; `cancelled` lo deja intacto para reintentar. */
const PAID = ["confirmed", "fulfilled"]

/** Sólo el pedido pagado consume SU carrito; un pedido viejo no borra otro carrito. */
export function completeOrderCart(id: string, status: string) {
  if (!SETTLED.includes(status)) return
  try {
    const saved = localStorage.getItem(`ali.order.cart.${id}`)
    const ref = readRef()
    if (PAID.includes(status) && saved && ref && saved === JSON.stringify(ref)) forgetCart()
    localStorage.removeItem(`ali.order.cart.${id}`)
  } catch {}
}

export const orderToken = (id: string) => { try { return localStorage.getItem(`ali.order.${id}`) } catch { return null } }
export const lastOrder = () => { try { return localStorage.getItem("ali.order.last") } catch { return null } }

export function toast(text: string) {
  const el = document.querySelector<HTMLElement>("[data-toast]")
  if (!el) return
  el.querySelector("[data-toast-text]")!.textContent = text
  el.classList.add("show")
  clearTimeout(Number(el.dataset.timer))
  el.dataset.timer = String(window.setTimeout(() => el.classList.remove("show"), 4500))
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
