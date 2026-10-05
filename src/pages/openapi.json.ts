// La tienda no tiene API propia: el contrato es el de la Store API de Ali.
import type { APIRoute } from "astro"
import { apiUrl } from "../lib/ali"

export const GET: APIRoute = () => new Response(null, { status: 302, headers: { Location: `${apiUrl()}/openapi.json`, "Cache-Control": "public, max-age=3600" } })
