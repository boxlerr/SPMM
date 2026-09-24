"""El stock de los insumos: suma de movimientos, reservas y caché.

DESDE EL 23/09/2026 EL STOCK ES LA SUMA DE MOVIMIENTOS

  físico     = Σ pieza_movimiento.cantidad no anulados. `pieza.stockactual` es el CACHÉ
               de esa suma: lo recalcula `recalcular_cache` después de cada movimiento
               (y la importación, para todas las piezas). Nadie más lo escribe: el sync
               deja de pisarlo.
  reservado  = Σ cantidad_reservada de las líneas de OT con reserva=1, usado=1 y
               disponible=0 (reservas vigentes: todavía no se retiró).
  libre      = físico − reservado.

`stock_de` lee el físico del caché y no suma los movimientos cada vez: la lista de
insumos filtra «con stock» y «bajo mínimo» en SQL sobre `pieza.stockactual`
(Pieza.bajo_minimo), y si la lista leyera una cosa y el filtro otra, un insumo podría
salir en «bajo mínimo» mostrando un stock que no lo está. Mientras el caché lo escriba
sólo este módulo, las dos son lo mismo.

SIN COMMIT

Todo trabaja sobre la sesión recibida y hace flush, nunca commit: el servicio que llama
decide cuándo termina la transacción. Marcar disponible una línea reservada crea el
egreso, recalcula el caché y cambia la línea: las tres cosas quedan o ninguna.
"""
from __future__ import annotations

from sqlalchemy import func, select

from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.domain.PiezaMovimiento import TIPOS_MOVIMIENTO, PiezaMovimiento
from backend.domain.PiezaRecorte import PiezaRecorte
from backend.application.materia_prima.reglas import fmt_mm
from backend.application.materia_prima.usuario import nombre_de
from backend.infrastructure.auditoria_movimientos import ahora_ar

# Cuántos ids por consulta. SQLite (los tests) tiene un tope de variables por sentencia
# y un IN con 1.400 OT de la pantalla de Órdenes lo pasa en las versiones viejas.
TANDA = 500


def en_tandas(ids):
    """Los ids sin repetir, ordenados y de a TANDA (para los IN)."""
    ids = sorted({int(i) for i in ids if i is not None})
    for i in range(0, len(ids), TANDA):
        yield ids[i:i + TANDA]


def _redondo(valor) -> float:
    """3 decimales, como NUMERIC(18,3): que 0,1 + 0,2 no se muestre 0,30000000000000004."""
    return round(float(valor or 0), 3) + 0.0  # + 0.0: que -0.0 salga 0.0


# ─────────────────────────── leer ───────────────────────────


async def stock_de(session, ids_pieza, excluir_linea: int | None = None) -> dict[int, dict]:
    """{id_pieza: {fisico, reservado, libre}} de las piezas que existen.

    `excluir_linea`: una línea de OT cuya reserva NO se cuenta. Es para preguntar
    «¿cuánto hay libre sin contar lo que ya reservó esta misma línea?» al cambiarle la
    reserva: si no, la línea competiría consigo misma.

    Las piezas que no existen no aparecen en el resultado.
    """
    resultado: dict[int, dict] = {}
    for tanda in en_tandas(ids_pieza):
        filas = await session.execute(
            select(Pieza.id, Pieza.stockactual).where(Pieza.id.in_(tanda))
        )
        for id_pieza, fisico in filas.all():
            resultado[id_pieza] = {"fisico": _redondo(fisico), "reservado": 0.0, "libre": 0.0}

        consulta = (
            select(OrdenTrabajoPieza.id_pieza, func.sum(OrdenTrabajoPieza.cantidad_reservada))
            .where(
                OrdenTrabajoPieza.id_pieza.in_(tanda),
                OrdenTrabajoPieza.reserva == 1,
                OrdenTrabajoPieza.usado == 1,
                func.coalesce(OrdenTrabajoPieza.disponible, 0) == 0,
                OrdenTrabajoPieza.cantidad_reservada.isnot(None),
            )
            .group_by(OrdenTrabajoPieza.id_pieza)
        )
        if excluir_linea is not None:
            consulta = consulta.where(OrdenTrabajoPieza.id != excluir_linea)
        for id_pieza, reservado in (await session.execute(consulta)).all():
            if id_pieza in resultado:
                resultado[id_pieza]["reservado"] = _redondo(reservado)

    for datos in resultado.values():
        datos["libre"] = _redondo(datos["fisico"] - datos["reservado"])
    return resultado


