// Formas publicadas por la Store API de Ali (/api/store/v1). Fuente: su openapi.json.

export interface PaymentMethod {
  id: string
  label: string
  description?: string | null
  kind: string
  cash: boolean
  default?: boolean
}

export interface Store {
  id: string
  name: string
  slug: string
  currency: string
  logo_url: string | null
  brand_color: string | null
  checkout_enabled: boolean
  /** El dueño eligió mostrar el catálogo sin vender en línea. */
  catalog_only?: boolean
  /** Chat público del negocio en Ali (lo manda /store). */
  chat_url?: string | null
  payment_methods: PaymentMethod[]
  fulfillment: {
    default: "pickup" | "delivery"
    pickup: { enabled: boolean; address: string | null }
    delivery: { enabled: boolean; requires_address: boolean }
  }
}

export interface Category {
  id: string
  name: string
  description: string | null
  position: number | null
  image_url: string | null
}

export interface ProductImage {
  url: string
  width: number | null
  height: number | null
  alt: string | null
}

export interface Variant {
  id: string
  name: string
  options: Record<string, string>
  price: string | null
  price_label: string | null
  currency: string
  stock: number | null
  /** buyable && in_stock: se puede agregar al carrito. */
  available: boolean
  /** Tiene precio publicado. */
  buyable: boolean
  in_stock: boolean
  max_quantity: number
  stock_badge: "sold_out" | "low" | null
  default?: boolean
  image_url: string | null
}

export interface Product {
  id: string
  name: string
  description: string | null
  category_id: string | null
  images: ProductImage[]
  variants: Variant[]
  /** Precio mínimo como número (el API lo manda como string decimal). */
  price_min: number | null
  price_label: string | null
  price_ranged: boolean
  buyable: boolean
  in_stock: boolean
}

export interface Page<T> {
  data: T[]
  has_more: boolean
  next_cursor: string | null
}
