// @ts-check
import { defineConfig, envField } from "astro/config"
import node from "@astrojs/node"
import netlify from "@astrojs/netlify"
import vercel from "@astrojs/vercel"
import { readFileSync } from "node:fs"

// El adaptador se elige solo: Netlify y Vercel definen NETLIFY / VERCEL al compilar.
// En cualquier otro lado queda un servidor Node (`npm start`).
const adapter = process.env.NETLIFY ? netlify() : process.env.VERCEL ? vercel() : node({ mode: "standalone" })

// Todas las variables se leen en tiempo de ejecución (access: "secret"), así una
// agencia cambia de llave test a live sin recompilar. La publicable igual llega al
// navegador, pero la manda el servidor en el HTML; nunca la secreta.
const runtime = (optional = true) => ({ context: /** @type {const} */ ("server"), access: /** @type {const} */ ("secret"), optional })

// Checkout en local: Ali exige https en return_url/cancel_url (con llave test acepta
// https://localhost). Con DEV_CERT y DEV_KEY (p. ej. de mkcert) `npm run dev` sirve por https.
const https = process.env.DEV_CERT && process.env.DEV_KEY ? { cert: readFileSync(process.env.DEV_CERT), key: readFileSync(process.env.DEV_KEY) } : undefined

export default defineConfig({
  output: "server",
  adapter,
  trailingSlash: "never",
  build: { inlineStylesheets: "auto" },
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
  vite: { server: { https } },
  env: {
    schema: {
      ALI_PUBLISHABLE_KEY: envField.string({ ...runtime(true) }),
      ALI_SECRET_KEY: envField.string({ ...runtime(true) }),
      ALI_API_URL: envField.string({ ...runtime(true), default: "https://soyali.com/api/store/v1" }),
      SITE_URL: envField.string({ ...runtime(true) }),
      ALI_BUSINESS_SLUG: envField.string({ ...runtime(true) }),
      ALI_CACHE_SECONDS: envField.number({ ...runtime(true), default: 60 }),
      // Modo catálogo: sin carrito ni checkout, con un botón «Consultar».
      ALI_CATALOG_ONLY: envField.boolean({ ...runtime(true), default: false }),
      ALI_CONTACT_URL: envField.string({ ...runtime(true) }),
    },
  },
})
