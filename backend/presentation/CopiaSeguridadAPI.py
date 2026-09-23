"""
Copias de seguridad (RF-19): la solapa «Copias de seguridad» de Configuración.

    GET  /backups/estado                            qué se puede hacer y dónde queda la
                                                    copia automática
    GET  /backups/descargar                         la copia completa (streaming)
    POST /backups/revisar                           subir un archivo y ver qué haría.
                                                    NO toca nada
    POST /backups/restauracion                      restaurarlo: pide la huella de la
                                                    revisión y escribir RESTAURAR (y, si
                                                    la copia no está firmada, confirmarlo
                                                    aparte)
    GET  /backups/automaticas                       las copias que se guardaron solas
                                                    antes de cada restauración
    GET  /backups/automaticas/{nombre}/descargar    bajar una de ésas

QUIÉN

Sólo el administrador: nivel admin en Configuración, que es sólo del rol admin (la API
de permisos no deja dárselo a nadie más). Lo aplica el mapa de permisos
(core/permisos_rutas.py, «backups») colgado en main.py, como el resto de la API: acá no
hay un chequeo propio.

LA COPIA DE ANTES DE RESTAURAR

Con las tablas ya bloqueadas y antes de vaciar nada, se arma la copia del estado actual
y se guarda en Storage (infrastructure/deposito_copias.py). Si eso no se puede —Storage
sin configurar, o que rechace la subida— no se restaura, salvo que el admin haya bajado
él mismo la copia completa en los últimos 15 minutos Y esa copia sea exactamente cómo
está todo ahora. Se comprueba, no se le cree:
  · El navegador manda el sha256 del archivo que recibió entero, y tiene que ser el de
    una descarga COMPLETA de ese admin anotada en la auditoría (con su sha256).
  · Con las tablas ya bloqueadas, la huella del contenido de hoy (huellas_actuales)
    tiene que ser la misma que la de esa descarga: si alguien guardó algo después, no
    coincide y hay que volver a bajarla. Si no, eso se perdería sin copia.
Nunca se restaura sin una copia de lo que había.

AUDITORÍA

Bajar una copia (GET) no pasa por el middleware, que sólo registra escrituras: lo anota
el propio endpoint ANTES de mandar el primer byte («empezó a descargar»), y al terminar
completa esa misma fila con cómo terminó —entera, o cortada y cuánto llegó—, aunque la
conexión se haya cortado. Si la fila no se puede escribir, la copia no se manda: bajarse
todos los datos no puede quedar sin rastro. Los intentos rechazados (403) los anota el
middleware (auditoria_movimientos.se_audita_el_rechazo). Revisar y restaurar sí pasan
(son POST); el endpoint deja en `request.state.auditoria` la frase —qué copia, de qué
fecha— y cuántas filas quedaron por tabla.

El porqué de todo lo demás (formato, qué no se restaura, cómo se valida el archivo):
infrastructure/copias_de_seguridad.py.
"""
import asyncio
import hashlib
import json
import re
import time
from datetime import datetime, timedelta
from typing import Optional

import anyio
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select, update

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger
from backend.core.security import get_usuario_verificado
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.infrastructure import auditoria_movimientos as auditoria_mov
from backend.infrastructure.copias_de_seguridad import (
    LIMITE_SUBIDA,
    NOMBRE_DE_ARCHIVO,
    SIN_FIRMA,
    VERSION,
    CopiaInvalida,
    CopiaPreviaFallo,
    ResumenCopia,
    contar_filas,
    copia_a_archivo,
    generar_copia,
    huella_de,
    huellas_actuales,
    huellas_de_contenido,
    leer_esquema,
    nombre_de_copia,
    nombre_llano,
    restaurar_copia,
    revisar_copia,
)
from backend.infrastructure.db import SessionLocal
from backend.infrastructure.deposito_copias import DepositoEnStorage

router = APIRouter(prefix="/backups")

