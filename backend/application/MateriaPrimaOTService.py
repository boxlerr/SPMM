"""Las materias primas de cada OT (spec §2.2): la solapa «Materias primas» de la OT, ahora
editable, y las marcas que pone Pendientes.

Hasta el 23/09/2026 estas líneas las escribía el sync con lo del sistema viejo, y el
sync INVENTABA las marcas (pedido = cantidad > 0, disponible = 1). Desde la reunión del
23/09 las carga SPMM: Carolina la lista al cargar la OT, Maxi marca pedido / reserva /
disponible desde Pendientes. Lo que se decide acá es qué significa cada marca y qué
arrastra.

LAS TRANSICIONES DE UNA LÍNEA (spec §1.7)

  pedido      0→1 estampa quién y cuándo; 1→0 lo limpia.
  reserva     0→1 aparta `cantidad_reservada` del stock libre del insumo. Si no viene,
              min(cantidad, libre). Si supera lo libre (sin contar esta misma línea) es
              409: «avisar, no bloquear», con ?forzar=true se reserva igual y el libre
              queda negativo. 1→0 suelta la reserva.
  disponible  0→1 estampa quién y cuándo, pone la fecha de entrega de hoy si no tenía y,
              si la línea estaba reservada, RETIRA del stock lo reservado (un movimiento
              `retiro_ot`, que queda anotado en la línea). 1→0 anula ese retiro: lo
              reservado vuelve a estar reservado y el stock, donde estaba.
  usado       1→0 con una reserva vigente la suelta: lo que no se usa no traba stock.
  cantidad    siempre > 0; si baja de lo reservado, la reserva baja con ella.
  descripción sólo en líneas de un insumo que NO es tipo 'insumo' (la de un 'insumo'
              sale de sus medidas y se cambia en el catálogo).
  insumo      no se cambia: se borra la línea y se agrega otra.

El orden en que se aplican los cambios de un mismo pedido está pensado para que las
combinaciones de la pantalla anden de una: «Quitar marcas» (disponible, reserva y pedido
en falso) primero desmarca Disponible —anula el retiro— y recién después suelta la
reserva; «Reservar y marcar disponible» reserva primero y retira después.

TODO EN UNA TRANSACCIÓN

Cada pedido (una línea, un lote, un alta de varias) queda entero o no queda: el servicio
trabaja con flush y confirma al final (ver MateriaPrimaOTRepository). En un lote, los
avisos de todas las líneas se juntan en UN 409: la persona ve todo lo que va a pasar y
dice que sí una vez.

QUIÉN Y CUÁNDO

Lo estampa el backend con el usuario del token y la hora del taller (ahora_ar), nunca lo
que diga el navegador.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi.encoders import jsonable_encoder

from backend.application.materia_prima.canera import celdas_de_ots
from backend.application.materia_prima.estado import estados_de_ots, ots_en_curso
from backend.application.materia_prima.reglas import (
    UNIDADES_LINEA,
    escalar_cantidad,
    factor_historial,
    norm_desc,
    sugerido_m,
    unidad_linea_desde_pieza,
)
from backend.application.materia_prima.stock import (
    anular_movimiento,
    consumido_de_lineas,
    recortes_disponibles_de,
    registrar_movimiento,
    stock_de,
)
from backend.application.materia_prima.usuario import nombre_solo
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.OrdenTrabajoPiezaCorte import OrdenTrabajoPiezaCorte
from backend.domain.PiezaMovimiento import PiezaMovimiento
from backend.dto.MateriaPrimaOTRequestDTO import (
    CambiosLinea,
    CambiosLineaLote,
    CorteIn,
    LineaIn,
)
from backend.infrastructure.MateriaPrimaOTRepository import MateriaPrimaOTRepository
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.estado_ordenes import fecha_o_nada

# Los largos de las columnas de texto de orden_trabajo_pieza.
LARGO_DESCRIPCION = 255
LARGO_PROVEEDOR = 200
LARGO_OBSERVACIONES = 2000

# Lo que entra en NUMERIC(10,1) (largo y ancho de un corte).
MAXIMO_MEDIDA_CORTE = 999_999_999.9

# Una diferencia menor que esto entre dos cantidades es ruido de coma flotante: 0,1 + 0,2
# no puede disparar un «la reserva supera lo libre».
_EPS = 1e-9

_UNIDAD_CANONICA = {u.upper(): u for u in UNIDADES_LINEA}
ORIGENES_ALTA = ("spmm", "historial")


@dataclass
class Resultado:
    """Lo que devuelve una escritura: los datos para la respuesta y la frase para
    Auditoría › Todo lo que se hizo (el endpoint la deja en request.state)."""
    data: Any
    frase: str | None = None


def _momento(valor: datetime) -> str:
    return valor.replace(microsecond=0).isoformat()


def a_json(datos):
    """Lo que sale por la API de la sección: jsonable_encoder, con las fechas con hora
    como «YYYY-MM-DDTHH:MM:SS» (spec §2: sin zona y SIN microsegundos).

    Por qué en la salida y no al guardar: ahora_ar() trae microsegundos y la base los
    guarda (TIMESTAMP), y además hay filas que no escribe esta sección (la importación,
    el borrado de la OT que libera la cañera). Recortarlos al estampar tampoco serviría:
    la cañera tiene un CHECK hasta >= desde, y un `hasta` recortado podría quedar ANTES
    de un `desde` con microsegundos del mismo segundo. Mismo formato que el catálogo
    (MateriaPrimaCatalogoService._momento). Las fechas solas (`date`) salen «YYYY-MM-DD».
    """
    return jsonable_encoder(datos, custom_encoder={datetime: _momento})


# ─────────────────────────── ayudas ───────────────────────────


def _marca(valor, por_defecto: int = 0) -> bool:
    """Una marca 0/1 de la base como bool. Vacía = su valor por defecto (`usado` es 1:
    las líneas de antes de la migración se usan)."""
    return bool(por_defecto if valor is None else valor)


def _numero(valor) -> float | None:
    """3 decimales, como NUMERIC(18,3): que 0,1 + 0,2 no salga 0,30000000000000004."""
    if valor is None:
        return None
    return round(float(valor), 3) + 0.0  # + 0.0: que -0.0 salga 0.0


def cant_texto(valor) -> str:
    """Una cantidad como la lee el taller en un mensaje: coma decimal, sin ceros de más."""
    texto = f"{round(float(valor or 0), 3):.3f}".rstrip("0").rstrip(".")
    return "0" if texto in ("", "-0") else texto.replace(".", ",")


def _texto(valor, largo: int, nombre: str) -> str | None:
    """Vacío es None, no ''. Más largo que la columna: 422 que lo dice (y no un 500 de la
    base)."""
    if valor is None:
        return None
    limpio = str(valor).strip()
    if not limpio:
        return None
    if len(limpio) > largo:
        raise BusinessException(f"{nombre} no puede pasar de {largo} caracteres.")
    return limpio


def _cantidad(valor) -> float:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        numero = None
    if numero is None or not math.isfinite(numero) or numero <= 0:
        raise BusinessException("La cantidad tiene que ser mayor que cero.")
    return round(numero, 3)


def _unidad(valor) -> str:
    """La unidad de una línea, escrita como las escribe el viejo (Un, Mts, Kg, Lts).
    Acepta cualquier capitalización («MTS» → «Mts»)."""
    texto = " ".join(str(valor or "").split())
    if not texto:
        raise BusinessException(f"Falta la unidad: {', '.join(UNIDADES_LINEA)}.")
    canonica = _UNIDAD_CANONICA.get(texto.upper())
    if canonica is None:
        raise BusinessException(
            f"«{texto}» no es una unidad de materia prima: va {', '.join(UNIDADES_LINEA)}."
        )
    return canonica


def _medida_corte(valor, nombre: str) -> float | None:
    if valor is None:
        return None
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        numero = None
    if numero is None or not math.isfinite(numero) or numero <= 0 or numero > MAXIMO_MEDIDA_CORTE:
        raise BusinessException(f"El {nombre} de un corte tiene que ser un número mayor que cero (en mm).")
    return round(numero, 1)


def _cortes(cortes_in: list[CorteIn] | None) -> list[dict]:
    """Los cortes como van a la base, validados: cantidad entera > 0; largo y ancho en mm,
    opcionales, con un decimal (NUMERIC(10,1))."""
    salida = []
    for corte in cortes_in or []:
        if corte.cantidad is None or int(corte.cantidad) != corte.cantidad or corte.cantidad <= 0:
            raise BusinessException("La cantidad de un corte tiene que ser un número entero mayor que cero.")
        salida.append({
            "cantidad": int(corte.cantidad),
            "largo_mm": _medida_corte(corte.largo_mm, "largo"),
            "ancho_mm": _medida_corte(corte.ancho_mm, "ancho"),
        })
    return salida


def _codigo(codigo) -> str:
    """El código como se muestra: sin los espacios de adelante que tiene alguno del viejo."""
    return str(codigo or "").strip()


# ─────────────────────────── cómo sale una línea ───────────────────────────


def _corte_a_dict(corte: OrdenTrabajoPiezaCorte) -> dict:
    return {
        "id": corte.id,
        "cantidad": corte.cantidad,
        "largo_mm": _numero(corte.largo_mm),
        "ancho_mm": _numero(corte.ancho_mm),
        "texto_original": corte.texto_original,
    }


async def lineas_a_dict(db, filas, repo: MateriaPrimaOTRepository | None = None) -> list[dict]:
    """Las líneas como las devuelve la API (el `Linea` de la spec), SIN pasar por
    `a_json` (Pendientes les agrega sus columnas antes).

    `filas` son las de MateriaPrimaOTRepository.lineas_con_pieza. Todo lo que no está en
    la línea se lee de una vez para todas: lo consumido (Σ consumo_material no anulado),
    los cortes, el stock libre y los recortes disponibles de cada insumo. Con 900 líneas
    son cinco consultas, no cinco mil.

    El precio es el de la pieza HOY (`unitario`), como en el viejo: la línea no lo
    congela.
    """
    if not filas:
        return []
    repo = repo or MateriaPrimaOTRepository(db)
    ids_linea = [fila[0].id for fila in filas]
    ids_pieza = {fila[0].id_pieza for fila in filas}
    consumido = await consumido_de_lineas(db, ids_linea)
    cortes = await repo.cortes_de_lineas(ids_linea)
    stock = await stock_de(db, ids_pieza)
    recortes = await recortes_disponibles_de(db, ids_pieza)

    salida = []
    for linea, codigo, desc_pieza, tipo, unitario, _unidad_pieza, proveedor_catalogo in filas:
        cortes_linea = cortes.get(linea.id, [])
        salida.append({
            "id": linea.id,
            "id_orden_trabajo": linea.id_orden_trabajo,
            "orden": linea.orden,
            "id_pieza": linea.id_pieza,
            "codigo": _codigo(codigo),
            "descripcion": linea.descripcion or desc_pieza,
            "tipo_pieza": tipo,
            "cantidad": _numero(linea.cantidad),
            "unidad": linea.unidad,
            "id_proveedor": linea.id_proveedor,
            # El texto de ESTA compra; si sólo se eligió uno del catálogo, su nombre.
            "proveedor": linea.proveedor or proveedor_catalogo,
            "observaciones": linea.observaciones,
            "usado": _marca(linea.usado, 1),
            "pedido": _marca(linea.pedido),
            "pedido_en": linea.pedido_en,
            "pedido_por": linea.pedido_por,
            "reserva": _marca(linea.reserva),
            "cantidad_reservada": _numero(linea.cantidad_reservada),
            "disponible": _marca(linea.disponible),
            "disponible_en": linea.disponible_en,
            "disponible_por": linea.disponible_por,
            "en_produccion": _marca(linea.en_produccion),
            "fecha_proveedor": linea.fecha_proveedor,
            "fecha_entrega": linea.fecha_entrega,
            "precio": _numero(unitario),
            "consumido": consumido.get(linea.id, 0.0),
            "cortes": [_corte_a_dict(c) for c in cortes_linea],
            "sugerido_m": sugerido_m(cortes_linea),
            "stock_libre": stock.get(linea.id_pieza, {}).get("libre", 0.0),
            "recortes_disponibles": recortes.get(linea.id_pieza, 0),
            "origen": linea.origen,
            "modificado_en": linea.modificado_en,
            "modificado_por": linea.modificado_por,
        })
        # No está en el `Linea` de la spec (es de Pendientes), pero va en todas: así la
        # pantalla que acaba de cambiar una línea lo recibe calculado y no lo repite.
        salida[-1]["falta"] = falta_de(salida[-1])
    return salida


def falta_de(linea: dict) -> float:
    """Lo que queda por conseguir de una línea (la columna «Falta» de Pendientes): nada si
    ya está disponible o pedida; si no, la cantidad menos lo que cubre su reserva."""
    if linea["disponible"] or linea["pedido"]:
        return 0.0
    cubierto = (linea["cantidad_reservada"] or 0) if linea["reserva"] else 0
    return round(max(0.0, (linea["cantidad"] or 0) - cubierto), 3) + 0.0


def reserva_vigente(linea) -> bool:
    """Reservada y todavía no retirada (lo que cuenta como «reservado» en el stock)."""
    return _marca(linea.reserva) and not _marca(linea.disponible) and _marca(linea.usado, 1)


# ─────────────────────────── el servicio ───────────────────────────


class MateriaPrimaOTService:
    def __init__(self, db):
        self.db = db
        self.repo = MateriaPrimaOTRepository(db)

    # ─────────────── lectura ───────────────

    async def _ot(self, id_orden_trabajo: int):
        orden = await self.repo.ot(id_orden_trabajo)
        if orden is None:
            raise NotFoundException(f"No existe la orden de trabajo {id_orden_trabajo}.")
        return orden

    async def _lineas_por_id(self, ids: list[int]) -> list[dict]:
        """Las líneas con esos ids, como salen por la API y en el orden pedido."""
        filas = await self.repo.lineas_con_pieza(ids_linea=ids)
        por_id = {d["id"]: d for d in await lineas_a_dict(self.db, filas, self.repo)}
        return [por_id[i] for i in ids if i in por_id]

    async def lineas_de_ot(self, id_orden_trabajo: int) -> dict:
        """La solapa Materias primas de una OT: sus líneas (todas, también las que no se
        usan: la solapa es donde se decide eso), el estado del material, si la OT ya
        arrancó (el «PRODUC se marca solo») y sus casilleros de la cañera."""
        orden = await self._ot(id_orden_trabajo)
        filas = await self.repo.lineas_con_pieza(ids_ot=[orden.id])
        lineas = await lineas_a_dict(self.db, filas, self.repo)
        en_curso = await ots_en_curso(self.db, [orden.id])
        estados = await estados_de_ots(self.db, [orden.id])
        celdas = await celdas_de_ots(self.db, [orden.id])
        return a_json({
            "id_orden_trabajo": orden.id,
            "numero_ot": orden.id_otvieja,
            "no_lleva_materia_prima": _marca(orden.no_lleva_materia_prima),
            "ot_en_curso": orden.id in en_curso,
            "estado_material": estados.get(orden.id, "sin_datos"),
            "celdas": celdas.get(orden.id, []),
            "lineas": lineas,
        })

    # ─────────────── «No lleva materias primas» ───────────────

    async def cambiar_no_lleva(self, id_orden_trabajo: int, no_lleva: bool,
                               usuario: dict | None) -> Resultado:
        """Marca (o desmarca) que la OT no necesita material. Es distinto de no tener
        ninguna línea cargada, que es que falta cargarla: con la marca el estado del
        material pasa a «no_lleva» y la OT sale de Pendientes.

        Las líneas que tuviera quedan como están (con sus reservas): la marca dice qué
        se compra, no borra lo que alguien cargó. Marcar lo que ya está marcado no toca
        nada (ni el «modificado»)."""
        orden = await self._ot(id_orden_trabajo)
        nuevo = 1 if no_lleva else 0
        if _marca(orden.no_lleva_materia_prima) != bool(nuevo):
            try:
                orden.no_lleva_materia_prima = nuevo
                # Es tocar la cabecera de la OT: queda quién y cuándo, como en toda
                # puerta que la modifica (OrdenTrabajoRepository._sellar_modificacion).
                orden.modificado_en = ahora_ar()
                orden.modificado_por = nombre_solo(usuario)
                await self.db.flush()
                await self.repo.confirmar()
            except Exception:
                await self.repo.deshacer()
                raise
        frase = (f"marcó que la OT N° {orden.id_otvieja} "
                 f"{'no lleva' if nuevo else 'lleva'} materias primas")
        return Resultado(data={"no_lleva_materia_prima": bool(nuevo)}, frase=frase)

    # ─────────────── traer historial ───────────────

    async def historial_de_ot(self, id_orden_trabajo: int) -> dict:
        orden = await self._ot(id_orden_trabajo)
        return await self.historial(orden.id_articulo, orden.unidades, excluir_ot=orden.id)

    async def historial(self, id_articulo: int | None, unidades, excluir_ot: int | None = None) -> dict:
        """La vista previa de «Traer historial»: las materias primas de la OT más reciente
        del mismo artículo (que tenga alguna que se usa), escaladas a esta OT.

        Es la MISMA para una OT que existe (GET /materia-prima/ot/{id}/historial: artículo
        y unidades de la OT, y se excluye a sí misma) y para una que se está dando de alta
        (GET /materia-prima/historial?id_articulo=&unidades=: lo que tiene el formulario).
        Las dos rutas devuelven exactamente esta forma.

        No escribe nada: el front la muestra, la persona confirma y manda el lote
        (origen 'historial').

        · factor = unidades de esta OT / unidades de la de origen (1 si falta alguna).
        · Por línea: la misma pieza, unidad y proveedor; la cantidad × factor (en 'Un'
          hacia arriba a entero: 2,4 bulones son 3); los cortes con su cantidad × factor
          hacia arriba. Marcas y observaciones NO se copian: son de la otra compra.
        · La descripción: la de la línea de origen si el insumo se describe a mano; si es
          tipo 'insumo', la de la pieza hoy (es la que la línea nueva va a congelar).
        · Las líneas en cero (hay en el viejo) no se ofrecen: no hay nada que comprar.
        · Sin artículo no hay historial: `id_articulo == None` en SQL es «IS NULL» y
          traería la OT de cualquier otra sin artículo.
        """
        origen = None
        if id_articulo is not None:
            origen = await self.repo.ot_origen_historial(id_articulo, excluir_ot)
        if origen is None:
            return {"origen": None, "factor": 1.0, "lineas": []}
        factor = factor_historial(unidades, origen.unidades)
        filas = await self.repo.lineas_con_pieza(ids_ot=[origen.id], solo_usadas=True)
        cortes = await self.repo.cortes_de_lineas([f[0].id for f in filas])

        lineas = []
        for linea, codigo, desc_pieza, tipo, _precio, unidad_pieza, proveedor_catalogo in filas:
            unidad = _UNIDAD_CANONICA.get(" ".join(str(linea.unidad or "").split()).upper()) \
                or unidad_linea_desde_pieza(unidad_pieza)
            cantidad = escalar_cantidad(linea.cantidad or 0, factor, unidad)
            if cantidad <= 0:
                continue
            lineas.append({
                "id_pieza": linea.id_pieza,
                "codigo": _codigo(codigo),
                "descripcion": desc_pieza if tipo == "insumo" else (linea.descripcion or desc_pieza),
                "cantidad": cantidad,
                "unidad": unidad,
                "id_proveedor": linea.id_proveedor,
                "proveedor": linea.proveedor or proveedor_catalogo,
                "cortes": [
                    {
                        # El round(…, 6) primero: 0.1 × 30 da 3.0000000000000004 y no son 4.
                        "cantidad": int(math.ceil(round(c.cantidad * factor, 6))),
                        "largo_mm": _numero(c.largo_mm),
                        "ancho_mm": _numero(c.ancho_mm),
                    }
                    for c in cortes.get(linea.id, [])
                ],
            })
        return a_json({
            "origen": {
                "id": origen.id,
                "numero_ot": origen.id_otvieja,
                "fecha_ot": fecha_o_nada(origen.fecha_orden),
                "unidades": origen.unidades,
            },
            "factor": round(factor, 6),
            "lineas": lineas,
        })

    # ─────────────── alta ───────────────

    async def agregar(self, id_orden_trabajo: int, lineas_in: list[LineaIn],
                      usuario: dict | None, forzar: bool = False) -> Resultado:
        """Agrega líneas a la OT, todas o ninguna (el alta de una sola es un lote de uno).

        Todo se valida ANTES de escribir, y los avisos de todas las líneas (un insumo
        inactivo) van juntos en un solo 409.
        """
        orden = await self._ot(id_orden_trabajo)
        if not lineas_in:
            return Resultado(data=[], frase=None)

        piezas = await self.repo.piezas({l.id_pieza for l in lineas_in})
        faltan = sorted({l.id_pieza for l in lineas_in if l.id_pieza not in piezas})
        if faltan:
            raise NotFoundException(
                f"No existe{'n' if len(faltan) > 1 else ''} el insumo "
                f"{', '.join(str(i) for i in faltan)}."
            )
        proveedores = await self.repo.proveedores(
            {l.id_proveedor for l in lineas_in if l.id_proveedor is not None})

        varias = len(lineas_in) > 1
        preparadas, avisos = [], []
        for n, dto in enumerate(lineas_in, start=1):
            pieza = piezas[dto.id_pieza]
            codigo = _codigo(pieza.cod_pieza)
            try:
                preparadas.append(self._preparar_alta(dto, pieza, proveedores))
            except BusinessException as e:
                raise BusinessException(f"{f'Línea {n} ({codigo}): ' if varias else ''}{e.message}")
            if _marca(pieza.inactivo):
                avisos.append(f"El insumo {codigo} está inactivo.")
        if avisos and not forzar:
            avisos = list(dict.fromkeys(avisos))
            raise ConfirmacionRequeridaException(
                " ".join(avisos) + (" ¿Cargarlos igual?" if len(avisos) > 1 else " ¿Cargarlo igual?"))

        nombre = nombre_solo(usuario)
        ahora = ahora_ar()
        try:
            orden_siguiente = await self.repo.siguiente_orden(orden.id)
            ids = []
            for valores, cortes in preparadas:
                linea = OrdenTrabajoPieza(
                    id_orden_trabajo=orden.id,
                    orden=orden_siguiente,
                    usado=1, pedido=0, reserva=0, disponible=0, en_produccion=0,
                    creado_en=ahora, creado_por=nombre,
                    **valores,
                )
                orden_siguiente += 1
                await self.repo.agregar(linea)
                for i, corte in enumerate(cortes, start=1):
                    self.db.add(OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=linea.id, orden=i, **corte))
                ids.append(linea.id)
            await self.db.flush()
            await self.repo.confirmar()
        except Exception:
            await self.repo.deshacer()
            raise

        lineas = await self._lineas_por_id(ids)
        if len(lineas) == 1:
            l = lineas[0]
            frase = (f"cargó {l['codigo']} ({cant_texto(l['cantidad'])} {l['unidad'] or ''}".rstrip()
                     + f") en la OT N° {orden.id_otvieja}")
        else:
            desde_historial = all(v.get("origen") == "historial" for v, _ in preparadas)
            frase = (f"cargó {len(lineas)} materias primas en la OT N° {orden.id_otvieja}"
                     + (" (traídas del historial)" if desde_historial else ""))
        return Resultado(data=a_json(lineas), frase=frase)

    def _preparar_alta(self, dto: LineaIn, pieza, proveedores: dict) -> tuple[dict, list[dict]]:
        """Los valores de una línea nueva, validados (422 si algo no va)."""
        cantidad = _cantidad(dto.cantidad)
        unidad = _unidad(dto.unidad) if dto.unidad is not None and str(dto.unidad).strip() \
            else unidad_linea_desde_pieza(pieza.unidad)

        # La descripción se CONGELA al cargar. En un insumo tipo 'insumo' es la suya (sale
        # de las medidas); en los demás, la que escribieron o, si no, la del insumo.
        desc_pieza = (pieza.descripcion or "")[:LARGO_DESCRIPCION]
        descripcion = _texto(dto.descripcion, LARGO_DESCRIPCION, "La descripción")
        if pieza.tipo == "insumo":
            if descripcion is not None and norm_desc(descripcion) != norm_desc(desc_pieza):
                raise BusinessException(
                    f"La descripción de {_codigo(pieza.cod_pieza)} sale de sus medidas: no se "
                    f"escribe en la línea (si está mal, se corrige en el insumo)."
                )
            descripcion = desc_pieza
        else:
            descripcion = descripcion or desc_pieza

        id_proveedor = dto.id_proveedor
        proveedor = _texto(dto.proveedor, LARGO_PROVEEDOR, "El proveedor")
        if id_proveedor is not None:
            elegido = proveedores.get(id_proveedor)
            if elegido is None:
                raise NotFoundException(f"No existe el proveedor {id_proveedor}.")
            proveedor = proveedor or elegido.razon_social

        origen = dto.origen or "spmm"
        if origen not in ORIGENES_ALTA:
            raise BusinessException(
                f"Origen «{origen}» desconocido: una línea nueva es 'spmm' o 'historial'.")

        valores = {
            "id_pieza": pieza.id,
            "cantidad": cantidad,
            "unidad": unidad,
            "descripcion": descripcion,
            "observaciones": _texto(dto.observaciones, LARGO_OBSERVACIONES, "Las observaciones"),
            "id_proveedor": id_proveedor,
            "proveedor": proveedor,
            "origen": origen,
        }
        return valores, _cortes(dto.cortes)

    # ─────────────── cambios ───────────────

    async def cambiar(self, id_linea: int, cambios: CambiosLinea, usuario: dict | None,
                      forzar: bool = False) -> Resultado:
        """PUT parcial de UNA línea."""
        return await self._cambiar_varias([id_linea], cambios, usuario, forzar, lote=False)

    async def cambiar_lote(self, ids: list[int], cambios: CambiosLineaLote, usuario: dict | None,
                           forzar: bool = False) -> Resultado:
        """Los mismos cambios a muchas líneas (la barra de acciones de Pendientes): todas o
        ninguna, con las mismas reglas que una sola."""
        ids = list(dict.fromkeys(int(i) for i in ids or []))
        if not ids:
            raise BusinessException("No se eligió ninguna línea.")
        return await self._cambiar_varias(ids, cambios, usuario, forzar, lote=True)

    async def _cambiar_varias(self, ids: list[int], cambios, usuario, forzar: bool,
                              lote: bool) -> Resultado:
        campos = set(cambios.model_fields_set)
        lineas = await self.repo.lineas(ids)
        faltan = [i for i in ids if i not in lineas]
        if faltan:
            raise NotFoundException(
                f"No existe{'n' if len(faltan) > 1 else ''} la línea de materia prima "
                f"{', '.join(str(i) for i in faltan)}."
            )
        piezas = await self.repo.piezas({l.id_pieza for l in lineas.values()})
        ordenes = await self.repo.ots({l.id_orden_trabajo for l in lineas.values()})
        proveedores = {}
        if "id_proveedor" in campos and cambios.id_proveedor is not None:
            proveedores = await self.repo.proveedores([cambios.id_proveedor])

        avisos: list[str] = []
        hechos: list[str] = []
        try:
            for id_linea in ids:
                linea = lineas[id_linea]
                pieza = piezas[linea.id_pieza]
                numero = ordenes[linea.id_orden_trabajo].id_otvieja
                try:
                    hechos_linea = await self._aplicar(
                        linea, pieza, numero, cambios, campos, usuario, avisos, proveedores)
                except BusinessException as e:
                    if lote:
                        raise BusinessException(
                            f"{_codigo(pieza.cod_pieza)} (OT N° {numero}): {e.message}")
                    raise
                for h in hechos_linea:
                    if h not in hechos:
                        hechos.append(h)
            if avisos and not forzar:
                raise ConfirmacionRequeridaException(" ".join(avisos) + " ¿Hacerlo igual?")
            await self.db.flush()
            await self.repo.confirmar()
        except Exception:
            await self.repo.deshacer()
            raise

        datos = await self._lineas_por_id(ids)
        if lote:
            numeros = sorted({d_ot.id_otvieja for d_ot in ordenes.values() if d_ot.id_otvieja})
            frase = (f"cambió {len(ids)} línea{'s' if len(ids) != 1 else ''} de materia prima "
                     f"(OT N° {', '.join(str(n) for n in numeros)})")
            if hechos:
                frase += ": " + ", ".join(hechos)
            return Resultado(data=a_json(datos), frase=frase)
        d = datos[0]
        numero = ordenes[d["id_orden_trabajo"]].id_otvieja
        frase = f"cambió la línea {d['codigo']} de la OT N° {numero}"
        if hechos:
            frase += ": " + ", ".join(hechos)
        return Resultado(data=a_json(d), frase=frase)

    async def _libre_sin(self, linea) -> float:
        """Lo libre del insumo sin contar lo que ya reservó esta misma línea (si no, la
        línea competiría consigo misma al cambiar su reserva)."""
        stock = await stock_de(self.db, [linea.id_pieza], excluir_linea=linea.id)
        return stock.get(linea.id_pieza, {}).get("libre", 0.0)

    async def _aplicar(self, linea, pieza, numero_ot, cambios, campos: set, usuario,
                       avisos: list[str], proveedores: dict) -> list[str]:
        """Aplica los cambios a UNA línea (sin commit). Devuelve qué se hizo, dicho para
        la frase de Auditoría. Los avisos (409) se juntan en `avisos` y el que llama
        decide: así un lote avisa todo junto.

        El orden de los pasos importa (ver el encabezado del módulo).
        """
        codigo = _codigo(pieza.cod_pieza)
        nombre = nombre_solo(usuario)
        ahora = ahora_ar()
        hechos: list[str] = []

        def vino(campo: str) -> bool:
            return campo in campos

        def marca_pedida(campo: str) -> bool | None:
            """El valor pedido para una marca, o None si no vino (o vino null: una marca
            en null no dice nada)."""
            if not vino(campo):
                return None
            return getattr(cambios, campo, None)

        # 0. El insumo de la línea no se cambia.
        if vino("id_pieza") and getattr(cambios, "id_pieza", None) is not None \
                and cambios.id_pieza != linea.id_pieza:
            raise BusinessException(
                "El insumo de una línea no se cambia: borrala y agregá otra con el insumo correcto.")

        # 1. Datos de la línea.
        if vino("cantidad"):
            nueva = _cantidad(cambios.cantidad)
            if nueva != _numero(linea.cantidad):
                hechos.append(f"cantidad {cant_texto(nueva)}")
            linea.cantidad = nueva
            # La reserva vigente no puede ser mayor que lo que lleva la línea.
            if reserva_vigente(linea) and (linea.cantidad_reservada or 0) > nueva + _EPS:
                linea.cantidad_reservada = nueva
        if vino("unidad"):
            linea.unidad = _unidad(cambios.unidad)
        if vino("descripcion"):
            nueva = _texto(cambios.descripcion, LARGO_DESCRIPCION, "La descripción")
            if pieza.tipo == "insumo":
                actual = linea.descripcion or pieza.descripcion
                if nueva is not None and norm_desc(nueva) != norm_desc(actual):
                    raise BusinessException(
                        f"La descripción de {codigo} sale de sus medidas: no se escribe en la "
                        f"línea (si está mal, se corrige en el insumo)."
                    )
            else:
                # Vacía = volver a la del insumo.
                linea.descripcion = nueva
                hechos.append("descripción")
        if vino("observaciones"):
            linea.observaciones = _texto(cambios.observaciones, LARGO_OBSERVACIONES, "Las observaciones")
            hechos.append("observaciones")
        if vino("orden"):
            if cambios.orden is not None and not (0 <= cambios.orden <= 32767):
                raise BusinessException("El orden de la línea tiene que ser un número entre 0 y 32767.")
            linea.orden = cambios.orden

        # 2. Proveedor de esta compra: uno del catálogo y/o un texto.
        if vino("id_proveedor"):
            if cambios.id_proveedor is None:
                linea.id_proveedor = None
            else:
                elegido = proveedores.get(cambios.id_proveedor)
                if elegido is None:
                    raise NotFoundException(f"No existe el proveedor {cambios.id_proveedor}.")
                linea.id_proveedor = elegido.id
                if not vino("proveedor"):
                    linea.proveedor = elegido.razon_social
        if vino("proveedor"):
            texto = _texto(cambios.proveedor, LARGO_PROVEEDOR, "El proveedor")
            # Un texto escrito a mano reemplaza al elegido de la lista: dejar el id
            # diría un proveedor y mostraría otro.
            if not vino("id_proveedor") and texto != linea.proveedor:
                linea.id_proveedor = None
            linea.proveedor = texto
        if vino("id_proveedor") or vino("proveedor"):
            hechos.append(f"proveedor {linea.proveedor}" if linea.proveedor else "sin proveedor")

        # 3. Fechas: null explícito BORRA; lo que no vino no se toca.
        if vino("fecha_proveedor"):
            linea.fecha_proveedor = cambios.fecha_proveedor
            hechos.append("fecha del proveedor")
        if vino("fecha_entrega"):
            linea.fecha_entrega = cambios.fecha_entrega
            hechos.append("fecha de entrega")

        # 4. PRODUC (marca manual).
        produccion = marca_pedida("en_produccion")
        if produccion is not None and _marca(linea.en_produccion) != produccion:
            linea.en_produccion = 1 if produccion else 0
            hechos.append("marcó en producción" if produccion else "desmarcó en producción")

        # 5. Utilizado. Lo que no se usa no traba stock: suelta la reserva vigente.
        usado = marca_pedida("usado")
        if usado is not None and _marca(linea.usado, 1) != usado:
            if not usado and reserva_vigente(linea):
                linea.reserva = 0
                linea.cantidad_reservada = None
                hechos.append("soltó la reserva")
            linea.usado = 1 if usado else 0
            hechos.append("marcó utilizada" if usado else "marcó que no se usa")

        # 6. Disponible 1→0: el retiro de stock se anula ANTES de tocar la reserva (así
        #    «Quitar marcas» anda en un solo pedido).
        disponible = marca_pedida("disponible")
        if disponible is False and _marca(linea.disponible):
            linea.disponible = 0
            linea.disponible_en = None
            linea.disponible_por = None
            if linea.id_movimiento_retiro is not None:
                movimiento = await self.db.get(PiezaMovimiento, linea.id_movimiento_retiro)
                if movimiento is not None and not movimiento.anulado:
                    await anular_movimiento(self.db, movimiento, usuario,
                                            motivo="Se desmarcó Disponible", desde_linea=True)
                linea.id_movimiento_retiro = None
            hechos.append("desmarcó disponible")

        # 7. Reserva.
        reserva = marca_pedida("reserva")
        vino_cantidad_reservada = vino("cantidad_reservada") \
            and getattr(cambios, "cantidad_reservada", None) is not None
        if reserva is True and not _marca(linea.reserva):
            if _marca(linea.disponible):
                raise BusinessException(
                    f"{codigo} ya está disponible: no hay nada que reservar.")
            if not _marca(linea.usado, 1):
                raise BusinessException(
                    f"{codigo} está marcada como que no se usa: tildá «Utilizado» antes de reservar.")
            libre = await self._libre_sin(linea)
            if vino_cantidad_reservada:
                cantidad_reservada = self._cantidad_reservada(cambios.cantidad_reservada, linea)
            else:
                # Sin cantidad: lo que haya libre, hasta lo que lleva la línea. Si no hay
                # nada libre, la línea entera (y el aviso de abajo lo dice).
                cantidad_reservada = min(float(linea.cantidad), libre) if libre > _EPS \
                    else float(linea.cantidad)
                cantidad_reservada = round(cantidad_reservada, 3)
            self._avisar_si_no_alcanza(cantidad_reservada, libre, codigo, numero_ot, avisos)
            linea.reserva = 1
            linea.cantidad_reservada = cantidad_reservada
            hechos.append(f"reservó {cant_texto(cantidad_reservada)}")
        elif reserva is False and _marca(linea.reserva):
            linea.reserva = 0
            linea.cantidad_reservada = None
            hechos.append("soltó la reserva")
        elif vino_cantidad_reservada:
            if not _marca(linea.reserva):
                raise BusinessException(
                    f"{codigo} no está reservada: tildá «Reserva» para apartar stock.")
            if _marca(linea.disponible):
                raise BusinessException(
                    f"Lo reservado de {codigo} ya se retiró del stock (está disponible): "
                    f"desmarcá «Disponible» para cambiarlo.")
            nueva = self._cantidad_reservada(cambios.cantidad_reservada, linea)
            anterior = float(linea.cantidad_reservada or 0)
            if nueva > anterior + _EPS:
                # Sólo avisa lo que se AGREGA: bajar una reserva nunca empeora el stock.
                libre = await self._libre_sin(linea)
                self._avisar_si_no_alcanza(nueva, libre, codigo, numero_ot, avisos)
            if abs(nueva - anterior) > _EPS:
                hechos.append(f"reservó {cant_texto(nueva)}")
            linea.cantidad_reservada = nueva

        # 8. Pedido.
        pedido = marca_pedida("pedido")
        if pedido is True and not _marca(linea.pedido):
            linea.pedido = 1
            linea.pedido_en = ahora
            linea.pedido_por = nombre
            hechos.append("marcó pedido")
        elif pedido is False and _marca(linea.pedido):
            linea.pedido = 0
            linea.pedido_en = None
            linea.pedido_por = None
            hechos.append("desmarcó pedido")

        # 9. Disponible 0→1: si estaba reservada, se retira lo reservado del stock.
        if disponible is True and not _marca(linea.disponible):
            linea.disponible = 1
            linea.disponible_en = ahora
            linea.disponible_por = nombre
            if not vino("fecha_entrega") and linea.fecha_entrega is None:
                linea.fecha_entrega = ahora.date()
            if _marca(linea.reserva) and linea.cantidad_reservada and linea.id_movimiento_retiro is None:
                movimiento = await registrar_movimiento(
                    self.db, linea.id_pieza, "retiro_ot", -float(linea.cantidad_reservada),
                    comentario=f"OT N° {numero_ot} – retirado para la orden",
                    usuario=usuario,
                    id_orden_trabajo=linea.id_orden_trabajo,
                    id_orden_trabajo_pieza=linea.id,
                )
                linea.id_movimiento_retiro = movimiento.id
                hechos.append(f"marcó disponible (retiró {cant_texto(linea.cantidad_reservada)} del stock)")
            else:
                hechos.append("marcó disponible")

        linea.modificado_en = ahora
        linea.modificado_por = nombre
        await self.db.flush()
        return hechos

    @staticmethod
    def _cantidad_reservada(valor, linea) -> float:
        try:
            numero = float(valor)
        except (TypeError, ValueError):
            numero = None
        if numero is None or not math.isfinite(numero) or numero <= 0:
            raise BusinessException("La cantidad a reservar tiene que ser mayor que cero.")
        if numero > float(linea.cantidad) + _EPS:
            raise BusinessException(
                f"No se puede reservar más de lo que lleva la línea ({cant_texto(linea.cantidad)}).")
        return round(numero, 3)

    @staticmethod
    def _avisar_si_no_alcanza(cantidad_reservada: float, libre: float, codigo: str,
                              numero_ot, avisos: list[str]) -> None:
        if cantidad_reservada > libre + _EPS:
            avisos.append(
                f"Hay {cant_texto(max(libre, 0))} libres de {codigo}; la reserva de "
                f"{cant_texto(cantidad_reservada)} para la OT N° {numero_ot} deja el stock "
                f"en negativo."
            )

    # ─────────────── cortes ───────────────

    async def reemplazar_cortes(self, id_linea: int, cortes_in: list[CorteIn],
                                usuario: dict | None) -> Resultado:
        """Reemplaza TODOS los cortes de la línea. No cambia la cantidad: la sugerencia en
        metros (sugerido_m) vuelve con la línea y la pantalla ofrece «Usar sugerencia»."""
        linea = await self.repo.linea(id_linea)
        if linea is None:
            raise NotFoundException(f"No existe la línea de materia prima {id_linea}.")
        cortes = _cortes(cortes_in)
        try:
            await self.repo.borrar_cortes(linea.id)
            for i, corte in enumerate(cortes, start=1):
                self.db.add(OrdenTrabajoPiezaCorte(id_orden_trabajo_pieza=linea.id, orden=i, **corte))
            linea.modificado_en = ahora_ar()
            linea.modificado_por = nombre_solo(usuario)
            await self.db.flush()
            await self.repo.confirmar()
        except Exception:
            await self.repo.deshacer()
            raise
        d = (await self._lineas_por_id([id_linea]))[0]
        orden = await self.repo.ot(d["id_orden_trabajo"])
        frase = (f"cargó {len(cortes)} corte{'s' if len(cortes) != 1 else ''} en {d['codigo']} "
                 f"de la OT N° {orden.id_otvieja if orden else d['id_orden_trabajo']}")
        return Resultado(data=a_json(d), frase=frase)

    # ─────────────── borrar ───────────────

    async def borrar(self, id_linea: int, usuario: dict | None, forzar: bool = False) -> Resultado:
        """Borra una línea. «Avisar, no bloquear»: si tiene consumos cargados o está pedida,
        409 diciendo qué se pierde, y con ?forzar=true se borra igual.

        Los consumos quedan (tienen su OT y su insumo): lo que se consumió no deja de
        haberse consumido. Si la línea había retirado stock al marcarse disponible, el
        retiro se anula (el material vuelve al stock). Los cortes se van con ella.
        """
        linea = await self.repo.linea(id_linea)
        if linea is None:
            raise NotFoundException(f"No existe la línea de materia prima {id_linea}.")
        pieza = (await self.repo.piezas([linea.id_pieza]))[linea.id_pieza]
        orden = await self.repo.ot(linea.id_orden_trabajo)
        numero = orden.id_otvieja if orden else linea.id_orden_trabajo
        codigo = _codigo(pieza.cod_pieza)

        cuantos, total = await self.repo.consumos_de_linea(linea.id)
        se_pierde = []
        if cuantos:
            varios = cuantos != 1
            se_pierde.append(
                f"tiene {cuantos} consumo{'s' if varios else ''} cargado{'s' if varios else ''} "
                f"({cant_texto(total)} {linea.unidad or ''}".rstrip()
                + f"), que {'quedan registrados' if varios else 'queda registrado'} en la OT "
                f"pero sin esta línea")
        if _marca(linea.pedido):
            quien = f" (la marcó {linea.pedido_por})" if linea.pedido_por else ""
            a_quien = f" a {linea.proveedor}" if linea.proveedor else ""
            se_pierde.append(f"está pedida{a_quien}{quien} y se pierde esa marca")
        if se_pierde and not forzar:
            raise ConfirmacionRequeridaException(
                f"La línea {codigo} de la OT N° {numero} " + " y ".join(se_pierde)
                + ". ¿Borrarla igual?")

        try:
            if linea.id_movimiento_retiro is not None:
                movimiento = await self.db.get(PiezaMovimiento, linea.id_movimiento_retiro)
                if movimiento is not None and not movimiento.anulado:
                    await anular_movimiento(self.db, movimiento, usuario,
                                            motivo="Se borró la línea de la OT", desde_linea=True)
            await self.repo.borrar_linea(linea)
            await self.repo.confirmar()
        except Exception:
            await self.repo.deshacer()
            raise
        logger.info(f"Service - Línea {id_linea} ({codigo}) borrada de la OT {numero}.")
        return Resultado(data={"id": id_linea}, frase=f"borró {codigo} de la OT N° {numero}")


__all__ = ["MateriaPrimaOTService", "Resultado", "lineas_a_dict", "falta_de", "reserva_vigente",
           "cant_texto", "a_json"]
