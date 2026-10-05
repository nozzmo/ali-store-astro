// JSON-LD (schema.org) con datos reales de la API. Nada inventado: sin ratings, sin marca.
import { available, productPath } from "./catalog"
import type { Product, Store } from "./types"
import { absolute } from "./site"

export function organization(store: Store, origin: string) {
  return {
    "@type": "Organization",
    "@id": `${origin}/#org`,
    name: store.name,
    url: `${origin}/`,
    ...(store.logo_url ? { logo: store.logo_url } : {}),
  }
}

export function website(store: Store, origin: string) {
  return {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: `${origin}/`,
    name: store.name,
    inLanguage: "es",
    publisher: { "@id": `${origin}/#org` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${origin}/?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  }
}

export function breadcrumbs(items: { name: string; url: string }[], origin: string) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absolute(origin, it.url) })),
  }
}

const availability = (ok: boolean) => (ok ? "https://schema.org/InStock" : "https://schema.org/OutOfStock")

export function product(p: Product, origin: string, categoryName?: string) {
  const url = absolute(origin, productPath(p))
  const offers = p.variants
    .filter((v) => v.price !== null)
    .map((v) => ({
      "@type": "Offer",
      sku: v.id,
      name: v.name,
      price: v.price,
      priceCurrency: v.currency,
      availability: availability(v.available),
      url,
      seller: { "@id": `${origin}/#org` },
    }))
  const prices = offers.map((o) => Number(o.price))
  return {
    "@type": "Product",
    "@id": `${url}#product`,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.images.length ? { image: p.images.map((i) => i.url) } : {}),
    sku: p.id,
    ...(categoryName ? { category: categoryName } : {}),
    offers:
      offers.length > 1
        ? {
            "@type": "AggregateOffer",
            priceCurrency: offers[0].priceCurrency,
            lowPrice: Math.min(...prices).toFixed(2),
            highPrice: Math.max(...prices).toFixed(2),
            offerCount: offers.length,
            availability: availability(available(p)),
            offers,
          }
        : offers[0],
  }
}

export function itemList(name: string, products: Product[], origin: string) {
  return {
    "@type": "ItemList",
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absolute(origin, productPath(p)), name: p.name })),
  }
}

export const graph = (...nodes: unknown[]) => ({ "@context": "https://schema.org", "@graph": nodes.filter(Boolean) })
