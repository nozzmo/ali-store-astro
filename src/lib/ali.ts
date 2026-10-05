// Cliente de la Store API de Ali para el SERVIDOR (SSR). Nunca se importa desde el navegador.
//
// - Usa la llave secreta (ali_sk_…) si está configurada; si no, la publicable.
// - Con la secreta manda `Ali-Buyer-IP` con la IP del comprador, así el límite de
//   Ali cuenta por comprador y no por el servidor de la tienda.
// - Cachea las lecturas de catálogo unos segundos (ALI_CACHE_SECONDS) y, si Ali
//   responde 429 o se cae, sirve la última copia buena en vez de romper la página.
import { ALI_API_URL, ALI_CACHE_SECONDS, ALI_PUBLISHABLE_KEY, ALI_SECRET_KEY } from "astro:env/server"
import type { Category, Page, Product, Store } from "./types"

export class AliError extends Error {
  constructor(
    public status: number,
    public problem: { type?: string; title?: string; detail?: string; code?: string; [key: string]: unknown },
    public retryAfter?: number,
  ) {
    super(String(problem.detail || problem.title || `Ali respondió ${status}`))
    this.name = "AliError"
  }
}

export interface AliContext {
  /** IP del comprador, para `Ali-Buyer-IP`. */
  buyerIp?: string
}

const TIMEOUT_MS = 8000
const MAX_ENTRIES = 3000
const MAX_CATALOG_PAGES = 20 // 20 × 100 = 2.000 productos
const cache = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

export const apiUrl = () => (ALI_API_URL || "https://soyali.com/api/store/v1").replace(/\/+$/, "")
export const publishableKey = () => ALI_PUBLISHABLE_KEY || ""
const serverKey = () => ALI_SECRET_KEY || ALI_PUBLISHABLE_KEY || ""
const usesSecret = () => Boolean(ALI_SECRET_KEY)

async function request<T>(path: string, ctx: AliContext): Promise<T> {
  const key = serverKey()
  if (!key) throw new AliError(0, { code: "not-configured", detail: "Falta ALI_PUBLISHABLE_KEY (o ALI_SECRET_KEY)." })

  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" }
  if (usesSecret() && ctx.buyerIp) headers["Ali-Buyer-IP"] = ctx.buyerIp

  let response: Response
  try {
    response = await fetch(`${apiUrl()}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    throw new AliError(0, { code: "unreachable", detail: `No pudimos conectar con Ali (${(error as Error).message}).` })
  }

  if (!response.ok) {
    const problem = await response.json().catch(() => ({}))
    const retry = Number(response.headers.get("retry-after") || (problem as { retry_after?: number }).retry_after || 0)
    throw new AliError(response.status, problem as AliError["problem"], retry || undefined)
  }
  return (await response.json()) as T
}

/** Lectura cacheada. Si Ali falla de forma transitoria, devuelve la última copia buena. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const ttl = Math.max(0, ALI_CACHE_SECONDS ?? 60) * 1000
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value as T

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const promise = load()
    .then((value) => {
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
      cache.set(key, { at: Date.now(), value })
      return value
    })
    .catch((error) => {
      if (hit && transient(error)) return hit.value as T
      throw error
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, promise)
  return promise
}

/**
 * Normaliza un producto de la API. Acepta el contrato actual (`buyable`, `in_stock`,
 * `available` por variante, `price_min` como string) y el anterior (`buyable?`, `in_stock?`).
 */
export function normalizeProduct(raw: any): Product {
  const variants = (raw.variants ?? []).map((v: any) => {
    const buyable = Boolean(v.buyable ?? v["buyable?"])
    const inStock = Boolean(v.in_stock ?? v["in_stock?"])
    return {
      ...v,
      buyable,
      in_stock: inStock,
      available: v.available ?? (buyable && inStock),
      max_quantity: v.max_quantity ?? (typeof v.stock === "number" ? v.stock : 999),
      stock_badge: v.stock_badge ?? (v.stock === 0 ? "sold_out" : typeof v.stock === "number" && v.stock <= 5 ? "low" : null),
    }
  })
  const min = raw.price_min === null || raw.price_min === undefined ? null : Number(raw.price_min)
  return {
    ...raw,
    variants,
    price_min: Number.isFinite(min) ? min : null,
    buyable: Boolean(raw.buyable ?? raw["buyable?"]),
    in_stock: Boolean(raw.in_stock ?? raw["in_stock?"]),
  }
}

export const transient = (error: unknown) =>
  error instanceof AliError && (error.status === 0 || error.status === 429 || error.status >= 500)

export const getStore = (ctx: AliContext) =>
  cached("store", async () => {
    const store = await request<Store>("/store", ctx)
    store.payment_methods = (store.payment_methods ?? []).map((m: any) => ({ ...m, cash: Boolean(m.cash ?? m["cash?"]) }))
    return store
  })

export const getCategories = (ctx: AliContext) =>
  cached("categories", async () => {
    const { data } = await request<{ data: Category[] }>("/categories", ctx)
    return [...data].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "es"))
  })

/** Un producto. Devuelve null si no existe o no está publicado. */
export const getProduct = (id: string, ctx: AliContext) =>
  cached(`product:${id}`, async () => {
    try {
      return normalizeProduct(await request<unknown>(`/products/${encodeURIComponent(id)}`, ctx))
    } catch (error) {
      if (error instanceof AliError && (error.status === 404 || error.status === 422)) return null
      throw error
    }
  })

/**
 * El catálogo publicado completo (hasta 2.000 productos), recorriendo el cursor de
 * /products de a 100. La búsqueda, los filtros y la paginación del sitio trabajan
 * sobre esta copia cacheada porque la API no ofrece búsqueda ni orden por precio.
 */
export const getCatalog = (ctx: AliContext) =>
  cached("catalog", async () => {
    const products: Product[] = []
    let cursor: string | null = null
    let truncated = false
    for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
      const query = new URLSearchParams({ limit: "100" })
      if (cursor) query.set("starting_after", cursor)
      const result: Page<Product> = await request<Page<Product>>(`/products?${query}`, ctx)
      products.push(...result.data.map(normalizeProduct))
      if (!result.has_more || !result.next_cursor) break
      cursor = result.next_cursor
      if (page === MAX_CATALOG_PAGES - 1) truncated = true
    }
    return { products, truncated }
  })

/**
 * Contexto de Ali para una request de Astro: la IP real del comprador. Sale de
 * `clientAddress`, que cada adaptador (Netlify, Vercel, Node) resuelve desde la
 * conexión o el header de su propia plataforma; nunca de un header que mande el cliente.
 */
export function aliContext(astro: { clientAddress?: string }): AliContext {
  try {
    return { buyerIp: astro.clientAddress?.trim() || undefined }
  } catch {
    return {}
  }
}
