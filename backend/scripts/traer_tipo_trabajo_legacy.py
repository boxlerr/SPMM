"""Trae del sistema viejo qué clase de trabajo es cada OT: Fabricación, Reparación,
Sin Cargo, Stock o Interno.

POR QUÉ EXISTE

Camilo, 14/09/2026: «cuando abrís la OT no dice si es fabricación o reparación o sin
cargo. Eso me ayuda de mucho al momento de poner los procesos». Y más tarde, mirando una
OT traída del viejo: «el botón de fabricación y reparación no lo está tomando, que es del
programa viejo. No te marca qué es».

Tenía razón, y no era la pantalla. El dato nunca llegó: `sync_db.Q_OTS` mapeaba
`ISNULL(v.afabricar, 0) AS fabricacion` y ponía `reparacion`, `sin_cargo`, `stock` e
`interno` en cero fijo. `afabricar` es la CANTIDAD a fabricar —el casillero "a Fabricar:"
de la pantalla vieja—, no un sí/no: en SPMM quedaron OT con `fabricacion` valiendo 20,
30, 110 o 160, y como todo el sistema compara con `= 1`, el taller veía TODAS las OT sin
tipo. Medido antes de correr esto: 1246 en 0, 5 en 1, 10 con un número suelto, 6 en NULL.

DE DÓNDE SALE EL DATO

En el legacy no hay una columna por tipo: es UN grupo de radios guardado en
`dbo.otrabajo.forma`, y el índice sigue el orden en que están en la pantalla:

    0 Fabricación · 1 Reparación · 2 Sin Cargo · 3 Stock · 4 Interno

Las cuatro cosas que fijan ese mapeo (ninguna es una corazonada):
  · `dbo.otrabajoStock` —donde el legacy guarda las órdenes de stock— tiene forma=3.
    Eso clava el 3, y con el 3 queda clavado todo el orden.
  · de las 2128 OT con forma=1, 380 dicen «REPARA…» en el texto, contra 18 de las 4814
    con forma=0; y son trabajos de reparar: «pelar y vulcanizar», «enderezar».
  · la OT 15187, forma=2, dice «En garantía:» — que es exactamente sin cargo.
  · la OT 15713, que el taller mandó fotografiada con «Fabricación» tildado, es forma=0.

QUÉ TOCA Y QUÉ NO

Toca SÓLO las cinco banderas de tipo, y sólo en las OT que vinieron del viejo
(`id_otvieja IS NOT NULL`). No mira fechas, ni cantidades, ni estados: el sync de OT está
apagado desde el 2/9 y esto no lo reenciende.

Y NO le pisa el tipo a una OT donde alguien YA ELIGIÓ uno desde SPMM — o sea: tocada a
mano (`modificado_en` cargado) **y** con alguna de las cinco banderas prendida. Si Lucas
entró y marcó «Reparación», eso vale más que lo que diga el legacy.

Las dos condiciones juntas y no `modificado_en` solo: `modificado_en` se estampa también
cuando se editan los PROCESOS de la OT, que no tiene nada que ver con el tipo. Con la
guarda amplia, tres OT que Matías tocó el 14/9 para cargarles procesos quedaban sin tipo
para siempre — protegiendo una decisión que nadie había tomado.

CÓMO SE CORRE

    .venv/bin/python -m backend.scripts.traer_tipo_trabajo_legacy
    .venv/bin/python -m backend.scripts.traer_tipo_trabajo_legacy --aplicar

Sin `--aplicar` no escribe nada: muestra el reparto y las que cambiarían.
"""
import asyncio
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from backend.infrastructure.db import SessionLocal          # noqa: E402
from backend.scripts.sync_db import _leer                   # noqa: E402

APLICAR = "--aplicar" in sys.argv
PISAR_EDITADAS = "--pisar-editadas" in sys.argv

# El índice del grupo de radios del programa viejo -> nuestras cinco columnas.
TIPOS = ["fabricacion", "reparacion", "sin_cargo", "stock", "interno"]

Q_FORMA = """
SELECT v.idot AS id_otvieja, ISNULL(v.forma, 0) AS forma
FROM dbo.otrabajo v
WHERE v.idot IN ({ids})
"""


def banderas(forma: int) -> dict:
    """forma -> {fabricacion: 1, reparacion: 0, ...}. Un tipo fuera de la lista (no
    debería pasar) deja las cinco en cero: mejor sin tipo que con el tipo equivocado."""
    return {c: (1 if i == forma else 0) for i, c in enumerate(TIPOS)}


