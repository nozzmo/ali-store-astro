// Tarjeta del servidor MCP público de la tienda en Ali (/hub/<slug>/mcp).
import type { APIRoute } from "astro"
import { apiUrl } from "../../../lib/ali"
import { loadShell, transientResponse } from "../../../lib/site"

export const GET: APIRoute = async (context) => {
  try {
    const { store } = await loadShell(context)
    const hub = `${new URL(apiUrl()).origin}/hub/${store.slug}`
    const upstream = await fetch(`${hub}/mcp/server-card`, { signal: AbortSignal.timeout(8000) })
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      Link: `<${hub}/mcp>; rel="mcp"`,
      "Cache-Control": "public, max-age=0",
      "CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    })
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    return transientResponse(error)
  }
}
