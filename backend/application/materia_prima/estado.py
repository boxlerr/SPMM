"""El estado del material de una OT (la columna Material de las listas y el planificador)
y si la OT ya arrancó.

EL ESTADO, CON LAS MARCAS DE VERDAD

Hasta el 23/09/2026 el estado salía de las marcas que INVENTABA el sync (pedido =
cantidad > 0, disponible = 1): de 212 OT abiertas, 118 salían «ok» y en el viejo 94 de
ellas estaban sin pedir. Ahora las marcas las pone SPMM (Pendientes, la solapa de la OT)
y el estado se calcula acá, una sola vez, sobre las líneas que se usan (usado = 1):

  no_lleva   la OT está marcada «No lleva materias primas»
  sin_datos  no tiene ninguna línea usada: nadie cargó la lista (no es que falte)
  ok         todas las líneas usadas están disponibles
  sin_stock  alguna línea no está ni disponible, ni pedida, ni reservada: FALTA PEDIR
  pedido     el resto: todo lo que falta está pedido o reservado, esperando

El orden importa: una OT con una línea sin pedir y otra pedida está en «sin_stock»,
porque lo que hay que hacer con ella es pedir.

`sin_stock` conserva el nombre de antes a propósito: lo leen la pantalla de Órdenes y el
planificador (frontend/src/lib/materialOT.ts), que ahora lo rotula «Falta pedir».
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import or_, select

from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.application.materia_prima.stock import en_tandas

ESTADOS_MATERIAL = ("no_lleva", "sin_datos", "ok", "sin_stock", "pedido")

# Los ids de estado_proceso (catálogo fijo del viejo: 1 Pendiente, 2 En curso,
# 3 Completado). El resto del backend los usa como números sueltos; acá con nombre.
ESTADO_PROCESO_EN_CURSO = 2
ESTADO_PROCESO_COMPLETADO = 3

# El centinela del sistema viejo para «sin fecha» (1900/1950-01-01) no es un arranque:
# mismo corte que TiemposOperarioRepository.
_INICIO_REAL_MINIMO = datetime(1950, 1, 2)


def _marca(linea, campo: str, por_defecto: int = 0) -> int:
    valor = linea.get(campo) if isinstance(linea, dict) else getattr(linea, campo, None)
    if valor is None:
        return por_defecto
    return 1 if valor else 0


def estado_material(no_lleva, lineas) -> str:
    """El estado del material de UNA OT a partir de su marca y sus líneas. PURA.

    `lineas`: dicts u objetos con usado, disponible, pedido y reserva (0/1 o bool). Una
    marca vacía cuenta como su valor por defecto: `usado` 1 (las líneas de antes de la
    migración se usan), las otras 0.
    """
    if no_lleva:
        return "no_lleva"
    usadas = [l for l in (lineas or []) if _marca(l, "usado", 1)]
    if not usadas:
        return "sin_datos"
    if all(_marca(l, "disponible") for l in usadas):
        return "ok"
    if any(not _marca(l, "disponible") and not _marca(l, "pedido") and not _marca(l, "reserva")
           for l in usadas):
        return "sin_stock"
    return "pedido"


async def estados_de_ots(session, ids_ot) -> dict[int, str]:
    """{id_ot: estado} con `estado_material`. Dos consultas por tanda (la marca de la OT y
    sus líneas); la cuenta se hace en Python con la misma función pura, así la regla está
    escrita una sola vez. Una OT que no existe sale «sin_datos», como antes."""
    ids = sorted({int(i) for i in ids_ot if i is not None})
    no_lleva: dict[int, int] = {}
    lineas: dict[int, list[dict]] = defaultdict(list)
    for tanda in en_tandas(ids):
        for id_ot, marca in (await session.execute(
            select(OrdenTrabajo.id, OrdenTrabajo.no_lleva_materia_prima)
            .where(OrdenTrabajo.id.in_(tanda))
        )).all():
            no_lleva[id_ot] = marca or 0
        for id_ot, usado, disponible, pedido, reserva in (await session.execute(
            select(OrdenTrabajoPieza.id_orden_trabajo, OrdenTrabajoPieza.usado,
                   OrdenTrabajoPieza.disponible, OrdenTrabajoPieza.pedido,
                   OrdenTrabajoPieza.reserva)
            .where(OrdenTrabajoPieza.id_orden_trabajo.in_(tanda))
        )).all():
            lineas[id_ot].append({"usado": usado, "disponible": disponible,
                                  "pedido": pedido, "reserva": reserva})
    return {i: estado_material(no_lleva.get(i, 0), lineas.get(i, [])) for i in ids}


async def ots_en_curso(session, ids_ot) -> set[int]:
    """Las OT que ya arrancaron: algún proceso En curso o Completado, o con inicio real
    (que no sea el centinela del viejo).

    Es el «PRODUC se marca solo»: si la OT ya está en el taller, el material está en
    producción aunque nadie haya tildado la marca manual de la línea.
    """
    en_curso: set[int] = set()
    for tanda in en_tandas(ids_ot):
        filas = await session.execute(
            select(OrdenTrabajoProceso.id_orden_trabajo)
            .where(
                OrdenTrabajoProceso.id_orden_trabajo.in_(tanda),
                or_(
                    OrdenTrabajoProceso.id_estado.in_(
                        (ESTADO_PROCESO_EN_CURSO, ESTADO_PROCESO_COMPLETADO)),
                    OrdenTrabajoProceso.inicio_real > _INICIO_REAL_MINIMO,
                ),
            )
            .distinct()
        )
        en_curso.update(fila[0] for fila in filas.all())
    return en_curso
