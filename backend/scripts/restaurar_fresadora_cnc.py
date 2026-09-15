"""Devuelve a su lugar la máquina 12 (FRESADORA CNC), borrada por error el 15/09/2026.

QUÉ PASÓ

Probando la auditoría nueva contra la app real, un script de prueba mandó
`DELETE /maquinarias/12?forzar=true`. La prueba apuntaba a una base de juguete para la
tabla de auditoría, pero los endpoints de negocio siguen leyendo Supabase: el borrado
fue de verdad, y el `forzar=true` salteó el aviso que justamente existe para frenar
esto. Error mío, no del sistema.

QUÉ SE LLEVÓ PUESTO

  1. La fila de `maquinaria` id 12.
  2. Por CASCADE, `rango_maquinaria (id_rango=7, id_maquinaria=12)` — y con eso el
     rango OFICIAL CNC se quedó SIN NINGUNA máquina: hoy no aparece ni una fila con
     id_rango=7 en toda la tabla.
  3. Nada más. `orden_trabajo_proceso.id_maquinaria` se pone en NULL en ese borrado,
     pero no había una sola pasada con máquina elegida a mano —0 de 5594, para las 26
     máquinas— así que no se perdió ninguna preselección.

CÓMO SE RECONSTRUYÓ, Y CON QUÉ CERTEZA

  · El nombre: el sistema viejo tiene `maquinas.idmaquina = 12 → 'FRESADORA CNC'`, y
    los ids del viejo coinciden uno a uno con los de SPMM (8 AGUJEREADORA DE BANCO,
    9 FRESADORA 1, 13 LIMADORA…). Además las 11 filas del plan que apuntan a la
    máquina 12 son de los procesos «FRESADORA CNC» y «PROGRAMACION FRESADORA CNC».
    Dos fuentes independientes que dicen lo mismo. CERTEZA ALTA.
  · El cruce con OFICIAL CNC: esas 11 filas tienen `id_rango_operario = 7` y
    `forzado_fuera_rango = false`. El planificador exige el cruce exacto, así que para
    haber podido asignar a MATIAS VEGA / PABLO ZANOTTI / IVAN BALMACEDA en esa máquina
    la fila (7, 12) tenía que existir. CERTEZA ALTA.
  · `cod_maquina`: NO se puede recuperar. No está en el sistema viejo, no está en
    ningún script ni en el historial de git. Queda en NULL a propósito: el patrón de
    las vecinas (FREY-1, FREY-2, FVNP-1) da para adivinar «FCNCY-1» o parecido, y un
    código inventado es peor que uno vacío — hay que cargarlo a mano en Recursos.
  · Si además el rango OFICIAL (6) podía usar esta máquina: NO se puede saber. Todas
    las máquinas menos cuatro tienen el cruce con OFICIAL, así que es probable, pero
    el plan nunca la usó con un OFICIAL y no hay rastro. NO se inventa: se restaura
    sólo lo que se puede probar, y queda para revisar en Recursos. Poner de menos hace
    que el planificador avise; poner de más lo haría asignar gente que quizá no
    corresponde, en silencio.

`proceso_maquinaria` no se toca: los procesos 67 y 110 no tienen ninguna fila ahí, y
las otras tres fresadoras tampoco. El planificador los cruza por el nombre.

Idempotente: se puede correr las veces que haga falta.
"""
import asyncio
import os
import sys

from dotenv import load_dotenv

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, RAIZ)
# El .env se busca desde el directorio del SCRIPT, no desde donde se lo llama: sin la
# ruta explícita este script se conecta a localhost y no dice nada.
load_dotenv(os.path.join(RAIZ, ".env"))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

ID = 12
NOMBRE = "FRESADORA CNC"
RANGO_OFICIAL_CNC = 7


def _url() -> str:
    url = os.getenv("SUPABASE_DB_URL", "")
    if not url:
        raise SystemExit("Falta SUPABASE_DB_URL en el .env")
    # El 6543 es el pooler de transacciones. El 5432 admite 15 conexiones en TODO el
    # proyecto: un script que las tome ahí le tira 500 a la app.
    url = url.replace(":5432/", ":6543/")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    engine = create_async_engine(_url(), connect_args={"statement_cache_size": 0})
    async with engine.begin() as cx:
        ya = (await cx.execute(text(
            "SELECT nombre FROM maquinaria WHERE id = :i"), {"i": ID})).scalar()
        if ya:
            print(f"La máquina {ID} ya está: «{ya}». No se toca nada.")
        else:
            await cx.execute(text(
                "INSERT INTO maquinaria (id, nombre, cod_maquina, limitacion, capacidad, especialidad) "
                "VALUES (:i, :n, NULL, NULL, NULL, NULL)"), {"i": ID, "n": NOMBRE})
            print(f"Repuesta la máquina {ID} «{NOMBRE}» (sin código: hay que cargarlo a mano).")

        cruce = (await cx.execute(text(
            "SELECT 1 FROM rango_maquinaria WHERE id_maquinaria = :m AND id_rango = :r"),
            {"m": ID, "r": RANGO_OFICIAL_CNC})).scalar()
        if cruce:
            print("El cruce con OFICIAL CNC ya estaba.")
        else:
            await cx.execute(text(
                "INSERT INTO rango_maquinaria (id_maquinaria, id_rango) VALUES (:m, :r)"),
                {"m": ID, "r": RANGO_OFICIAL_CNC})
            print("Repuesto el cruce OFICIAL CNC ↔ FRESADORA CNC.")

        # La secuencia tiene que quedar por encima del id repuesto o la próxima alta
        # desde la pantalla choca contra la clave primaria.
        await cx.execute(text(
            "SELECT setval('maquinaria_id_seq', GREATEST((SELECT MAX(id) FROM maquinaria), :i))"),
            {"i": ID})

    async with engine.begin() as cx:
        print("\nComo quedó:")
        for fila in (await cx.execute(text("""
            SELECT m.id, m.nombre, m.cod_maquina, r.nombre
            FROM maquinaria m
            LEFT JOIN rango_maquinaria rm ON rm.id_maquinaria = m.id
            LEFT JOIN rango r ON r.id = rm.id_rango
            WHERE m.id = :i"""), {"i": ID})).all():
            print("  ", fila)
        huerfanos = (await cx.execute(text(
            "SELECT count(*) FROM rango_maquinaria WHERE id_rango = :r"),
            {"r": RANGO_OFICIAL_CNC})).scalar()
        print(f"   máquinas que puede usar OFICIAL CNC: {huerfanos}")
        print(f"   total de máquinas: "
              f"{(await cx.execute(text('SELECT count(*) FROM maquinaria'))).scalar()}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