# Las sesiones con las que se lee y se restaura. Variable del módulo a propósito, igual
# que SESIONES_PERMISOS: los tests la pisan (conftest) para que ninguno llegue a la base
# de producción por acá aunque se olvide de pisar la dependencia.
SESIONES_BACKUP = SessionLocal
# Dónde queda la copia automática. Ídem: los tests nunca suben nada a Storage.
FABRICA_DEPOSITO = DepositoEnStorage

# Cuánto vale «la acabo de bajar» cuando la copia automática no se puede guardar.
VENTANA_DESCARGA_MANUAL = timedelta(minutes=15)

CONFIRMACION = "RESTAURAR"


def get_sesiones_backup():
    return SESIONES_BACKUP


def get_deposito():
    return FABRICA_DEPOSITO()


# ─────────────────────────── piezas ───────────────────────────


def _error(status: int, message: str, campo: str = "copia") -> HTTPException:
    return HTTPException(status_code=status, detail={"message": message, "campo": campo})


def _quien(usuario: dict) -> dict:
    nombre = " ".join(p for p in (usuario.get("nombre"), usuario.get("apellido")) if p).strip()
    return {
        "id_usuario": usuario.get("id_usuario"),
        "usuario": usuario.get("username"),
        "nombre": nombre or usuario.get("username"),
    }


def _fecha_legible(cuando: Optional[datetime]) -> str:
    return f"{cuando:%d/%m/%Y %H:%M}" if cuando else "fecha desconocida"


def _cabeceras_de_descarga(nombre: str) -> dict:
    return {
        "Content-Disposition": f'attachment; filename="{nombre}"',
        # El front está en otro dominio: sin esto no puede leer el nombre del archivo.
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Cache-Control": "no-store",
    }


def _chequear_subida(archivo: UploadFile) -> None:
    tamano = getattr(archivo, "size", None)
    if tamano is None:
        archivo.file.seek(0, 2)
        tamano = archivo.file.tell()
        archivo.file.seek(0)
    if not tamano:
        raise _error(422, "El archivo está vacío.")
    if tamano > LIMITE_SUBIDA:
        raise _error(
            413,
            f"El archivo pesa {tamano / 1024 / 1024:.1f} MB y el máximo para restaurar desde "
            f"la app es {LIMITE_SUBIDA // (1024 * 1024)} MB.",
        )


async def _conexion_de_lectura(sesion):
    """Una foto fija de toda la base: todas las tablas del mismo instante, aunque alguien
    guarde algo mientras la copia se arma. En Postgres, REPEATABLE READ y sólo lectura."""
    if sesion.bind.dialect.name == "postgresql":
        return await sesion.connection(execution_options={
            "isolation_level": "REPEATABLE READ",
            "postgresql_readonly": True,
        })
    return await sesion.connection()


_COLUMNAS_DE_CUENTA = ("id_usuario", "username", "email", "nombre", "apellido", "rol", "activo",
                       "admin_permanente")


async def _usuarios_actuales(conn, esquema) -> list:
    """Las cuentas de hoy, para incluir los usuarios: quién restaura, quiénes son
    administradores permanentes (si la columna existe) y qué cambia en cada una."""
    t = esquema.tables.get("usuario")
    if t is None:
        return []
    columnas = [t.c[c] for c in _COLUMNAS_DE_CUENTA if c in t.c]
    return [dict(f) for f in (await conn.execute(select(*columnas))).mappings().all()]


async def _planos_con_archivo(conn, esquema) -> Optional[set]:
    """Los planos que hoy tienen su archivo en algún lado (blob o ruta)."""
    t = esquema.tables.get("plano")
    if t is None or "id" not in t.c or "storage_path" not in t.c:
        return None
    condicion = t.c.storage_path.is_not(None)
    if "archivo" in t.c:
        condicion = or_(condicion, t.c.archivo.is_not(None))
    return set((await conn.execute(select(t.c.id).where(condicion))).scalars().all())


# ── la auditoría de las descargas ──

