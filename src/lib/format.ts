// Utilidades compartidas entre servidor y navegador. Sólo FORMATEAN: ningún precio
// se calcula acá; los montos llegan siempre hechos desde la API de Ali.

export function money(amount: string | number | null | undefined, currency = "GTQ"): string {
  if (amount === null || amount === undefined || amount === "") return ""
  const value = Number(amount)
  if (!Number.isFinite(value)) return String(amount)
  // Mismo formato que los `price_label` de Ali («Q75.00»): símbolo pegado y dos decimales.
  return `${currencySymbol(currency)}${value.toFixed(2)}`
}

const symbols = new Map<string, string>()
function currencySymbol(currency: string): string {
  if (!symbols.has(currency)) {
    let symbol = `${currency} `
    try {
      symbol = new Intl.NumberFormat("es-GT", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? symbol
    } catch {}
    symbols.set(currency, symbol)
  }
  return symbols.get(currency)!
}

export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  )
}

/** Texto comparable para la búsqueda: sin tildes, sin mayúsculas. */
export const fold = (text: string | null | undefined) =>
  (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export const ORDER_STATUS: Record<string, { label: string; tone: "wait" | "ok" | "done" | "bad"; help: string }> = {
  pending: { label: "Recibido", tone: "wait", help: "La tienda recibió tu pedido y lo va a confirmar pronto." },
  confirmed: { label: "Confirmado", tone: "ok", help: "La tienda confirmó tu pedido y lo está preparando." },
  fulfilled: { label: "Entregado", tone: "done", help: "Tu pedido ya fue entregado. ¡Gracias por tu compra!" },
  cancelled: { label: "Cancelado", tone: "bad", help: "Este pedido fue cancelado. Si tenés dudas, escribile a la tienda." },
}

export const orderStatus = (status: string) =>
  ORDER_STATUS[status] ?? { label: status, tone: "wait" as const, help: "" }

/** Avisos que impiden pagar hasta que el comprador quite el producto. */
export const BLOCKING_ISSUES = ["out_of_stock", "gone"]

/** Mensajes en español para los avisos de revalidación del carrito que manda Ali. */
export function issueMessage(issue: { code?: string; line?: { product_name?: string } | null; from?: string | null; to?: string | null }, currency = "GTQ"): string {
  const name = issue.line?.product_name || "Un producto"
  switch (issue.code) {
    case "price_changed":
      return `${name} cambió de precio${issue.from && issue.to ? `: de ${money(issue.from, currency)} a ${money(issue.to, currency)}` : ""}.`
    case "gone":
      return `${name} ya no está disponible (la tienda lo pausó o dejó de venderlo).`
    case "out_of_stock":
      return `${name} se agotó.`
    case "reduced":
      return `${name} tiene menos existencias; ajustamos la cantidad a lo disponible.`
    default:
      return `${name}: revisá este producto antes de pagar.`
  }
}
