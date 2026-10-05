# Tienda Astro para Ali

Una tienda en línea completa y sin marca sobre la **Store API de Ali**: catálogo con
búsqueda, filtros y categorías, ficha de producto con galería y variantes, carrito,
checkout con envío cotizado y página de pedido. Todo lo del negocio —nombre, logo,
color, productos, fotos, precios, envío y métodos de pago— sale de la API de Ali.
El template no trae textos, colores ni fotos de ningún negocio.

## Arranque en 3 pasos

1. En Ali → **Integraciones → Store API**, creá una llave **publicable** (`ali_pk_test_…`)
   y, si querés, una **secreta** (`ali_sk_test_…`).
2. Copiá `.env.example` a `.env` y pegá las llaves.
3. `npm install && npm run dev` → <http://localhost:4321>

Para producción cambiá a las llaves `ali_pk_live_…` / `ali_sk_live_…` y verificá tu
dominio (ver abajo).

## Deploy

Los botones copian este template a un repo tuyo y lo publican. Los dos piden **sólo las
llaves**.

[![Deploy en Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/nozzmo/ali-store-astro)
[![Deploy en Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nozzmo/ali-store-astro&env=ALI_PUBLISHABLE_KEY,ALI_SECRET_KEY&envDescription=Llaves%20de%20la%20Store%20API%20de%20Ali%20(Integraciones%20%E2%86%92%20Store%20API))

Si preferís hacerlo a mano: `npx degit nozzmo/ali-store-astro mi-tienda`, o «Use this
template» en GitHub.

- **Netlify** lee `netlify.toml` (pide las variables de `[template.environment]`).
- **Vercel** detecta Astro solo; las variables las pide el botón.
- **Cualquier servidor Node**: `npm run build && npm start` (puerto `PORT`, por defecto 8080).

El adaptador se elige solo al compilar: Netlify, Vercel o Node.

## Variables

| Variable | Obligatoria | Para qué |
|---|---|---|
| `ALI_PUBLISHABLE_KEY` | Sí | Carrito y checkout desde el navegador. Es pública. |
| `ALI_SECRET_KEY` | Recomendada | El servidor lee el catálogo con ella y manda `Ali-Buyer-IP` con la IP del comprador, así el límite de Ali se cuenta por comprador y no por tu servidor. **Nunca** llega al navegador. |
| `ALI_API_URL` | No | Por defecto `https://soyali.com/api/store/v1`. |
| `SITE_URL` | No | Tu dominio público (`https://mitienda.com`) para canonical, sitemap y Open Graph. Si falta, se usa el de la request. |
| `ALI_BUSINESS_SLUG` | No | Fuerza el slug de `data-ali-business`. Por defecto viene de la API. |
| `ALI_CACHE_SECONDS` | No | Segundos de caché del catálogo (60). |
| `ALI_CATALOG_ONLY` | No | `true` fuerza el modo catálogo (ver abajo). |
| `ALI_CONTACT_URL` | No | A dónde lleva «Consultar» en modo catálogo (p. ej. `https://wa.me/502…`). Si falta, se usa el `chat_url` del negocio que manda Ali. |

Todas se leen en tiempo de ejecución: para pasar de test a live alcanza con cambiar
las variables y reiniciar, sin recompilar.

## Verificar tu dominio en Ali

Para vender en vivo, Ali tiene que confiar en tu dominio. Lo verifica abriendo tu
portada y buscando el atributo **`data-ali-business="<slug-de-tu-negocio>"`**.

Este template ya lo pone en el `<body>` de todas las páginas, con el slug que devuelve
la API (o el de `ALI_BUSINESS_SLUG`). Sólo tenés que:

1. Publicar el sitio en tu dominio con **https**.
2. En Ali → Integraciones, registrar el dominio (`https://mitienda.com`) y verificarlo.

Para comprobarlo: `curl -s https://mitienda.com/ | grep data-ali-business`.

Con una llave **test** Ali acepta cualquier origen sin verificar (local, deploy previews de
Netlify o Vercel). Las llaves **live** sólo funcionan desde dominios verificados.

## Checkout en local

Ali exige que `return_url` y `cancel_url` sean **https**. El template usa siempre el
origen real del sitio (`location.origin`), nunca fuerza `http`. Con llave test Ali
acepta `https://localhost`, así que para probar el pago en local levantá el sitio con
https:

```bash
mkcert -install && mkcert localhost          # o cualquier certificado para localhost
DEV_CERT=./localhost.pem DEV_KEY=./localhost-key.pem npm run dev
# → https://localhost:4321
```

Con `npm start` (build de producción) las variables son `SERVER_CERT_PATH` y
`SERVER_KEY_PATH`. Por `http://` podés navegar y armar el carrito, pero el botón de
pagar va a avisar que hace falta https.

## Modo catálogo (sin carrito)

Para negocios que muestran productos y precios pero venden por conversación.

- **Lo decide Ali**: si `GET /store` responde `catalog_only: true` (el dueño eligió no
  vender en línea) o `checkout_enabled: false` (no tiene un método de pago activo), la
  tienda funciona como catálogo.
- **`ALI_CATALOG_ONLY=true` lo fuerza** aunque Ali pueda cobrar.

En modo catálogo: no hay ícono de carrito ni botones de agregar; `/carrito` y
`/checkout` redirigen al catálogo; los precios se siguen viendo; y el encabezado y cada
ficha muestran **«Consultar»**, que abre `ALI_CONTACT_URL` o, si no está, el chat del
negocio en Ali (`chat_url` de `/store`). Sin ninguno de los dos, no se muestra el botón.

## Agotados y productos pausados

- **Agotado** (sin existencias): la tarjeta sigue en la grilla con el aviso «Agotado» y
  queda al final en cualquier orden; «Solo disponibles» lo oculta. En la ficha, las
  opciones agotadas aparecen tachadas y no se pueden elegir; si se agotaron todas, el
  botón dice «Agotado» y está deshabilitado. Si una opción se agota mientras el
  comprador mira, Ali responde `409` (`out-of-stock`) al agregar y la ficha la marca agotada.
- **Sin precio** (todas las opciones sin precio): no es un agotado. La tarjeta dice
  «Consultar» y la ficha ofrece «Consultar precio», que abre el contacto del negocio.
- **Pausado** (la tienda lo dejó inactivo, en borrador o archivado): Ali no lo lista y
  `GET /products/{id}` da 404. Su URL muestra «Este producto no está disponible» con
  estado 404 y enlaces al catálogo.
- **En un carrito guardado**: Ali avisa (`out_of_stock` o `gone`) y el template muestra
  qué producto es, un botón «Quitar del carrito» y bloquea el pago hasta quitarlo. Si se
  agota con el checkout abierto, Ali responde `409 cart-changed` al pagar, corrige el
  carrito y el resumen se redibuja con el total nuevo.

## Qué hace cada página

| Ruta | Qué muestra |
|---|---|
| `/` | Portada (nombre del negocio, destacados, categorías) y catálogo completo |
| `/categoria/<slug>` | Productos de una categoría |
| `/producto/<nombre>-<id>` | Galería, variantes (el precio grande cambia con la opción), cantidad y «Agregar» |
| `/carrito` | Líneas, cantidades, total por línea y subtotal de Ali |
| `/checkout` | Datos, retiro o envío (con cotización), pago y resumen |
| `/pedido/<id>` | Número corto (`#90279B`), estado en español, detalle y entrega |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` | SEO y resumen para asistentes de IA |
| `/openapi.json` | Redirige al OpenAPI de la Store API de Ali |

Búsqueda (`?q=`), tope de precio (`?hasta=`), «solo disponibles» (`?disponibles=1`),
orden (`?orden=`) y página (`?pagina=`) funcionan sin JavaScript; con JavaScript se
aplican solos y «Ver más productos» agrega la página siguiente.

## Reglas que el template respeta

- **Nunca calcula precios en el navegador.** Subtotal, envío y total se muestran tal
  como los devuelve Ali, y el resumen del checkout se redibuja con el carrito que
  responde Ali después de cada cambio (retiro/envío, cotización, cantidades).
- **Un 429 de Ali no es un 500.** El catálogo se cachea unos segundos; si Ali limita o
  se cae, se sirve la última copia buena. Si no hay copia, el comprador ve «Hay mucho
  tráfico» con `503` y `Retry-After`, y la página se reintenta sola.
- **La llave secreta no sale del servidor.** El navegador sólo usa la publicable.
- **Fotos sin estirar.** Todas las imágenes van recortadas (`object-fit: cover`) en
  proporciones fijas; los productos sin foto muestran un marcador neutro.

## Personalizar

- Colores: `src/styles/global.css` (variables en `:root`). El acento toma el
  `brand_color` del negocio en Ali si tiene buen contraste; si no, negro.
- Logo: si el negocio tiene logo en Ali, se usa en el encabezado y como favicon.
- Textos: están en las páginas de `src/pages`, en español neutro.

## Límites conocidos de la API

- `/products` no busca ni ordena por precio: el template recorre el catálogo (hasta
  2.000 productos, de a 100) y busca, filtra y pagina en el servidor sobre esa copia.
- No existe «pausar» una sola variante: una variante sin precio llega con
  `buyable: false` y se muestra como «No disponible».
- La API no da URLs amigables (slugs): las rutas llevan el id al final.
