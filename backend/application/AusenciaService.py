"""La asistencia de cada persona, en su versión simple (RF-06).

Qué hay (el modelo y el porqué, en domain/AusenciaOperario.py):

  · El Activo / Ausente de la ficha queda guardado con fecha: pasar a alguien a Ausente
    abre una ausencia ese día, y volverlo a Activo la cierra (lo hace el guardado de la
    persona, OperarioService.modificarOperario → AusenciaRepository).
  · Se puede cargar a mano una ausencia de un día o de un período —vacaciones, una
    licencia—, con motivo opcional, y queda quién la cargó.
  · El historial en la ficha, con el total de días de un período (corridos y
    laborables).

Qué NO hace, a propósito:

  · No toca el plan. El planificador sigue mirando `operario.disponible`, como hasta
    ahora; cargar unas vacaciones no saca a nadie del plan.
  · No hay fichadas (hora de entrada y de salida de cada día): eso es la v2, Módulo J.
"""
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError

from backend.application.IncidenciaProcesoService import nombre_de
from backend.application.PausaService import ahora_ar
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.domain.AusenciaOperario import (
    MOTIVO_TEXTO,
    MOTIVOS,
    AusenciaOperario,
    dias_de_ausencia,
    dias_trabajo_de,
)
from backend.infrastructure.AusenciaRepository import AusenciaRepository

LARGO_OBSERVACION = 300

# Una carga de más de un año es, casi seguro, un año mal tipeado (2062 por 2026): se
# pide partirla en vez de sumarle treinta y seis años de falta a alguien.
TOPE_DIAS_CARGA = 366


