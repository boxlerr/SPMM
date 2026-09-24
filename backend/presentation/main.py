from fastapi import FastAPI,HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
# Routers de presentación
from backend.presentation.ProcesoAPI import router as proceso_router
from backend.presentation.OperarioAPI import router as operario_router
from backend.presentation.OrdenTrabajoAPI import router as orden_trabajo_router
from backend.presentation.SectorAPI import router as sector_router
from backend.presentation.ArticuloAPI import router as articulo_router
from backend.presentation.PlanificacionAPI import router as plan_router
from backend.presentation.PrioridadAPI import router as prioridad_router
from backend.presentation.MaquinariaAPI import router as maquinaria_router
from backend.presentation.AuthAPI import router as auth_router
from backend.presentation.NotificacionAPI import router as notificacion_router
from backend.presentation.DashboardAPI import router as dashboard_router
from backend.presentation.PlanoAPI import router as plano_router
from backend.presentation.IncidenciaProcesoAPI import router as incidencia_router
from backend.presentation.ClienteAPI import router as cliente_router
from backend.presentation.AuditoriaAPI import router as auditoria_router
from backend.presentation.PermisosAPI import router as permisos_router
from backend.presentation.CopiaSeguridadAPI import router as copia_seguridad_router


from backend.presentation.ConfigAPI import router as config_router
from backend.presentation.PiezaAPI import router as pieza_router
from backend.presentation.OrdenTrabajoPiezaAPI import router as ot_pieza_router
from backend.presentation.ConsumoMaterialAPI import router as consumo_material_router
from backend.presentation.MateriaPrimaCatalogoAPI import router as mp_catalogo_router
from backend.presentation.MateriaPrimaOTAPI import router as mp_ot_router
from backend.presentation.MateriaPrimaPendientesAPI import router as mp_pendientes_router
from backend.presentation.PausaAPI import router as pausa_router
from backend.presentation.AsistenciaAPI import router as asistencia_router
from backend.presentation.RendimientoOperarioAPI import router as rendimiento_operario_router
from backend.presentation.RangoAPI import router as rango_router
from backend.presentation.UsoMaquinaAPI import router as uso_maquina_router
from backend.presentation.ReportesAPI import router as reportes_router
from backend.presentation.ws_routes import get_ws_manager
from backend.application.event_bus import EventBus
from backend.application.AlertaRetrasoService import AlertaRetrasoService, TOPE_POR_CORRIDA
from backend.application.AlertaStockService import AlertaStockService
from backend.application.MantenimientoMaquinaService import MantenimientoMaquinaService
from backend.infrastructure.notifications.handlers import NotificationHandlers
from backend.domain.events.work_order import WorkOrderCreated, WorkOrderStateChanged
import asyncio
from backend.scripts.sync_db import main as sync_main, run_sync as run_sync_once
from backend.infrastructure.migraciones import (
    aplicar_migraciones, migraciones_pendientes, sql_a_mano,
)
from backend.infrastructure import auditoria_movimientos as auditoria_mov
from backend.infrastructure import auditoria_procesos as auditoria_proc
from backend.infrastructure.db import SessionLocal
import json
import os
import time
from datetime import datetime


import logging

from backend.core.security import get_current_user, decode_access_token, require_politica
from backend.core.permisos_rutas import POLITICAS


from backend.commons.handlers.exception_handlers import registrar_exception_handlers

app = FastAPI(title="SPMM Backend", version="1.0")

from backend.core.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Comprime respuestas > 500 bytes. Reduce el payload de /ordenes (~1.5MB) a ~150-250KB,
# que sobre la conexión DuckDNS (upload limitado) es el cuello principal de descarga.
app.add_middleware(GZipMiddleware, minimum_size=500)


