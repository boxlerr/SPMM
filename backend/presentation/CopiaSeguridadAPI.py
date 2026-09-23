"""
Copias de seguridad (RF-19): la solapa «Copias de seguridad» de Configuración.

    GET  /backups/estado                            qué se puede hacer y dónde queda la
                                                    copia automática
    GET  /backups/descargar                         la copia completa (streaming)
    POST /backups/revisar                           subir un archivo y ver qué haría.
                                                    NO toca nada
    POST /backups/restauracion                      restaurarlo: pide la huella de la
                                                    revisión y escribir RESTAURAR
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
él mismo la copia completa en los últimos 15 minutos (queda en la auditoría: es lo que
se mira) y lo diga al confirmar. Nunca se restaura sin una copia de lo que había.

AUDITORÍA

Bajar una copia (GET) no pasa por el middleware, que sólo registra escrituras: lo anota
el propio endpoint al terminar de mandarla. Revisar y restaurar sí pasan (son POST); el
endpoint deja en `request.state.auditoria` la frase —qué copia, de qué fecha— y cuántas
filas quedaron por tabla.

El porqué de todo lo demás (formato, qué no se restaura, cómo se valida el archivo):
infrastructure/copias_de_seguridad.py.
"""
import asyncio
import re
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.loggers.logger import logger
from backend.core.security import get_usuario_verificado
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.infrastructure import auditoria_movimientos as auditoria_mov
from backend.infrastructure.copias_de_seguridad import (
    LIMITE_SUBIDA,
    NOMBRE_DE_ARCHIVO,
    VERSION,
    CopiaInvalida,
    CopiaPreviaFallo,
    ResumenCopia,
    contar_filas,
    copia_a_archivo,
    generar_copia,
    huella_de,
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


async def _admin_actual(conn, esquema, usuario: dict) -> Optional[dict]:
    """La cuenta de quien restaura, como está hoy (para la opción de incluir usuarios)."""
    t = esquema.tables.get("usuario")
    if t is None:
        return None
    fila = (await conn.execute(
        select(t.c.id_usuario, t.c.username, t.c.email).where(t.c.id_usuario == usuario.get("id_usuario"))
    )).mappings().first()
    return dict(fila) if fila else None


async def _anotar_descarga(fabrica, usuario: dict, ruta: str, arranque: float, frase: str,
                           detalle: dict) -> None:
    """Una fila de auditoría por cada copia bajada. Nunca rompe la descarga."""
    try:
        async with fabrica() as sesion:
            await auditoria_mov.registrar(
                sesion,
                usuario=usuario,
                metodo="GET",
                ruta=ruta,
                estado=200,
                duracion_ms=int((time.monotonic() - arranque) * 1000),
                resumen={"frase": frase, "despues": detalle},
            )
    except Exception as e:
        logger.warning(f"Copias de seguridad: no se pudo anotar la descarga en la auditoría: {e}")


async def _descargo_recien(conn, usuario: dict, ahora: datetime) -> bool:
    """¿Este admin terminó de bajar una copia completa en los últimos 15 minutos?"""
    try:
        cuantas = await conn.scalar(
            select(func.count()).select_from(AuditoriaMovimiento).where(
                AuditoriaMovimiento.id_usuario == usuario.get("id_usuario"),
                AuditoriaMovimiento.ruta == "/backups/descargar",
                AuditoriaMovimiento.estado == 200,
                AuditoriaMovimiento.creado_en >= ahora - VENTANA_DESCARGA_MANUAL,
            )
        )
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo mirar si hubo una descarga reciente: {e}")
        return False
    return bool(cuantas)


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

    # La base se abre ANTES de contestar: si no responde, es un 503 con su mensaje y no
    # un .zip cortado a la mitad.
    sesion = fabrica()
    try:
        conn = await _conexion_de_lectura(sesion)
        esquema = await leer_esquema(conn)
    except Exception as e:
        await sesion.close()
        logger.error(f"Copias de seguridad: no se pudo leer la base para la copia: {e}")
        raise _error(503, "No se pudo leer la base para armar la copia. Probá de nuevo en un rato.")

    resumen = ResumenCopia(nombre=nombre)

    async def cuerpo():
        try:
            async for trozo in generar_copia(conn, esquema, generado_por=_quien(usuario),
                                             motivo="descarga", cuando=cuando, resumen=resumen):
                yield trozo
        finally:
            await sesion.close()
        await _anotar_descarga(
            fabrica, usuario, "/backups/descargar", arranque,
            f"descargó una copia de seguridad completa ({nombre}: {resumen.total_filas} filas "
            f"de {len(resumen.filas_por_tabla)} tablas)",
            {"archivo": nombre, "filas": resumen.total_filas, "bytes": resumen.bytes},
        )

    return StreamingResponse(cuerpo(), media_type="application/zip",
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
        admin = await _admin_actual(conn, esquema, usuario) if incluir_usuarios else None
        try:
            revision = await asyncio.to_thread(
                revisar_copia, archivo.file, esquema,
                incluir_usuarios=incluir_usuarios, admin_actual=admin,
            )
        except CopiaInvalida as e:
            request.state.auditoria = {"despues": {"archivo": archivo.filename, "motivo": e.message}}
            raise _error(422, e.message)
        actuales = await contar_filas(conn, esquema)
        await sesion.rollback()

    request.state.auditoria = {
        "frase": f"revisó la copia de seguridad del {_fecha_legible(revision.generado_en)} "
                 f"({archivo.filename}) antes de restaurarla",
        "despues": {"archivo": archivo.filename, "huella": revision.huella},
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
            admin = await _admin_actual(conn, esquema, usuario) if incluir_usuarios else None
            revision = await asyncio.to_thread(
                revisar_copia, archivo.file, esquema,
                incluir_usuarios=incluir_usuarios, admin_actual=admin,
            )

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
                if ya_descargue_la_copia_actual and await _descargo_recien(conn, usuario, cuando):
                    copia_previa.update(nombre=None, donde="la copia que descargaste recién")
                    return
                raise CopiaPreviaFallo(motivo)

            resultado = await restaurar_copia(
                conn, esquema, archivo.file, revision,
                admin_actual=admin, antes_de_borrar=antes_de_borrar,
            )
            await sesion.commit()
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
        ),
        "despues": {
            "archivo": archivo.filename,
            "generada_en": revision.generado_en.isoformat() if revision.generado_en else None,
            "huella": revision.huella,
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
    arranque = time.monotonic()
    try:
        datos = await deposito.bajar(nombre)
    except Exception as e:
        logger.error(f"Copias de seguridad: no se pudo bajar {nombre}: {e}")
        raise _error(404, "No se pudo bajar esa copia: puede que ya no exista.")
    await _anotar_descarga(
        fabrica, usuario, f"/backups/automaticas/{nombre}/descargar", arranque,
        f"descargó la copia automática {nombre}", {"archivo": nombre, "bytes": len(datos)},
    )
    # En pedazos: Cloud Run corta en 32 MB una respuesta que no va por partes.
    trozos = (datos[i:i + (1 << 20)] for i in range(0, len(datos), 1 << 20))
    return StreamingResponse(trozos, media_type="application/zip", headers=_cabeceras_de_descarga(nombre))
