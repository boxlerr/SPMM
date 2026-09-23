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
from collections import defaultdict
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
#
# El 23/09 se sumaron los de un taller metalúrgico, para que se pueda cargar «de
# cualquier tipo» lo que se rechaza en el control (reunión con Lucas: «si algo se
# rechazó, que quede el registro»). No se borró ni se renombró ninguna clave: hay filas
# guardadas con ellas. El ORDEN sí cambió, y es a propósito: es el de los desplegables,
# y arriba va lo que más se va a cargar (el rechazo en el control), no lo que existía
# primero. «Otro» siempre al final.
TIPOS: dict[str, str] = {
    "RECHAZO_CONTROL": "Pieza rechazada en control",
    "MEDIDA_FUERA_DE_TOLERANCIA": "Medida fuera de tolerancia",
    "MECANIZADO": "Error de mecanizado",
    "CORTE_PLEGADO": "Error de corte / plegado",
    "SOLDADURA": "Soldadura",
    "ARMADO": "Error de armado",
    "TERMINACION": "Terminación / superficie",
    "MATERIAL_NO_CONFORME": "Material no conforme",
    "GOLPE_MANIPULACION": "Golpe o daño al mover la pieza",
    "INTERPRETACION_PLANOS": "Interpretación de planos",
    "DOCUMENTACION": "Documentación",
    "OTRO": "Otro",
}

# El que carga desde la OT casi siempre está anotando un rechazo del control: arranca
# en éste. El DTO sigue con INTERPRETACION_PLANOS de default para el modal viejo del
# planificador, que no manda tipo en algunas versiones.
TIPO_DEL_FORMULARIO = "RECHAZO_CONTROL"

