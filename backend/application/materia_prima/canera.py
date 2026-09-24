"""La cañera: el mueble donde se deja el material cortado de cada OT.

Una grilla fija de columnas A..O × filas 1..9. Cada casillero se nombra «E4» (columna y
fila) y lo ocupa a lo sumo una OT vigente; una OT puede ocupar varios. La tabla es
canera_ocupacion (domain/CaneraOcupacion.py): liberar es cerrar la fila con `hasta`, no
borrarla.

Acá está lo que leen las dos pantallas que la muestran (Pendientes, con su grilla
compacta, y la solapa Cañera) y la solapa de la OT (sus casilleros). Las escrituras
(asignar, mover, liberar) las hace el servicio de Pendientes, sobre la misma tabla.
"""
from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy import select

from backend.commons.exceptions.BusinessException import BusinessException
from backend.domain.Articulo import Articulo
from backend.domain.CaneraOcupacion import COLUMNAS_CANERA, FILAS_CANERA, CaneraOcupacion
from backend.domain.Cliente import Cliente
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.application.materia_prima.estado import estados_de_ots
from backend.application.materia_prima.stock import en_tandas

__all__ = ["COLUMNAS_CANERA", "FILAS_CANERA", "parse_celda", "celda_texto",
           "celdas_de_ots", "canera_vigente"]

_CELDA = re.compile(r"^([A-Z])\s*(\d{1,2})$")


def parse_celda(texto) -> tuple[str, int]:
    """«E4» → ('E', 4). Acepta minúsculas y espacios («e 4»). 422 si no es un casillero
    de la grilla (A..O × 1..9): mejor un «no existe» claro que una fila que la base
    rechaza con un error de CHECK."""
    t = str(texto or "").strip().upper()
    m = _CELDA.match(t)
    if not m or m.group(1) not in COLUMNAS_CANERA or int(m.group(2)) not in FILAS_CANERA:
        raise BusinessException(
            f"«{texto}» no es un casillero de la cañera: va una columna de la A a la "
            f"{COLUMNAS_CANERA[-1]} y una fila del 1 al {FILAS_CANERA[-1]} (por ejemplo E4)."
        )
    return m.group(1), int(m.group(2))


def celda_texto(columna: str, fila: int) -> str:
    """('E', 4) → «E4»."""
    return f"{columna}{fila}"


async def celdas_de_ots(session, ids_ot) -> dict[int, list[str]]:
    """{id_ot: ["E4", "E5"]}: los casilleros VIGENTES de cada OT, en orden. Sólo las OT
    que tienen alguno."""
    resultado: dict[int, list[str]] = defaultdict(list)
    for tanda in en_tandas(ids_ot):
        filas = await session.execute(
            select(CaneraOcupacion.id_orden_trabajo, CaneraOcupacion.columna, CaneraOcupacion.fila)
            .where(CaneraOcupacion.id_orden_trabajo.in_(tanda), CaneraOcupacion.hasta.is_(None))
            .order_by(CaneraOcupacion.columna, CaneraOcupacion.fila)
        )
        for id_ot, columna, fila in filas.all():
            resultado[id_ot].append(celda_texto(columna, fila))
    return dict(resultado)


async def canera_vigente(session) -> dict:
    """Lo que devuelve GET /materia-prima/canera: la grilla y sus ocupaciones vigentes.

    Cada ocupación trae la OT (número visible, cliente, artículo), el estado de su
    material (el mismo cálculo que la columna Material de las listas) y si está
    finalizada: la pantalla pinta verde lo listo, ámbar lo que falta y rayado lo que ya
    se puede liberar. Una ocupación sin OT de SPMM (un número del viejo que no existe
    acá, o una OT borrada) trae sólo `ot_texto`.

    Las fechas salen como datetime: el endpoint las pasa por jsonable_encoder
    («YYYY-MM-DDTHH:MM:SS», sin zona).
    """
    filas = (await session.execute(
        select(CaneraOcupacion, OrdenTrabajo.id_otvieja, OrdenTrabajo.finalizadototal,
               Cliente.nombre, Articulo.descripcion)
        .outerjoin(OrdenTrabajo, OrdenTrabajo.id == CaneraOcupacion.id_orden_trabajo)
        .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
        .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
        .where(CaneraOcupacion.hasta.is_(None))
        .order_by(CaneraOcupacion.columna, CaneraOcupacion.fila, CaneraOcupacion.id)
    )).all()
    estados = await estados_de_ots(
        session, [o.id_orden_trabajo for o, *_ in filas if o.id_orden_trabajo is not None]
    )
    ocupaciones = []
    for ocupacion, numero, finalizadototal, cliente, articulo in filas:
        es_de_spmm = ocupacion.id_orden_trabajo is not None
        ocupaciones.append({
            "id": ocupacion.id,
            "celda": ocupacion.celda,
            "columna": ocupacion.columna,
            "fila": ocupacion.fila,
            "id_orden_trabajo": ocupacion.id_orden_trabajo,
            "numero_ot": numero if es_de_spmm else None,
            "ot_texto": ocupacion.ot_texto,
            "cliente": cliente,
            "articulo": articulo,
            "estado_material": estados.get(ocupacion.id_orden_trabajo) if es_de_spmm else None,
            "finalizada": bool(es_de_spmm and finalizadototal == 1),
            "desde": ocupacion.desde,
            "asignado_por": ocupacion.asignado_por,
        })
    return {
        "columnas": list(COLUMNAS_CANERA),
        "filas": list(FILAS_CANERA),
        "ocupaciones": ocupaciones,
    }