async def saldo_de_movimientos(session, id_pieza: int) -> float:
    """Σ de los movimientos no anulados de una pieza: el físico de verdad (el caché es
    esto guardado)."""
    total = (await session.execute(
        select(func.coalesce(func.sum(PiezaMovimiento.cantidad), 0))
        .where(PiezaMovimiento.id_pieza == id_pieza, PiezaMovimiento.anulado == 0)
    )).scalar()
    return _redondo(total)


async def recortes_disponibles_de(session, ids_pieza) -> dict[int, int]:
    """{id_pieza: cuántos recortes disponibles tiene} (suma de `cantidad`), sólo las que
    tienen alguno. Es el numerito de la tijera en Pendientes y en la lista de insumos."""
    resultado: dict[int, int] = {}
    for tanda in en_tandas(ids_pieza):
        filas = await session.execute(
            select(PiezaRecorte.id_pieza, func.sum(PiezaRecorte.cantidad))
            .where(PiezaRecorte.id_pieza.in_(tanda), PiezaRecorte.estado == "disponible")
            .group_by(PiezaRecorte.id_pieza)
        )
        for id_pieza, cantidad in filas.all():
            if cantidad:
                resultado[id_pieza] = int(cantidad)
    return resultado


async def consumido_de_lineas(session, ids_linea) -> dict[int, float]:
    """{id_línea: lo consumido} = Σ consumo_material no anulado de la línea (RF-15). Es la
    columna «C. usado»: `orden_trabajo_pieza.cantusada` queda sin uso. Sólo las líneas que
    tienen algún consumo."""
    resultado: dict[int, float] = {}
    for tanda in en_tandas(ids_linea):
        filas = await session.execute(
            select(ConsumoMaterial.id_orden_trabajo_pieza, func.sum(ConsumoMaterial.cantidad))
            .where(ConsumoMaterial.id_orden_trabajo_pieza.in_(tanda),
                   ConsumoMaterial.anulado == 0)
            .group_by(ConsumoMaterial.id_orden_trabajo_pieza)
        )
        for id_linea, total in filas.all():
            resultado[id_linea] = _redondo(total)
    return resultado


# ─────────────────────────── escribir ───────────────────────────


async def recalcular_cache(session, id_pieza: int) -> float:
    """pieza.stockactual = Σ movimientos no anulados. Devuelve el saldo.

    Por el objeto de la sesión y no con un UPDATE suelto: si la pieza ya está cargada,
    un UPDATE por afuera la dejaría con el número viejo en memoria y el servicio lo
    devolvería así.
    """
    await session.flush()
    saldo = await saldo_de_movimientos(session, id_pieza)
    pieza = await session.get(Pieza, id_pieza)
    if pieza is not None:
        pieza.stockactual = saldo
        await session.flush()
    return saldo


def _signo_valido(tipo: str, cantidad: float) -> bool:
    if tipo == "ingreso":
        return cantidad > 0
    if tipo in ("egreso", "retiro_ot"):
        return cantidad < 0
    return True  # ajuste: la diferencia, con el signo que tenga