async def _anotar_inicio(fabrica, usuario: dict, ruta: str, frase: str, detalle: dict) -> int:
    """La fila de la descarga, ANTES de mandar nada. Levanta si no se puede: sin fila,
    no hay copia."""
    fila = auditoria_mov.armar_fila(
        usuario=usuario, metodo="GET", ruta=ruta, estado=200, duracion_ms=0,
        resumen={"frase": frase, "despues": detalle},
    )
    # Todavía no terminó: sin estado, como un hecho que está pasando.
    fila.estado = None
    async with fabrica() as sesion:
        sesion.add(fila)
        await sesion.commit()
        return fila.id


async def _anotar_fin(fabrica, id_fila: int, usuario: dict, *, estado: int, frase: str,
                      detalle: dict, arranque: float) -> None:
    """Completa la fila de la descarga con cómo terminó. Nunca levanta: la fila de
    «empezó a descargar» ya está."""
    nombre = " ".join(p for p in (usuario.get("nombre"), usuario.get("apellido")) if p).strip()
    try:
        async with fabrica() as sesion:
            await sesion.execute(
                update(AuditoriaMovimiento).where(AuditoriaMovimiento.id == id_fila).values(
                    estado=estado,
                    descripcion=f"{nombre or usuario.get('username') or 'alguien'} {frase}",
                    duracion_ms=int((time.monotonic() - arranque) * 1000),
                    detalle=json.dumps({"despues": auditoria_mov._limpiar(detalle)},
                                       ensure_ascii=False, default=str)[:auditoria_mov.TOPE_DETALLE],
                )
            )
            await sesion.commit()
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo completar la fila {id_fila} de la auditoría: {e}")


class _DescargaAnotada(StreamingResponse):
    """Una respuesta en pedazos que, pase lo que pase —terminó, se cortó la conexión, se
    canceló el pedido—, al final cierra la copia y completa su fila de auditoría.

    Lo de «al final» va acá y no en el generador: cuando el navegador corta, Starlette
    cancela el envío y el generador queda colgado en su `yield` (lo cierra el recolector
    de basura, cuando sea). Esto corre siempre, con la cancelación en pausa (shield) y un
    tope de tiempo para no colgarse si la base no contesta."""

    def __init__(self, contenido, *, al_terminar, **kwargs):
        super().__init__(contenido, **kwargs)
        self._al_terminar = al_terminar
        self.enviada_entera = False

    async def stream_response(self, send) -> None:
        await super().stream_response(send)
        self.enviada_entera = True

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.move_on_after(30, shield=True):
                cerrar = getattr(self.body_iterator, "aclose", None)
                if cerrar is not None:
                    try:
                        await cerrar()
                    except Exception as e:
                        logger.warning(f"Copias de seguridad: no se pudo cerrar la copia: {e}")
                await self._al_terminar(self.enviada_entera)


