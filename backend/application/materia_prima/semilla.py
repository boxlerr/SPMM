"""La lista de formatos con la que arranca la base.

La siembra la migración (2026-09-23_materia_prima.sql, INSERT … ON CONFLICT (nombre)
DO NOTHING); esto es la misma lista en Python, para los tests (SQLite no corre la
migración: las tablas salen del ORM y el catálogo arranca vacío) y para quien necesite
saber qué formatos hay sin ir a la base. Un test compara las dos listas: si se agrega
un formato, va en los dos lados.
"""
from sqlalchemy import select

from backend.domain.Formato import Formato

# (nombre, iniciales para el código, etiquetas de las medidas en orden)
#
# Las iniciales repiten las del viejo a propósito, choques incluidos: BR = BARRA REDONDO
# y BARRA RECTANGULAR, TR = TUBO REDONDO y TUBO RECTANGULAR, P = PLACA y PLANCHUELA. El
# número del código se comparte por prefijo, así los códigos nuevos siguen la serie de
# los que ya usan las facturas del viejo.
FORMATOS_SEMILLA: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("BARRA REDONDO", "BR", ("Ø",)),
    ("BARRA CUADRADO", "BC", ("Lado",)),
    ("BARRA HEXAGONAL", "BH", ("Entre caras",)),
    ("BARRA RECTANGULAR", "BR", ("Ancho", "Espesor")),
    ("TUBO REDONDO", "TR", ("Ø exterior", "Ø interior")),
    ("TUBO CUADRADO", "TC", ("Lado", "Espesor")),
    ("TUBO RECTANGULAR", "TR", ("Lado A", "Lado B", "Espesor")),
    ("PLACA", "P", ("Espesor", "Ancho", "Largo")),
    ("PLANCHUELA", "P", ("Ancho", "Espesor")),
    ("ANGULOS IGUALES", "AI", ("Ala", "Espesor")),
    ("ANGULOS DESIGUALES", "AD", ("Ala A", "Ala B", "Espesor")),
    ("PERFIL U", "PU", ("Alto", "Ala", "Espesor")),
    ("PERFIL T", "PT", ("Alto", "Ala", "Espesor")),
    ("CORTE PANTOGRAFO", "CP", ("Medida", "Espesor")),
    ("CORTE LASER", "CL", ("Medida 1", "Medida 2", "Medida 3", "Medida 4", "Medida 5")),
)


async def sembrar_formatos(session) -> dict[str, int]:
    """Carga los formatos que falten (por nombre) y devuelve {nombre: id} de todos.

    Idempotente como el INSERT … ON CONFLICT DO NOTHING de la migración: un formato que
    ya está no se toca. Hace flush, no commit (el que llama decide).
    """
    existentes = {
        f.nombre: f for f in (await session.execute(select(Formato))).scalars().all()
    }
    for orden, (nombre, iniciales, etiquetas) in enumerate(FORMATOS_SEMILLA, start=1):
        if nombre in existentes:
            continue
        valores = list(etiquetas) + [None] * (5 - len(etiquetas))
        formato = Formato(
            nombre=nombre, iniciales=iniciales, orden=orden, activo=1,
            etiqueta1=valores[0], etiqueta2=valores[1], etiqueta3=valores[2],
            etiqueta4=valores[3], etiqueta5=valores[4],
        )
        session.add(formato)
        existentes[nombre] = formato
    await session.flush()
    return {nombre: f.id for nombre, f in existentes.items()}
