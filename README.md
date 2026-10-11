# P.07 · Listado de moldes — registro vivo (Silver Industrial)

Reemplaza el Excel P.07 por un registro en línea que editan los cambiadores de molde desde el celular o la tablet.
Cada movimiento queda con **nombre + fecha** (y la **IP**, visible solo para el administrador). Imprime el P.07 con el formato vigente (A4 vertical, Rev 02, Cod P.07) y descarga Excel.

Desarrollado por Mgter. Diego Ortiz — Líder de Mejora Continua | Consultor ISO

## Estructura
- `db/schema.sql` y `db/seed.sql`: tablas `posiciones` y `moldes` + carga inicial de la planilla al 09/06/26 (354 posiciones, 394 moldes).
- raíz: API en Cloudflare Worker (`p07-moldes-api`), 37 pruebas de API aprobadas.
- `app/`: página única (HTML + JS puro) para GitHub Pages, 35 pruebas de interfaz aprobadas.

## Despliegue (≈15 min)
1. **Neon** (proyecto de NC Silver): SQL Editor → pegar y ejecutar `db/schema.sql`, luego `db/seed.sql`. La semilla se bloquea sola si se corre por segunda vez.
2. **Worker** (igual que NC-Silver-API: secrets comunes, sin Secrets Store):
   ```
   npm install
   npx wrangler secret put DATABASE_URL   # cadena de conexión de Neon (la misma que usa NC)
   npx wrangler secret put PLANTA_KEY     # Moldessilverindustrial
   npx wrangler secret put ADMIN_KEY      # una clave distinta, solo para Diego
   npx wrangler deploy
   ```
   Probar: `https://p07-moldes-api.<tu-subdominio>.workers.dev/api/health` → `{"ok":true}`.
3. **App**: si la URL del Worker es distinta, editar `app/config.js`. Subir el contenido de `app/` a un repo con GitHub Pages. Si el sitio no es `https://diegortizdao-collab.github.io`, ajustar `ALLOWED_ORIGINS` en `wrangler.toml` y volver a desplegar.
4. **Portal SGC**: agregar una tarjeta/iframe a la URL de la app (igual que RRHH y Apéndice C).

## Reglas de uso
- Clave de planta: ve, mueve, cambia estado y "personal para mover". Clave de administrador: además crea moldes/posiciones, edita datos maestros y ve la IP.
- Mover a un estante numerado ocupado muestra aviso y pide confirmar (no bloquea). Los pallets no tienen límite.
- No se guarda historial de posiciones: solo quién y cuándo hizo el último cambio.
- Posiciones: estante 1–334 (y BIS), pallets P1–P18, S/A, Dep. PT, PT, NO.

## Criterios de la carga inicial (confirmados por Diego)
- Fuente: Listado de moldes (posiciones reales) + Histórico del 08/09/26 (moldes vivos que faltaban). Total: 404 moldes en 354 posiciones.
- 307 BIS y 308 BIS son posiciones distintas (la cartelería quedó así). Cada código de estantería es una posición independiente; se pueden crear más desde Administración.
- Posición **NO** = molde que se llevaron, con la baja sin oficializar (11 moldes).
- Las 59 filas en rojo del Histórico (Eliminado) no se cargan.
- `db/revisar_carga.csv`: 3 moldes del Histórico cuya posición ya está ocupada en el Listado; quedaron en S/A hasta que los cambiadores los ubiquen.
- Nº Molde = ubicación en la estantería; Nº Control = identificación única desde el ingreso a Silver.

## Impresión
- Formato por defecto = rótulo que usa Bureau Veritas: Nº Molde | Especificación | Cliente / Silver | Nº Control.
- Orden por estantería (cambiadores), por cliente (cambiadores) o por Nº de control (correlación de ingresos, como el Histórico).
- Formato completo: suma Personal para mover y Estado.

## Pendientes
1. Como el P.07 pasa a ser registro controlado: actualizar el procedimiento y sumar un respaldo semestral (como Q.11).
2. Revisar con los cambiadores los moldes cuyas posiciones difieren entre Listado e Histórico (se tomó el Listado por ser la ubicación real).

## Ficha de producto ↔ P.07 (vínculos)
- Tabla `vinculos (familia_id, molde_id, confirmado, origen, ...)`: `db/vinculos.sql` (correr UNA vez en el SQL Editor de Neon, después del schema y la semilla).
- La ficha no guarda posiciones: las lee en vivo del P.07 a través del vínculo, así hay un solo lugar donde se mueve un molde.
- Trae 239 vínculos **sugeridos** (misma posición que la planilla vieja de la ficha + cliente coincidente; en S/A y pallets además exige palabras en común con el nombre). Quedan marcados "Sugerido — falta confirmar" hasta que el administrador los confirme.
- Endpoints: `GET /api/vinculos` (cualquier clave); `PUT /api/vinculos/:familia` {nombre, molde_id}, `POST /api/vinculos/:familia/confirmar`, `DELETE /api/vinculos/:familia/:molde_id` (solo admin).
- Una familia puede tener más de un molde vinculado; un molde puede servir a varias familias.

## Fotos de la ficha
- Tabla `fotos`: `db/fotos.sql` (correr UNA vez en Neon). Guarda en la base la foto de cada variante y el logo de cada familia (la ficha las achica antes: ~100 KB c/u), sin servicios extra ni bindings nuevos.
- `POST /api/fotos` (clave de planta: fotos de producto; admin: también logos) reemplaza la foto anterior de esa variante. `GET /api/fotos` lista. `GET /api/fotos/:uuid/img` es pública (la pide una etiqueta `<img>`) y el uuid cambia en cada reemplazo, así que el navegador la cachea. `DELETE` solo admin.
- Si algún día se pasa de unos miles de fotos, se migra a R2 cambiando solo esa ruta.

## Siguiente fase
Edición de campos de la ficha compartida entre dispositivos (hoy queda en el navegador) y lectura del maestro desde el planificador.

## Deploy desde Cloudflare (sin Node local)
Workers & Pages → Import a repository → este repo. Root directory `/`, deploy command `npx wrangler deploy`. Los secrets (DATABASE_URL, PLANTA_KEY, ADMIN_KEY) están en Secrets Store y declarados en wrangler.toml (si no figuran ahí, el deploy los borra).