# 🔹 Auditoría: quién creó, editó o eliminó qué.
#
# Se agrega ÚLTIMO a propósito: Starlette envuelve del último al primero, así que
# éste queda por fuera de todo y ve el estado que realmente recibió el navegador.
#
# Está acá, y no repartido por los servicios, porque son 78 endpoints de escritura y
# el próximo que alguien agregue no llevaría la llamada — que es exactamente cómo la
# única auditoría que había (los intentos de planificar) quedó sola durante un año.
# El porqué completo y qué se guarda y qué no: infrastructure/auditoria_movimientos.py
#
# Se registra con add_middleware y no con el decorador @app.middleware("http") porque
# ese decorador está deprecado en Starlette y sale con warning; además así la función
# queda suelta y los tests la pueden montar en una app de juguete.
async def auditar_movimientos(request: Request, call_next):
    metodo = request.method
    ruta = request.url.path
    usuario = _quien_es(request)

    # Quién está pidiendo, disponible para todo lo que pase de acá para abajo.
    #
    # Va SIEMPRE, aunque esta ruta no se audite en `auditoria_movimiento`: lo usa la
    # auditoría de procesos (infrastructure/auditoria_procesos.py), que no mira el
    # pedido sino lo que quedó en la base, y necesita el autor ahí abajo. La mitad de
    # los caminos que tocan procesos no reciben el usuario por parámetro aunque el
    # endpoint sí pida token — borrar una OT, borrar un proceso del catálogo—, y sin
    # esto esos cambios quedarían sin autor.
    #
    # Se setea antes de `call_next` a propósito: el endpoint corre en una tarea hija,
    # que copia el contexto en el momento en que se crea. Al revés no funcionaría.
    token = auditoria_proc.poner_contexto(
        usuario=usuario,
        metodo=metodo,
        ruta=ruta,
        parametros=dict(request.query_params),
    )
    try:
        return await _auditar(request, call_next, metodo, ruta, usuario)
    finally:
        auditoria_proc.limpiar_contexto(token)


async def _auditar(request, call_next, metodo, ruta, usuario):
    if not auditoria_mov.se_audita(metodo, ruta):
        # Una lectura no se guarda, salvo el intento rechazado de bajar lo que es sólo
        # del admin (las copias de seguridad, RF-19): ver se_audita_el_rechazo.
        arranque = time.monotonic()
        respuesta = await call_next(request)
        if auditoria_mov.se_audita_el_rechazo(metodo, ruta, respuesta.status_code):
            await _guardar_movimiento(request, metodo, ruta, respuesta.status_code, arranque,
                                      None, usuario)
        return respuesta

    # El cuerpo se lee ANTES de que lo lea el endpoint. Starlette lo cachea y se lo
    # reentrega al handler (_CachedRequest), así que leerlo acá no lo consume — pero
    # de un plano no se lee nada: el cuerpo es el PDF entero.
    cuerpo = None
    try:
        if auditoria_mov.se_lee_el_cuerpo(
            ruta,
            request.headers.get("content-type", ""),
            int(request.headers.get("content-length") or 0),
        ):
            crudo = await request.body()
            if crudo:
                cuerpo = json.loads(crudo)
    except Exception:
        # Un cuerpo ilegible es problema del endpoint, no de la auditoría: la fila se
        # guarda igual, sin el detalle.
        cuerpo = None

    arranque = time.monotonic()
    try:
        respuesta = await call_next(request)
        estado = respuesta.status_code
    except Exception:
        # Lo que explota sin handler termina en un 500: queda registrado igual, que es
        # justo lo que se busca cuando alguien pregunta "guardé y no pasó nada".
        await _guardar_movimiento(request, metodo, ruta, 500, arranque, cuerpo, usuario)
        raise

    await _guardar_movimiento(request, metodo, ruta, estado, arranque, cuerpo, usuario)
    return respuesta


