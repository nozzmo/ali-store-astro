import type { APIRoute } from "astro"
import { getCatalog } from "../lib/ali"
import { categoryPath, productPath } from "../lib/catalog"
import { loadShell, siteOrigin, transientResponse } from "../lib/site"

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!)

export const GET: APIRoute = async (context) => {
  try {
    const shell = await loadShell(context)
    const { products } = await getCatalog(shell.ali)
    const origin = siteOrigin(context.url)
    const urls = [
      `${origin}/`,
      ...shell.categories.map((c) => `${origin}${categoryPath(shell.slugs.get(c.id)!)}`),
      ...products.map((p) => `${origin}${productPath(p)}`),
    ]
    const imageOf = new Map(products.map((p) => [`${origin}${productPath(p)}`, p.images[0]?.url]))
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${xml(u)}</loc>${imageOf.get(u) ? `<image:image><image:loc>${xml(imageOf.get(u)!)}</image:loc></image:image>` : ""}</url>`).join("\n")}
</urlset>
`
    return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0", "CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } })
  } catch (error) {
    return transientResponse(error)
  }
}
