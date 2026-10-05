// Red de seguridad: si una página deja escapar un error de Ali (429, caída),
// el comprador ve «no disponible / mucho tráfico» con 503, nunca un 500.
import { defineMiddleware } from "astro:middleware"
import { AliError } from "./lib/ali"

export const onRequest = defineMiddleware(async (context, next) => {
  try {
    const response = await next()
    response.headers.set("X-Content-Type-Options", "nosniff")
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    return response
  } catch (error) {
    if (!(error instanceof AliError) || context.url.pathname === "/no-disponible") throw error
    context.locals.aliFailure = { status: error.status, retryAfter: error.retryAfter, code: error.problem?.code as string | undefined }
    return context.rewrite("/no-disponible")
  }
})
