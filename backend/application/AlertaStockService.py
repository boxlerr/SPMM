"""El aviso automático de stock bajo (RF-14).

QUÉ PIDE EL REQUISITO

«El sistema deberá alertar automáticamente cuando un insumo esté por debajo del stock
mínimo definido.»

El stock ya estaba (`pieza.stockactual`, lo trae el sync del sistema viejo) y la
campanita también (la dejó armada el aviso de OT retrasada, RF-04). Faltaban dos
cosas: el mínimo —nadie lo había definido nunca— y quién mirara la diferencia. El
mínimo se carga en la solapa Materia Prima; esto es lo segundo.

LA REGLA

  · la pieza tiene un mínimo cargado        (sin mínimo = no se vigila)
  · tiene stock conocido                    (NULL es «no sabemos», no «cero»)
  · el stock es ESTRICTAMENTE menor         (el SRS dice «por debajo»)
  · y de esta bajada todavía no se avisó    (pieza.stock_bajo_avisado_en IS NULL)

Las tres primeras son `Pieza.bajo_minimo`, escritas UNA vez en el modelo: la misma
regla filtra la solapa, así que la campanita y la pantalla no pueden opinar distinto.

EL ANTI-DUPLICADO, Y POR QUÉ NO ES EL MISMO QUE EL DE RF-04

Una OT se retrasa una sola vez; un insumo se perfora muchas: baja, se repone, vuelve
a bajar. Cada bajada merece su aviso, pero una bajada sola no puede avisarse cada vez
que corre el detector. Por eso la marca vive en la pieza y no en un índice único de
la notificación:

  1. REARMAR. Primero se limpian las marcas de las piezas que ya NO están abajo (se
     repusieron, les subieron el stock en el viejo, les bajaron o sacaron el mínimo).
     Esa pieza queda lista para avisar la próxima vez que baje.
  2. RECLAMAR. De las que están abajo y sin marca, se toman hasta `tope` y se les
     pone la marca con un UPDATE ... WHERE stock_bajo_avisado_en IS NULL RETURNING id.
     Si dos corridas se pisaran (un reintento del cron mientras la primera sigue),
     Postgres hace esperar a la segunda por el lock de la fila y, al soltarse, la
     re-evalúa: la marca ya está y la fila no vuelve. Sólo se avisa de lo que ESTA
     corrida reclamó.
  3. AVISAR. Una notificación por pieza reclamada.

Los tres pasos van en UNA transacción: si el aviso no se pudo escribir, la marca
tampoco queda, y la próxima corrida lo intenta de nuevo. Una marca sin su aviso sería
el peor estado posible: la pieza quedaría callada para siempre.

La regla vive en la consulta, no en un índice, así que funciona igual en SQLite (los
tests) que en Postgres.

EL TOPE POR CORRIDA

Mismo motivo que RF-04: el día que el pañol cargue treinta mínimos de una, la primera
corrida no puede dejar treinta renglones juntos en la campanita. Se avisa de hasta
`tope` y el resto queda para la próxima (no se pierde: la consulta lo vuelve a
encontrar). Primero van las más comprometidas: las que se quedaron sin nada, y
después las que tienen menos stock en proporción a su mínimo.

LO QUE ESTO NO HACE

No descuenta ni corrige stock: el stock es del sistema viejo (decisión del 11/09) y
acá sólo se lee. Si el número del viejo está mal, el aviso va a estar mal igual; eso
se arregla en el viejo o cuando el stock pase a SPMM (RF-13).
"""
from datetime import datetime

from sqlalchemy import case, func, select, update

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.loggers.logger import logger
from backend.domain.Notificacion import Notificacion
from backend.domain.Pieza import Pieza
from backend.infrastructure.auditoria_movimientos import ahora_ar

# El tipo con el que viaja el aviso hasta la campanita. La pantalla lo usa para el
# ícono, el rótulo y para saber que tocarlo lleva a la materia prima.
TIPO_ALERTA = "STOCK_BAJO"

# Cuántos avisos como mucho escribe UNA corrida. Mismo número que el de órdenes
# retrasadas, por el mismo motivo (ver el encabezado).
TOPE_POR_CORRIDA = 25

# Lo máximo de la descripción que entra en la frase. La descripción del sistema viejo
# a veces es larguísima y la frase tiene que caber en los 500 de la columna con el
# número adentro: el número es lo que importa, no la descripción entera.
_TOPE_DESCRIPCION = 200


def formatear_cantidad(valor) -> str:
    """Un número como lo escribe el taller: sin «.0» de más y con coma decimal.

    `12.0` -> «12», `2.5` -> «2,5», `0.125` -> «0,125». Hasta tres decimales: el
    catálogo mezcla unidades, kilos y metros, y más que milésimas no le sirve a nadie.
    """
    if valor is None:
        return "?"
    v = round(float(valor), 3)
    if v == int(v):
        return str(int(v))
    return f"{v:.3f}".rstrip("0").rstrip(".").replace(".", ",")


def _con_unidad(valor, unidad: str | None) -> str:
    cantidad = formatear_cantidad(valor)
    unidad = (unidad or "").strip()
    return f"{cantidad} {unidad}" if unidad else cantidad


def armar_mensaje(cod_pieza, descripcion, stock, minimo, unidad) -> str:
    """La frase que se lee en la campanita. Cabe en los 500 caracteres de la columna.

    Dice qué insumo es —con el código, que es como lo busca el pañol—, cuánto queda y
    cuál es el mínimo: lo necesario para decidir si hay que pedir hoy, sin abrir nada.
    """
    desc = (descripcion or "").strip()
    if len(desc) > _TOPE_DESCRIPCION:
        desc = desc[: _TOPE_DESCRIPCION - 1].rstrip() + "…"
    nombre = f"{cod_pieza} ({desc})" if desc else f"{cod_pieza}"
    return (
        f"Stock bajo de {nombre}: quedan {_con_unidad(stock, unidad)} "
        f"y el mínimo es {_con_unidad(minimo, unidad)}."
    )[:500]


