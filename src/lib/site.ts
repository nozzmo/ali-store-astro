// Lo que toda página necesita: datos del negocio, categorías, URL pública y acento.
import type { AstroGlobal } from "astro"
import { ALI_BUSINESS_SLUG, ALI_CATALOG_ONLY, ALI_CONTACT_URL, SITE_URL } from "astro:env/server"
import { AliError, aliContext, getCategories, getStore, type AliContext } from "./ali"
import { categorySlugs } from "./catalog"
import type { Category, Store } from "./types"

export interface Shell {
  ali: AliContext
  store: Store
  categories: Category[]
  slugs: Map<string, string>
  /** El slug que Ali busca en `data-ali-business` para verificar el dominio. */
  businessSlug: string
  /**
   * Modo catálogo (sin carrito ni checkout). Manda Ali: si /store dice
   * `catalog_only: true` (el dueño eligió no vender en línea) o `checkout_enabled: false`
   * (el negocio no tiene cómo cobrar), la tienda es un catálogo.
   * ALI_CATALOG_ONLY=true lo fuerza aunque Ali pueda cobrar.
   */
  catalogOnly: boolean
  /** A dónde lleva «Consultar»: ALI_CONTACT_URL o el chat del negocio que manda Ali. */
  contactUrl: string | null
}

export async function loadShell(astro: { clientAddress?: string }): Promise<Shell> {
  const ali = aliContext(astro)
  const [store, categories] = await Promise.all([getStore(ali), getCategories(ali)])
  return {
    ali,
    store,
    categories,
    slugs: categorySlugs(categories),
    businessSlug: ALI_BUSINESS_SLUG || store.slug,
    catalogOnly: ALI_CATALOG_ONLY === true || store.catalog_only === true || store.checkout_enabled === false,
    contactUrl: ALI_CONTACT_URL || store.chat_url || null,
  }
}

/** Origen público del sitio: SITE_URL si está, si no el de la request. */
export function siteOrigin(url: URL): string {
  return (SITE_URL || url.origin).replace(/\/+$/, "")
}

export const absolute = (origin: string, path: string) => (/^https?:\/\//.test(path) ? path : `${origin}${path.startsWith("/") ? "" : "/"}${path}`)

/**
 * Corre la carga de datos de una página. Si Ali no responde (429, caída, llave mala)
 * no devolvemos un 500: reescribimos a /no-disponible, que explica qué pasa y
 * cuándo reintentar.
 */
export async function guard<T>(astro: AstroGlobal, load: () => Promise<T>): Promise<T | Response> {
  try {
    return await load()
  } catch (error) {
    if (!(error instanceof AliError)) throw error
    astro.locals.aliFailure = { status: error.status, retryAfter: error.retryAfter, code: error.problem?.code as string | undefined }
    return astro.rewrite("/no-disponible")
  }
}

/** Acento de marca: el color de Ali si es un hex válido; si no, negro. Texto encima con contraste AA. */
export function accent(store: Store): { color: string; ink: string } {
  const hex = store.brand_color?.trim() ?? ""
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) return { color: "#111111", ink: "#ffffff" }
  const value = hex.startsWith("#") ? hex : `#${hex}`
  const channel = (i: number) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  // Un acento muy claro no sirve sobre fondo blanco: volvemos a neutro.
  if (contrast(luminance, 1) < 3) return { color: "#111111", ink: "#ffffff" }
  return { color: value, ink: contrast(luminance, 1) >= 4.5 ? "#ffffff" : "#111111" }
}

/** Para endpoints de texto (sitemap, llms.txt): un 503 con Retry-After en vez de un 500. */
export function transientResponse(error: unknown): Response {
  if (!(error instanceof AliError)) throw error
  const retry = String(Math.min(Math.max(error.retryAfter ?? 30, 5), 300))
  return new Response("La tienda no está disponible en este momento. Reintentá en unos segundos.\n", {
    status: error.status === 401 || error.problem?.code === "not-configured" ? 500 : 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": retry, "Cache-Control": "no-store" },
  })
}