async def _guardar_movimiento(request, metodo, ruta, estado, arranque, cuerpo, usuario):
    """Sesión propia y corta: la del endpoint ya se cerró, y si el pedido terminó en
    rollback esa sesión está envenenada — escribir ahí sería perder la fila justo en
    el caso que más interesa. Nada de esto puede levantar."""
    try:
        async with SessionLocal() as sesion:
            await auditoria_mov.registrar(
                sesion,
                usuario=usuario,
                metodo=metodo,
                ruta=ruta,
                estado=estado,
                duracion_ms=int((time.monotonic() - arranque) * 1000),
                cuerpo=cuerpo,
                parametros=dict(request.query_params) or None,
                resumen=_resumen_del_endpoint(request),
                origen=_origen(request, metodo, ruta),
            )
    except Exception as e:
        logging.getLogger("uvicorn").warning(f"Auditoría: no se pudo guardar {metodo} {ruta}: {e}")


def _resumen_del_endpoint(request) -> dict | None:
    """Lo que el endpoint quiso dejar dicho en la auditoría, si dijo algo.

    El middleware sólo ve el pedido: «editó permisos» y el cuerpo. Hay cambios en los
    que eso no alcanza para contestar «¿quién le dio esto a quién, y qué tenía antes?»
    —los de permisos (RF-24)—, y el único que sabe el antes es el endpoint. Lo deja en
    `request.state.auditoria` y acá se levanta: el endpoint y el middleware comparten el
    scope del pedido, así que ven el mismo `state`.
    """
    try:
        resumen = getattr(request.state, "auditoria", None)
    except Exception:
        return None
    return resumen if isinstance(resumen, dict) else None


def _origen(request, metodo, ruta) -> dict | None:
    """IP y navegador, SÓLO para entrar, salir y las claves (RF-25): son las filas
    donde «desde dónde» contesta algo («¿ese intento fallido fue desde el taller?»).
    En el resto no suma y agrandaría cada fila."""
    if not auditoria_mov.tipo_de_acceso(metodo, ruta):
        return None
    try:
        cliente = request.client.host if request.client else None
        return auditoria_mov.origen_del_pedido(request.headers, cliente)
    except Exception:
        return None


def _quien_es(request) -> dict | None:
    """El usuario del token, o None. El middleware corre antes que las dependencias,
    así que el token lo lee él mismo. Un token vencido no es un error acá: que la
    llamada se rechace es trabajo de get_current_user."""
    cabecera = request.headers.get("authorization") or ""
    if not cabecera.lower().startswith("bearer "):
        return None
    try:
        datos = decode_access_token(cabecera[7:])
        return {
            "username": datos.get("sub"),
            "id_usuario": datos.get("id_usuario"),
            "nombre": datos.get("nombre"),
            "apellido": datos.get("apellido"),
        }
    except Exception:
        return None


app.add_middleware(BaseHTTPMiddleware, dispatch=auditar_movimientos)

# 🔹 Registrar todos los routers
# Auth queda público (sus endpoints protegidos lo manejan internamente)
app.include_router(auth_router)

# 🔹 Realtime & Events Wiring
# Inicializar EventBus y Handlers
event_bus = EventBus()
ws_manager = get_ws_manager()
notification_handlers = NotificationHandlers(ws_manager)

# Suscribir handlers a eventos
event_bus.subscribe(WorkOrderCreated, notification_handlers.on_work_order_created)
event_bus.subscribe(WorkOrderStateChanged, notification_handlers.on_work_order_state_changed)

# Guardar event_bus en app.state para acceso global/inyección scopeada
app.state.event_bus = event_bus

# El resto pide sesión y, además, el permiso de su router (RF-24).
#
# QUÉ PIDE CADA ROUTER NO SE DECIDE ACÁ: está en core/permisos_rutas.py (POLITICAS),
# el único mapa, con el porqué de cada línea. Acá sólo se cuelga: una dependencia por
# router —no por endpoint, son ~150— que mira el método (leer / escribir) y la ruta
# contra la base en cada pedido. Un router nuevo sin su política no arranca (KeyError)
# y tests/test_permisos_rutas.py exige que toda ruta tenga la suya.
#
# Hoy todos los usuarios son admin, y el admin pasa todo por regla sin leer ninguna
# tabla de permisos: el deploy no le cambia nada a nadie.
def _protegido(router: str) -> list:
    return [Depends(get_current_user), Depends(require_politica(POLITICAS[router], router))]


