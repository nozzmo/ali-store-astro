// llms.txt (https://llmstxt.org): qué es la tienda, qué vende y cómo comprar por API.
import type { APIRoute } from "astro"
import { apiUrl, getCatalog } from "../lib/ali"
import { available, categoryPath, productPath } from "../lib/catalog"
import { loadShell, siteOrigin, transientResponse } from "../lib/site"

export const GET: APIRoute = async (context) => {
  try {
    const shell = await loadShell(context)
    const { store, categories, slugs, catalogOnly } = shell
    const { products } = await getCatalog(shell.ali)
    const origin = siteOrigin(context.url)
    const names = new Map(categories.map((c) => [c.id, c.name]))
    const { pickup, delivery } = store.fulfillment
    const api = apiUrl()
    const hub = `${new URL(api).origin}/hub/${store.slug}`
    const line = (p: (typeof products)[number]) => `- [${p.name}](${origin}${productPath(p)})${p.price_label ? `: ${p.price_ranged ? "desde " : ""}${p.price_label}` : ""}${available(p) ? "" : " (agotado)"}${names.get(p.category_id ?? "") ? ` · ${names.get(p.category_id ?? "")}` : ""}`
    const body = `# ${store.name}

> ${catalogOnly ? "Catálogo" : "Tienda en línea"} de ${store.name}. ${products.length} productos en ${categories.length} categorías. Precios en ${store.currency}.${pickup.enabled ? ` Retiro en tienda${pickup.address ? ` (${pickup.address})` : ""}.` : ""}${delivery.enabled ? " Envío a domicilio cotizado según la dirección." : ""}${catalogOnly ? " Catálogo sin compra en línea: se consulta con la tienda." : " Pago en línea."}

Los precios, existencias y totales los calcula Ali (la plataforma de la tienda) en cada consulta; esta página es un resumen.

## Categorías

${categories.map((c) => `- [${c.name}](${origin}${categoryPath(slugs.get(c.id)!)})${c.description ? `: ${c.description}` : ""}`).join("\n")}

## Productos

${products.slice(0, 500).map(line).join("\n")}

## Comprar por API (agentes)

- Store API de Ali — OpenAPI: ${api}/openapi.json
- Guía para LLMs de la Store API: ${api}/llms.txt
- Servidor MCP de la tienda: ${hub}/mcp (tarjeta: ${origin}/.well-known/mcp/server-card.json)

## Optional

- [Mapa del sitio](${origin}/sitemap.xml)
`
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0", "CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } })
  } catch (error) {
    return transientResponse(error)
  }
}
