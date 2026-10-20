# Medir el rendimiento de SPMM (antes y después)

Regla desde el 20/10/2026: **cada feature se mide antes y después**, y se testea a medida
que se avanza. Estas herramientas son las que se usaron ese día para las cinco cosas:
renders de más, peso del JavaScript (lazy loading), pedidos y caché, consultas lentas y
N+1, e imágenes/fuentes/scripts. No hace falta instalar nada: Python del `.venv`, Node 22
y el Chrome de la máquina.

Todo se corre **desde la raíz del repo** (o del worktree).

## 1. Peso del JavaScript de cada pantalla

```bash
cd frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:8010 npx next build --turbopack
python3 ../rendimiento/medir_bundle.py .next antes.json
```

Da, por ruta, el JS que se baja al ABRIR la pantalla (crudo y comprimido) y qué
librerías pesadas viajan ahí. Lo que se carga con `next/dynamic` o `import()` no cuenta:
es justamente lo que se quiere sacar del arranque.

Para saber **qué archivo** ocupa cuánto (el «bundle analyzer», que con Turbopack no
viene): compilar una vez con `productionBrowserSourceMaps: true` en `next.config.ts`
(sin commitearlo) y

```bash
python3 ../rendimiento/analizar_mapas.py .next /operaciones/page 40
```

Ojo: lo que importa el layout (Sidebar, Topbar, el cartel del aviso…) viaja en TODAS las
pantallas, y Turbopack no separa una constante de las demás del mismo archivo: importar
una función chica de un archivo grande trae el archivo entero.

## 2. Backend con los datos reales, sin poder escribir

```bash
BENCH_LOG=antes.jsonl .venv/bin/python rendimiento/bench_backend.py 8010
```

Levanta la app del repo contra Supabase por el **6543** (no gasta las 15 plazas del 5432
que usa producción) con **cada transacción en READ ONLY**: si algo intenta escribir,
Postgres lo rechaza (al arrancar se ven las migraciones fallando por eso: es lo
esperado). Entra como un admin real sin token. Por cada pedido anota en el JSONL cuántas
consultas hizo, cuánto tardó la base y qué sentencias se repitieron: **una sentencia
repetida N veces en un pedido es la firma del N+1**.

Para comparar dos versiones del backend contra los MISMOS datos (la base de producción
cambia mientras se mide), levantar la vieja en otro puerto desde un worktree y:

```bash
git worktree add --detach /tmp/base origin/main && cd /tmp/base
BENCH_LOG=viejo.jsonl <repo>/.venv/bin/python <repo>/rendimiento/bench_backend.py 8011
python3 rendimiento/comparar_backend.py viejo.jsonl nuevo.jsonl 3
```

Dice, ruta por ruta, si el JSON es **idéntico** (la prueba de que no se rompió nada) y
las consultas y el tiempo de cada lado. Los tiempos desde una compu de acá están inflados
(~36 ms por ida y vuelta a São Paulo; en Cloud Run es ~1 ms): lo que vale es la cantidad
de consultas y la diferencia relativa.

## 3. Pantallas: renders, pedidos, CPU

Con el front compilado sirviéndose (`npx next start -p 3107`) y el banco del punto 2:

```bash
CPU=4 ESCENARIOS=1 node rendimiento/medir_pantallas.mjs http://127.0.0.1:3107 antes.json
```

Chrome sin pantalla manejado por el protocolo de DevTools (lo mismo que usa el MCP de
Chrome DevTools), con la CPU frenada 4× como una PC del taller. Por pantalla: JS bajado,
pedidos a la API (y cuáles se repiten), tiempo de script, tareas largas (TBT), LCP y
**cuántos componentes de React se dibujaron** (un gancho de DevTools que anda en el build
de producción). Con `ESCENARIOS=1` además mide qué pasa al volver a la pestaña y en 10 s
sin tocar nada (timers, polling). Sesión de mentira: JWT armado a mano (el front sólo
lee `exp`) y un usuario con `nombre` y `apellido`.

## 4. Producción

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="spmm-backend" AND httpRequest.requestMethod!="OPTIONS"' --project spmm-metlo-9323 --freshness=7d --limit 20000 --format='json(timestamp,httpRequest.requestMethod,httpRequest.requestUrl,httpRequest.status,httpRequest.latency,httpRequest.responseSize)' > prod.json
python3 rendimiento/resumen_prod.py prod.json
.venv/bin/python rendimiento/pg_lentas.py
```

Latencia p50/p95 por ruta en Cloud Run (lo que daría Sentry como «transacciones lentas»)
y las consultas más caras según `pg_stat_statements` (sólo lectura, por el 6543).

## Lo que se aprendió el 20/10/2026

- La base es chica (la tabla más grande tiene 18 mil filas) y no fue el cuello: lo lento
  era lo que se mandaba (`/ordenes`: 4,4 MB sin comprimir) y lo que se repetía.
- Medir antes evita trabajo inútil: subir la compresión de nivel 6 a 9 no costaba nada
  con estos datos (128 ms los dos), así que se dejó como estaba.
- Una optimización vale si el JSON que sale es el mismo. Comparar contra el backend viejo
  con los mismos datos, no contra una foto de hace un rato.