app.include_router(articulo_router, tags=["articulos"], dependencies=_protegido("articulos"))
app.include_router(proceso_router, tags=["procesos"], dependencies=_protegido("procesos"))
app.include_router(operario_router, tags=["operarios"], dependencies=_protegido("operarios"))
app.include_router(orden_trabajo_router, tags=["ordenes_trabajo"], dependencies=_protegido("ordenes"))
app.include_router(sector_router, tags=["sectores"], dependencies=_protegido("sectores"))
app.include_router(plan_router, tags=["planificacion"], dependencies=_protegido("planificacion"))
app.include_router(prioridad_router, tags=["prioridades"], dependencies=_protegido("prioridades"))
app.include_router(maquinaria_router, tags=["maquinarias"], dependencies=_protegido("maquinarias"))
app.include_router(notificacion_router, tags=["notificaciones"], dependencies=_protegido("notificaciones"))
app.include_router(dashboard_router, tags=["dashboard"], dependencies=_protegido("dashboard"))
app.include_router(plano_router, tags=["planos"], dependencies=_protegido("planos"))
app.include_router(incidencia_router, tags=["incidencias"], dependencies=_protegido("incidencias"))
# WebSocket DESREGISTRADO (ago 2026). El endpoint /ws/notifications era, de lejos,
# el mayor costo del servicio: Cloud Run factura CPU + RAM mientras la conexión está
# abierta, y cada una vivía hasta el timeout de 600 s sin transmitir casi nada. Eran
# ~14 h de instancia por día contra ~20 s de todo el resto de la API.
#
# Además nunca funcionó del todo: WSManager mantiene las conexiones en memoria de la
# instancia, así que con maxScale > 1 un broadcast no alcanzaba a los clientes
# conectados a otra instancia.
#
# El frontend ahora consulta GET /notificaciones cada 30 s. No se pierde ninguna
# notificación: NotificationHandlers las persiste ANTES de emitirlas.
# Para reactivarlo hay que resolver primero el estado compartido entre instancias
# (Redis pub/sub, o Supabase Realtime, que ya está pago y no cuesta tiempo de Cloud Run).
# app.include_router(ws_router, tags=["websocket"])

app.include_router(cliente_router, tags=["clientes"], dependencies=_protegido("clientes"))
app.include_router(config_router, tags=["configuracion"], dependencies=_protegido("config"))

app.include_router(pieza_router, tags=["piezas"], dependencies=_protegido("piezas"))
app.include_router(ot_pieza_router, tags=["ordenes_trabajo_piezas"], dependencies=_protegido("ordenes_trabajo_piezas"))
# RF-15: lo que se consumió de cada material de la OT. Tabla propia de SPMM; el sync no
# la mira. Registrar pide poder editar la OT (la política de consumos_material); anular
# es además de quien lo cargó o de un admin (lo decide el servicio, que es el que sabe
# quién lo cargó).
app.include_router(consumo_material_router, tags=["consumos_material"], dependencies=_protegido("consumos_material"))
# Materia prima en SPMM (reunión del 23/09/2026: la gestión pasa del sistema viejo a SPMM).
# Tres routers bajo /materia-prima, cada uno con su política: el catálogo de insumos
# (stock, recortes, precios, proveedores), las materias primas de cada OT, y Pendientes
# con la cañera. Los tres leen y escriben con la sección «Materia prima» de Operaciones.
app.include_router(mp_catalogo_router, tags=["materia_prima"], dependencies=_protegido("materia_prima_catalogo"))
app.include_router(mp_ot_router, tags=["materia_prima"], dependencies=_protegido("materia_prima_ot"))
app.include_router(mp_pendientes_router, tags=["materia_prima"], dependencies=_protegido("materia_prima_pendientes"))
# RF-03: pausar y reanudar una OT o un paso, con motivo y quién. Tabla propia de SPMM
# (orden_trabajo_pausa); no le cambia el estado a ningún paso.
app.include_router(pausa_router, tags=["pausas"], dependencies=_protegido("pausas"))
# RF-06: la asistencia (ausencias con fecha) y el tiempo efectivo de cada persona, en su
# ficha. Tabla propia de SPMM (operario_ausencia); no le cambia nada al planificador.
app.include_router(asistencia_router, tags=["asistencia"], dependencies=_protegido("asistencia"))
# RF-07: el reporte de rendimiento de cada persona, en su ficha (sólo lectura; la
# exportación se arma en el navegador). Pide la sección confidencial «Rendimiento por
# persona», la misma del cuadro del Dashboard.
app.include_router(rendimiento_operario_router, tags=["rendimiento_operario"],
                   dependencies=_protegido("rendimiento_operario"))
