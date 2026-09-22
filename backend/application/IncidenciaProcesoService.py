"""Las no conformidades de una orden (RF-12).

El SRS pide «generar reportes de no conformidades y asociarlos a las órdenes
correspondientes». La mitad de abajo ya existía desde el 25/06 con otro nombre —la
tabla `incidencia_proceso`, que cuelga de la OT— pero sólo servía para UNA pregunta:
cuánto tiempo se perdió por no interpretar un plano. Lo que faltaba era poder decir qué
clase de no conformidad fue, qué tan grave, si se resolvió, y poder sacar la lista
filtrada para llevarla a una reunión.

DOS COSAS QUE NO SE HICIERON, A PROPÓSITO

  · No hay tabla catálogo de tipos. El RF no pide un ABM de tipos y no hay ninguno
    comparable en el sistema: las listas viven acá abajo, se exponen por
    `GET /incidencias/tipos` y el front las dibuja. El día que el taller quiera
    agregar uno, es una línea acá y no una pantalla nueva.
  · No hay borrado. Un registro de calidad no se borra: se cierra. Por eso hay
    `cerrar()` y no `eliminar()`.
"""
import csv
import io
from datetime import datetime, timedelta

from fastapi.encoders import jsonable_encoder

from backend.domain.IncidenciaProceso import IncidenciaProceso, _ahora_ar
from backend.dto.IncidenciaProcesoRequestDTO import (
    CerrarIncidenciaDTO,
    IncidenciaProcesoRequestDTO,
    IncidenciaProcesoUpdateDTO,
)
from backend.infrastructure.IncidenciaProcesoRepository import IncidenciaProcesoRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger


# Qué clase de no conformidad. La clave es lo que se guarda (y lo que ya está guardado:
# INTERPRETACION_PLANOS es el único tipo que existía hasta el 22/09), el valor es cómo
# se lee en pantalla y en el CSV.
TIPOS: dict[str, str] = {
    "INTERPRETACION_PLANOS": "Interpretación de planos",
    "MEDIDA_FUERA_DE_TOLERANCIA": "Medida fuera de tolerancia",
    "MATERIAL_NO_CONFORME": "Material no conforme",
    "TERMINACION": "Terminación / superficie",
    "DOCUMENTACION": "Documentación",
    "OTRO": "Otro",
}

GRAVEDADES: dict[str, str] = {
    "LEVE": "Leve",
    "MEDIA": "Media",
    "GRAVE": "Grave",
}

ESTADOS: dict[str, str] = {
    "ABIERTA": "Abierta",
    "CERRADA": "Cerrada",
}

ABIERTA = "ABIERTA"
CERRADA = "CERRADA"

# Cuántas filas como mucho trae el reporte de una vez. El tope viejo del listado era 50
# y estaba clavado en el código: con eso, «todas las no conformidades del año» era una
# lista cortada que no avisaba que estaba cortada. Ahora el tope se pide, se devuelve en
# la respuesta y el resumen se calcula sobre TODO lo que matchea, no sobre lo traído.
TOPE_REPORTE = 500
TOPE_MAXIMO = 5000


def nombre_de(usuario: dict | None) -> tuple[int | None, str | None]:
    """Quién es, sacado del token. Sin token, nadie: nunca un autor inventado."""
    if not usuario:
        return None, None
    partes = [usuario.get("nombre") or "", usuario.get("apellido") or ""]
    completo = " ".join(p for p in partes if p).strip() or usuario.get("username")
    return usuario.get("id_usuario"), (str(completo)[:120] if completo else None)


def _fecha(valor: str | None, campo: str) -> datetime | None:
    """`YYYY-MM-DD` a datetime local. Las fechas de esta base no llevan zona."""
    if not valor:
        return None
    try:
        return datetime.strptime(valor.strip()[:10], "%Y-%m-%d")
    except ValueError:
        raise BusinessException(f"La fecha «{campo}» tiene que ser del tipo AAAA-MM-DD.")


