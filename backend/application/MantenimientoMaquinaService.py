"""El mantenimiento preventivo de cada máquina y su aviso (RF-10).

Pedido de Julián: «una pequeña opción de configurar fechas con el mantenimiento
preventivo que ellos aún no lo hacen pero para futuro tenerlo ya configurado donde
puedas elegir qué usuario tiene que llegarle el email con la notificación».

QUÉ SE CONFIGURA, POR MÁQUINA

  · cada cuántos DÍAS (maquinaria.frecuencia_mantenimiento_dias, ya existía: RF-08);
  · opcional, cada cuántas HORAS DE USO efectivo (las de application/UsoMaquinaService);
  · con cuántos días de anticipación avisar (por defecto 3);
  · desde cuándo contar si todavía no se registró ningún mantenimiento;
  · a qué USUARIOS del sistema les llega el email. Por defecto, a nadie.

DE DÓNDE SE CUENTA (LA «BASE»)

El último «mantenimiento hecho» registrado o el «contar desde», el más nuevo de los dos.
Sin ninguno de los dos NO hay próxima fecha ni aviso, a propósito: el taller todavía no
lleva mantenimientos, y contar desde el alta de la máquina daría las 31 vencidas el
primer día. Para arrancar se registra el último que se hizo o se pone desde cuándo contar.

  próxima fecha = base + frecuencia en días
  vencido por horas = horas de uso efectivo desde la base ≥ el tope de horas

EL AVISO: UNA SOLA VEZ POR VENCIMIENTO — DECISIÓN A CONFIRMAR

Lo dispara el mismo cron de siempre (POST /internal/alertas, junto con RF-04 y RF-14). A
cada vencimiento le corresponde UN aviso, con una clave que lo identifica:

  · por fecha: «fecha:<próxima fecha>». Sale al entrar en la ventana de aviso («le toca
    el 12/10, faltan 3 días») o, si la corrida llega tarde, ya vencido. NO sale un segundo
    aviso el día que vence: es un vencimiento, un aviso. Si se quiere el recordatorio del
    día, es otra clave más.
  · por horas: «horas:<base>:<tope>». Sale una vez al llegar al tope.

Registrar el mantenimiento hecho mueve la base, y con ella las claves: el próximo
vencimiento vuelve a avisar. Cambiar la frecuencia cambia la próxima fecha y también.

Cada aviso es una notificación en la campanita (tipo MANTENIMIENTO_MAQUINA) y un email a
cada elegido activo con email. El índice único (máquina, clave) hace que dos corridas a
la vez no lo dupliquen. Si el email no está configurado o falla, la corrida sigue, el
aviso de la campanita queda y en la fila del aviso queda escrito qué pasó con el email.
No se reintenta: el reintento automático es lo que duplica mails.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError

from backend.application.AusenciaService import fecha_corta, leer_fecha
from backend.application.MaquinariaService import FRECUENCIA_MAXIMA_DIAS, validar_frecuencia
from backend.application.PausaService import ahora_ar
from backend.application.UsoMaquinaService import UsoMaquinaService
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.core.config import settings
from backend.domain.MantenimientoMaquina import (
    DIAS_AVISO_POR_DEFECTO,
    EMAIL_PENDIENTE,
    MOTIVO_PROXIMO,
    MOTIVO_VENCIDO_FECHA,
    MOTIVO_VENCIDO_HORAS,
    MantenimientoAviso,
    MantenimientoConfig,
    MantenimientoHecho,
)
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Notificacion import Notificacion
from backend.infrastructure.MantenimientoMaquinaRepository import MantenimientoMaquinaRepository
from backend.infrastructure.notifications import email as correo

# El tipo con el que viaja el aviso hasta la campanita.
TIPO_ALERTA = "MANTENIMIENTO_MAQUINA"

TOPE_POR_CORRIDA = 25
DIAS_AVISO_MAXIMO = 60
# Diez años de uso continuo. Más es un error de tipeo.
HORAS_MAXIMAS = 87_600
TOPE_HECHO_POR = 120
TOPE_NOTA = 500

ESTADO_TEXTO = {
    "sin_configurar": "Sin configurar",
    "sin_base": "Falta desde cuándo contar",
    "al_dia": "Al día",
    "proximo": "Le toca pronto",
    "vencido": "Vencido",
}

MOTIVO_TEXTO = {
    MOTIVO_PROXIMO: "Le toca pronto",
    MOTIVO_VENCIDO_FECHA: "Vencido por fecha",
    MOTIVO_VENCIDO_HORAS: "Vencido por horas de uso",
}


# ─────────────────────────── las cuentas (funciones puras) ───────────────────────────


def fmt_horas(minutos_: int | None) -> str:
    if minutos_ is None:
        return "—"
    h = minutos_ / 60
    return f"{h:.0f} h" if h >= 10 or h == int(h) else f"{h:.1f} h".replace(".", ",")


def calcular_estado(*, frecuencia_dias: int | None, cada_horas: int | None,
                    dias_aviso: int | None, ultimo_hecho: date | None,
                    contar_desde: date | None, usado_min: int | None, hoy: date) -> dict:
    """Dónde está parada una máquina con su mantenimiento. Ver el encabezado."""
    dias_aviso = DIAS_AVISO_POR_DEFECTO if dias_aviso is None else dias_aviso
    configurado = bool(frecuencia_dias) or bool(cada_horas)
    bases = [d for d in (ultimo_hecho, contar_desde) if d is not None]
    base = max(bases) if bases else None
    base_origen = None
    if base is not None:
        base_origen = "hecho" if base == ultimo_hecho else "contar_desde"

    proxima = base + timedelta(days=frecuencia_dias) if (base and frecuencia_dias) else None
    dias_restantes = (proxima - hoy).days if proxima else None
    tope_min = cada_horas * 60 if cada_horas else None
    usado = usado_min if (base and cada_horas) else None
    horas_restantes_min = (tope_min - usado) if (tope_min is not None and usado is not None) else None

    vencido_por = []
    if dias_restantes is not None and dias_restantes < 0:
        vencido_por.append("fecha")
    if horas_restantes_min is not None and horas_restantes_min <= 0:
        vencido_por.append("horas")

    if not configurado:
        estado = "sin_configurar"
    elif base is None:
        estado = "sin_base"
    elif vencido_por:
        estado = "vencido"
    elif dias_restantes is not None and dias_restantes <= dias_aviso:
        estado = "proximo"
    else:
        estado = "al_dia"

    return {
        "estado": estado,
        "estado_texto": ESTADO_TEXTO[estado],
        "configurado": configurado,
        "base": base,
        "base_origen": base_origen,
        "frecuencia_dias": frecuencia_dias,
        "cada_horas": cada_horas,
        "dias_aviso": dias_aviso,
        "proxima_fecha": proxima,
        "dias_restantes": dias_restantes,
        "usado_min": usado,
        "horas_restantes_min": horas_restantes_min,
        "vencido_por": vencido_por,
    }


def avisos_que_tocan(estado: dict) -> list[tuple[str, str, date | None]]:
    """(clave, motivo, vence) de lo que HOY merece aviso. Que ya se haya avisado lo mira
    quien llama (la clave es la que no se repite)."""
    salida = []
    proxima, dias = estado["proxima_fecha"], estado["dias_restantes"]
    if proxima is not None and dias is not None and dias <= estado["dias_aviso"]:
        motivo = MOTIVO_VENCIDO_FECHA if dias < 0 else MOTIVO_PROXIMO
        salida.append((f"fecha:{proxima.isoformat()}", motivo, proxima))
    if "horas" in estado["vencido_por"]:
        salida.append((f"horas:{estado['base'].isoformat()}:{estado['cada_horas']}",
                       MOTIVO_VENCIDO_HORAS, None))
    return salida


def armar_aviso(nombre: str, motivo: str, estado: dict, hoy: date) -> tuple[str, str, str]:
    """(mensaje de la campanita, detalle, asunto del email). El mensaje cabe en 500."""
    nombre = (nombre or "").strip() or "la máquina"
    if motivo == MOTIVO_VENCIDO_HORAS:
        mensaje = (f"Mantenimiento de «{nombre}» vencido por uso: lleva {fmt_horas(estado['usado_min'])} "
                   f"desde el {fecha_corta(estado['base'])} y le toca cada {estado['cada_horas']} h.")
        asunto = f"Mantenimiento vencido: {nombre}"
    else:
        proxima, dias = estado["proxima_fecha"], estado["dias_restantes"]
        if dias < 0:
            hace = "1 día" if dias == -1 else f"{-dias} días"
            mensaje = (f"Mantenimiento de «{nombre}» vencido: le tocaba el {fecha_corta(proxima)} "
                       f"(hace {hace}).")
            asunto = f"Mantenimiento vencido: {nombre}"
        elif dias == 0:
            mensaje = f"Mantenimiento de «{nombre}»: le toca hoy, {fecha_corta(proxima)}."
            asunto = f"Mantenimiento para hoy: {nombre}"
        else:
            faltan = "1 día" if dias == 1 else f"{dias} días"
            mensaje = f"Mantenimiento de «{nombre}»: le toca el {fecha_corta(proxima)} (faltan {faltan})."
            asunto = f"Mantenimiento en {faltan}: {nombre}"

    partes = []
    if estado["base_origen"] == "hecho":
        partes.append(f"Último mantenimiento: {fecha_corta(estado['base'])}")
    else:
        partes.append(f"Se cuenta desde el {fecha_corta(estado['base'])} (no hay ninguno registrado)")
    if estado["frecuencia_dias"]:
        partes.append(f"cada {estado['frecuencia_dias']} días")
    if estado["cada_horas"]:
        partes.append(f"cada {estado['cada_horas']} h de uso (lleva {fmt_horas(estado['usado_min'])})")
    detalle = ", ".join(partes) + ". Cuando se haga, registralo en Recursos › Recurso maquinaria."
    return mensaje[:500], detalle, asunto


def texto_del_email(mensaje: str, detalle: str) -> str:
    enlace = f"{(settings.FRONTEND_URL or '').rstrip('/')}/recursos?tab=maquinas"
    return (f"{mensaje}\n\n{detalle}\n\nVer la máquina: {enlace}\n\n"
            "Este aviso lo manda SPMM porque te eligieron para recibir los avisos de "
            "mantenimiento de esta máquina.")


def enmascarar(email: str | None) -> str | None:
    """«julian@hotmail.com» → «j•••@hotmail.com». Para quien no ve la lista de usuarios."""
    if not email or "@" not in email:
        return None
    usuario, dominio = email.strip().split("@", 1)
    return f"{usuario[:1]}•••@{dominio}"


def _nombre(nombre, apellido) -> str:
    return " ".join(p.strip() for p in (nombre or "", apellido or "") if p and p.strip())


def _entero(valor, campo: str, minimo: int, maximo: int) -> int | None:
    if valor is None or valor == "":
        return None
    try:
        n = int(valor)
    except (TypeError, ValueError):
        raise BusinessException(f"«{campo}» tiene que ser un número entero.")
    if n < minimo or n > maximo:
        raise BusinessException(f"«{campo}» tiene que ir de {minimo} a {maximo}.")
    return n


# ─────────────────────────── el servicio ───────────────────────────


class MantenimientoMaquinaService:
    def __init__(self, db_session):
        self.db = db_session
        self.repository = MantenimientoMaquinaRepository(db_session)

    async def _maquina(self, id_maquinaria: int) -> Maquinaria:
        m = await self.db.get(Maquinaria, id_maquinaria)
        if m is None:
            raise NotFoundException(f"No existe la máquina {id_maquinaria}.")
        return m

    async def _estado(self, m: Maquinaria, config: MantenimientoConfig | None,
                      ultimo: date | None, hoy: date, ahora: datetime) -> dict:
        contar_desde = config.contar_desde if config else None
        cada_horas = config.cada_horas if config else None
        bases = [d for d in (ultimo, contar_desde) if d]
        usado = None
        if cada_horas and bases:
            usado = (await UsoMaquinaService(self.db).minutos_desde(
                {m.id: datetime.combine(max(bases), time())}, ahora)).get(m.id, 0)
        return calcular_estado(
            frecuencia_dias=m.frecuencia_mantenimiento_dias, cada_horas=cada_horas,
            dias_aviso=config.dias_aviso if config else None, ultimo_hecho=ultimo,
            contar_desde=contar_desde, usado_min=usado, hoy=hoy,
        )

    # ── lo que ve la pantalla ──

    async def ver(self, id_maquinaria: int, *, ve_emails: bool) -> ResponseDTO:
        m = await self._maquina(id_maquinaria)
        config = await self.repository.config(id_maquinaria)
        hechos = await self.repository.hechos(id_maquinaria)
        ahora = ahora_ar()
        estado = await self._estado(m, config, hechos[0].fecha if hechos else None, ahora.date(), ahora)
        destinatarios = [
            {
                "id_usuario": d.id_usuario,
                "nombre": _nombre(d.nombre, d.apellido) or f"Usuario #{d.id_usuario}",
                "email": (d.email if ve_emails else enmascarar(d.email)),
                "activo": bool(d.activo),
                # Si le va a llegar: activo y con email.
                "recibe": bool(d.activo) and bool((d.email or "").strip()),
            }
            for d in await self.repository.destinatarios(id_maquinaria)
        ]
        avisos = [
            {
                "id": a.id, "motivo": a.motivo, "motivo_texto": MOTIVO_TEXTO.get(a.motivo, a.motivo),
                "vence": a.vence, "creado_en": a.creado_en, "email_estado": a.email_estado,
                "email_enviados": a.email_enviados, "email_fallidos": a.email_fallidos,
                "email_detalle": a.email_detalle,
            }
            for a in await self.repository.avisos(id_maquinaria)
        ]
        data = {
            "id_maquinaria": m.id,
            "maquina": m.nombre,
            "config": {
                "frecuencia_dias": m.frecuencia_mantenimiento_dias,
                "cada_horas": config.cada_horas if config else None,
                "dias_aviso": config.dias_aviso if config else DIAS_AVISO_POR_DEFECTO,
                "contar_desde": config.contar_desde if config else None,
                "actualizado_en": config.actualizado_en if config else None,
                "usuario_actualiza": config.usuario_actualiza if config else None,
            },
            "estado": estado,
            "historial": [
                {"id": h.id, "fecha": h.fecha, "hecho_por": h.hecho_por, "nota": h.nota,
                 "cargado_en": h.cargado_en, "usuario_carga": h.usuario_carga}
                for h in hechos
            ],
            "destinatarios": destinatarios,
            "avisos": avisos,
            "email_configurado": _email_configurado(),
            "emails_visibles": ve_emails,
        }
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")

    async def destinatarios_posibles(self, *, ve_emails: bool) -> ResponseDTO:
        """Los usuarios que pueden recibir el aviso (activos y con email). Sin la sección
        confidencial «Usuarios y permisos», el email sale tapado."""
        data = [
            {"id_usuario": u.id_usuario,
             "nombre": _nombre(u.nombre, u.apellido) or f"Usuario #{u.id_usuario}",
             "email": u.email if ve_emails else enmascarar(u.email)}
            for u in await self.repository.usuarios_con_email()
        ]
        return ResponseDTO(status=True, data=jsonable_encoder(data), errorDescription="")

    # ── configurar ──

    async def configurar(self, id_maquinaria: int, cambios: dict, *, id_usuario: int | None,
                         usuario: str | None, ve_emails: bool) -> ResponseDTO:
        """Guarda lo que VINO (lo que no vino no se toca). `destinatarios` reemplaza la
        lista entera; vacía = a nadie."""
        m = await self._maquina(id_maquinaria)
        try:
            if "frecuencia_dias" in cambios:
                m.frecuencia_mantenimiento_dias = validar_frecuencia(
                    _entero(cambios["frecuencia_dias"], "Cada cuántos días", 1, FRECUENCIA_MAXIMA_DIAS))
            config = await self.repository.config(id_maquinaria)
            if config is None:
                config = MantenimientoConfig(id_maquinaria=id_maquinaria, dias_aviso=DIAS_AVISO_POR_DEFECTO)
                self.db.add(config)
            if "cada_horas" in cambios:
                config.cada_horas = _entero(cambios["cada_horas"], "Cada cuántas horas de uso", 1, HORAS_MAXIMAS)
            if "dias_aviso" in cambios:
                dias = _entero(cambios["dias_aviso"], "Avisar con días de anticipación", 0, DIAS_AVISO_MAXIMO)
                config.dias_aviso = DIAS_AVISO_POR_DEFECTO if dias is None else dias
            if "contar_desde" in cambios:
                config.contar_desde = leer_fecha(cambios["contar_desde"], "contar desde")
            if "destinatarios" in cambios:
                ids = await self._validar_destinatarios(cambios["destinatarios"] or [])
                await self.repository.reemplazar_destinatarios(id_maquinaria, ids)
            config.actualizado_en = ahora_ar()
            config.id_usuario_actualiza = id_usuario
            config.usuario_actualiza = (usuario or "")[:120] or None
            await self.db.commit()
        except (BusinessException, NotFoundException):
            await self.db.rollback()
            raise
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Mantenimiento: no se pudo guardar la configuración de {id_maquinaria}: {e}")
            raise InfrastructureException("No se pudo guardar el mantenimiento de la máquina.") from e
        return await self.ver(id_maquinaria, ve_emails=ve_emails)

    async def _validar_destinatarios(self, ids) -> list[int]:
        try:
            pedidos = []
            for i in ids:
                n = int(i)
                if n not in pedidos:
                    pedidos.append(n)
        except (TypeError, ValueError):
            raise BusinessException("La lista de a quién avisar tiene que ser de usuarios.")
        if not pedidos:
            return []
        validos = {u.id_usuario for u in await self.repository.usuarios_con_email()}
        faltan = [i for i in pedidos if i not in validos]
        if faltan:
            raise BusinessException(
                "Sólo se le puede avisar a usuarios activos que tengan email cargado "
                f"({len(faltan)} de los elegidos no)."
            )
        return pedidos

    # ── el historial ──

    async def registrar_hecho(self, id_maquinaria: int, datos: dict, *, id_usuario: int | None,
                              usuario: str | None, ve_emails: bool) -> ResponseDTO:
        await self._maquina(id_maquinaria)
        fecha = leer_fecha(datos.get("fecha"), "fecha")
        hoy = ahora_ar().date()
        if fecha is None:
            raise BusinessException("Falta el día en que se hizo el mantenimiento.")
        if fecha > hoy:
            raise BusinessException("Un mantenimiento hecho no puede tener fecha futura.")
        if fecha < date(2000, 1, 1):
            raise BusinessException("Revisá el año de la fecha.")
        hecho_por = (str(datos.get("hecho_por") or "").strip())[:TOPE_HECHO_POR] or None
        nota = (str(datos.get("nota") or "").strip())
        if len(nota) > TOPE_NOTA:
            raise BusinessException(f"La nota puede tener hasta {TOPE_NOTA} caracteres.")
        try:
            self.db.add(MantenimientoHecho(
                id_maquinaria=id_maquinaria, fecha=fecha, hecho_por=hecho_por, nota=nota or None,
                cargado_en=ahora_ar(), id_usuario_carga=id_usuario,
                usuario_carga=(usuario or "")[:120] or None,
            ))
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Mantenimiento: no se pudo registrar el de {id_maquinaria}: {e}")
            raise InfrastructureException("No se pudo registrar el mantenimiento.") from e
        return await self.ver(id_maquinaria, ve_emails=ve_emails)

    async def borrar_hecho(self, id_maquinaria: int, id_registro: int, *, ve_emails: bool) -> ResponseDTO:
        """Para el cargado por error. Sin él, la próxima fecha vuelve a contar desde el
        anterior (y puede quedar vencido: se dice en pantalla antes de borrar)."""
        await self._maquina(id_maquinaria)
        hecho = await self.repository.hecho(id_maquinaria, id_registro)
        if hecho is None:
            raise NotFoundException("Ese mantenimiento no está registrado en esta máquina.")
        try:
            await self.db.delete(hecho)
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Mantenimiento: no se pudo borrar el registro {id_registro}: {e}")
            raise InfrastructureException("No se pudo borrar el mantenimiento.") from e
        return await self.ver(id_maquinaria, ve_emails=ve_emails)

    # ── lo de todas las máquinas (la tabla y el aviso) ──

    async def estados(self, ahora: datetime | None = None) -> dict[int, dict]:
        """{máquina: estado del mantenimiento} de TODAS. Una lectura por tabla."""
        ahora = ahora or ahora_ar()
        hoy = ahora.date()
        configs = await self.repository.configs()
        ultimos = await self.repository.ultimo_hecho_por_maquina()
        maquinas = await self.repository.maquinas()

        def _base(id_m):
            c = configs.get(id_m)
            bases = [d for d in (ultimos.get(id_m), c.contar_desde if c else None) if d]
            return max(bases) if bases else None

        por_horas = {m.id: datetime.combine(_base(m.id), time()) for m in maquinas
                     if configs.get(m.id) and configs[m.id].cada_horas and _base(m.id)}
        usado = await UsoMaquinaService(self.db).minutos_desde(por_horas, ahora)
        salida = {}
        for m in maquinas:
            c = configs.get(m.id)
            salida[m.id] = {
                "nombre": m.nombre,
                **calcular_estado(
                    frecuencia_dias=m.frecuencia_mantenimiento_dias,
                    cada_horas=c.cada_horas if c else None,
                    dias_aviso=c.dias_aviso if c else None,
                    ultimo_hecho=ultimos.get(m.id),
                    contar_desde=c.contar_desde if c else None,
                    usado_min=usado.get(m.id), hoy=hoy,
                ),
            }
        return salida

    async def detectarYAvisar(self, tope: int = TOPE_POR_CORRIDA, ahora: datetime | None = None) -> ResponseDTO:
        """Busca los vencimientos que todavía no se avisaron, escribe el aviso (campanita +
        registro) y manda el email a los elegidos. Para POST /internal/alertas."""
        try:
            ahora = ahora or ahora_ar()
            hoy = ahora.date()
            tope = max(int(tope), 1)
            estados = await self.estados(ahora)
            ya = await self.repository.claves_avisadas()
            candidatos = []
            for id_m, est in estados.items():
                for clave, motivo, vence in avisos_que_tocan(est):
                    if (id_m, clave) not in ya:
                        candidatos.append((id_m, clave, motivo, vence, est))
            # Primero lo vencido y, dentro de eso, lo más atrasado.
            candidatos.sort(key=lambda c: (c[2] == MOTIVO_PROXIMO, c[4]["dias_restantes"] or 0, c[0]))

            creados = []
            for id_m, clave, motivo, vence, est in candidatos[:tope]:
                mensaje, detalle, asunto = armar_aviso(est["nombre"], motivo, est, hoy)
                try:
                    # Savepoint por aviso: si otra corrida ya lo escribió (índice único),
                    # se pierde ése y los demás siguen.
                    async with self.db.begin_nested():
                        notif = Notificacion(
                            mensaje=mensaje, tipo=TIPO_ALERTA, leida=False, motivo=detalle,
                            id_usuario_creador=None,
                            # EXPLÍCITO: el default del modelo es utcnow (tres horas adelantado).
                            fecha_creacion=ahora,
                        )
                        self.db.add(notif)
                        await self.db.flush()
                        aviso = MantenimientoAviso(
                            id_maquinaria=id_m, clave=clave, motivo=motivo, vence=vence,
                            creado_en=ahora, id_notificacion=notif.id_notificacion,
                            email_estado=EMAIL_PENDIENTE,
                        )
                        self.db.add(aviso)
                        await self.db.flush()
                    creados.append((aviso, asunto, texto_del_email(mensaje, detalle)))
                except IntegrityError:
                    logger.info(f"Mantenimiento: el aviso {clave} de la máquina {id_m} ya lo escribió otra corrida.")
            # El aviso y su marca, juntos: si no se pudo guardar, la próxima lo intenta.
            await self.db.commit()

            # Los emails, DESPUÉS de guardar: un email que no sale no puede llevarse puesto
            # el aviso de la campanita.
            emails = await self.repository.emails_de(sorted({a.id_maquinaria for a, _, _ in creados}))
            cuenta = {"enviados": 0, "fallidos": 0, "sin_configurar": 0, "sin_destinatarios": 0}
            for aviso, asunto, texto in creados:
                r = await correo.enviar(emails.get(aviso.id_maquinaria, []), asunto, texto)
                aviso.email_estado = r.estado
                aviso.email_enviados = r.enviados
                aviso.email_fallidos = r.fallidos
                aviso.email_detalle = r.detalle
                cuenta["enviados"] += r.enviados
                cuenta["fallidos"] += r.fallidos
                if r.estado == correo.SIN_CONFIGURAR:
                    cuenta["sin_configurar"] += 1
                if r.estado == correo.SIN_DESTINATARIOS:
                    cuenta["sin_destinatarios"] += 1
            if creados:
                try:
                    await self.db.commit()
                except Exception as e:
                    await self.db.rollback()
                    logger.warning(f"Mantenimiento: no se pudo anotar cómo salieron los emails: {e}")

            sin_avisar = max(len(candidatos) - len(creados), 0)
            logger.info("Alertas de mantenimiento: %d avisos, %d quedaron para la próxima (tope=%d), "
                        "emails: %s.", len(creados), sin_avisar, tope, cuenta)
            return ResponseDTO(
                status=True,
                data={"creadas": len(creados), "sin_avisar": sin_avisar, "tope": tope, "emails": cuenta},
                errorDescription="",
            )
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Service - Error al avisar mantenimientos: {e}")
            raise InfrastructureException("Error al generar los avisos de mantenimiento.") from e


def _email_configurado() -> bool:
    try:
        return bool(correo.ENVIADOR.configurado())
    except Exception:
        return False