app.include_router(rango_router, tags=["rangos"], dependencies=_protegido("rangos"))
# RF-10: las horas de uso de cada máquina (las escribe solo el cambio de estado de los
# pasos) y su mantenimiento preventivo, en Recursos › Recurso maquinaria. Tablas propias
# de SPMM; el sync no las mira y el planificador tampoco.
app.include_router(uso_maquina_router, tags=["uso_maquinas"], dependencies=_protegido("maquinas_uso"))
app.include_router(auditoria_router, tags=["auditoria"], dependencies=_protegido("auditoria"))
# RF-19: bajar una copia completa y restaurarla. Sólo admin (la política «backups»).
app.include_router(copia_seguridad_router, tags=["copias de seguridad"], dependencies=_protegido("backups"))
# RF-23: el armador de reportes personalizados del Dashboard. El router pide el Dashboard
# (leer para armar y exportar, editar para guardar); cada fuente pide además lo suyo, y
# eso lo mira el servicio (application/ReportesCatalogo.py).
app.include_router(reportes_router, tags=["reportes personalizados"],
                   dependencies=_protegido("reportes_personalizados"))

# RF-24: la administración de permisos (matriz rol × área y rol × sección, permisos de
# más por persona, secciones confidenciales, cambio de rol). No va por el mapa: cada
# endpoint pide lo suyo —leer, la sección «Usuarios y permisos»; cambiar, admin—.
app.include_router(permisos_router, tags=["permisos"], dependencies=[Depends(get_current_user)])

# Agrega los handler de exepciones globales al contexto de la aplicacion.
# La lista vive en exception_handlers.py, al lado de los handlers: tenerla acá fue lo
# que dejó a BusinessException sin registrar y convirtió los avisos de negocio en un
# "Error de conexión" en pantalla.
registrar_exception_handlers(app)


# 🔹 Logger básico
logger = logging.getLogger("uvicorn")

# 🔹 Endpoint raíz
@app.get("/")
def root():
    return {"message": "Backend funcionando correctamente"}

from datetime import datetime
from fastapi import Response

@app.get("/health")
def health_check(response: Response):
    """200 si la instancia está entera; 503 si le quedó alguna migración sin aplicar.

    Una columna del modelo que falta en la base tumba la lectura de todas las OT
    (ver backend/infrastructure/migraciones.py). El arranque no se frena por eso, así
    que esto es lo que lo deja ver desde afuera: al probar la revisión con tag antes
    de pasarle tráfico, /health en 503 dice que NO se le pase y qué .sql correr. Cloud
    Run no lo mira solo (el probe por defecto es TCP): si algún día se configura un
    startup probe HTTP acá, una revisión sin migrar ni siquiera queda lista.
    """
    response.headers["Cache-Control"] = "no-store"
    pendientes = migraciones_pendientes()
    if pendientes:
        response.status_code = 503
        return {
            "status": "migraciones_pendientes",
            "timestamp": datetime.now().isoformat(),
            "service": "SPMM Backend",
            "migraciones_pendientes": pendientes,
            "correr_a_mano": [sql_a_mano(n) for n in pendientes],
        }
    return {
        "status": "ok", 
        "timestamp": datetime.now().isoformat(),
        "service": "SPMM Backend"
    }

