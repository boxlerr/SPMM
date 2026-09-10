"""Mueve a Supabase Storage los planos que todavía están guardados adentro de la base.

POR QUÉ
    Hasta el 9/9/2026 el archivo iba como BLOB en `plano.archivo`. Con la biblioteca
    completa del taller eso son varios GB en el disco de la base, que en el plan Pro
    incluye 8 GB y cobra US$0,125 el GB extra; el mismo plan incluye 100 GB de Storage
    a US$0,0213 el GB. Ver 2026-09-09_planos_en_storage.sql.

CÓMO
    Fila por fila: sube el objeto al bucket `planos`, y recién cuando Storage confirmó,
    anota `storage_path` y pone `archivo = NULL`. Nunca al revés. Si el script se corta,
    lo que ya se movió quedó movido y lo que no, sigue con su blob y se abre igual: el
    backend lee storage_path primero y cae al blob si no hay.

    Se puede correr con la app andando. No hay ventana en la que un plano no se pueda
    abrir.

    .venv/bin/python -m backend.scripts.planos.migrar_planos_a_storage
    .venv/bin/python -m backend.scripts.planos.migrar_planos_a_storage --aplicar
    .venv/bin/python -m backend.scripts.planos.migrar_planos_a_storage --huerfanos
"""
import asyncio
import json
import os
import sys
import urllib.request

from dotenv import load_dotenv

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
load_dotenv(os.path.join(RAIZ, ".env"))
sys.path.insert(0, RAIZ)

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

from backend.infrastructure import storage_planos

APLICAR = "--aplicar" in sys.argv
HUERFANOS = "--huerfanos" in sys.argv


def _url_de_la_base() -> str:
    url = os.getenv("SUPABASE_DB_URL") or ""
    if not url:
        sys.exit("Falta SUPABASE_DB_URL en el .env")

    # PUERTO 6543 (transaction pooler) Y NO 5432 (session pooler), A PROPÓSITO.
    #
    # El session pooler admite 15 clientes para TODO el proyecto, y el backend en Cloud
    # Run ya puede usar los 15 él solo (pool 5 + 10 de overflow). El 9/9/2026 correr esto
    # en paralelo con la app hizo que la pantalla de Planos contestara 500 en la mitad de
    # los archivos: no era Storage, era `(EMAXCONNSESSION) max clients reached`.
    #
    # El transaction pooler no gasta esas 15 plazas. Pide `statement_cache_size=0`, que
    # es lo que ya usan los engines de estos scripts: asyncpg prepara sentencias del lado
    # del servidor y pgbouncer en modo transacción no se lo permite.
    url = url.replace(":5432/", ":6543/")

    return url.replace("postgresql://", "postgresql+asyncpg://").split("?")[0]


def _kb(n) -> str:
    return f"{(n or 0) / 1024:.0f} KB"


