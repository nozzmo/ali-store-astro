// Cabeceras de caché. Las páginas de catálogo se cachean poco tiempo en la CDN
// (Netlify/Vercel) y se sirven viejas mientras se revalidan: así un pico de
// visitas no se convierte en un pico de llamadas a Ali.
import type { AstroGlobal } from "astro"
import { ALI_CACHE_SECONDS } from "astro:env/server"

export function cacheCatalog(astro: Pick<AstroGlobal, "response">) {
  const seconds = Math.max(0, ALI_CACHE_SECONDS ?? 60)
  const cdn = `public, s-maxage=${seconds}, stale-while-revalidate=600, stale-if-error=86400`
  astro.response.headers.set("Cache-Control", "public, max-age=0, must-revalidate")
  astro.response.headers.set("CDN-Cache-Control", cdn)
  astro.response.headers.set("Netlify-CDN-Cache-Control", `${cdn}, durable`)
  astro.response.headers.set("Vercel-CDN-Cache-Control", cdn)
}

export function noStore(astro: Pick<AstroGlobal, "response">) {
  astro.response.headers.set("Cache-Control", "private, no-store")
}