@app.post("/internal/sync")
async def internal_sync(request: Request):
    """
    Corre UNA pasada del sync y devuelve el resultado.

    Existe para hosts serverless (Cloud Run), donde el contenedor se apaga si no
    hay tráfico y el loop de fondo no sobrevive: ahí el sync lo dispara un cron
    externo (Cloud Scheduler) pegándole a este endpoint.

    Protegido con SYNC_TOKEN. Si la variable no está seteada, el endpoint queda
    deshabilitado (para que nadie pueda dispararlo en un entorno mal configurado).
    """
    esperado = os.getenv("SYNC_TOKEN")
    if not esperado:
        raise HTTPException(status_code=404, detail="Not Found")
    if request.headers.get("x-sync-token") != esperado:
        raise HTTPException(status_code=401, detail="No autorizado")

    inicio = datetime.now()
    await run_sync_once()
    return {
        "status": "ok",
        "duracion_seg": round((datetime.now() - inicio).total_seconds(), 1),
        "timestamp": inicio.isoformat(),
    }


async def get_db_interno():
    """Sesión para los trabajos internos (los dispara un cron, no una pantalla).

    Es una dependencia y no un `async with` adentro del endpoint para que los tests
    puedan pisarla: `SessionLocal` acá es el de PRODUCCIÓN —se arma al importar db.py—
    y un test que llame a este endpoint sin pisar nada le escribiría a Supabase.
    """
    async with SessionLocal() as session:
        yield session


@app.post("/internal/alertas-retraso")
async def internal_alertas_retraso(
    request: Request,
    tope: int = TOPE_POR_CORRIDA,
    db=Depends(get_db_interno),
):
    """Busca órdenes vencidas sin aviso y crea la alerta de cada una (RF-04).

    Mismo patrón y misma protección que `/internal/sync`: el contenedor de Cloud Run
    se apaga si no hay tráfico, así que no sirve un reloj adentro del proceso — esto lo
    dispara un cron externo una vez por día.

    `tope` acota cuántos avisos escribe UNA corrida. Hay ~194 órdenes abiertas y el
    taller está sobrevendido: sin tope, la primera pasada puede dejar la campanita con
    cien renglones el día uno y nadie la vuelve a mirar. Lo que queda afuera no se
    pierde —la próxima corrida lo vuelve a encontrar— y la respuesta dice cuántos
    quedaron, para hacer la primera pasada a mano y mirando.

    Protegido con SYNC_TOKEN. Si la variable no está seteada, el endpoint queda
    deshabilitado (para que nadie pueda dispararlo en un entorno mal configurado).
    """
    esperado = os.getenv("SYNC_TOKEN")
    if not esperado:
        raise HTTPException(status_code=404, detail="Not Found")
    if request.headers.get("x-sync-token") != esperado:
        raise HTTPException(status_code=401, detail="No autorizado")

    inicio = datetime.now()
    resultado = await AlertaRetrasoService(db).detectarYAvisarRetrasos(tope=tope)
    return {
        "status": "ok",
        **resultado.data,
        "duracion_seg": round((datetime.now() - inicio).total_seconds(), 1),
        "timestamp": inicio.isoformat(),
    }