def armar_motivo(stock, minimo, unidad, proveedor, estante, letra, nro) -> str:
    """El detalle de abajo: cuánto falta, a quién se le pide y dónde está."""
    partes = [f"Faltan {_con_unidad(max(minimo - stock, 0), unidad)} para llegar al mínimo"]
    if (proveedor or "").strip():
        partes.append(f"Proveedor: {proveedor.strip()}")
    ubicacion = " ".join(p.strip() for p in (estante, letra, nro) if p and p.strip())
    if ubicacion:
        partes.append(f"Ubicación: {ubicacion}")
    return ". ".join(partes) + "."


class AlertaStockService:
    """Capa de aplicación del aviso de stock bajo.

    No la llama ninguna pantalla: la dispara `POST /internal/alertas` (junto con el
    aviso de órdenes retrasadas), que a su vez lo llama un cron externo. Ver main.py.
    """

    def __init__(self, db_session):
        self.db = db_session

    # 🔹 Detectar y avisar
    async def detectarYAvisarStockBajo(self, tope: int = TOPE_POR_CORRIDA, ahora: datetime = None):
        """Rearma, reclama hasta `tope` piezas bajo mínimo sin aviso y avisa de cada una.

        Devuelve cuántos avisos creó, cuántas piezas quedaron esperando el suyo y
        cuántas marcas se rearmaron: sin el segundo número, una corrida topeada se ve
        igual que una en la que ya no queda nada por avisar.
        """
        try:
            ahora = ahora or ahora_ar()
            tope = max(int(tope), 1)

            # 1. REARMAR: lo que ya no está abajo, vuelve a poder avisar.
            rearmadas = (
                await self.db.execute(
                    update(Pieza)
                    .where(Pieza.stock_bajo_avisado_en.isnot(None), ~Pieza.bajo_minimo)
                    .values(stock_bajo_avisado_en=None)
                    .execution_options(synchronize_session=False)
                )
            ).rowcount or 0

            sin_aviso = [Pieza.bajo_minimo, Pieza.stock_bajo_avisado_en.is_(None)]

            # Dos consultas a propósito, como en RF-04: el total se cuenta en la base y
            # sólo se leen las `tope` que se van a avisar, con LAS MISMAS condiciones.
            pendientes = (
                await self.db.execute(
                    select(func.count()).select_from(Pieza).where(*sin_aviso)
                )
            ).scalar_one()

            creadas = 0
            if pendientes:
                # Primero lo más comprometido: sin stock (o con mínimo 0 y stock
                # negativo) arriba de todo, después la proporción stock/mínimo más baja.
                urgencia = case(
                    (Pieza.stock_minimo > 0, Pieza.stockactual / Pieza.stock_minimo),
                    else_=-1.0,
                )
                filas = (
                    await self.db.execute(
                        select(
                            Pieza.id,
                            Pieza.cod_pieza,
                            Pieza.descripcion,
                            Pieza.stockactual,
                            Pieza.stock_minimo,
                            Pieza.unidad,
                            Pieza.proveedor,
                            Pieza.estante,
                            Pieza.letra,
                            Pieza.nro,
                        )
                        .where(*sin_aviso)
                        .order_by(urgencia.asc(), Pieza.id.asc())
                        .limit(tope)
                    )
                ).all()

                # 2. RECLAMAR: sólo se avisa de lo que ESTA corrida marcó.
                reclamadas = set(
                    (
                        await self.db.execute(
                            update(Pieza)
                            .where(Pieza.id.in_([f.id for f in filas]), *sin_aviso)
                            .values(stock_bajo_avisado_en=ahora)
                            .returning(Pieza.id)
                            .execution_options(synchronize_session=False)
                        )
                    ).scalars().all()
                )

                # 3. AVISAR.
                avisos = [
                    Notificacion(
                        mensaje=armar_mensaje(f.cod_pieza, f.descripcion, f.stockactual,
                                              f.stock_minimo, f.unidad),
                        tipo=TIPO_ALERTA,
                        leida=False,
                        motivo=armar_motivo(f.stockactual, f.stock_minimo, f.unidad,
                                            f.proveedor, f.estante, f.letra, f.nro),
                        # No la generó una persona: la generó el detector.
                        id_usuario_creador=None,
                        id_pieza=f.id,
                        # EXPLÍCITO: el default del modelo es `utcnow` y deja los avisos
                        # tres horas adelantados. Mismo cuidado que RF-04.
                        fecha_creacion=ahora,
                    )
                    for f in filas
                    if f.id in reclamadas
                ]
                self.db.add_all(avisos)
                creadas = len(avisos)

            # UN commit para los tres pasos: la marca y su aviso quedan juntos o no
            # queda ninguno de los dos.
            await self.db.commit()

            sin_avisar = max(pendientes - creadas, 0)
            logger.info(
                "Alertas de stock: %d avisos creados, %d piezas quedaron para la próxima "
                "corrida, %d marcas rearmadas (tope=%d).", creadas, sin_avisar, rearmadas, tope,
            )

            return ResponseDTO(
                status=True,
                data={"creadas": creadas, "sin_avisar": sin_avisar,
                      "rearmadas": rearmadas, "tope": tope},
                errorDescription="",
            )

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Service - Error al detectar stock bajo: {e}")
            raise InfrastructureException("Error al generar las alertas de stock bajo.") from e