# Qué se hace con lo rechazado. Lista cerrada por lo mismo que los tipos: se agrupa por
# esto. NULL = todavía no se decidió.
DISPOSICIONES: dict[str, str] = {
    "RETRABAJO": "Se retrabaja",
    "DESCARTE": "Se descarta",
    "CONCESION": "Se acepta con concesión",
    "DEVOLUCION_PROVEEDOR": "Se devuelve al proveedor",
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
        """Cargar una no conformidad de cualquier tipo contra una orden.

        Quién la registró y cuándo salen solos (del token y del reloj del taller): no
        vienen en el cuerpo y no se pueden elegir. Lo demás se valida contra la base
        ANTES de guardar, para que el que carga lea «esa persona no existe» y no un
        error de base de datos:
          · la orden existe;
          · el paso, si viene, es de ESA orden (y de ahí sale el proceso);
          · la persona que hizo las piezas, si viene, existe;
          · las piezas no son negativas, y no se rechazan más de las que se controlaron.
        """
        logger.info(f"Service - Registrar no conformidad tipo={dto.tipo} OT={dto.id_orden_trabajo}")
        if not dto.id_orden_trabajo:
            raise BusinessException("La no conformidad debe estar asociada a una orden de trabajo.")

        tipo = self._validar(dto.tipo or "INTERPRETACION_PLANOS", TIPOS, "tipo")
        gravedad = self._validar(dto.gravedad, GRAVEDADES, "gravedad")
        disposicion = self._validar(dto.disposicion, DISPOSICIONES, "destino de lo rechazado")
        piezas, controladas = self._piezas(dto.piezas_afectadas, dto.piezas_controladas)

        if await self.repository.orden(id_orden=dto.id_orden_trabajo) is None:
            raise BusinessException(f"No existe la orden de trabajo {dto.id_orden_trabajo}.")
        id_proceso = dto.id_proceso
        if dto.id_otp is not None:
            id_proceso = await self._proceso_del_paso(dto.id_otp, dto.id_orden_trabajo)
        await self._validar_persona(dto.id_operario)
        id_usuario, nombre = nombre_de(usuario)

        incidencia = IncidenciaProceso(
            id_orden_trabajo=dto.id_orden_trabajo,
            id_proceso=id_proceso,
            id_otp=dto.id_otp,
            id_operario=dto.id_operario,
            tipo=tipo,
            minutos_perdidos=max(0, dto.minutos_perdidos or 0),
            operarios_extra=max(0, dto.operarios_extra or 0),
            descripcion=dto.descripcion,
            # Sin gravedad queda NULL —«sin clasificar»— y no MEDIA: que el reporte
            # pueda mostrar cuáles todavía nadie evaluó es la mitad de para qué sirve.
            gravedad=gravedad,
            piezas_afectadas=piezas,
            piezas_controladas=controladas,
            disposicion=disposicion,
            estado=ABIERTA,
            id_usuario=id_usuario,
            usuario=nombre,
            fecha_registro=_ahora_ar(),
        )
        creada = await self.repository.save(incidencia)
        return ResponseDTO(status=True, data=await self._como_en_el_reporte(creada), errorDescription="")

    async def actualizar(self, id_incidencia: int, dto: IncidenciaProcesoUpdateDTO,
                         usuario: dict | None = None):
        """Corregir una no conformidad ya cargada.

        Sólo se tocan los campos que VIENEN en el cuerpo: mandar nada más la gravedad no
        puede vaciar la descripción de paso. Con las mismas validaciones que el alta.
        """
        incidencia = await self._traer(id_incidencia)
        cambios = dto.model_dump(exclude_unset=True)

        # Primero todo lo que puede decir que no, después se toca la fila: un error a
        # mitad de camino no deja el objeto de la sesión cambiado a medias.
        tipo = self._validar(cambios["tipo"], TIPOS, "tipo") if "tipo" in cambios else None
        gravedad = self._validar(cambios.get("gravedad"), GRAVEDADES, "gravedad")
        disposicion = self._validar(cambios.get("disposicion"), DISPOSICIONES, "destino de lo rechazado")
        estado = self._validar(cambios["estado"], ESTADOS, "estado") if "estado" in cambios else None
        if "piezas_afectadas" in cambios or "piezas_controladas" in cambios:
            piezas = self._piezas(
                cambios.get("piezas_afectadas", incidencia.piezas_afectadas),
                cambios.get("piezas_controladas", incidencia.piezas_controladas),
            )
        else:
            piezas = None
        if "id_operario" in cambios:
            await self._validar_persona(cambios["id_operario"])
        if cambios.get("id_otp") is not None:
            # El paso manda sobre el proceso: si se elige el paso, el proceso es el suyo.
            cambios["id_proceso"] = await self._proceso_del_paso(cambios["id_otp"],
                                                                 incidencia.id_orden_trabajo)

        if "tipo" in cambios:
            incidencia.tipo = tipo or incidencia.tipo
        if "gravedad" in cambios:
            incidencia.gravedad = gravedad
        if "disposicion" in cambios:
            incidencia.disposicion = disposicion
        if "estado" in cambios:
            self._mover_estado(incidencia, estado or ABIERTA, usuario)
        if piezas is not None:
            incidencia.piezas_afectadas, incidencia.piezas_controladas = piezas
        for campo in ("descripcion", "accion_correctiva", "id_proceso", "id_operario", "id_otp"):
            if campo in cambios:
                setattr(incidencia, campo, cambios[campo])
        for campo in ("minutos_perdidos", "operarios_extra"):
            if campo in cambios:
                setattr(incidencia, campo, max(0, cambios[campo] or 0))

        guardada = await self.repository.guardar_cambios(incidencia)
        return ResponseDTO(status=True, data=await self._como_en_el_reporte(guardada), errorDescription="")

    async def cerrar(self, id_incidencia: int, dto: CerrarIncidenciaDTO | None = None,
                     usuario: dict | None = None):
        """Darla por resuelta: estampa la fecha y deja anotado qué se hizo."""
        incidencia = await self._traer(id_incidencia)
        if dto is not None and dto.accion_correctiva is not None:
            incidencia.accion_correctiva = dto.accion_correctiva
        self._mover_estado(incidencia, CERRADA, usuario)
        guardada = await self.repository.guardar_cambios(incidencia)
        return ResponseDTO(status=True, data=await self._como_en_el_reporte(guardada), errorDescription="")

    async def _como_en_el_reporte(self, incidencia: IncidenciaProceso) -> dict:
        """La fila guardada tal como la muestra el reporte: con el número de OT, el paso,
        el proceso y el nombre de quien hizo las piezas.

        Es un SUPERCONJUNTO de lo que se devolvía antes (todas las columnas de la tabla),
        así que lo que ya leía la respuesta sigue andando. Con esto la pantalla pone la
        fila nueva en la lista al toque, sin volver a pedir todo.
        """
        filas = await self.repository.buscar(id_incidencia=incidencia.id, limite=1)
        return filas[0] if filas else jsonable_encoder(incidencia)

    @staticmethod
    def _piezas(rechazadas: int | None, controladas: int | None) -> tuple[int | None, int | None]:
        """Piezas rechazadas y controladas: nunca negativas, y no más rechazadas que
        controladas. None pasa: es «no se dijo», que no es lo mismo que 0.

        Antes un negativo se convertía en 0 sin avisar. Para un rechazo eso es peor que
        un error: «-10» es casi seguro un 10 mal tipeado, y guardar 0 dice «ninguna».
        """
        for valor, que in ((rechazadas, "rechazadas"), (controladas, "controladas")):
            if valor is not None and valor < 0:
                raise BusinessException(f"Las piezas {que} no pueden ser menos que cero.")
        if rechazadas is not None and controladas is not None and rechazadas > controladas:
            raise BusinessException(
                f"No se pueden rechazar más piezas ({rechazadas}) de las que se "
                f"controlaron ({controladas})."
            )
        return rechazadas, controladas

    async def _proceso_del_paso(self, id_otp: int, id_orden: int) -> int | None:
        """El paso tiene que ser de ESTA orden: uno de otra OT dejaría la no conformidad
        diciendo que se rechazó algo en un trabajo que esa orden no tiene."""
        paso = await self.repository.paso(id_otp)
        if paso is None or paso["id_orden_trabajo"] != id_orden:
            raise BusinessException("Ese paso no es de esta orden de trabajo.")
        return paso["id_proceso"]

    async def _validar_persona(self, id_operario: int | None) -> None:
        """Quién hizo las piezas tiene que ser alguien que existe. None pasa: «no se sabe»
        es una respuesta válida y no se reemplaza por nadie."""
        if id_operario is not None and await self.repository.persona(id_operario) is None:
            raise BusinessException(f"No existe la persona {id_operario} en Recursos.")

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
                      hasta: str | None = None, id_operario: int | None = None,
                      limite: int = TOPE_REPORTE):
        """El listado con filtros que pide el RF-12, más su resumen.

        Todos los filtros son opcionales y sin ninguno trae TODAS: hasta hoy eso no se
        podía, porque el repositorio exigía el tipo. `id_operario` (23/09) es quién hizo
        las piezas.
        """
        filtros = self._filtros(id_orden=id_orden, nro_ot=nro_ot, tipo=tipo,
                                gravedad=gravedad, estado=estado, desde=desde, hasta=hasta,
                                id_operario=id_operario)
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
                "disposiciones": DISPOSICIONES,
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

    def _filtros(self, *, id_orden, nro_ot, tipo, gravedad, estado, desde, hasta,
                 id_operario=None) -> dict:
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
            "id_operario": id_operario,
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
        # Del 23/09, al final a propósito: quien ya tenía armada una planilla sobre este
        # archivo encuentra las dieciséis de antes en el mismo lugar.
        ("paso", "Paso"),
        ("piezas_controladas", "Piezas controladas"),
        ("disposicion", "Qué se hace con lo rechazado"),
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
        if campo == "disposicion":
            return DISPOSICIONES.get(valor, valor or "")
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
            # `disposiciones` y `tipo_del_formulario` son del 23/09: el front los usa
            # para saber que este servidor ya sabe cargar rechazos (con uno de antes, el
            # botón no aparece en vez de fallar al guardar).
            data={"tipos": TIPOS, "gravedades": GRAVEDADES, "estados": ESTADOS,
                  "disposiciones": DISPOSICIONES, "tipo_del_formulario": TIPO_DEL_FORMULARIO},
            errorDescription="",
        )

    # ------------------------------------------------------------------
    # Cargar desde la OT: qué pasos tiene y quién hizo cada uno (23/09)
    # ------------------------------------------------------------------

    async def para_registrar(self, *, id_orden: int | None = None, nro_ot: int | None = None):
        """Lo que hace falta para cargar una no conformidad en una OT: la orden, sus
        pasos y, de cada paso, QUIÉN LO HIZO según lo que sabe el sistema.

        El sistema no guarda quién hizo cada paso (los operarios no tienen usuario y el
        avance lo marca el supervisor). Lo que sabe es la misma atribución que usan los
        tiempos de RF-06 y el rendimiento de RF-07 (TiemposOperarioService.le_toca): la
        persona elegida a mano en la OT o, si no hay, la del ÚLTIMO plan que incluyó ese
        paso. Por eso es una SUGERENCIA con su origen («ot» / «plan») y el formulario la
        deja cambiar: lo que se guarda es lo que elige quien carga.

        Una OT que no existe no es un error: `orden` vuelve en None y el formulario dice
        «no hay ninguna OT con ese número» mientras se escribe.
        """
        # Adentro y no arriba: PausaService (que importa TiemposOperarioService) usa
        # `nombre_de` de este módulo, y arriba sería una importación circular.
        from backend.application.TiemposOperarioService import (
            ESTADO_TEXTO,
            le_toca,
            personas_del_ultimo_plan,
        )

        if not id_orden and not nro_ot:
            raise BusinessException("Falta decir de qué orden: el número de OT.")
        orden = await self.repository.orden(id_orden=id_orden, nro_ot=nro_ot)
        if orden is None:
            return ResponseDTO(status=True, data={"orden": None, "pasos": []}, errorDescription="")

        pasos = await self.repository.pasos_de_la_orden(orden["id"])
        plan = await self.repository.plan_de_la_orden(orden["id"])
        pasos_por_ot_proceso: dict = defaultdict(list)
        for p in pasos:
            pasos_por_ot_proceso[(orden["id"], p["id_proceso"])].append(p["id_otp"])
        del_plan = personas_del_ultimo_plan(plan, pasos_por_ot_proceso)

        candidatos = {p["id_operario_elegido"] for p in pasos}
        for gente in del_plan.values():
            candidatos |= gente
        nombres = await self.repository.nombres_de_personas(candidatos)

        salida = []
        for p in pasos:
            gente = del_plan.get(p["id_otp"], set())
            elegido = p["id_operario_elegido"]
            ids = set(gente) | ({elegido} if elegido is not None else set())
            sugeridos = []
            # El elegido a mano primero; después los del plan, por nombre.
            for i in sorted(ids, key=lambda i: (i != elegido, nombres.get(i, "").lower())):
                origen = le_toca(i, elegido, gente, p["cant_operarios"])
                # Fuera: a quien la regla no le da el paso (un plan viejo que la OT ya
                # pisó eligiendo a otro) y a quien el plan nombró y ya no está en Recursos.
                if origen is None or i not in nombres:
                    continue
                sugeridos.append({"id_operario": i, "nombre": nombres[i], "origen": origen})
            salida.append({
                "id_otp": p["id_otp"],
                "paso": p["paso"],
                "id_proceso": p["id_proceso"],
                "proceso": p["proceso"],
                "estado": ESTADO_TEXTO.get(p["id_estado"], "Pendiente"),
                "sugeridos": sugeridos,
            })
        return ResponseDTO(status=True, data={"orden": jsonable_encoder(orden), "pasos": salida},
                           errorDescription="")

    # ------------------------------------------------------------------
    # Por persona: «piezas rechazadas por persona este mes» (23/09)
    # ------------------------------------------------------------------

    async def por_persona(self, *, nro_ot: int | None = None, tipo: str | None = None,
                          gravedad: str | None = None, estado: str | None = None,
                          desde: str | None = None, hasta: str | None = None,
                          id_operario: int | None = None):
        """Las no conformidades agrupadas por quién hizo las piezas, con los mismos
        filtros que el listado (salvo la OT puntual: agrupar una sola orden por persona
        es la lista de esa orden). Pide la sección confidencial «Rendimiento por
        persona»: ver core/permisos_rutas.py, política «incidencias»."""
        filtros = self._filtros(id_orden=None, nro_ot=nro_ot, tipo=tipo, gravedad=gravedad,
                                estado=estado, desde=desde, hasta=hasta, id_operario=id_operario)
        self._rango_en_orden(filtros)
        filtros.pop("id_orden")
        personas = await self.repository.por_persona(**filtros)
        resumen = await self.repository.resumen(**filtros)
        return ResponseDTO(
            status=True,
            data={"personas": personas, "resumen": resumen},
            errorDescription="",
        )

    async def rechazos_de_persona(self, id_operario: int, desde: str | None = None,
                                  hasta: str | None = None):
        """Las no conformidades de las que alguien hizo las piezas, para su ficha: qué,
        cuántas piezas, en qué OT y cuándo. Sin período, toda la historia.

        Pide la sección confidencial «Rendimiento por persona», la misma del reporte de
        RF-07 que está al lado: es un número al lado de un nombre y sirve para evaluar a
        la persona («le tengo que llamar la atención»).
        """
        persona = await self.repository.persona(id_operario)
        if persona is None:
            raise NotFoundException(f"No existe la persona {id_operario}.")
        filtros = self._filtros(id_orden=None, nro_ot=None, tipo=None, gravedad=None,
                                estado=None, desde=desde, hasta=hasta, id_operario=id_operario)
        self._rango_en_orden(filtros)
        filas = await self.repository.buscar(**filtros, limite=TOPE_REPORTE)
        resumen = await self.repository.resumen(**filtros)
        return ResponseDTO(
            status=True,
            data={
                "persona": persona,
                "desde": desde or None,
                "hasta": hasta or None,
                "no_conformidades": jsonable_encoder(filas),
                "resumen": resumen,
                "hay_mas": resumen["total"] > len(filas),
                "tipos": TIPOS,
                "disposiciones": DISPOSICIONES,
                "estados": ESTADOS,
                "gravedades": GRAVEDADES,
            },
            errorDescription="",
        )

    @staticmethod
    def _rango_en_orden(filtros: dict) -> None:
        if filtros["desde"] and filtros["hasta"] and filtros["hasta"] <= filtros["desde"]:
            raise BusinessException("El período termina antes de empezar.")

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