@app.post("/internal/alertas")
async def internal_alertas(
    request: Request,
    tope: int = TOPE_POR_CORRIDA,
    db=Depends(get_db_interno),
):
    """Corre TODOS los avisos automáticos en una pasada: órdenes retrasadas (RF-04),
    stock bajo (RF-14) y mantenimiento de máquinas (RF-10, el único que además manda
    email: a los usuarios elegidos en cada máquina; si el email no está configurado o
    falla, el aviso de la campanita queda igual y la corrida no falla por eso).

    POR QUÉ UNO SOLO Y NO UNO POR AVISO

    Cada aviso nuevo con su propia ruta es un trabajo más para dar de alta en Cloud
    Scheduler, a mano, y el día que alguien se olvide de uno ese aviso queda mudo sin
    que nadie lo note. Con uno solo, el cron se configura una vez y el próximo aviso
    que se agregue acá corre solo.

    Se puede llamar seguido (por ejemplo, cada hora): los dos avisos son idempotentes
    —ninguno repite lo que ya avisó— así que correr de más no ensucia la campanita.
    El de retraso sólo encuentra algo nuevo una vez por día; el de stock, cada vez que
    el sync del viejo trae un stock que perforó un mínimo.

    `/internal/alertas-retraso` queda como estaba, por si ya hay un cron apuntándole.

    Cada aviso corre aislado: si uno falla, el otro corre igual y lo que alcanzó a
    escribir queda escrito. La respuesta es 500 si falló alguno —para que el cron lo
    marque y lo reintente, cosa que ninguno de los dos duplica— y dice cuál.

    `tope` vale para CADA aviso por separado.

    Protegido con SYNC_TOKEN, igual que `/internal/sync`. Si la variable no está
    seteada, el endpoint queda deshabilitado.
    """
    esperado = os.getenv("SYNC_TOKEN")
    if not esperado:
        raise HTTPException(status_code=404, detail="Not Found")
    if request.headers.get("x-sync-token") != esperado:
        raise HTTPException(status_code=401, detail="No autorizado")

    inicio = datetime.now()
    avisos = (
        ("retraso", lambda: AlertaRetrasoService(db).detectarYAvisarRetrasos(tope=tope)),
        ("stock", lambda: AlertaStockService(db).detectarYAvisarStockBajo(tope=tope)),
        ("mantenimiento", lambda: MantenimientoMaquinaService(db).detectarYAvisar(tope=tope)),
    )
    resultados, fallas = {}, {}
    for nombre, correr in avisos:
        try:
            resultados[nombre] = (await correr()).data
        except Exception as e:
            logger.error(f"Alertas internas: falló el aviso de {nombre}: {e}")
            fallas[nombre] = getattr(e, "message", None) or str(e)
            # En Postgres una consulta que falla deja la transacción abortada y la
            # sesión no sirve hasta el rollback: sin esto, el segundo aviso caería
            # por culpa del primero.
            try:
                await db.rollback()
            except Exception:
                pass

    cuerpo = {
        "status": "error" if fallas else "ok",
        **resultados,
        "fallas": fallas,
        "duracion_seg": round((datetime.now() - inicio).total_seconds(), 1),
        "timestamp": inicio.isoformat(),
    }
    if fallas:
        return JSONResponse(status_code=500, content=cuerpo)
    return cuerpo


@app.on_event("startup")
async def startup_event():
    # 🔹 DDL que el código nuevo necesita, antes de atender la primera consulta.
    #    El deploy a Cloud Run es a mano: si el modelo declara una columna que en la
    #    base no está, el SELECT la pide igual y se cae la lectura de TODAS las OT.
    #    Ver backend/infrastructure/migraciones.py.
    await aplicar_migraciones()

    print("RUTAS REGISTRADAS:")
    for route in app.routes:
        print(f"  - {route.path} ({getattr(route, 'methods', 'WS')})")

    # 🔹 Sincronización de BD en segundo plano.
    #    En hosts con proceso persistente (Render, Fly, VM) corre como loop.
    #    En serverless (Cloud Run) se apaga con SYNC_LOOP_ENABLED=false y el sync
    #    lo dispara Cloud Scheduler contra POST /internal/sync.
    if (os.getenv("SYNC_LOOP_ENABLED", "true").lower() != "false"):
        logger.info("Iniciando tarea de sincronización de BD en segundo plano...")
        asyncio.create_task(sync_main())
    else:
        logger.info("Loop de sync DESACTIVADO (SYNC_LOOP_ENABLED=false) — se espera un cron externo a POST /internal/sync.")