async def registrar_movimiento(session, id_pieza: int, tipo: str, cantidad, comentario=None,
                               usuario: dict | None = None, id_orden_trabajo: int | None = None,
                               id_orden_trabajo_pieza: int | None = None, origen: str = "spmm",
                               *, avisar_negativo: bool = False) -> PiezaMovimiento:
    """Agrega un movimiento de stock y recalcula el caché. Devuelve el movimiento.

    `cantidad` va CON SIGNO (+ entra, − sale) y el signo tiene que ir con el tipo:
    ingreso > 0; egreso y retiro_ot < 0; ajuste ≠ 0 (la diferencia contra el saldo
    contado: la cuenta la hace el servicio, que es el que recibe el saldo nuevo). Si no,
    422: un «ingreso» negativo sumaría bien y se leería mal.

    `avisar_negativo`: si el movimiento deja el físico por debajo de cero, 409 con el
    saldo que quedaría (el servicio lo pasa como `not forzar`). Se mira contra la suma
    de movimientos, que es lo que va a quedar en el caché.

    Fecha = ahora en hora del taller; quién = el usuario del token (None = un script).
    """
    if tipo not in TIPOS_MOVIMIENTO:
        raise BusinessException(
            f"Tipo de movimiento desconocido: «{tipo}». Tiene que ser {', '.join(TIPOS_MOVIMIENTO)}."
        )
    try:
        cantidad = round(float(cantidad), 3)
    except (TypeError, ValueError):
        raise BusinessException("La cantidad del movimiento tiene que ser un número.")
    if cantidad == 0:
        raise BusinessException("Un movimiento en cero no mueve nada.")
    if not _signo_valido(tipo, cantidad):
        raise BusinessException(
            f"Un {tipo} va {'positivo' if tipo == 'ingreso' else 'negativo'} "
            f"(llegó {fmt_mm(cantidad)})."
        )

    pieza = await session.get(Pieza, id_pieza)
    if pieza is None:
        raise NotFoundException(f"No existe el insumo {id_pieza}.")

    if avisar_negativo and cantidad < 0:
        quedaria = _redondo(await saldo_de_movimientos(session, id_pieza) + cantidad)
        if quedaria < 0:
            raise ConfirmacionRequeridaException(
                f"El stock de {pieza.cod_pieza.strip()} queda en {fmt_mm(quedaria)} "
                f"(negativo). ¿Registrarlo igual?"
            )

    id_usuario, nombre = nombre_de(usuario)
    movimiento = PiezaMovimiento(
        id_pieza=id_pieza,
        fecha=ahora_ar(),
        tipo=tipo,
        cantidad=cantidad,
        comentario=(str(comentario).strip() or None) if comentario is not None else None,
        id_orden_trabajo=id_orden_trabajo,
        id_orden_trabajo_pieza=id_orden_trabajo_pieza,
        id_usuario=id_usuario,
        usuario=nombre,
        origen=origen,
        anulado=0,
    )
    session.add(movimiento)
    await session.flush()
    await recalcular_cache(session, id_pieza)
    return movimiento


async def anular_movimiento(session, movimiento, usuario: dict | None = None,
                            motivo: str | None = None, *, desde_linea: bool = False) -> PiezaMovimiento:
    """Anula un movimiento (deja de sumar, queda a la vista) y recalcula el caché.

    `movimiento` puede ser el objeto o su id. 422 si ya estaba anulado.

    Los `retiro_ot` no se anulan a mano: los crea marcar Disponible una línea reservada
    y se anulan desmarcándolo (`desde_linea=True` es ese camino). Anularlo desde el stock
    dejaría la línea diciendo que lo retiró y el stock diciendo que no.
    """
    if not isinstance(movimiento, PiezaMovimiento):
        encontrado = await session.get(PiezaMovimiento, movimiento)
        if encontrado is None:
            raise NotFoundException(f"No existe el movimiento de stock {movimiento}.")
        movimiento = encontrado
    if movimiento.anulado:
        raise BusinessException("Ese movimiento ya está anulado.")
    if movimiento.tipo == "retiro_ot" and not desde_linea:
        numero = None
        if movimiento.id_orden_trabajo is not None:
            numero = (await session.execute(
                select(OrdenTrabajo.id_otvieja).where(OrdenTrabajo.id == movimiento.id_orden_trabajo)
            )).scalar()
        raise BusinessException(
            "Este egreso lo generó marcar Disponible una línea reservada de la OT"
            + (f" N° {numero}" if numero else "")
            + ": se anula desmarcando «Disponible» en esa línea."
        )
    _, nombre = nombre_de(usuario)
    movimiento.anulado = 1
    movimiento.anulado_en = ahora_ar()
    movimiento.anulado_por = nombre
    motivo = (str(motivo).strip() if motivo is not None else "") or None
    movimiento.motivo_anulacion = motivo
    await session.flush()
    await recalcular_cache(session, movimiento.id_pieza)
    return movimiento