async def main():
    async with SessionLocal() as session:
        filas = (await session.execute(text("""
            SELECT id, id_otvieja, fabricacion, reparacion, sin_cargo, stock, interno,
                   modificado_en
            FROM orden_trabajo
            WHERE id_otvieja IS NOT NULL
            ORDER BY id_otvieja
        """))).mappings().all()
        print(f"OT traídas del sistema viejo : {len(filas)}")

        # Tocada a mano Y con un tipo ya elegido. Ver el comentario de arriba: sólo
        # `modificado_en` incluiría a las que se editaron para cargarles PROCESOS, que no
        # eligieron ningún tipo y quedarían en blanco para siempre.
        editadas = {f["id_otvieja"] for f in filas
                    if f["modificado_en"] is not None
                    and any((f[c] or 0) == 1 for c in TIPOS)}
        if editadas and not PISAR_EDITADAS:
            print(f"Con tipo elegido a mano      : {len(editadas)} -> no se les toca "
                  f"(usar --pisar-editadas para forzarlo)")

        ids = [f["id_otvieja"] for f in filas]
        legacy = {r["id_otvieja"]: int(r["forma"] or 0)
                  for r in await _leer(Q_FORMA.format(ids=",".join(str(i) for i in ids)))}
        print(f"Encontradas en el legacy     : {len(legacy)}")

        reparto = {}
        for f in legacy.values():
            reparto[f] = reparto.get(f, 0) + 1
        print("Reparto según el viejo        : " + " · ".join(
            f"{TIPOS[k] if k < len(TIPOS) else f'forma {k}'}={v}"
            for k, v in sorted(reparto.items())))

        cambios, sin_dato, iguales, respetadas = [], [], 0, 0
        for f in filas:
            if f["id_otvieja"] not in legacy:
                sin_dato.append(f["id_otvieja"])
                continue
            if f["id_otvieja"] in editadas and not PISAR_EDITADAS:
                respetadas += 1
                continue
            nuevo = banderas(legacy[f["id_otvieja"]])
            actual = {c: (f[c] if f[c] is not None else 0) for c in TIPOS}
            if actual == nuevo:
                iguales += 1
            else:
                cambios.append((f["id"], f["id_otvieja"], actual, nuevo))

        print(f"\nYa estaban bien               : {iguales}")
        print(f"Respetadas (elegidas a mano)  : {respetadas}")
        print(f"No están en el legacy         : {len(sin_dato)}"
              + (f" -> {sin_dato[:10]}{'…' if len(sin_dato) > 10 else ''}" if sin_dato else ""))
        print(f"A CORREGIR                    : {len(cambios)}")

        # El resumen que le importa al taller: cuántas quedan de cada tipo.
        resumen = {}
        for _, _, _, nuevo in cambios:
            t = next((c for c in TIPOS if nuevo[c] == 1), "sin tipo")
            resumen[t] = resumen.get(t, 0) + 1
        for t, n in sorted(resumen.items(), key=lambda x: -x[1]):
            print(f"    -> {t:12} : {n}")

        # Las que tenían una CANTIDAD metida adentro de la bandera: el destrozo puntual
        # que dejó el mapeo viejo de `afabricar`. Se listan una por una porque son pocas
        # y porque es la prueba de que el bug existió.
        basura = [(o, a["fabricacion"], next((c for c in TIPOS if n[c] == 1), "sin tipo"))
                  for _, o, a, n in cambios if a["fabricacion"] not in (0, 1)]
        if basura:
            print(f"\n  De ésas, {len(basura)} tenían una CANTIDAD metida adentro de la "
                  f"bandera `fabricacion` (el bug de `afabricar`):")
            for ot, valia, queda in basura:
                print(f"    OT {ot}: fabricacion valía {valia} -> queda {queda}")

        if not cambios:
            print("\nNada que corregir.")
            return
        if not APLICAR:
            print("\nEsto fue una prueba en seco. Para escribir de verdad: --aplicar")
            return

        for id_ot, _, _, nuevo in cambios:
            await session.execute(
                text("UPDATE orden_trabajo SET "
                     + ", ".join(f"{c} = :{c}" for c in TIPOS)
                     + " WHERE id = :id"),
                {**nuevo, "id": id_ot})
        await session.commit()
        print(f"\nListo: {len(cambios)} OT corregidas.")


if __name__ == "__main__":
    asyncio.run(main())
