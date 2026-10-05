// Rutas, búsqueda, filtros y paginación del catálogo. Corre en el servidor sobre la
// copia cacheada de /products (ver getCatalog en ./ali).
import type { Category, Product } from "./types"
import { fold, slugify } from "./format"

export const PAGE_SIZE = 24

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** /producto/<nombre>-<uuid>: legible y estable aunque el producto cambie de nombre. */
export const productPath = (p: Pick<Product, "id" | "name">) => `/producto/${slugify(p.name)}-${p.id}`

export function productIdFromParam(param: string | undefined): string | null {
  return param?.match(UUID)?.[1]?.toLowerCase() ?? null
}

/** Slugs únicos por categoría (si dos se llaman igual, la segunda lleva sufijo). */
export function categorySlugs(categories: Category[]): Map<string, string> {
  const seen = new Map<string, number>()
  const slugs = new Map<string, string>()
  for (const c of categories) {
    const base = slugify(c.name)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    slugs.set(c.id, n === 1 ? base : `${base}-${n}`)
  }
  return slugs
}

export const categoryPath = (slug: string) => `/categoria/${slug}`

/** Hay al menos una variante con precio y existencias. */
export const available = (p: Product) => p.variants.some((v) => v.available)

/** Sin precio en ninguna variante: el negocio lo vende «a consultar», no está agotado. */
export const unpriced = (p: Product) => p.variants.length > 0 && p.variants.every((v) => !v.buyable)
export const hasPhoto = (p: Product) => p.images.length > 0

export type Sort = "relevancia" | "precio-asc" | "precio-desc" | "nombre"
export const SORTS: { value: Sort; label: string }[] = [
  { value: "relevancia", label: "Recomendados" },
  { value: "precio-asc", label: "Precio: menor a mayor" },
  { value: "precio-desc", label: "Precio: mayor a menor" },
  { value: "nombre", label: "Nombre (A–Z)" },
]

export interface Filters {
  q: string
  max: number | null
  available: boolean
  sort: Sort
  page: number
}

export function readFilters(url: URL): Filters {
  const p = url.searchParams
  const sort = p.get("orden") as Sort
  const max = Number(p.get("hasta"))
  return {
    q: (p.get("q") ?? "").trim().slice(0, 80),
    max: Number.isFinite(max) && max > 0 ? max : null,
    available: p.get("disponibles") === "1",
    sort: SORTS.some((s) => s.value === sort) ? sort : "relevancia",
    page: Math.max(1, Math.floor(Number(p.get("pagina")) || 1)),
  }
}

export function filterQuery(f: Partial<Filters>, page?: number): string {
  const p = new URLSearchParams()
  if (f.q) p.set("q", f.q)
  if (f.max) p.set("hasta", String(f.max))
  if (f.available) p.set("disponibles", "1")
  if (f.sort && f.sort !== "relevancia") p.set("orden", f.sort)
  if (page && page > 1) p.set("pagina", String(page))
  const s = p.toString()
  return s ? `?${s}` : ""
}

const priceOf = (p: Product) => p.price_min ?? Number.POSITIVE_INFINITY

function score(p: Product, terms: string[], categoryName: string): number {
  const name = fold(p.name)
  const rest = `${fold(p.description)} ${fold(categoryName)} ${p.variants.map((v) => fold(v.name)).join(" ")}`
  let total = 0
  for (const t of terms) {
    if (name.startsWith(t)) total += 6
    else if (name.includes(` ${t}`)) total += 5
    else if (name.includes(t)) total += 4
    else if (rest.includes(t)) total += 1
    else return 0
  }
  return total
}

export function applyFilters(products: Product[], f: Filters, categoryNames: Map<string, string>) {
  const terms = fold(f.q).split(/\s+/).filter(Boolean)
  let list = products.map((p, index) => ({ p, index, score: terms.length ? score(p, terms, categoryNames.get(p.category_id ?? "") ?? "") : 1 }))
  list = list.filter((x) => x.score > 0)
  if (f.max !== null) list = list.filter((x) => priceOf(x.p) <= f.max!)
  if (f.available) list = list.filter((x) => available(x.p))

  // Los agotados quedan siempre al final, con cualquier orden.
  const byAvailability = (a: Product, b: Product) => Number(available(b)) - Number(available(a))
  list.sort((a, b) => {
    const stock = byAvailability(a.p, b.p)
    if (stock !== 0) return stock
    switch (f.sort) {
      case "precio-asc":
        return priceOf(a.p) - priceOf(b.p) || a.p.name.localeCompare(b.p.name, "es")
      case "precio-desc":
        return priceOf(b.p) - priceOf(a.p) || a.p.name.localeCompare(b.p.name, "es")
      case "nombre":
        return a.p.name.localeCompare(b.p.name, "es")
      default:
        return b.score - a.score || a.index - b.index
    }
  })

  const total = list.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(f.page, pages)
  const items = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((x) => x.p)
  return { items, total, page, pages }
}

/** Topes de precio «redondos» a partir de los precios reales del catálogo. */
export function priceSteps(products: Product[]): number[] {
  const prices = products.map((p) => p.price_min).filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b)
  if (prices.length < 6) return []
  const nice = (n: number) => {
    const magnitude = 10 ** Math.floor(Math.log10(n))
    const step = magnitude >= 100 ? magnitude / 2 : magnitude
    return Math.ceil(n / step) * step
  }
  const steps = [0.25, 0.5, 0.75].map((q) => nice(prices[Math.floor(q * (prices.length - 1))]))
  return [...new Set(steps)].filter((n) => n < prices[prices.length - 1])
}