class IncidenciaProcesoService:
    def __init__(self, db_session):
        self.repository = IncidenciaProcesoRepository(db_session)

    # ------------------------------------------------------------------
    # Alta y correcciones
    # ------------------------------------------------------------------

    async def registrar(self, dto: IncidenciaProcesoRequestDTO, usuario: dict | None = None):
        logger.info(f"Service - Registrar no conformidad tipo={dto.tipo} OT={dto.id_orden_trabajo}")
        if not dto.id_orden_trabajo:
            raise BusinessException("La no conformidad debe estar asociada a una orden de trabajo.")

        tipo = self._validar(dto.tipo or "INTERPRETACION_PLANOS", TIPOS, "tipo")
        gravedad = self._validar(dto.gravedad, GRAVEDADES, "gravedad")
        id_usuario, nombre = nombre_de(usuario)

        incidencia = IncidenciaProceso(
            id_orden_trabajo=dto.id_orden_trabajo,
            id_proceso=dto.id_proceso,
            id_operario=dto.id_operario,
            tipo=tipo,
            minutos_perdidos=max(0, dto.minutos_perdidos or 0),
            operarios_extra=max(0, dto.operarios_extra or 0),
            descripcion=dto.descripcion,
            # Sin gravedad queda NULL —«sin clasificar»— y no MEDIA: que el reporte
            # pueda mostrar cuáles todavía nadie evaluó es la mitad de para qué sirve.
            gravedad=gravedad,
            piezas_afectadas=(None if dto.piezas_afectadas is None else max(0, dto.piezas_afectadas)),
            estado=ABIERTA,
            id_usuario=id_usuario,
            usuario=nombre,
            fecha_registro=_ahora_ar(),
        )
        creada = await self.repository.save(incidencia)
        return ResponseDTO(status=True, data=jsonable_encoder(creada), errorDescription="")

    async def actualizar(self, id_incidencia: int, dto: IncidenciaProcesoUpdateDTO,
                         usuario: dict | None = None):
        """Corregir una no conformidad ya cargada.

        Sólo se tocan los campos que VIENEN en el cuerpo: mandar nada más la gravedad no
        puede vaciar la descripción de paso.
        """
        incidencia = await self._traer(id_incidencia)
        cambios = dto.model_dump(exclude_unset=True)

        if "tipo" in cambios:
            incidencia.tipo = self._validar(cambios["tipo"], TIPOS, "tipo") or incidencia.tipo
        if "gravedad" in cambios:
            incidencia.gravedad = self._validar(cambios["gravedad"], GRAVEDADES, "gravedad")
        if "estado" in cambios:
            nuevo = self._validar(cambios["estado"], ESTADOS, "estado") or ABIERTA
            self._mover_estado(incidencia, nuevo, usuario)
        for campo in ("descripcion", "accion_correctiva", "id_proceso", "id_operario"):
            if campo in cambios:
                setattr(incidencia, campo, cambios[campo])
        for campo in ("minutos_perdidos", "operarios_extra"):
            if campo in cambios:
                setattr(incidencia, campo, max(0, cambios[campo] or 0))
        if "piezas_afectadas" in cambios:
            piezas = cambios["piezas_afectadas"]
            incidencia.piezas_afectadas = None if piezas is None else max(0, piezas)

        guardada = await self.repository.guardar_cambios(incidencia)
        return ResponseDTO(status=True, data=jsonable_encoder(guardada), errorDescription="")

    async def cerrar(self, id_incidencia: int, dto: CerrarIncidenciaDTO | None = None,
                     usuario: dict | None = None):
        """Darla por resuelta: estampa la fecha y deja anotado qué se hizo."""
        incidencia = await self._traer(id_incidencia)
        if dto is not None and dto.accion_correctiva is not None:
            incidencia.accion_correctiva = dto.accion_correctiva
        self._mover_estado(incidencia, CERRADA, usuario)
        guardada = await self.repository.guardar_cambios(incidencia)
        return ResponseDTO(status=True, data=jsonable_encoder(guardada), errorDescription="")

    def _mover_estado(self, incidencia: IncidenciaProceso, nuevo: str, usuario: dict | None):
        """Estado y fecha de cierre se escriben juntos, siempre.

        Si se separaran, una fila podría quedar CERRADA sin fecha (el reporte no sabría
        desde cuándo) o ABIERTA con fecha de cierre (que es peor: parece resuelta).
        """
        if nuevo == CERRADA:
            if incidencia.estado != CERRADA:
                incidencia.fecha_cierre = _ahora_ar()
            incidencia.estado = CERRADA
        else:
            incidencia.estado = ABIERTA
            incidencia.fecha_cierre = None

    async def _traer(self, id_incidencia: int) -> IncidenciaProceso:
        incidencia = await self.repository.find_by_id(id_incidencia)
        if incidencia is None:
            raise NotFoundException(f"No existe la no conformidad {id_incidencia}.")
        return incidencia

    @staticmethod
    def _validar(valor: str | None, permitidos: dict[str, str], campo: str) -> str | None:
        """Vacío pasa (es «sin clasificar»); un valor que no está en la lista, no.

        Se valida contra la lista y no se guarda cualquier cosa porque el reporte agrupa
        por estos valores: un 'grave' en minúscula sería una categoría nueva que nadie
        ve en los filtros y que no suma en ningún lado.
        """
        if valor is None or str(valor).strip() == "":
            return None
        limpio = str(valor).strip().upper()
        if limpio not in permitidos:
            raise BusinessException(
                f"«{valor}» no es un {campo} válido. Los valores posibles son: "
                + ", ".join(permitidos)
            )
        return limpio

    # ------------------------------------------------------------------
    # El reporte
    # ------------------------------------------------------------------

    async def reporte(self, *, id_orden: int | None = None, nro_ot: int | None = None,
                      tipo: str | None = None, gravedad: str | None = None,
                      estado: str | None = None, desde: str | None = None,
                      hasta: str | None = None, limite: int = TOPE_REPORTE):
        """El listado con filtros que pide el RF-12, más su resumen.

        Todos los filtros son opcionales y sin ninguno trae TODAS: hasta hoy eso no se
        podía, porque el repositorio exigía el tipo.
        """
        filtros = self._filtros(id_orden=id_orden, nro_ot=nro_ot, tipo=tipo,
                                gravedad=gravedad, estado=estado, desde=desde, hasta=hasta)
        tope = max(1, min(int(limite or TOPE_REPORTE), TOPE_MAXIMO))

        filas = await self.repository.buscar(**filtros, limite=tope)
        resumen = await self.repository.resumen(**filtros)
        return ResponseDTO(
            status=True,
            data={
                "no_conformidades": jsonable_encoder(filas),
                "resumen": resumen,
                "tope": tope,
                # Que la pantalla pueda avisar «hay más de las que estás viendo» en vez
                # de mostrar una lista cortada sin decirlo.
                "hay_mas": resumen["total"] > len(filas),
                "tipos": TIPOS,
                "gravedades": GRAVEDADES,
                "estados": ESTADOS,
            },
            errorDescription="",
        )

    async def listar_por_orden(self, id_orden: int):
        """Las no conformidades de UNA orden: la asociación que pide el RF, mirada
        desde la orden y no desde el reporte."""
        filas = await self.repository.buscar(id_orden=id_orden, limite=TOPE_REPORTE)
        resumen = await self.repository.resumen(id_orden=id_orden)
        return ResponseDTO(
            status=True,
            data={"no_conformidades": jsonable_encoder(filas), "resumen": resumen},
            errorDescription="",
        )

    def _filtros(self, *, id_orden, nro_ot, tipo, gravedad, estado, desde, hasta) -> dict:
        # «SIN_CLASIFICAR» no es una gravedad guardada: es la forma de pedir las que
        # quedaron con NULL, que son justo las que hay que ir a completar.
        sin_clasificar = bool(gravedad) and str(gravedad).strip().upper() == "SIN_CLASIFICAR"
        return {
            "id_orden": id_orden,
            # El que escribe en el filtro pone el número de la orden, no el id interno.
            "nro_ot": nro_ot,
            "tipo": self._validar(tipo, TIPOS, "tipo"),
            "gravedad": None if sin_clasificar else self._validar(gravedad, GRAVEDADES, "gravedad"),
            "sin_clasificar": sin_clasificar,
            "estado": self._validar(estado, ESTADOS, "estado"),
            "desde": _fecha(desde, "desde"),
            # `hasta` es inclusivo para el que lo escribe: pidió «hasta el 22» y espera
            # ver lo del 22. Por eso se compara contra el día siguiente.
            "hasta": (_fecha(hasta, "hasta") + timedelta(days=1)) if hasta else None,
        }

    # Cómo se llama cada columna en el CSV. El orden importa: es el que ve el que abre
    # el archivo.
    COLUMNAS_CSV = [
        ("nro_ot", "N° OT"),
        ("cliente", "Cliente"),
        ("producto", "Producto"),
        ("fecha_registro", "Fecha"),
        ("tipo", "Tipo"),
        ("gravedad", "Gravedad"),
        ("estado", "Estado"),
        ("piezas_afectadas", "Piezas afectadas"),
        ("minutos_perdidos", "Minutos perdidos"),
        ("operarios_extra", "Recurso humano extra"),
        ("proceso", "Proceso"),
        ("operario", "Recurso humano"),
        ("descripcion", "Qué pasó"),
        ("accion_correctiva", "Qué se hizo"),
        ("usuario", "Lo reportó"),
        ("fecha_cierre", "Fecha de cierre"),
    ]

    async def reporte_csv(self, **filtros_crudos) -> str:
        """El mismo reporte, para abrir en Excel.

        Dos detalles que no son decorativos: el separador es `;` y el archivo arranca
        con BOM. El Excel de las máquinas del taller está en español de Argentina, donde
        la coma es el separador DECIMAL: con `,` la planilla abre toda en una columna.
        """
        respuesta = await self.reporte(**filtros_crudos, limite=TOPE_MAXIMO)
        filas = respuesta.data["no_conformidades"]

        salida = io.StringIO()
        escritor = csv.writer(salida, delimiter=";", lineterminator="\r\n",
                              quoting=csv.QUOTE_MINIMAL)
        escritor.writerow([titulo for _, titulo in self.COLUMNAS_CSV])
        for fila in filas:
            escritor.writerow([self._celda(campo, fila) for campo, _ in self.COLUMNAS_CSV])
        # El BOM es lo que hace que Excel lea los acentos: sin él, «Interpretación»
        # aparece roto.
        return "﻿" + salida.getvalue()

    @staticmethod
    def _celda(campo: str, fila: dict) -> str:
        valor = fila.get(campo)
        if campo == "tipo":
            return TIPOS.get(valor, valor or "")
        if campo == "gravedad":
            # Vacío sería «no aplica»; acá la verdad es que nadie la evaluó todavía.
            return GRAVEDADES.get(valor, "Sin clasificar")
        if campo == "estado":
            return ESTADOS.get(valor, valor or "")
        if campo in ("fecha_registro", "fecha_cierre"):
            if not valor:
                return ""
            try:
                return datetime.fromisoformat(valor).strftime("%d/%m/%Y %H:%M")
            except ValueError:
                return str(valor)
        if valor is None:
            return ""
        return str(valor)

    def catalogos(self):
        """Las listas para dibujar los desplegables, sin que el front las repita."""
        return ResponseDTO(
            status=True,
            data={"tipos": TIPOS, "gravedades": GRAVEDADES, "estados": ESTADOS},
            errorDescription="",
        )

    # ------------------------------------------------------------------
    # Lo que ya miraba el dashboard
    # ------------------------------------------------------------------

    async def listar(self, tipo: str | None = None, desde: str | None = None,
                     hasta: str | None = None):
        data = await self.repository.find_recientes(tipo, desde, hasta, limit=50)
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")

    async def metricas(self, tipo: str | None = None, desde: str | None = None,
                       hasta: str | None = None):
        """Métrica para el dashboard. Si la tabla aún no existe (migración pendiente),
        devuelve métricas vacías en vez de romper el dashboard."""
        try:
            metricas = await self.repository.metricas(tipo, desde, hasta)
            recientes = await self.repository.find_recientes(tipo, desde, hasta, limit=20)
            data = {**metricas, "recientes": jsonable_encoder(recientes)}
            return ResponseDTO(status=True, data=data, errorDescription="")
        except InfrastructureException as e:
            logger.error(f"Service - métricas incidencias no disponibles: {e}")
            return ResponseDTO(
                status=True,
                data={
                    "total_incidencias": 0,
                    "total_minutos": 0,
                    "total_operarios_extra": 0,
                    "por_operario": [],
                    "por_mes": [],
                    "recientes": [],
                },
                errorDescription="",
            )