def conflicto(mensaje: str) -> HTTPException:
    """409: lo pedido choca con lo que ya está cargado. Mismo formato que las pausas."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT,
                         detail={"message": mensaje, "campo": "ausencia"})


def fecha_corta(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def leer_fecha(valor, campo: str) -> date | None:
    """«AAAA-MM-DD» (o un date) a date. Sin zona: es un día del taller."""
    if valor is None or valor == "":
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    try:
        return date.fromisoformat(str(valor).strip()[:10])
    except ValueError:
        raise BusinessException(f"La fecha «{campo}» tiene que ser del tipo AAAA-MM-DD.")


def _motivo(valor) -> str | None:
    if valor is None:
        return None
    limpio = str(valor).strip().upper()
    if not limpio:
        return None
    if limpio not in MOTIVOS:
        raise BusinessException(
            "El motivo tiene que ser uno de la lista: "
            + ", ".join(MOTIVO_TEXTO[m].lower() for m in MOTIVOS) + " (o ninguno).")
    return limpio


def _texto(valor, largo: int) -> str | None:
    if valor is None:
        return None
    limpio = " ".join(str(valor).split())
    return limpio[:largo] if limpio else None


def nombre_persona(op) -> str:
    """«JUAN PEREZ», como se la nombra en el taller (y en la auditoría)."""
    return " ".join(x for x in [getattr(op, "nombre", ""), getattr(op, "apellido", "")] if x).strip() \
        or f"#{getattr(op, 'id', '')}"


def periodo_por_defecto(hoy: date) -> tuple[date, date]:
    """El año en curso: es lo que se mira para vacaciones y faltas."""
    return date(hoy.year, 1, 1), date(hoy.year, 12, 31)


def ausencia_a_dict(a: AusenciaOperario, hoy: date) -> dict:
    """Cómo sale una ausencia por la API.

    `hasta` es el último día que faltó (inclusivo), como se dice en el taller; `vuelve`
    es el primer día de vuelta, como se guarda. `dias` son los corridos de la ausencia
    entera (una abierta, hasta hoy), no los del período que se está mirando.
    """
    fin = a.vuelve if a.vuelve is not None else hoy + timedelta(days=1)
    dias = max(0, (fin - a.desde).days)
    return jsonable_encoder({
        "id": a.id,
        "id_operario": a.id_operario,
        "desde": a.desde,
        "hasta": a.hasta_inclusivo,
        "vuelve": a.vuelve,
        "abierta": a.vuelve is None,
        # Volvió el mismo día que lo marcaron: queda el registro, no suma.
        "mismo_dia": a.vuelve is not None and a.vuelve <= a.desde,
        "programada": a.desde > hoy,
        "dias": dias,
        "motivo": a.motivo,
        "motivo_texto": MOTIVO_TEXTO.get(a.motivo) if a.motivo else None,
        "observacion": a.observacion,
        "origen": a.origen,
        "cargada_en": a.cargada_en,
        "usuario_carga": a.usuario_carga,
        "cerrada_en": a.cerrada_en,
        "usuario_cierre": a.usuario_cierre,
    })


class AusenciaService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = AusenciaRepository(db_session)

    async def _persona(self, id_operario: int):
        op = await self.repository.find_operario(id_operario)
        if op is None:
            raise NotFoundException(f"No existe la persona {id_operario}.")
        return op

    async def _de_la_persona(self, id_operario: int, id_ausencia: int) -> AusenciaOperario:
        a = await self.repository.find(id_ausencia)
        if a is None or a.id_operario != id_operario:
            raise NotFoundException("Esa ausencia ya no está. Actualizá la ficha.")
        return a

    # ------------------------------------------------------------------
    # El historial
    # ------------------------------------------------------------------

    async def historial(self, id_operario: int, desde=None, hasta=None) -> ResponseDTO:
        """Las ausencias de la persona que tocan el período, y el total de días.

        Sin período, el año en curso.
        """
        op = await self._persona(id_operario)
        hoy = ahora_ar().date()
        p_desde, p_hasta = leer_fecha(desde, "desde"), leer_fecha(hasta, "hasta")
        if p_desde is None and p_hasta is None:
            p_desde, p_hasta = periodo_por_defecto(hoy)
        p_desde = p_desde or date(2000, 1, 1)
        p_hasta = p_hasta or date(hoy.year, 12, 31)
        if p_hasta < p_desde:
            raise BusinessException("El período termina antes de empezar.")

        filas = await self.repository.de_la_persona(id_operario, p_desde, p_hasta)
        feriados = await self.repository.feriados()
        dias_trabajo = dias_trabajo_de(op.dias_trabajo)
        dias, laborables = dias_de_ausencia(
            [(a.desde, a.vuelve) for a in filas], p_desde, p_hasta, hoy, dias_trabajo, feriados)

        # Por motivo, cada día UNA vez: si una carga y una ESTADO se pisan, manda la que
        # tiene motivo (y entre dos con motivo, la cargada a mano, que es la que se pensó).
        por_motivo: dict[str, int] = {}
        vistos: set[date] = set()
        orden = sorted(filas, key=lambda a: (a.motivo is None, a.origen != "CARGA", a.desde))
        for a in orden:
            fin = a.vuelve if a.vuelve is not None else hoy + timedelta(days=1)
            d, tope = max(a.desde, p_desde), min(fin, p_hasta + timedelta(days=1))
            while d < tope:
                if d not in vistos:
                    vistos.add(d)
                    clave = a.motivo or "SIN_MOTIVO"
                    por_motivo[clave] = por_motivo.get(clave, 0) + 1
                d += timedelta(days=1)

        abierta = next((a for a in filas if a.vuelve is None), None)
        if abierta is None and not (op.disponible if op.disponible is not None else True):
            # Está Ausente pero no hay nada abierto: se marcó antes de que esto existiera
            # (o se cerró a mano). La ficha lo avisa para que no parezca un error.
            abierta_sin_fecha = True
        else:
            abierta_sin_fecha = False

        data = {
            "id_operario": id_operario,
            "periodo": {"desde": p_desde.isoformat(), "hasta": p_hasta.isoformat()},
            "disponible": bool(op.disponible) if op.disponible is not None else True,
            "ausente_sin_fecha": abierta_sin_fecha,
            "abierta": ausencia_a_dict(abierta, hoy) if abierta is not None else None,
            "resumen": {
                "dias": dias,
                "dias_laborables": laborables,
                "por_motivo": [
                    {"motivo": m, "texto": MOTIVO_TEXTO.get(m, "Sin motivo"), "dias": n}
                    for m, n in sorted(por_motivo.items(), key=lambda x: -x[1])
                ],
            },
            "motivos": [{"codigo": m, "texto": MOTIVO_TEXTO[m]} for m in MOTIVOS],
            "ausencias": [ausencia_a_dict(a, hoy) for a in filas],
        }
        return ResponseDTO(status=True, data=data, errorDescription="")

    # ------------------------------------------------------------------
    # Cargar, corregir, borrar
    # ------------------------------------------------------------------

    def _tramo(self, desde: date | None, hasta: date | None) -> tuple[date, date]:
        """(desde, vuelve) a partir de lo que se escribe en pantalla: desde y hasta,
        las dos incluidas. Sin hasta, es un solo día."""
        if desde is None:
            raise BusinessException("Falta desde qué día.")
        hasta = hasta or desde
        if hasta < desde:
            raise BusinessException("El último día no puede ser anterior al primero.")
        if (hasta - desde).days + 1 > TOPE_DIAS_CARGA:
            raise BusinessException(
                "Son más de 366 días: revisá el año. Si de verdad es tan larga, cargala en "
                "dos partes.")
        return desde, hasta + timedelta(days=1)

    async def _sin_pisar_otra_carga(self, id_operario: int, desde: date, vuelve: date,
                                    salvo: int | None = None) -> None:
        """Dos cargas a mano que se pisan son un error de tipeo o un doble clic, y harían
        dudar de cuál vale. Con una del Activo / Ausente sí puede convivir: es lo que
        pasa cuando se la pone Ausente y después se cargan las vacaciones de esos días,
        y cada día cuenta una vez igual."""
        pisadas = await self.repository.cargadas_que_pisan(id_operario, desde, vuelve, salvo)
        if pisadas:
            p = pisadas[0]
            cual = (f"del {fecha_corta(p.desde)} al {fecha_corta(p.hasta_inclusivo)}"
                    if p.hasta_inclusivo and p.hasta_inclusivo != p.desde
                    else f"el {fecha_corta(p.desde)}")
            motivo = f" ({MOTIVO_TEXTO[p.motivo].lower()})" if p.motivo else ""
            raise conflicto(f"Ya tiene cargada una ausencia {cual}{motivo}. Corregí esa en vez "
                            f"de cargar otra encima.")

    async def cargar(self, id_operario: int, desde, hasta=None, motivo=None,
                     observacion=None, usuario: dict | None = None) -> ResponseDTO:
        op = await self._persona(id_operario)
        d, vuelve = self._tramo(leer_fecha(desde, "desde"), leer_fecha(hasta, "hasta"))
        motivo = _motivo(motivo)
        observacion = _texto(observacion, LARGO_OBSERVACION)
        await self._sin_pisar_otra_carga(id_operario, d, vuelve)

        id_usuario, nombre = nombre_de(usuario)
        ausencia = AusenciaOperario(
            id_operario=id_operario, desde=d, vuelve=vuelve, motivo=motivo,
            observacion=observacion, origen="CARGA",
            # Hora del taller y usuario del token, nunca lo que diga el navegador.
            cargada_en=ahora_ar(), id_usuario_carga=id_usuario, usuario_carga=nombre,
        )
        await self.repository.guardar(ausencia)
        await self.db.commit()
        logger.info(f"Ausencias: {nombre or 'alguien'} cargó una ausencia a la persona "
                    f"{id_operario} del {d} al {vuelve} (vuelve), motivo {motivo}.")
        salida = ausencia_a_dict(ausencia, ahora_ar().date())
        salida["persona"] = nombre_persona(op)
        return ResponseDTO(status=True, data=salida, errorDescription="")

    async def corregir(self, id_operario: int, id_ausencia: int, cambios: dict,
                       usuario: dict | None = None) -> ResponseDTO:
        """Cambia lo que venga en `cambios` (desde, hasta, motivo, observacion).

        · A cualquiera se le puede poner o sacar el motivo y la observación: es lo que se
          hace cuando se marcó «Ausente» a la mañana y a la tarde se sabe por qué.
        · Las fechas también, para corregir una carga o un «Ausente» que se marcó tarde.
          La abierta sólo cambia su `desde`: se cierra poniéndolo «Activo», no con una
          fecha, porque si no la ficha diría «Ausente» y el historial que volvió.
        """
        op = await self._persona(id_operario)
        a = await self._de_la_persona(id_operario, id_ausencia)
        hoy = ahora_ar().date()

        if "motivo" in cambios:
            a.motivo = _motivo(cambios.get("motivo"))
        if "observacion" in cambios:
            a.observacion = _texto(cambios.get("observacion"), LARGO_OBSERVACION)

        if "desde" in cambios or "hasta" in cambios:
            nuevo_desde = leer_fecha(cambios.get("desde"), "desde") if "desde" in cambios else a.desde
            if a.vuelve is None:
                if "hasta" in cambios and cambios.get("hasta"):
                    raise conflicto("Sigue marcado Ausente: para cerrarla, ponelo «Activo» en su "
                                    "ficha y queda cerrada con la fecha de hoy.")
                if nuevo_desde is None:
                    raise BusinessException("Falta desde qué día.")
                if nuevo_desde > hoy:
                    raise BusinessException("Está Ausente desde hoy o antes: no puede empezar "
                                            "en una fecha que todavía no llegó.")
                a.desde = nuevo_desde
            else:
                nuevo_hasta = (leer_fecha(cambios.get("hasta"), "hasta") if "hasta" in cambios
                               else a.hasta_inclusivo)
                d, vuelve = self._tramo(nuevo_desde, nuevo_hasta)
                if a.origen == "CARGA":
                    await self._sin_pisar_otra_carga(id_operario, d, vuelve, salvo=a.id)
                a.desde, a.vuelve = d, vuelve

        try:
            await self.db.flush()
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise conflicto("No se pudo guardar: revisá las fechas.")
        _, nombre = nombre_de(usuario)
        logger.info(f"Ausencias: {nombre or 'alguien'} corrigió la ausencia {id_ausencia} "
                    f"de la persona {id_operario}: {sorted(cambios)}.")
        salida = ausencia_a_dict(a, hoy)
        salida["persona"] = nombre_persona(op)
        return ResponseDTO(status=True, data=salida, errorDescription="")

    async def borrar(self, id_operario: int, id_ausencia: int,
                     usuario: dict | None = None) -> ResponseDTO:
        """Borra una ausencia cargada por error. La abierta no: sigue marcado Ausente, y
        borrarla dejaría la ficha diciendo una cosa y el historial otra."""
        op = await self._persona(id_operario)
        a = await self._de_la_persona(id_operario, id_ausencia)
        if a.vuelve is None:
            raise conflicto("Sigue marcado Ausente: ponelo «Activo» en su ficha y queda cerrada. "
                            "Si fue un error, después la podés borrar.")
        hoy = ahora_ar().date()
        salida = ausencia_a_dict(a, hoy)
        salida["persona"] = nombre_persona(op)
        await self.repository.borrar(a)
        await self.db.commit()
        _, nombre = nombre_de(usuario)
        logger.info(f"Ausencias: {nombre or 'alguien'} borró la ausencia {id_ausencia} "
                    f"({a.desde} → {a.vuelve}) de la persona {id_operario}.")
        return ResponseDTO(status=True, data=salida, errorDescription="")
