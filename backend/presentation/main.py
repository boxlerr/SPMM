from fastapi import FastAPI,HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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


from backend.presentation.ConfigAPI import router as config_router
from backend.presentation.PiezaAPI import router as pieza_router
from backend.presentation.OrdenTrabajoPiezaAPI import router as ot_pieza_router
from backend.presentation.RangoAPI import router as rango_router
from backend.presentation.ws_routes import get_ws_manager
from backend.application.event_bus import EventBus
from backend.infrastructure.notifications.handlers import NotificationHandlers
from backend.domain.events.work_order import WorkOrderCreated, WorkOrderStateChanged
import asyncio
from backend.scripts.sync_db import main as sync_main, run_sync as run_sync_once
from backend.infrastructure.migraciones import aplicar_migraciones
from backend.infrastructure import auditoria_movimientos as auditoria_mov
from backend.infrastructure import auditoria_procesos as auditoria_proc
from backend.infrastructure.db import SessionLocal
import json
import os
import time
from datetime import datetime


import logging

from backend.core.security import get_current_user, decode_access_token


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
        return await call_next(request)

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
            )
    except Exception as e:
        logging.getLogger("uvicorn").warning(f"Auditoría: no se pudo guardar {metodo} {ruta}: {e}")


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

# El resto se protege globalmente
protected_deps = [Depends(get_current_user)]

app.include_router(articulo_router, tags=["articulos"], dependencies=protected_deps)
app.include_router(proceso_router, tags=["procesos"], dependencies=protected_deps)
app.include_router(operario_router, tags=["operarios"], dependencies=protected_deps)
app.include_router(orden_trabajo_router, tags=["ordenes_trabajo"], dependencies=protected_deps)
app.include_router(sector_router, tags=["sectores"], dependencies=protected_deps)
app.include_router(plan_router,tags=["planificacion"], dependencies=protected_deps)
app.include_router(prioridad_router,tags=["prioridades"], dependencies=protected_deps)
app.include_router(maquinaria_router,tags=["maquinarias"], dependencies=protected_deps)
app.include_router(notificacion_router, tags=["notificaciones"], dependencies=protected_deps)
app.include_router(dashboard_router, tags=["dashboard"], dependencies=protected_deps)
app.include_router(plano_router, tags=["planos"], dependencies=protected_deps)
app.include_router(incidencia_router, tags=["incidencias"], dependencies=protected_deps)
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

app.include_router(cliente_router, tags=["clientes"], dependencies=protected_deps)
app.include_router(config_router, tags=["configuracion"], dependencies=protected_deps)

app.include_router(pieza_router, tags=["piezas"], dependencies=protected_deps)
app.include_router(ot_pieza_router, tags=["ordenes_trabajo_piezas"], dependencies=protected_deps)
app.include_router(rango_router, tags=["rangos"], dependencies=protected_deps)
app.include_router(auditoria_router, tags=["auditoria"], dependencies=protected_deps)

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
    response.headers["Cache-Control"] = "no-store"
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