async def mover(conn, engine) -> None:
    pendientes = (await conn.execute(sa.text("""
        SELECT id, nombre, tipo_archivo, id_articulo, id_orden_trabajo,
               octet_length(archivo) AS bytes
        FROM plano
        WHERE archivo IS NOT NULL AND storage_path IS NULL
        ORDER BY id
    """))).mappings().all()

    total_bytes = sum(f["bytes"] or 0 for f in pendientes)
    print(f"Planos con el archivo adentro de la base: {len(pendientes)} "
          f"({total_bytes / 2**20:.0f} MB)")
    if not pendientes:
        print("Nada que mover.")
        return
    if not APLICAR:
        for f in pendientes[:10]:
            print(f"  · {f['id']:>5}  {f['nombre'][:60]:<60} {_kb(f['bytes'])}")
        if len(pendientes) > 10:
            print(f"  … y {len(pendientes) - 10} más")
        print("\n(corrida en seco — no se movió nada; usar --aplicar)")
        return

    # Tres en paralelo. Uno por uno son ~4100 subidas de ida y vuelta a São Paulo, casi
    # una hora de reloj; el cuello es la latencia, no el ancho de banda. Cada worker abre
    # SU conexión: una conexión de SQLAlchemy no se puede usar desde dos tareas a la vez.
    #
    # Y TRES Y NO MÁS: el pooler de Supabase en modo sesión (puerto 5432, el que usa
    # SUPABASE_DB_URL) admite 15 clientes en total, contando los del backend en Cloud Run.
    # Con seis acá más los procesos del importador, la base empezó a contestar
    # "(EMAXCONNSESSION) max clients reached" — o sea que este script le puede sacar las
    # conexiones a la app en producción. Si hay que ir más rápido, la salida no es subir
    # este número: es correrlo cuando no haya nada más pegado a la base.
    WORKERS = 3
    movidos, fallados, bytes_movidos = 0, [], 0
    lock = asyncio.Lock()
    cola = asyncio.Queue()
    for f in pendientes:
        cola.put_nowait(f)

    async def worker():
        nonlocal movidos, bytes_movidos
        async with engine.connect() as propia:
            while True:
                try:
                    f = cola.get_nowait()
                except asyncio.QueueEmpty:
                    return
                try:
                    # El blob se lee de a uno: son hasta 13 MB cada uno y traerlos
                    # todos juntos revienta la memoria del proceso.
                    datos = (await propia.execute(
                        sa.text("SELECT archivo FROM plano WHERE id = :id"),
                        {"id": f["id"]})).scalar_one()
                    if not datos:
                        continue
                    ruta = storage_planos.ruta_para(
                        f["nombre"], id_articulo=f["id_articulo"],
                        id_orden=f["id_orden_trabajo"])
                    await asyncio.to_thread(storage_planos.subir_sync, ruta, datos,
                                            f["tipo_archivo"])
                    await propia.execute(sa.text("""
                        UPDATE plano SET storage_path = :ruta, tamano = :tamano,
                                         archivo = NULL
                         WHERE id = :id
                    """), {"ruta": ruta, "tamano": len(datos), "id": f["id"]})
                    await propia.commit()
                    async with lock:
                        movidos += 1
                        bytes_movidos += len(datos)
                        if movidos % 200 == 0:
                            print(f"  … {movidos}/{len(pendientes)} "
                                  f"({bytes_movidos / 2**20:.0f} MB movidos)", flush=True)
                except Exception as e:
                    await propia.rollback()
                    async with lock:
                        fallados.append((f["id"], str(e)[:120]))

    await asyncio.gather(*[worker() for _ in range(WORKERS)])

    print(f"\nMOVIDOS {movidos} planos, {bytes_movidos / 2**20:.0f} MB.")
    if fallados:
        print(f"Quedaron {len(fallados)} sin mover (siguen abriéndose desde la base):")
        for id_plano, error in fallados[:15]:
            print(f"  · {id_plano}: {error}")
    print("\nEl espacio del bytea no vuelve solo: cuando no quede ninguno, correr\n"
          "  VACUUM FULL plano;   (bloquea la tabla unos segundos)")


async def huerfanos(conn) -> None:
    """Objetos que están en el bucket y ninguna fila usa.

    Los deja el reemplazo de un plano (el objeto viejo) y un borrado que no llegó a
    limpiar Storage. No se borran solos: acá se listan, y con --aplicar se borran.
    """
    url, clave = storage_planos._credenciales()
    usados = {r[0] for r in (await conn.execute(
        sa.text("SELECT storage_path FROM plano WHERE storage_path IS NOT NULL"))).all()}

    def _listar(prefijo: str) -> list:
        cuerpo = json.dumps({"prefix": prefijo, "limit": 1000}).encode()
        pedido = urllib.request.Request(
            f"{url}/storage/v1/object/list/{storage_planos.BUCKET}", data=cuerpo,
            headers={"apikey": clave, "Authorization": f"Bearer {clave}",
                     "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(pedido, timeout=60) as r:
            return json.load(r)

    # La API lista una carpeta por vez, así que hay que bajar por el árbol.
    encontrados = []
    pendientes = [""]
    while pendientes:
        prefijo = pendientes.pop()
        for item in _listar(prefijo):
            ruta = f"{prefijo}{item['name']}"
            if item.get("id") is None:      # es carpeta
                pendientes.append(f"{ruta}/")
            else:
                encontrados.append(ruta)

    sobran = sorted(set(encontrados) - usados)
    print(f"Objetos en el bucket: {len(encontrados)} | usados por alguna fila: "
          f"{len(usados)} | huérfanos: {len(sobran)}")
    for ruta in sobran[:15]:
        print(f"  · {ruta}")
    if not sobran:
        return
    if not APLICAR:
        print("\n(corrida en seco — no se borró nada; usar --huerfanos --aplicar)")
        return
    for ruta in sobran:
        try:
            await asyncio.to_thread(storage_planos.borrar_sync, ruta)
        except Exception as e:
            print(f"  ✗ {ruta}: {str(e)[:100]}")
    print(f"\nBORRADOS {len(sobran)} objetos huérfanos.")


async def main() -> None:
    engine = create_async_engine(_url_de_la_base(), pool_size=4, max_overflow=0,
                                 pool_pre_ping=True,
                                 connect_args={"statement_cache_size": 0})
    async with engine.connect() as conn:
        if HUERFANOS:
            await huerfanos(conn)
        else:
            await mover(conn, engine)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
