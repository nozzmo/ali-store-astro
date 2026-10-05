// Cliente de la Store API para el NAVEGADOR. Usa sólo la llave publicable
// (ali_pk_…), que el servidor deja en <body data-ali-pk>. El carrito vive en Ali;
// acá sólo guardamos su id y su token.

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
  return problem.detail || "Algo salió mal. Intentá de nuevo."
}

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
    if (problem.status === 404 || problem.status === 409) { writeRef(null); setCount(0); return null }
    throw error
  }
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
    localStorage.setItem("ali.order.last", id)
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