async def _descarga_reciente(conn, usuario: dict, ahora: datetime, huella: str) -> Optional[dict]:
    """La descarga COMPLETA de este admin, de los últimos 15 minutos, cuyo archivo tiene
    esta huella (el sha256 que calculó el navegador). Devuelve su huella del contenido,
    o None."""
    huella = (huella or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", huella):
        return None
    try:
        # En un savepoint: si esta lectura falla, la restauración sigue sana (en Postgres
        # una consulta que falla deja inservible la transacción entera).
        async with conn.begin_nested():
            filas = (await conn.execute(
                select(AuditoriaMovimiento.detalle).where(
                    AuditoriaMovimiento.id_usuario == usuario.get("id_usuario"),
                    AuditoriaMovimiento.ruta == "/backups/descargar",
                    AuditoriaMovimiento.estado == 200,
                    AuditoriaMovimiento.creado_en >= ahora - VENTANA_DESCARGA_MANUAL,
                ).order_by(AuditoriaMovimiento.id.desc())
            )).scalars().all()
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo mirar si hubo una descarga reciente: {e}")
        return None
    for crudo in filas:
        try:
            despues = json.loads(crudo or "{}").get("despues") or {}
        except (TypeError, ValueError, AttributeError):
            continue
        if despues.get("completa") is True and despues.get("sha256") == huella:
            contenido = despues.get("contenido")
            return contenido if isinstance(contenido, dict) else None
    return None


def _vista_previa(revision, actuales: dict, nombre_archivo: str, deposito) -> dict:
    m = revision.manifiesto
    tablas = []
    for p in revision.tablas:
        tablas.append({
            "tabla": p.nombre,
            "nombre": nombre_llano(p.nombre),
            "grupo": p.grupo,
            "accion": p.accion,
            "filas_actuales": actuales.get(p.nombre, 0),
            "filas_copia": p.filas_copia,
        })
    cambian = [p for p in revision.tablas if p.accion in ("reemplaza", "vacia")]
    return {
        "archivo": {"nombre": nombre_archivo, "tamano": revision.tamano, "huella": revision.huella},
        "copia": {
            "generada_en": revision.generado_en.isoformat(timespec="seconds") if revision.generado_en else None,
            "generada_por": revision.generado_por,
            "version_formato": m.get("version"),
            "motivo": m.get("motivo"),
        },
        "tablas": tablas,
        "resumen": {
            "tablas_que_cambian": len(cambian),
            "filas_actuales": sum(actuales.get(p.nombre, 0) for p in cambian),
            "filas_copia": sum(p.filas_copia or 0 for p in cambian),
        },
        "ignoradas": revision.ignoradas,
        "avisos": revision.avisos,
        "incluir_usuarios": revision.incluir_usuarios,
        "cambios_de_usuarios": revision.cambios_de_usuarios,
        "planos_sin_archivo": revision.planos_sin_archivo,
        "firma": {"valida": revision.firmada, "motivo": None if revision.firmada else SIN_FIRMA},
        "copia_automatica": {"disponible": deposito.disponible(), "donde": deposito.donde},
    }


def _motivo(e: Exception) -> str:
    """El error de la base, en un renglón y sin el «<class 'asyncpg…'>:» del driver."""
    original = getattr(e, "orig", None)
    if getattr(original, "sqlstate", None) == "55P03" or "lock timeout" in str(e):
        return ("alguien estaba usando el sistema y no se pudo tomar la base a tiempo. "
                "Probá de nuevo en un minuto")
    crudo = (str(original or e).strip() or type(e).__name__).splitlines()[0]
    return re.sub(r"^<class '[^']+'>:\s*", "", crudo)[:300]


_FECHA_EN_NOMBRE = re.compile(r"^spmm_backup_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})?")


def _fecha_del_nombre(nombre: str) -> Optional[str]:
    m = _FECHA_EN_NOMBRE.match(nombre)
    if not m:
        return None
    a, me, d, h, mi, s = m.groups()
    try:
        return datetime(int(a), int(me), int(d), int(h), int(mi), int(s or 0)).isoformat()
    except ValueError:
        return None


class _SinFirma(Exception):
    """La copia no tiene la firma de este servidor y el admin no la aceptó aparte."""


async def _cuentas(conn, esquema, usuario: dict, incluir_usuarios: bool):
    """(cuentas de hoy, la de quien restaura). Sólo hacen falta con los usuarios."""
    if not incluir_usuarios:
        return None, None
    cuentas = await _usuarios_actuales(conn, esquema)
    admin = next((c for c in cuentas if c.get("id_usuario") == usuario.get("id_usuario")), None)
    return cuentas, admin


def _revisar(archivo, esquema, incluir_usuarios, admin, cuentas, planos_hoy):
    return revisar_copia(
        archivo, esquema, incluir_usuarios=incluir_usuarios, admin_actual=admin,
        usuarios_actuales=cuentas, planos_con_archivo_hoy=planos_hoy,
    )


# ─────────────────────────── endpoints ───────────────────────────


@router.get("/estado")
async def estado(deposito=Depends(get_deposito)):
    return ResponseDTO(data={
        "version_formato": VERSION,
        "limite_subida_mb": LIMITE_SUBIDA // (1024 * 1024),
        "copia_automatica": {"disponible": deposito.disponible(), "donde": deposito.donde},
        "minutos_descarga_manual": int(VENTANA_DESCARGA_MANUAL.total_seconds() // 60),
    })


@router.get("/descargar")
async def descargar(
    usuario: dict = Depends(get_usuario_verificado),
    fabrica=Depends(get_sesiones_backup),
):
    """La copia completa, armada mientras se manda."""
    cuando = auditoria_mov.ahora_ar()
    nombre = nombre_de_copia(cuando)
    arranque = time.monotonic()

    ruta = "/backups/descargar"

    # Queda anotada ANTES del primer byte. Si no se puede anotar, no se manda nada.
    try:
        id_fila = await _anotar_inicio(
            fabrica, usuario, ruta,
            f"empezó a descargar una copia de seguridad completa ({nombre})",
            {"archivo": nombre, "completa": False},
        )
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo anotar la descarga en la auditoría: {e}")
        raise _error(503, "No se pudo anotar la descarga en la auditoría, y una copia con todos los "
                          "datos no se entrega sin dejar rastro. Probá de nuevo en un rato.")

    # La base se abre ANTES de contestar: si no responde, es un 503 con su mensaje y no
    # un .zip cortado a la mitad.
    sesion = fabrica()
    try:
        conn = await _conexion_de_lectura(sesion)
        esquema = await leer_esquema(conn)
    except Exception as e:
        await sesion.close()
        logger.error(f"Copias de seguridad: no se pudo leer la base para la copia: {e}")
        await _anotar_fin(fabrica, id_fila, usuario, estado=503, arranque=arranque,
                          frase=f"no pudo descargar una copia de seguridad ({nombre}): la base no respondió",
                          detalle={"archivo": nombre, "completa": False})
        raise _error(503, "No se pudo leer la base para armar la copia. Probá de nuevo en un rato.")

    resumen = ResumenCopia(nombre=nombre)
    suma = hashlib.sha256()

    async def cuerpo():
        try:
            async for trozo in generar_copia(conn, esquema, generado_por=_quien(usuario),
                                             motivo="descarga", cuando=cuando, resumen=resumen):
                suma.update(trozo)
                yield trozo
        finally:
            # Si la conexión se cortó en medio de una consulta, la cancelación sigue viva
            # acá: sin el shield, el close se cancela también y la conexión queda tomada
            # hasta que la junte el recolector (y el pooler de Supabase tiene 15).
            with anyio.move_on_after(10, shield=True):
                await sesion.close()

    async def al_terminar(enviada_entera: bool):
        if enviada_entera and resumen.completa:
            await _anotar_fin(
                fabrica, id_fila, usuario, estado=200, arranque=arranque,
                frase=(f"descargó una copia de seguridad completa ({nombre}: {resumen.total_filas} "
                       f"filas de {len(resumen.filas_por_tabla)} tablas)"),
                detalle={
                    "archivo": nombre, "completa": True, "filas": resumen.total_filas,
                    "bytes": resumen.bytes,
                    # Con esto se reconoce después ESTE archivo (el navegador manda su
                    # sha256) y se comprueba que siga siendo cómo está todo (restaurar).
                    "sha256": suma.hexdigest(),
                    "contenido": huellas_de_contenido(resumen.sha256_por_tabla),
                },
            )
        else:
            await _anotar_fin(
                fabrica, id_fila, usuario, estado=499, arranque=arranque,
                frase=(f"empezó a descargar una copia de seguridad completa ({nombre}) y se cortó "
                       f"(llegaron {resumen.bytes} bytes)"),
                detalle={"archivo": nombre, "completa": False, "bytes": resumen.bytes},
            )

    return _DescargaAnotada(cuerpo(), al_terminar=al_terminar, media_type="application/zip",
                            headers=_cabeceras_de_descarga(nombre))


@router.post("/revisar")
async def revisar(
    request: Request,
    archivo: UploadFile = File(...),
    incluir_usuarios: bool = Form(False),
    usuario: dict = Depends(get_usuario_verificado),
    fabrica=Depends(get_sesiones_backup),
    deposito=Depends(get_deposito),
):
    """La vista previa: qué se reemplaza (filas de hoy contra filas de la copia) y qué
    no. Revisa el archivo entero —hashes, filas, tipos— y no escribe nada."""
    _chequear_subida(archivo)
    request.state.auditoria = {"despues": {"archivo": archivo.filename}}
    async with fabrica() as sesion:
        conn = await sesion.connection()
        esquema = await leer_esquema(conn)
        cuentas, admin = await _cuentas(conn, esquema, usuario, incluir_usuarios)
        planos_hoy = await _planos_con_archivo(conn, esquema)
        try:
            revision = await asyncio.to_thread(
                _revisar, archivo.file, esquema, incluir_usuarios, admin, cuentas, planos_hoy,
            )
        except CopiaInvalida as e:
            request.state.auditoria = {"despues": {"archivo": archivo.filename, "motivo": e.message}}
            raise _error(422, e.message)
        actuales = await contar_filas(conn, esquema)
        await sesion.rollback()

    request.state.auditoria = {
        "frase": f"revisó la copia de seguridad del {_fecha_legible(revision.generado_en)} "
                 f"({archivo.filename}) antes de restaurarla"
                 + ("" if revision.firmada else " (sin la firma de este servidor)"),
        "despues": {"archivo": archivo.filename, "huella": revision.huella,
                    "firmada": revision.firmada},
    }
    return ResponseDTO(data=_vista_previa(revision, actuales, archivo.filename or "", deposito))


@router.post("/restauracion")
async def restaurar(
    request: Request,
    archivo: UploadFile = File(...),
    huella: str = Form(...),
    confirmacion: str = Form(...),
    incluir_usuarios: bool = Form(False),
    ya_descargue_la_copia_actual: bool = Form(False),
    # El sha256 del archivo que el navegador recibió entero al bajar la copia de hoy.
    huella_copia_actual: str = Form(""),
    # Para una copia sin la firma de este servidor: que el admin la quiere igual.
    aceptar_copia_sin_firma: bool = Form(False),
    usuario: dict = Depends(get_usuario_verificado),
    fabrica=Depends(get_sesiones_backup),
    deposito=Depends(get_deposito),
):
    """Reemplaza los datos por los de la copia. Una sola transacción: o queda todo, o no
    cambia nada."""
    request.state.auditoria = {"despues": {"archivo": archivo.filename}}
    if (confirmacion or "").strip() != CONFIRMACION:
        raise _error(422, f"Para restaurar hay que escribir {CONFIRMACION}, en mayúsculas.", "confirmacion")
    _chequear_subida(archivo)
    huella_real, _ = huella_de(archivo.file)
    if huella_real != (huella or "").strip().lower():
        raise _error(
            409,
            "El archivo no es el mismo que se revisó. Volvé a elegirlo y revisalo antes de restaurar.",
            "huella",
        )

    quien = _quien(usuario)
    cuando = auditoria_mov.ahora_ar()
    nombre_previa = nombre_de_copia(cuando, antes_de_restaurar=True)
    copia_previa: dict = {}

    async with fabrica() as sesion:
        conn = await sesion.connection()
        try:
            esquema = await leer_esquema(conn)
            cuentas, admin = await _cuentas(conn, esquema, usuario, incluir_usuarios)
            planos_hoy = await _planos_con_archivo(conn, esquema)
            revision = await asyncio.to_thread(
                _revisar, archivo.file, esquema, incluir_usuarios, admin, cuentas, planos_hoy,
            )
            if not revision.firmada and not aceptar_copia_sin_firma:
                raise _SinFirma()

            async def antes_de_borrar():
                # Con las tablas bloqueadas: la copia es exactamente lo que se va a pisar.
                if deposito.disponible():
                    try:
                        previa, resumen_previa = await copia_a_archivo(
                            conn, esquema, generado_por=quien, cuando=cuando,
                            motivo=f"automática, antes de restaurar {archivo.filename}",
                            resumen=ResumenCopia(nombre=nombre_previa),
                        )
                        try:
                            await deposito.guardar(nombre_previa, previa)
                        finally:
                            previa.close()
                        copia_previa.update(nombre=nombre_previa, donde=deposito.donde,
                                            filas=resumen_previa.total_filas)
                        return
                    except Exception as e:
                        logger.error(f"Copias de seguridad: no se pudo guardar la copia previa: {e}")
                        motivo = "no se pudo guardar sola una copia del estado actual"
                else:
                    motivo = "no hay dónde guardar sola una copia del estado actual"
                if not ya_descargue_la_copia_actual:
                    raise CopiaPreviaFallo(motivo)
                bajada = await _descarga_reciente(conn, usuario, cuando, huella_copia_actual)
                if bajada is None:
                    raise CopiaPreviaFallo(
                        f"{motivo}, y no hay una descarga completa tuya de los últimos "
                        f"{int(VENTANA_DESCARGA_MANUAL.total_seconds() // 60)} minutos que sea el "
                        "archivo que tenés (la descarga tiene que hacerse desde esta pantalla)"
                    )
                # Con las tablas ya bloqueadas: ¿lo que bajó sigue siendo cómo está todo?
                ahora = await huellas_actuales(conn, esquema)
                grupos = ("datos", "acceso") if incluir_usuarios else ("datos",)
                if any(ahora.get(g) != bajada.get(g) for g in grupos):
                    raise CopiaPreviaFallo(
                        f"{motivo}, y desde que descargaste la copia alguien guardó cambios: esa "
                        "copia ya no es cómo está todo ahora y lo nuevo se perdería"
                    )
                copia_previa.update(nombre=None, donde="la copia que descargaste recién")

            resultado = await restaurar_copia(
                conn, esquema, archivo.file, revision,
                admin_actual=admin, antes_de_borrar=antes_de_borrar,
            )
            await sesion.commit()
        except _SinFirma:
            await sesion.rollback()
            mensaje = (f"No se restauró nada. {SIN_FIRMA} Si igual querés restaurarla (sin los "
                       "usuarios), confirmalo marcando «Restaurar igual».")
            request.state.auditoria = {"despues": {"archivo": archivo.filename, "motivo": mensaje}}
            raise _error(409, mensaje, "firma")
        except CopiaPreviaFallo as e:
            await sesion.rollback()
            mensaje = (
                f"No se restauró nada: {e.message}. Descargá ahora la copia completa (botón "
                f"«Descargar copia completa») y volvé a confirmar marcando que ya la descargaste."
            )
            request.state.auditoria = {"despues": {"archivo": archivo.filename, "motivo": mensaje}}
            raise _error(409, mensaje, "copia_previa")
        except CopiaInvalida as e:
            await sesion.rollback()
            request.state.auditoria = {"despues": {"archivo": archivo.filename, "motivo": e.message}}
            raise _error(422, e.message)
        except Exception as e:
            await sesion.rollback()
            logger.error(f"Copias de seguridad: la restauración falló y se deshizo: {e}")
            mensaje = f"No se pudo restaurar: {_motivo(e)}. La base quedó como estaba: no se cambió nada."
            request.state.auditoria = {"despues": {"archivo": archivo.filename, "motivo": mensaje}}
            raise _error(500, mensaje, "restauracion")

    filas = resultado["filas_por_tabla"]
    request.state.auditoria = {
        "frase": (
            f"restauró la copia de seguridad del {_fecha_legible(revision.generado_en)} "
            f"({archivo.filename}): {resultado['total_filas']} filas en {len(filas)} tablas"
            + (", con los usuarios" if incluir_usuarios else "")
            + ("" if revision.firmada else " (una copia sin la firma de este servidor)")
        ),
        "despues": {
            "archivo": archivo.filename,
            "generada_en": revision.generado_en.isoformat() if revision.generado_en else None,
            "huella": revision.huella,
            "firmada": revision.firmada,
            "con_usuarios": incluir_usuarios,
            "copia_previa": copia_previa.get("nombre") or copia_previa.get("donde"),
            "filas": filas,
        },
    }
    return ResponseDTO(data={
        "restaurada": {
            "archivo": archivo.filename,
            "generada_en": revision.generado_en.isoformat(timespec="seconds") if revision.generado_en else None,
        },
        "tablas": [
            {"tabla": nombre, "nombre": nombre_llano(nombre), "filas": n} for nombre, n in filas.items()
        ],
        "total_filas": resultado["total_filas"],
        "conservadas": [nombre_llano(p.nombre) for p in revision.tablas
                        if p.accion in ("conserva", "sin_copia")],
        "copia_previa": copia_previa or None,
        "archivos_conservados": resultado["archivos_conservados"],
        "planos_sin_archivo": resultado["planos_sin_archivo"],
        "avisos": revision.avisos,
    })


@router.get("/automaticas")
async def automaticas(deposito=Depends(get_deposito)):
    """Las copias que se guardaron solas antes de cada restauración: con una de éstas se
    deshace una restauración (se baja y se restaura)."""
    if not deposito.disponible():
        return ResponseDTO(data={"disponible": False, "copias": []})
    try:
        copias = await deposito.listar()
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo listar las automáticas: {e}")
        raise _error(503, "No se pudo leer la lista de copias automáticas. Probá de nuevo en un rato.")
    for c in copias:
        c["fecha"] = _fecha_del_nombre(c["nombre"])
    return ResponseDTO(data={"disponible": True, "copias": copias})


@router.get("/automaticas/{nombre}/descargar")
async def descargar_automatica(
    nombre: str,
    usuario: dict = Depends(get_usuario_verificado),
    fabrica=Depends(get_sesiones_backup),
    deposito=Depends(get_deposito),
):
    if not NOMBRE_DE_ARCHIVO.match(nombre):
        raise _error(404, "Esa copia no existe.")
    try:
        datos = await deposito.bajar(nombre)
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo bajar {nombre}: {e}")
        raise _error(404, "No se pudo bajar esa copia: puede que ya no exista.")
    # Anotada antes de mandar nada, y sin fila no hay copia (igual que la completa).
    try:
        id_fila = await _anotar_inicio(
            fabrica, usuario, f"/backups/automaticas/{nombre}/descargar",
            f"descargó la copia automática {nombre}",
            {"archivo": nombre, "bytes": len(datos), "sha256": hashlib.sha256(datos).hexdigest()},
        )
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo anotar la descarga en la auditoría: {e}")
        raise _error(503, "No se pudo anotar la descarga en la auditoría, y una copia con todos los "
                          "datos no se entrega sin dejar rastro. Probá de nuevo en un rato.")
    arranque = time.monotonic()

    async def al_terminar(enviada_entera: bool):
        await _anotar_fin(
            fabrica, id_fila, usuario, estado=200 if enviada_entera else 499, arranque=arranque,
            frase=(f"descargó la copia automática {nombre}" if enviada_entera
                   else f"empezó a descargar la copia automática {nombre} y se cortó"),
            detalle={"archivo": nombre, "bytes": len(datos), "completa": enviada_entera,
                     "sha256": hashlib.sha256(datos).hexdigest()},
        )

    # En pedazos: Cloud Run corta en 32 MB una respuesta que no va por partes.
    async def trozos():
        for i in range(0, len(datos), 1 << 20):
            yield datos[i:i + (1 << 20)]

    return _DescargaAnotada(trozos(), al_terminar=al_terminar, media_type="application/zip",
                            headers=_cabeceras_de_descarga(nombre))
