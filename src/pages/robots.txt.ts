import type { APIRoute } from "astro"
import { siteOrigin } from "../lib/site"

export const GET: APIRoute = ({ url }) => {
  const origin = siteOrigin(url)
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /carrito",
      "Disallow: /checkout",
      "Disallow: /pedido/",
      "Disallow: /no-disponible",
      "Disallow: /*?*q=",
      "",
      `Sitemap: ${origin}/sitemap.xml`,
      `# Resumen para asistentes de IA: ${origin}/llms.txt`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  )
}
