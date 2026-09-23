"""RF-17: el historial de UNA OT y de UNA persona, dentro de Auditoría.

El SRS pide «repositorio centralizado de documentos históricos y registros de auditoría
de cada orden y cada operario». Julián lo quiso en Auditoría y no en la ficha: estos
tests arman una OT y una persona con una historia conocida y exigen que la línea de
tiempo que arma el servidor la cuente entera, una vez cada cosa y sin inventar autores:

  · lo del registro central (el pedido) y lo de la tabla del hecho (la pausa, el
    consumo) van UNA vez; del registro quedan los intentos que no se pudieron;
  · un guardado que tocó la cabecera y los pasos es UN renglón;
  · lo que cambió de la cabecera se lee del antes/después (desde el 23/09) o se deduce
    comparando con el guardado anterior, y el renglón lo dice;
  · cada sección se respeta: sin «Pasos de las OT» no van los pasos, sin
    «Planificaciones» no va el plan y sin «Rendimiento por persona» no va lo estimado
    contra lo que llevó cada paso.

Y lo que lo hace posible desde hoy: los guardados de la OT y de la persona dejan en el
registro qué cambió (antes y después, sin datos personales) y las altas quedan atadas a
lo que crearon.

CONTRA QUÉ BASE

SQLite en memoria siempre. Y, si está la variable SPMM_PG_PRUEBAS con la URL de un
Postgres DESCARTABLE en localhost, todo otra vez ahí: es donde se ven los errores de
dialecto que SQLite no reproduce (fechas que vuelven como texto, UUID, LIKE). Esa base se
BORRA ENTERA (DROP SCHEMA public CASCADE): por eso sólo se acepta localhost. Nunca
Supabase. Además, contra Postgres se aplica dos veces la migración del índice y se mira
que quede parcial y con su comentario. Cuánto ahorra ese índice con volumen de verdad se
midió aparte y está en el mensaje del commit.

    SPMM_PG_PRUEBAS=postgresql+asyncpg://yo@127.0.0.1:55473/spmm_rf17 pytest ...
"""
import json
import os
from datetime import date, datetime, time
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from backend.application import HistorialService as H
from backend.commons.handlers.exception_handlers import registrar_exception_handlers
from backend.core.permisos import DatosDePermisos, permisos_de
from backend.core.security import get_current_user, get_permisos_actuales
from backend.domain.Articulo import Articulo
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.AusenciaOperario import AusenciaOperario
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.IncidenciaProceso import IncidenciaProceso
from backend.domain.Operario import Operario
from backend.domain.OperarioRango import OperarioRango
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import PausaOrden
from backend.domain.Pieza import Pieza
from backend.domain.Planificacion import Planificacion
from backend.domain.Plano import Plano
from backend.domain.Prioridad import Prioridad
from backend.domain.Proceso import Proceso
from backend.domain.Rango import Rango
from backend.domain.Sector import Sector
from backend.infrastructure import auditoria_movimientos as auditoria
from backend.infrastructure import historial_cambios as hc
from backend.infrastructure.db import Base
from backend.infrastructure.migraciones import MIGRACIONES
from backend.presentation import AuditoriaAPI
from backend.tests.conftest import TEST_TABLES

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url: str) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


MOTORES = ["sqlite"] + (["postgres"] if PG_URL and _pg_seguro(PG_URL) else [])
MIGRACION_RF17 = dict(MIGRACIONES)["2026-09-23_historial_por_ot_y_persona"]

LUCAS = "Lucas Longchamps"
OT, OTP1, OTP2 = 1500, 11, 12
# Los lotes del plan son UUID (en SQLite, el tipo Uuid no lee otra cosa).
LOTE_SEPT = "5e0b7a1c-0000-4000-8000-000000000917"
LOTE_AGO = "5e0b7a1c-0000-4000-8000-000000000817"
d = datetime.fromisoformat


# ─────────────────────────── las piezas, sin base ───────────────────────────

def test_un_detalle_recortado_igual_dice_que_cambio():
    """El detalle se corta a 4000 caracteres; el antes y el después van primero para
    que un guardado con muchos pasos no se los lleve en el recorte."""
    fila = auditoria.armar_fila(
        usuario={"id_usuario": 1, "nombre": "Lucas", "apellido": "Longchamps"},
        metodo="PUT", ruta="/ordenes/1500", estado=200, duracion_ms=5,
        cuerpo={"procesos": [{"observaciones": "x" * 290, "i": i} for i in range(20)]},
        resumen={"frase": "editó la OT 15300: prioridad: Normal → Alta",
                 "antes": {"prioridad": "Normal"}, "despues": {"prioridad": "Alta"}},
    )
    assert len(fila.detalle) == auditoria.TOPE_DETALLE  # quedó recortado
    with pytest.raises(ValueError):
        json.loads(fila.detalle)
    leido = H.leer_detalle(fila.detalle)
    assert leido["antes"] == {"prioridad": "Normal"} and leido["despues"] == {"prioridad": "Alta"}
    assert fila.descripcion == "Lucas Longchamps editó la OT 15300: prioridad: Normal → Alta"


def test_el_alta_queda_atada_a_lo_que_creo_solo_si_salio_bien():
    base = dict(usuario={"id_usuario": 1, "nombre": "Lucas"}, metodo="POST", ruta="/ordenes",
                duracion_ms=5, resumen={"id_entidad": "2001", "frase": "creó la OT 15801"})
    bien = auditoria.armar_fila(estado=200, **base)
    assert bien.id_entidad == "2001" and bien.descripcion == "Lucas creó la OT 15801"
    mal = auditoria.armar_fila(estado=500, **base)
    assert mal.id_entidad is None and "(no se pudo: error 500)" in mal.descripcion
    # El número del camino manda sobre el que diga el endpoint.
    camino = auditoria.armar_fila(usuario=None, metodo="PUT", ruta="/ordenes/7", estado=200,
                                  duracion_ms=1, resumen={"id_entidad": "99"})
    assert camino.id_entidad == "7"


def test_los_datos_personales_no_se_copian_al_registro():
    antes = {"nombre": "Juan", "dni": "30111222", "disponible": "Activo"}
    despues = {"nombre": "Juan", "dni": "99999999", "disponible": "Ausente"}
    cambios = hc.diferencias(antes, despues, hc.ETIQUETAS_PERSONA, hc.PRIVADOS_PERSONA)
    assert {"campo": "estado", "antes": "Activo", "despues": "Ausente"} in cambios
    texto = json.dumps(cambios) + hc.frase_de_cambios(cambios)
    assert "30111222" not in texto and "99999999" not in texto
    assert "DNI (cambió)" in hc.frase_de_cambios(cambios)
    # Sin una de las dos fotos no se dice nada: decir «cambió» sin saber de qué a qué
    # sería inventar.
    assert hc.diferencias(None, despues, hc.ETIQUETAS_PERSONA) == []


def test_lo_que_cambio_se_deduce_comparando_con_el_guardado_anterior():
    filas = [
        {"id": 1, "salio_bien": True, "cuerpo": {"fecha_prometida": "2026-09-30T00:00:00", "id_prioridad": 1},
         "antes": None, "despues": None},
        {"id": 2, "salio_bien": False, "cuerpo": {"fecha_prometida": "2027-01-01T00:00:00"},
         "antes": None, "despues": None},  # no se pudo: no cuenta
        {"id": 3, "salio_bien": True, "cuerpo": {"fecha_prometida": "2026-10-05", "id_prioridad": 3},
         "antes": None, "despues": None},
        {"id": 4, "salio_bien": True, "cuerpo": {"fecha_prometida": "2026-10-05T00:00:00", "id_prioridad": 3},
         "antes": None, "despues": None},
        {"id": 5, "salio_bien": True, "cuerpo": None, "antes": None, "despues": None},  # recortado
    ]
    nombres = {("id_prioridad", 1): "Normal", ("id_prioridad", 3): "Urgente"}
    r = H.deducir_cambios(
        filas, normalizar=lambda c: {k: H._normalizar_ot(k, c[k]) for k in hc.ETIQUETAS_OT if k in c},
        legible=lambda k, v: H._legible_ot(k, v, nombres), etiquetas=hc.ETIQUETAS_OT)
    assert r[1][0] == [] and "primer guardado" in r[1][1]
    assert 2 not in r
    assert r[3][0] == ["fecha prometida: 30/09/2026 → 05/10/2026", "prioridad: Normal → Urgente"]
    assert "Deducido" in r[3][1]
    assert r[4] == ([], "Los datos quedaron igual que en el guardado anterior.")
    assert "recortado" in r[5][1]


def _paso(id_, cuando, accion="edicion", cambios=None, ruta="/ordenes/1500", metodo="PUT",
          origen="Guardado de la orden", descripcion=None, id_otp=OTP1):
    return {"id": id_, "creado_en": cuando, "id_usuario": 1, "usuario": LUCAS, "origen": origen,
            "id_orden_trabajo": OT, "id_otp": id_otp, "id_proceso": 100, "nombre_proceso": "TORNO CNC",
            "accion": accion, "paso": 1, "cambios": json.dumps(cambios) if cambios else None,
            "descripcion": descripcion or f"{accion} {id_}", "metodo": metodo, "ruta": ruta}


def test_los_pasos_de_un_mismo_guardado_son_un_renglon_y_las_pausas_no_van():
    estado = [{"campo": "estado", "antes": "Pendiente", "despues": "En Proceso"}]
    filas = [
        _paso(1, d("2026-09-18 12:00:00"), cambios=[{"campo": "minutos", "antes": "60", "despues": "90"}]),
        _paso(2, d("2026-09-18 12:00:00"), accion="alta"),
        _paso(3, d("2026-09-18 12:00:02"), accion="baja"),       # mismo pedido, 2 s después
        _paso(4, d("2026-09-18 15:00:00"), cambios=estado, ruta="/ordenes/1500/procesos/100/estado"),
        _paso(5, d("2026-09-18 16:00:00"), accion="pausa", ruta="/ordenes/1500/pausar", metodo="POST"),
        _paso(6, d("2026-09-01 08:00:00"), accion="alta", ruta="/ordenes", metodo="POST"),
        _paso(7, d("2026-09-01 08:00:00"), accion="alta", ruta="/ordenes", metodo="POST"),
    ]
    grupos = {g["id"]: g for g in H.grupos_de_pasos(filas)}
    assert set(grupos) == {"pasos-6", "pasos-1", "pasos-4"}
    assert grupos["pasos-1"]["titulo"] == "3 cambios en los pasos" and len(grupos["pasos-1"]["lineas"]) == 3
    assert grupos["pasos-4"]["tipo"] == "estado"
    assert grupos["pasos-6"]["tipo"] == "alta" and grupos["pasos-6"]["titulo"] == "cargó la OT con 2 pasos"


def test_el_pedido_y_sus_pasos_son_un_solo_renglon():
    def mov(id_, cuando, ruta, tipo, titulo=None, lineas=(), igual=False):
        m = {"id": id_, "creado_en": cuando, "usuario": LUCAS, "id_usuario": 1, "accion": "editó",
             "entidad": "orden de trabajo", "id_entidad": str(OT), "descripcion": f"{LUCAS} editó orden de trabajo #{OT}",
             "metodo": "PUT", "ruta": ruta, "estado": 200, "duracion_ms": 800, "detalle": None}
        return H.evento_de_movimiento(m, tipo, titulo=titulo, lineas=lineas, igual=igual)

    con_cambios = mov(1, d("2026-09-18 12:00:01"), "/ordenes/1500", "cabecera", "editó los datos de la OT 15300",
                      ["prioridad: Normal → Urgente"])
    sin_cambios = mov(2, d("2026-09-19 12:00:01"), "/ordenes/1500", "cabecera", "guardó la OT 15300", igual=True)
    del_estado = mov(3, d("2026-09-20 10:00:01"), "/ordenes/1500/procesos/100/estado", "estado")
    grupos = H.grupos_de_pasos([
        _paso(1, d("2026-09-18 12:00:00"), accion="alta", descripcion="agregó el paso 2 — FRESA"),
        _paso(2, d("2026-09-19 12:00:00"), accion="baja", descripcion="sacó el paso 3 — PINTURA"),
        _paso(3, d("2026-09-20 10:00:00"), ruta="/ordenes/1500/procesos/100/estado",
              cambios=[{"campo": "estado", "antes": "Pendiente", "despues": "En Proceso"}],
              descripcion="cambió el paso 1 — TORNO CNC: estado: Pendiente → En Proceso"),
        # Otro autor: no es el mismo pedido.
        {**_paso(4, d("2026-09-20 10:00:00"), accion="baja", ruta="/ordenes/1500/procesos/100/estado"),
         "id_usuario": 2, "usuario": "Sofía Ruiz"},
    ])
    libres = H.juntar_pasos_con_pedidos([con_cambios, sin_cambios, del_estado], grupos)
    assert con_cambios["lineas"] == ["prioridad: Normal → Urgente", "Pasos — agregó el paso 2 — FRESA"]
    assert sin_cambios["titulo"] == "sacó el paso 3 — PINTURA" and sin_cambios["tipo"] == "pasos"
    assert del_estado["titulo"] == "cambió el paso 1 — TORNO CNC: estado: Pendiente → En Proceso"
    assert [g["quien"] for g in libres] == ["Sofía Ruiz"]


def test_la_pausa_que_se_cierra_sola_lo_dice_y_la_abierta_tambien():
    pausas = [
        {"id": 1, "id_orden_trabajo": OT, "id_otp": OTP1, "paso": 1, "nombre_proceso": "TORNO CNC",
         "motivo": "MAQUINA_ROTA", "observacion": None, "desde": d("2026-09-15 09:00"), "hasta": d("2026-09-15 10:30"),
         "cierre": "PASO_TERMINADO", "usuario_pausa": LUCAS, "usuario_reanuda": None,
         "id_usuario_pausa": 1, "id_usuario_reanuda": None},
        {"id": 2, "id_orden_trabajo": OT, "id_otp": None, "paso": None, "nombre_proceso": None,
         "motivo": "OTRO", "observacion": "Se cortó la luz", "desde": d("2026-09-20 09:00"), "hasta": None,
         "cierre": None, "usuario_pausa": LUCAS, "usuario_reanuda": None,
         "id_usuario_pausa": 1, "id_usuario_reanuda": None},
    ]
    ev = {e["id"]: e for e in H.eventos_de_pausas(pausas)}
    assert ev["reanuda-1"]["titulo"] == "se cerró sola la pausa del paso 1 (TORNO CNC) al terminar el paso"
    assert ev["reanuda-1"]["quien"] is None  # la cerró el sistema: sin autor inventado
    assert ev["reanuda-1"]["lineas"] == ["Estuvo en pausa 1 h 30 min"]
    assert ev["pausa-2"]["lineas"] == ["Motivo: Se cortó la luz"] and ev["pausa-2"]["nota"] == "Sigue pausada."
    assert "reanuda-2" not in ev


def test_sin_autor_registrado_la_frase_es_impersonal():
    """Una pausa de antes de que se guardara quién (o un pedido sin usuario) no queda con
    un verbo colgando («Pausó la OT») ni con un autor inventado."""
    vieja = {"id": 3, "id_orden_trabajo": OT, "id_otp": None, "paso": None, "nombre_proceso": None,
             "motivo": "FALTA_MATERIAL", "observacion": None, "desde": d("2026-09-01 09:00"),
             "hasta": d("2026-09-01 10:00"), "cierre": "REANUDADA", "usuario_pausa": None,
             "usuario_reanuda": None, "id_usuario_pausa": None, "id_usuario_reanuda": None}
    ev = {e["id"]: e for e in H.eventos_de_pausas([vieja])}
    assert ev["pausa-3"]["titulo"] == "se pausó la OT" and ev["pausa-3"]["quien"] is None
    assert ev["reanuda-3"]["titulo"] == "se reanudó la OT"
    m = {"id": 9, "creado_en": d("2026-09-02 10:00"), "usuario": None, "id_usuario": None, "accion": "editó",
         "entidad": "orden de trabajo", "id_entidad": str(OT), "descripcion": f"alguien editó orden de trabajo #{OT}",
         "metodo": "PUT", "ruta": f"/ordenes/{OT}", "estado": 200, "duracion_ms": 5, "detalle": None}
    assert H.evento_de_movimiento(m, "cabecera")["titulo"] == f"alguien editó orden de trabajo #{OT}"
    assert H.evento_de_movimiento(m, "cabecera", titulo="guardó la OT 15300")["titulo"] == "alguien guardó la OT 15300"


# ─────────────────────────── la línea de tiempo entera, por la API ───────────────────────────

def _mov(cuando, ruta, *, metodo="PUT", accion="editó", entidad="orden de trabajo", id_entidad=str(OT),
         descripcion=None, estado=200, detalle=None, usuario=LUCAS, id_usuario=1):
    return AuditoriaMovimiento(
        creado_en=cuando, id_usuario=id_usuario, usuario=usuario, accion=accion, entidad=entidad,
        id_entidad=id_entidad, descripcion=descripcion or f"{usuario} {accion} {entidad} #{id_entidad}",
        metodo=metodo, ruta=ruta, estado=estado, duracion_ms=40,
        detalle=json.dumps(detalle, ensure_ascii=False) if detalle is not None else None)


def _paso_orm(cuando, *, accion="edicion", cambios=None, ruta=f"/ordenes/{OT}", metodo="PUT",
              origen="Guardado de la orden", descripcion="", id_otp=OTP1, proceso="TORNO CNC", paso=1):
    return AuditoriaProcesoOT(
        creado_en=cuando, id_usuario=1, usuario=LUCAS, origen=origen, id_orden_trabajo=OT, id_otp=id_otp,
        id_proceso=100, nombre_proceso=proceso, accion=accion, paso=paso,
        cambios=json.dumps(cambios, ensure_ascii=False) if cambios else None, descripcion=descripcion,
        metodo=metodo, ruta=ruta)


async def _sembrar(s):
    s.add_all([
        EstadoProceso(id=1, descripcion="Pendiente"), EstadoProceso(id=2, descripcion="En Proceso"),
        EstadoProceso(id=3, descripcion="Finalizado"),
        Prioridad(id=1, descripcion="Normal"), Prioridad(id=3, descripcion="Urgente"),
        Sector(id=1, nombre="MECANIZADO"),
        Articulo(id=42, cod_articulo="A42", descripcion="EJE 42", abreviatura="x"),
        Articulo(id=5, cod_articulo="A5", descripcion="BRIDA", abreviatura="x"),
        Cliente(id=999, nombre="ACME S.A."), Cliente(id=1, nombre="OTRO"),
        Proceso(id=100, nombre="TORNO CNC"), Proceso(id=101, nombre="FRESA"),
        Rango(id=1, nombre="TORNERO"),
        Operario(id=7, nombre="Juan", apellido="Perez", categoria="OFICIAL", disponible=True,
                 hora_inicio=time(7), hora_fin=time(16)),
        Operario(id=8, nombre="Ana", apellido="Gomez", categoria="OFICIAL", disponible=True,
                 hora_inicio=time(7), hora_fin=time(16)),
        Pieza(id=3, cod_pieza="P3", descripcion="CHAPA 3"),
    ])
    await s.flush()
    s.add(OperarioRango(id_operario=7, id_rango=1))
    s.add_all([
        OrdenTrabajo(id=OT, id_otvieja=15300, id_prioridad=1, id_sector=1, id_articulo=42, id_cliente=999,
                     unidades=10, fecha_orden=d("2026-09-01"), fecha_entrada=d("2026-09-01"),
                     fecha_prometida=d("2026-10-20")),
        OrdenTrabajo(id=77, id_otvieja=14000, id_prioridad=1, id_sector=1, id_articulo=5, id_cliente=1,
                     unidades=1, fecha_orden=d("2026-08-01"), fecha_entrada=d("2026-08-01"),
                     fecha_prometida=d("2026-08-20")),
    ])
    await s.flush()
    s.add_all([
        OrdenTrabajoProceso(id=OTP1, id_orden_trabajo=OT, id_proceso=100, orden=1, tiempo_proceso=120,
                            id_estado=3, cant_operarios=1, id_operario=7,
                            inicio_real=d("2026-09-15 08:00"), fin_real=d("2026-09-15 11:30")),
        OrdenTrabajoProceso(id=OTP2, id_orden_trabajo=OT, id_proceso=101, orden=2, tiempo_proceso=60,
                            id_estado=1, cant_operarios=1),
    ])
    await s.flush()

    s.add_all([
        # La OT: dos guardados viejos (sin antes/después) y uno nuevo.
        _mov(d("2026-09-16 10:00:02"), f"/ordenes/{OT}",
             detalle={"datos": {"fecha_prometida": "2026-09-30T00:00:00", "id_prioridad": 1, "id_cliente": 999}}),
        _mov(d("2026-09-18 12:00:01"), f"/ordenes/{OT}",
             detalle={"datos": {"fecha_prometida": "2026-10-05T00:00:00", "id_prioridad": 3, "id_cliente": 999}}),
        _mov(d("2026-09-22 09:00:01"), f"/ordenes/{OT}", descripcion=f"{LUCAS} editó la OT 15300: unidades: 10 → 12",
             detalle={"antes": {"unidades": "10"}, "despues": {"unidades": "12"}, "datos": {"unidades": 12}}),
        # La pausa: el pedido que salió bien es la misma que la de la tabla; el 409, no.
        _mov(d("2026-09-19 08:00:01"), f"/ordenes/{OT}/pausar", metodo="POST", accion="pausó",
             descripcion=f"{LUCAS} pausó la OT 15300: Falta material"),
        _mov(d("2026-09-19 08:05:00"), f"/ordenes/{OT}/pausar", metodo="POST", accion="pausó", estado=409,
             descripcion=f"{LUCAS} pausó orden de trabajo #{OT} (no se pudo: error 409)"),
        # Estado masivo: el número va en el cuerpo.
        _mov(d("2026-09-20 15:00:01"), "/ordenes/estado-masivo", id_entidad=None,
             entidad="orden de trabajo › estado masivo", detalle={"datos": {"orden_ids": [OT, 3, 4], "id_estado": 3}}),
        _mov(d("2026-09-20 15:30:00"), "/ordenes/estado-masivo", id_entidad=None,
             entidad="orden de trabajo › estado masivo", detalle={"datos": {"orden_ids": [3, 4], "id_estado": 3}}),
        # Un consumo que no se pudo cargar (y el que sí, que sale de su tabla).
        _mov(d("2026-09-21 10:00:00"), "/consumos-material", metodo="POST", accion="creó",
             entidad="consumo de material", id_entidad=None, estado=422,
             descripcion=f"{LUCAS} creó consumo de material (no se pudo: error 422)",
             detalle={"datos": {"id_orden_trabajo": OT, "id_pieza": 3, "cantidad": 0}}),
        _mov(d("2026-09-21 11:00:01"), "/consumos-material", metodo="POST", accion="creó",
             entidad="consumo de material", id_entidad=None,
             detalle={"datos": {"id_orden_trabajo": OT, "id_pieza": 3, "cantidad": 2.5}}),
        _mov(d("2026-09-21 12:00:01"), "/consumos-material/1/anular", entidad="consumo de material › anulación",
             id_entidad="1"),
        # Materia prima agregada a la lista de la OT.
        _mov(d("2026-09-14 09:00:00"), "/ordenes-trabajo-piezas", metodo="POST", accion="creó",
             entidad="materia prima de la OT", id_entidad=None,
             detalle={"datos": {"id_orden_trabajo": OT, "id_pieza": 3, "cantidad": 4, "unidad": "u"}}),
        # Una entrega.
        _mov(d("2026-09-22 16:00:00"), f"/ordenes/{OT}/entrega", entidad="orden de trabajo › fecha de entrega",
             detalle={"datos": {"cantidad_agregar": 5}}),
        # La no conformidad la cerró Lucas.
        _mov(d("2026-09-22 14:00:01"), "/incidencias/900/cerrar", entidad="incidencia", id_entidad="900"),
        # Otra OT: no aparece.
        _mov(d("2026-09-18 12:00:01"), "/ordenes/77", id_entidad="77"),

        # La persona 7.
        _mov(d("2026-09-01 08:00:00"), "/operarios", metodo="POST", accion="creó", entidad="persona",
             id_entidad=None, descripcion=f"{LUCAS} creó persona — Juan Perez"),
        _mov(d("2026-09-17 07:30:01"), "/operarios/7", entidad="persona", id_entidad="7",
             descripcion=f"{LUCAS} editó a Juan Perez: estado: Activo → Ausente",
             detalle={"antes": {"estado": "Activo"}, "despues": {"estado": "Ausente"}}),
        _mov(d("2026-09-17 09:00:00"), "/operarios/7/skills/100/estado", entidad="persona › capacidades",
             id_entidad="7", detalle={"datos": {"habilitado": False}}),
        _mov(d("2026-09-10 11:00:01"), "/operarios/7/ausencias", metodo="POST", accion="creó",
             entidad="persona › ausencias", id_entidad="7",
             descripcion=f"{LUCAS} cargó una ausencia a Juan Perez del 01/09 al 03/09 (vacaciones)"),
        # Otra persona: no aparece.
        _mov(d("2026-09-17 07:30:01"), "/operarios/8", entidad="persona", id_entidad="8"),
    ])
    s.add_all([
        _paso_orm(d("2026-09-18 12:00:00"), cambios=[{"campo": "persona elegida", "antes": None, "despues": "Juan Perez"}],
                  descripcion="cambió el paso 1 — TORNO CNC: persona elegida: — → Juan Perez"),
        _paso_orm(d("2026-09-18 12:00:00"), accion="alta", id_otp=OTP2, proceso="FRESA", paso=2,
                  descripcion="agregó el paso 2 — FRESA"),
        _paso_orm(d("2026-09-20 15:00:00"), ruta="/ordenes/estado-masivo", origen="Varias OT a la vez",
                  cambios=[{"campo": "estado", "antes": "En Proceso", "despues": "Finalizado"}],
                  descripcion="cambió el paso 1 — TORNO CNC: estado: En Proceso → Finalizado"),
        _paso_orm(d("2026-09-19 08:00:00"), accion="pausa", ruta=f"/ordenes/{OT}/pausar", metodo="POST",
                  origen="Pausar", descripcion="pausó la OT: Falta material", id_otp=None),
    ])
    s.add_all([
        PausaOrden(id_orden_trabajo=OT, id_otp=None, motivo="FALTA_MATERIAL", desde=d("2026-09-19 08:00"),
                   hasta=d("2026-09-19 12:00"), cierre="REANUDADA", usuario_pausa=LUCAS, usuario_reanuda=LUCAS),
        PausaOrden(id_orden_trabajo=OT, id_otp=OTP1, paso=1, nombre_proceso="TORNO CNC", motivo="MAQUINA_ROTA",
                   desde=d("2026-09-15 09:00"), hasta=d("2026-09-15 10:00"), cierre="PASO_TERMINADO",
                   usuario_pausa=LUCAS),
        ConsumoMaterial(id=1, id_orden_trabajo=OT, id_pieza=3, cantidad=2.5, unidad="kg", fecha=d("2026-09-21 11:00"),
                        usuario=LUCAS, anulado=1, anulado_en=d("2026-09-21 12:00"), anulado_por=LUCAS,
                        motivo_anulacion="se cargó dos veces"),
        IncidenciaProceso(id=900, id_orden_trabajo=OT, id_proceso=100, id_operario=7,
                          tipo="MEDIDA_FUERA_DE_TOLERANCIA", gravedad="MEDIA", estado="CERRADA",
                          minutos_perdidos=45, usuario=LUCAS, fecha_registro=d("2026-09-22 10:00"),
                          fecha_cierre=d("2026-09-22 14:00"), accion_correctiva="se rehízo"),
        # Subido desde la app (utcnow: 3 h adelantado) y desde el importador de Drive (hora local).
        Plano(id=77, nombre="15300.pdf", tipo_archivo="pdf", fecha_subida=d("2026-09-16 13:00"), id_orden_trabajo=OT),
        Plano(id=78, nombre="EJE42.pdf", tipo_archivo="pdf", fecha_subida=d("2026-09-09 10:00"), id_articulo=42,
              drive_file_id="abc"),
        AusenciaOperario(id_operario=7, desde=date(2026, 9, 1), vuelve=date(2026, 9, 4), motivo="VACACIONES",
                         origen="CARGA", cargada_en=d("2026-09-10 11:00"), usuario_carga=LUCAS),
        AusenciaOperario(id_operario=7, desde=date(2026, 9, 17), vuelve=date(2026, 9, 18), motivo="ENFERMEDAD",
                         origen="ESTADO", cargada_en=d("2026-09-17 07:30"), usuario_carga=LUCAS,
                         cerrada_en=d("2026-09-18 07:10"), usuario_cierre=LUCAS),
        Planificacion(orden_id=OT, proceso_id=100, id_orden_trabajo_proceso=OTP1, id_operario=7, inicio_min=0,
                      fin_min=120, duracion_min=120, prioridad_peso=1, nombre_proceso="TORNO CNC",
                      id_planificacion_lote=LOTE_SEPT, descripcion_lote="Planificación septiembre 2026",
                      creado_en=d("2026-09-14 17:00")),
    ])
    await s.flush()
    # Las dos tablas del plan que se crean con SQL a mano (sin modelo). En Postgres, con
    # el DDL de producción (el id es SERIAL y el lote, UUID).
    if s.bind.dialect.name == "postgresql":
        await s.execute(text("CREATE TABLE planificacion_intento (id SERIAL PRIMARY KEY, creado_en TIMESTAMP "
                             "NOT NULL, tipo VARCHAR(20) NOT NULL, ordenes_ids TEXT, id_planificacion_lote UUID, "
                             "id_usuario INTEGER, usuario VARCHAR(120))"))
        await s.execute(text("CREATE TABLE planificacion_borrada (id SERIAL PRIMARY KEY, id_planificacion_lote UUID, "
                             "descripcion_lote VARCHAR(200), alcance VARCHAR(20) NOT NULL, orden_ids TEXT, "
                             "borrado_en TIMESTAMP NOT NULL, id_usuario INTEGER, usuario VARCHAR(120))"))
    else:
        await s.execute(text("CREATE TABLE planificacion_intento (id INTEGER PRIMARY KEY, creado_en TIMESTAMP, "
                             "tipo VARCHAR(20), ordenes_ids TEXT, id_planificacion_lote VARCHAR(40), "
                             "id_usuario INTEGER, usuario VARCHAR(120))"))
        await s.execute(text("CREATE TABLE planificacion_borrada (id INTEGER PRIMARY KEY, id_planificacion_lote "
                             "VARCHAR(40), descripcion_lote VARCHAR(200), alcance VARCHAR(20), orden_ids TEXT, "
                             "borrado_en TIMESTAMP, id_usuario INTEGER, usuario VARCHAR(120))"))
    await s.execute(text("INSERT INTO planificacion_intento (creado_en, tipo, ordenes_ids, id_planificacion_lote, "
                         "id_usuario, usuario) VALUES (:creado, 'confirmar', '1500', :lote, 1, "
                         "'Lucas Longchamps')"), {"lote": LOTE_SEPT, "creado": d("2026-09-14 17:00:05")})
    await s.execute(text("INSERT INTO planificacion_borrada (id_planificacion_lote, descripcion_lote, alcance, "
                         "orden_ids, borrado_en, usuario) VALUES (:lote, 'Planificación agosto 2026', "
                         "'ordenes', '[1500]', :borrado, 'Lucas Longchamps')"),
                    {"lote": LOTE_AGO, "borrado": d("2026-09-13 09:00:00")})
    await s.commit()


def _permisos(*, pasos=True, plan=True, rendimiento=False, ausencias=True):
    """Un rol «auditor» con Auditoría en ver y las solapas que se pidan. `ausencias`: le
    da también Recursos en ver, que es lo que pide leer las ausencias afuera (política
    'asistencia'); sin eso el historial de la persona no las manda (revisión del 23/09)."""
    secciones = {}
    if not pasos:
        secciones["auditoria_procesos"] = "none"
    if not plan:
        secciones["auditoria_planificacion"] = "none"
    areas = {"auditoria": "read"}
    if ausencias:
        areas["recursos"] = "read"
    return permisos_de(DatosDePermisos(
        rol="auditor", rol_areas=areas, rol_secciones=secciones,
        usuario_secciones={"dashboard_rendimiento": "read"} if rendimiento else {},
    ), 5, "auditor")


@pytest_asyncio.fixture(params=MOTORES)
async def base(request):
    motor = request.param
    if motor == "postgres":
        engine = create_async_engine(PG_URL, poolclass=NullPool)
    else:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                     connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        if motor == "postgres":
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=TEST_TABLES + [AuditoriaMovimiento.__table__]))
        if motor == "postgres":
            # La migración de RF-17, dos veces: tiene que ser idempotente.
            for _ in range(2):
                for sentencia in MIGRACION_RF17:
                    await conn.execute(text(sentencia))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Sesion() as s:
        await _sembrar(s)
    Sesion.motor = motor
    yield Sesion
    await engine.dispose()


@pytest_asyncio.fixture
async def api(base):
    """La API de Auditoría con permisos que cada test cambia (`api.permisos = ...`)."""
    async def _db():
        async with base() as s:
            yield s

    app = FastAPI()
    registrar_exception_handlers(app)
    app.include_router(AuditoriaAPI.router)
    app.dependency_overrides[AuditoriaAPI.get_db] = _db
    app.dependency_overrides[get_current_user] = lambda: {"id_usuario": 5, "username": "auditor"}
    estado = {"permisos": _permisos()}
    app.dependency_overrides[get_permisos_actuales] = lambda: estado["permisos"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        c.estado = estado
        yield c


async def _historial(api, que, id_, **params):
    r = await api.get(f"/auditoria/historial/{que}/{id_}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _por_titulo(datos, empieza):
    return [e for e in datos["eventos"] if e["titulo"].startswith(empieza)]


async def test_la_ot_cuenta_todo_una_vez_y_lo_ultimo_primero(api):
    h = await _historial(api, "ordenes", OT)
    assert h["orden"]["numero"] == 15300 and h["orden"]["cliente"] == "ACME S.A."
    # Ninguna lectura se cayó (cada una va en un SAVEPOINT y, si falla, sólo avisa).
    assert h["avisos"] == []
    cuandos = [e["cuando"] for e in h["eventos"]]
    assert cuandos == sorted(cuandos, reverse=True)
    assert h["total"] == len(h["eventos"]) and not h["recortado"]
    assert {t["tipo"] for t in h["tipos"]} >= {"cabecera", "estado", "pausas", "consumos", "materia_prima",
                                               "no_conformidades", "planos", "entregas", "plan"}
    # Nada de otra OT ni de ninguna persona.
    assert not [e for e in h["eventos"] if "#77" in e["titulo"] or "persona" in e["titulo"]]

    # La pausa: una vez (de su tabla, con el motivo) y el intento que no se pudo, aparte.
    pausas = [e for e in h["eventos"] if e["tipo"] == "pausas"]
    assert [(e["titulo"], e["salio_bien"]) for e in pausas] == [
        ("reanudó la OT", True),
        (f"pausó orden de trabajo #{OT} (no se pudo: error 409)", False),
        ("pausó la OT", True),
        ("se cerró sola la pausa del paso 1 (TORNO CNC) al terminar el paso", True),
        ("pausó el paso 1 (TORNO CNC)", True),
    ]
    assert _por_titulo(h, "pausó la OT")[0]["lineas"] == ["Motivo: Falta material"]

    # El consumo: el alta y la anulación de su tabla, el intento fallido del registro.
    consumos = [(e["titulo"], e["fuente"]) for e in h["eventos"] if e["tipo"] == "consumos"]
    assert consumos == [
        ("anuló el consumo de 2,5 kg de CHAPA 3", "Consumos"),
        ("registró un consumo de 2,5 kg de CHAPA 3", "Consumos"),
        ("creó consumo de material (no se pudo: error 422)", "Registro"),
    ]
    assert _por_titulo(h, "agregó a la lista de materia prima: CHAPA 3 (4 u)")


async def test_la_cabecera_dice_que_cambio_y_si_lo_dedujo(api):
    h = await _historial(api, "ordenes", OT)
    nuevo = _por_titulo(h, "editó los datos de la OT 15300")
    assert nuevo[0]["lineas"] == ["unidades: 10 → 12"] and not nuevo[0]["deducido"]
    # El guardado viejo del 18/09 cambió fecha y prioridad Y los pasos: un renglón.
    viejo = nuevo[1]
    assert viejo["cuando"].startswith("2026-09-18T12:00")
    assert viejo["lineas"] == [
        "fecha prometida: 30/09/2026 → 05/10/2026",
        "prioridad: Normal → Urgente",
        "Pasos — cambió el paso 1 — TORNO CNC: persona elegida: — → Juan Perez",
        "Pasos — agregó el paso 2 — FRESA",
    ]
    assert viejo["deducido"] and viejo["fuente"] == "Registro y pasos"
    primero = _por_titulo(h, "guardó la OT 15300")
    assert len(primero) == 1 and "primer guardado" in primero[0]["nota"]
    # El estado masivo que la incluía, con sus pasos adentro.
    masivo = _por_titulo(h, "marcó todos los pasos como Terminado")
    assert len(masivo) == 1
    assert masivo[0]["titulo"] == "marcó todos los pasos como Terminado (junto con 2 OT más)"
    assert masivo[0]["lineas"] == ["cambió el paso 1 — TORNO CNC: estado: En Proceso → Finalizado"]
    assert _por_titulo(h, "registró una entrega de 5 unidades")


async def test_los_hechos_de_otras_tablas_con_su_autor_y_su_hora(api):
    h = await _historial(api, "ordenes", OT)
    cierre = _por_titulo(h, "cerró la no conformidad #900")
    assert len(cierre) == 1 and cierre[0]["quien"] == LUCAS
    assert cierre[0]["lineas"] == ["Acción correctiva: se rehízo"]
    assert not _por_titulo(h, "se cerró la no conformidad")  # no va dos veces
    alta_nc = _por_titulo(h, "registró la no conformidad #900")[0]
    assert "Persona: Juan Perez" in alta_nc["lineas"] and alta_nc["quien"] == LUCAS
    # El plano que subió la app se guardó en UTC: va 3 h antes. El de Drive, como está.
    planos = {e["titulo"]: e for e in h["eventos"] if e["tipo"] == "planos"}
    assert planos["se subió el plano «15300.pdf»"]["cuando"] == "2026-09-16T10:00:00"
    assert planos["se subió el plano «EJE42.pdf» del artículo"]["cuando"] == "2026-09-09T10:00:00"
    # Sin autor registrado, la frase es impersonal: nunca un autor inventado.
    assert all(e["quien"] is None for e in planos.values())
    # El plan: quién lo confirmó (del intento) y quién la sacó de otro.
    plan = _por_titulo(h, "confirmó el plan «Planificación septiembre 2026», con 1 paso de esta OT")[0]
    assert plan["quien"] == LUCAS and plan["lineas"] == ["TORNO CNC — Juan Perez"]
    assert _por_titulo(h, "sacó la OT del plan «Planificación agosto 2026»")[0]["quien"] == LUCAS
    # El alta no quedó registrada: lo dice la propia OT, sin autor.
    alta = [e for e in h["eventos"] if e["tipo"] == "alta"]
    assert len(alta) == 1 and alta[0]["quien"] is None and alta[0]["fuente"] == "Datos de la OT"


async def test_el_filtro_de_fechas_se_hace_en_el_servidor(api):
    h = await _historial(api, "ordenes", OT, desde="2026-09-19", hasta="2026-09-19")
    assert [e["tipo"] for e in h["eventos"]] == ["pausas", "pausas", "pausas"]
    assert h["desde"] == "2026-09-19" and h["hasta"] == "2026-09-19"
    r = await api.get(f"/auditoria/historial/ordenes/{OT}", params={"desde": "2026-09-20", "hasta": "2026-09-01"})
    assert r.status_code == 400
    r = await api.get("/auditoria/historial/ordenes/424242")
    assert r.status_code == 404


async def test_sin_la_seccion_de_pasos_ni_la_del_plan_no_van(api):
    api.estado["permisos"] = _permisos(pasos=False, plan=False)
    h = await _historial(api, "ordenes", OT)
    assert not [e for e in h["eventos"] if e["tipo"] == "plan"]
    assert not [l for e in h["eventos"] for l in e["lineas"] if "Pasos —" in l or "cambió el paso" in l]
    assert {o["que"] for o in h["ocultos"]} == {"pasos", "plan"}
    # Lo del registro central sigue: es la sección que sí tiene.
    assert _por_titulo(h, "marcó todos los pasos como Terminado")[0]["lineas"] == []
    assert _por_titulo(h, "editó los datos de la OT 15300")


async def test_la_persona_cuenta_su_ficha_sus_ausencias_y_su_trabajo(api):
    h = await _historial(api, "personas", 7)
    assert h["avisos"] == []
    assert h["persona"] == {"id": 7, "nombre": "Juan Perez", "categoria": "OFICIAL", "sector": None,
                            "activo": True, "dada_de_baja": False, "baja": None}
    cuandos = [e["cuando"] for e in h["eventos"]]
    assert cuandos == sorted(cuandos, reverse=True)
    assert not [e for e in h["eventos"] if "#8" in e["titulo"]]

    alta = [e for e in h["eventos"] if e["tipo"] == "alta"]
    assert alta[0]["titulo"] == "dio de alta a Juan Perez" and alta[0]["deducido"]
    assert "por el nombre" in alta[0]["nota"]

    # Pasar a Ausente: el pedido y la ausencia que abrió son UN renglón.
    ficha = _por_titulo(h, "editó la ficha de Juan Perez")
    assert len(ficha) == 1
    assert ficha[0]["lineas"] == ["estado: Activo → Ausente", "Motivo: Enfermedad",
                                  "Quedó registrada la ausencia el 17/09/2026"]
    assert _por_titulo(h, "volvió a poner a Juan Perez como Activo")[0]["lineas"] == ["Faltó el 17/09/2026"]
    # La ausencia cargada a mano: el renglón del pedido, con el motivo de la tabla.
    cargas = [e for e in h["eventos"] if e["tipo"] == "ausencias" and "01/09" in e["titulo"]]
    assert len(cargas) == 1 and cargas[0]["fuente"] == "Registro y ausencias"

    assert _por_titulo(h, "deshabilitó la habilidad TORNO CNC")[0]["tipo"] == "habilidades"
    asignacion = _por_titulo(h, "le asignó el paso 1 — TORNO CNC de la OT 15300")[0]
    assert asignacion["quien"] == LUCAS and asignacion["ot"] == {"id": OT, "numero": 15300}
    assert _por_titulo(h, "arrancó el paso 1 — TORNO CNC de la OT 15300")[0]["quien"] is None
    termino = _por_titulo(h, "terminó el paso 1 — TORNO CNC de la OT 15300")[0]
    assert termino["lineas"] == []  # lo estimado contra lo real es de otra sección
    assert _por_titulo(h, "pausó el paso 1 (TORNO CNC) de la OT 15300")
    nc = _por_titulo(h, "registró una no conformidad de la OT 15300 en la que figura")
    assert len(nc) == 1 and "Persona: Juan Perez" not in nc[0]["lineas"]
    assert _por_titulo(h, "cerró la no conformidad #900 de la OT 15300")[0]["quien"] == LUCAS
    assert _por_titulo(h, "confirmó el plan «Planificación septiembre 2026», que le dio 1 paso en 1 OT")
    assert {o["que"] for o in h["ocultos"]} == {"rendimiento"}


async def test_lo_estimado_contra_lo_real_pide_rendimiento_por_persona(api):
    api.estado["permisos"] = _permisos(rendimiento=True)
    h = await _historial(api, "personas", 7)
    assert h["avisos"] == []
    termino = _por_titulo(h, "terminó el paso 1 — TORNO CNC de la OT 15300")[0]
    assert termino["lineas"][0] == "Estimado: 2 h"
    assert termino["lineas"][1].startswith("Efectivo: ")
    assert not h["ocultos"]

    api.estado["permisos"] = _permisos(pasos=False, plan=False)
    h = await _historial(api, "personas", 7)
    assert not [e for e in h["eventos"] if e["tipo"] in ("asignaciones", "plan")]
    assert {o["que"] for o in h["ocultos"]} == {"pasos", "plan", "rendimiento"}


async def test_sin_recursos_ni_operaciones_las_ausencias_no_se_mandan(api):
    """Revisión del 23/09: las ausencias (motivo ENFERMEDAD, la observación) se leen
    afuera con Recursos u Operaciones. Quien tiene sólo Auditoría no las recibe por acá:
    ni los renglones de la tabla, ni los pedidos que las cargaron, ni el motivo en
    ninguna parte de la respuesta. Y la pantalla dice que hay algo que no se muestra."""
    api.estado["permisos"] = _permisos(ausencias=False)
    r = await api.get("/auditoria/historial/personas/7")
    assert r.status_code == 200, r.text
    h = r.json()
    assert not [e for e in h["eventos"] if e["tipo"] == "ausencias"]
    assert "ausencia" not in json.dumps([e for e in h["eventos"]], ensure_ascii=False).lower()
    assert "enfermedad" not in r.text.lower()
    assert "ausencias" in {o["que"] for o in h["ocultos"]}
    # Lo demás de la persona sigue: su ficha, su alta y lo que trabajó.
    assert [e for e in h["eventos"] if e["tipo"] == "alta"]
    assert _por_titulo(h, "terminó el paso 1 — TORNO CNC de la OT 15300")

    # Con Operaciones (sin Recursos) también se ven: es la misma regla de afuera.
    api.estado["permisos"] = permisos_de(DatosDePermisos(
        rol="auditor", rol_areas={"auditoria": "read", "operaciones": "read"}), 5, "auditor")
    h = await _historial(api, "personas", 7)
    assert [e for e in h["eventos"] if e["tipo"] == "ausencias"]
    assert "ausencias" not in {o["que"] for o in h["ocultos"]}


async def test_la_migracion_deja_el_indice_parcial_con_su_comentario(base):
    """Sólo en Postgres (SQLite no tiene COMMENT ni índices parciales iguales): la
    migración corrió dos veces en el fixture sin error, y el índice quedó parcial."""
    if base.motor != "postgres":
        pytest.skip("sólo contra el Postgres descartable (SPMM_PG_PRUEBAS)")
    async with base() as s:
        definicion = (await s.execute(text(
            "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_auditoria_mov_sin_numero'"))).scalar()
        comentario = (await s.execute(text(
            "SELECT obj_description('ix_auditoria_mov_sin_numero'::regclass, 'pg_class')"))).scalar()
    assert "(ruta, creado_en)" in definicion and "WHERE (id_entidad IS NULL)" in definicion
    assert comentario.startswith("RF-17:")


async def test_la_ot_15_no_trae_lo_de_la_1500(base):
    """Las filas con el número en el cuerpo se buscan por el número entero, no por un
    pedazo: «15» no es «1500» ni «150». Con el LIKE de la base de verdad (SQLite y, si
    está, Postgres)."""
    datos = json.dumps({"datos": {"id_orden_trabajo": 1500, "id_pieza": 15}}, ensure_ascii=False)
    masivo = json.dumps({"datos": {"orden_ids": [3, 15], "id_estado": 3}}, ensure_ascii=False)
    solo = json.dumps({"datos": {"orden_ids": [150]}}, ensure_ascii=False)

    async def coincide(texto, n):
        async with base() as s:
            for patron in H.patrones_del_numero(n):
                if (await s.execute(text("SELECT :t LIKE :p"), {"t": texto, "p": patron})).scalar():
                    return True
        return False

    assert await coincide(datos, 1500) and not await coincide(datos, 150)
    assert await coincide(masivo, 15) and await coincide(masivo, 3) and not await coincide(masivo, 1)
    assert await coincide(solo, 150) and not await coincide(solo, 15)


async def test_los_buscadores(api):
    r = await api.get("/auditoria/historial/ordenes", params={"buscar": "15300"})
    assert [o["numero"] for o in r.json()["ordenes"]] == [15300]
    r = await api.get("/auditoria/historial/ordenes", params={"buscar": "acme"})
    assert r.json()["ordenes"][0] == {"id": OT, "numero": 15300, "cliente": "ACME S.A.", "articulo": "EJE 42",
                                      "fecha_prometida": "2026-10-20T00:00:00", "terminada": False}
    r = await api.get("/auditoria/historial/ordenes")
    assert [o["id"] for o in r.json()["ordenes"]] == [OT, 77]  # las últimas cargadas
    r = await api.get("/auditoria/historial/personas", params={"buscar": "per"})
    assert [p["nombre"] for p in r.json()["personas"]] == ["Juan Perez"]
    r = await api.get("/auditoria/historial/personas/999")
    assert r.status_code == 404


# ─────────────────────────── los guardados dejan dicho qué cambió ───────────────────────────

@pytest_asyncio.fixture
async def app_real(base, monkeypatch):
    """Los endpoints de verdad (OT y persona) con el middleware de verdad, sobre SQLite:
    lo que el registro guarda al editar una OT o una persona."""
    from starlette.middleware.base import BaseHTTPMiddleware

    from backend.core.security import create_access_token
    from backend.presentation import OperarioAPI, OrdenTrabajoAPI, main

    monkeypatch.setattr(main, "SessionLocal", base)

    async def _db():
        async with base() as s:
            yield s

    app = FastAPI()
    registrar_exception_handlers(app)
    app.add_middleware(BaseHTTPMiddleware, dispatch=main.auditar_movimientos)
    app.include_router(OrdenTrabajoAPI.router)
    app.include_router(OperarioAPI.router)
    # Y Auditoría, para ver lo que contesta sobre lo guardado (con los permisos del admin).
    app.include_router(AuditoriaAPI.router)
    app.dependency_overrides[OrdenTrabajoAPI.get_db] = _db
    app.dependency_overrides[OperarioAPI.get_db] = _db
    app.dependency_overrides[AuditoriaAPI.get_db] = _db
    app.dependency_overrides[get_permisos_actuales] = lambda: permisos_de(
        DatosDePermisos(rol="admin"), 1, "lucas")
    app.dependency_overrides[get_current_user] = lambda: {"id_usuario": 1, "username": "lucas",
                                                          "nombre": "Lucas", "apellido": "Longchamps"}
    token = create_access_token({"sub": "lucas", "id_usuario": 1, "nombre": "Lucas", "apellido": "Longchamps"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t",
                           headers={"Authorization": f"Bearer {token}"}) as c:
        c.sesiones = base
        yield c


async def _ultima(sesiones, ruta, metodo):
    async with sesiones() as s:
        return (await s.execute(select(AuditoriaMovimiento).where(
            AuditoriaMovimiento.ruta == ruta, AuditoriaMovimiento.metodo == metodo)
            .order_by(AuditoriaMovimiento.id.desc()).limit(1))).scalar_one()


async def test_guardar_la_ot_deja_el_antes_y_el_despues_legibles(app_real):
    r = await app_real.put(f"/ordenes/{OT}", json={"fecha_prometida": "2026-11-02T00:00:00", "id_prioridad": 3})
    assert r.status_code == 200, r.text
    fila = await _ultima(app_real.sesiones, f"/ordenes/{OT}", "PUT")
    assert fila.descripcion == ("Lucas Longchamps editó la OT 15300: fecha prometida: 20/10/2026 → "
                                "02/11/2026; prioridad: Normal → Urgente")
    detalle = json.loads(fila.detalle)
    assert detalle["antes"] == {"fecha prometida": "20/10/2026", "prioridad": "Normal"}
    assert detalle["despues"] == {"fecha prometida": "02/11/2026", "prioridad": "Urgente"}
    assert list(detalle)[:2] == ["antes", "despues"]

    # Guardar sin cambiar nada: antes y después vacíos («quedó igual»), la frase de siempre.
    await app_real.put(f"/ordenes/{OT}", json={"fecha_prometida": "2026-11-02T00:00:00"})
    fila = await _ultima(app_real.sesiones, f"/ordenes/{OT}", "PUT")
    assert json.loads(fila.detalle)["antes"] == {} and fila.descripcion.endswith(f"#{OT}")


async def test_guardar_la_persona_no_copia_el_dni_y_dice_los_rangos(app_real):
    r = await app_real.put("/operarios/7", json={
        "nombre": "Juan", "apellido": "Perez", "categoria": "OFICIAL", "disponible": False,
        "dni": "30999888", "hora_inicio": "07:00", "hora_fin": "16:00"})
    assert r.status_code == 200, r.text
    fila = await _ultima(app_real.sesiones, "/operarios/7", "PUT")
    detalle = json.loads(fila.detalle)
    assert detalle["antes"]["estado"] == "Activo" and detalle["despues"]["estado"] == "Ausente"
    assert detalle["antes"]["DNI"] == hc.OCULTO == detalle["despues"]["DNI"]
    assert "30999888" not in fila.descripcion and "30999888" not in json.dumps(detalle["despues"])
    assert fila.descripcion.startswith("Lucas Longchamps editó a Juan Perez: estado: Activo → Ausente")


async def test_ningun_dato_personal_queda_en_el_detalle_ni_en_la_respuesta(app_real):
    """Revisión del 23/09: `antes`/`despues` tapaban el DNI, pero el cuerpo del pedido se
    guardaba entero en `detalle.datos`, y /auditoria/movimientos lo devolvía. Ahora se
    busca cada dato en TODA la fila (y en lo que contesta Auditoría), no en una clave."""
    privados = {"dni": "30999888", "telefono": "11-5555-4444", "celular": "11-4444-3333",
                "email": "juan.perez@correo.com", "fecha_nacimiento": "1990-05-15"}
    r = await app_real.put("/operarios/7", json={
        "nombre": "Juan", "apellido": "Perez", "categoria": "OFICIAL", "disponible": True,
        "hora_inicio": "07:00", "hora_fin": "16:00", **privados})
    assert r.status_code == 200, r.text
    r = await app_real.post("/operarios", json={
        "nombre": "Rita", "apellido": "Luz", "categoria": "OFICIAL",
        "dni": "27111222", "celular": "11-3333-2222"})
    assert r.status_code == 200, r.text
    nuevo = r.json()["data"]["id"]

    edicion = await _ultima(app_real.sesiones, "/operarios/7", "PUT")
    alta = await _ultima(app_real.sesiones, "/operarios", "POST")
    for fila, valores in ((edicion, privados.values()), (alta, ("27111222", "11-3333-2222"))):
        entera = " ".join(str(v) for v in (fila.descripcion, fila.detalle, fila.usuario, fila.ruta))
        for valor in valores:
            assert valor not in entera, (fila.ruta, valor)
        datos = json.loads(fila.detalle)["datos"]
        # Se sabe QUE se mandó (la clave queda), no QUÉ.
        assert datos["dni"] == hc.OCULTO
        # Lo que no es privado sigue: el registro sirve para saber qué se guardó.
        assert datos["nombre"] in ("Juan", "Rita") and datos["categoria"] == "OFICIAL"
    assert json.loads(edicion.detalle)["datos"]["fecha_nacimiento"] == hc.OCULTO

    # Y lo que contesta Auditoría, en las dos puertas.
    for ruta in ("/auditoria/movimientos", "/auditoria/movimientos/de/persona/7",
                 f"/auditoria/movimientos/de/persona/{nuevo}"):
        r = await app_real.get(ruta)
        assert r.status_code == 200, (ruta, r.text)
        for valor in (*privados.values(), "27111222", "11-3333-2222"):
            assert valor not in r.text, (ruta, valor)


async def test_el_alta_de_una_persona_queda_atada_a_su_numero(app_real):
    r = await app_real.post("/operarios", json={"nombre": "Rita", "apellido": "Luz", "categoria": "OFICIAL"})
    assert r.status_code == 200, r.text
    fila = await _ultima(app_real.sesiones, "/operarios", "POST")
    assert fila.id_entidad == str(r.json()["data"]["id"])
    assert fila.descripcion == "Lucas Longchamps dio de alta a Rita Luz"


# ─────────────────────────── alta, cambio de nombre y baja (RF-17) ───────────────────────────
#
# Julián, en la reunión con Lucas: el historial tiene que registrar el ALTA, la BAJA y el
# CAMBIO DE NOMBRE de cada persona. Una persona dada de baja ya no tiene fila en
# `operario`: se la sigue pudiendo elegir y su línea de tiempo sale entera, con el nombre
# que quedó en el registro.

def _fila(id_, cuando, ruta, metodo, *, estado=200, detalle=None, descripcion="", usuario=LUCAS):
    return {"id": id_, "creado_en": d(cuando), "usuario": usuario, "id_usuario": 1, "metodo": metodo,
            "ruta": ruta, "estado": estado, "descripcion": descripcion,
            "detalle": json.dumps(detalle, ensure_ascii=False) if detalle is not None else None}


def test_la_historia_de_la_persona_dice_como_se_llamaba_en_cada_momento():
    movs = [
        # Un alta de antes del 23/09: sin cuerpo legible, el nombre sale de la frase.
        _fila(1, "2026-09-01 08:00", "/operarios", "POST", descripcion=f"{LUCAS} creó persona — Juan Perez"),
        # Un guardado viejo (sin antes/después): el cambio se deduce contra el alta.
        _fila(2, "2026-09-10 08:00", "/operarios/9", "PUT",
              detalle={"datos": {"nombre": "Juan", "apellido": "Pérez", "categoria": "OFICIAL"}}),
        # Uno nuevo que sólo tocó el apellido: el nombre sale del cuerpo.
        _fila(3, "2026-09-23 08:00", "/operarios/9", "PUT",
              detalle={"antes": {"apellido": "Pérez"}, "despues": {"apellido": "Pereyra"},
                       "datos": {"nombre": "Juan", "apellido": "Pereyra", "categoria": "OFICIAL"}}),
        # Uno que no cambió el nombre.
        _fila(4, "2026-09-23 09:00", "/operarios/9", "PUT",
              detalle={"antes": {"categoría": "OFICIAL"}, "despues": {"categoría": "MEDIO OFICIAL"},
                       "datos": {"nombre": "Juan", "apellido": "Pereyra", "categoria": "MEDIO OFICIAL"}}),
        # La baja que no se pudo (pedía confirmar), la que sí y un segundo clic.
        _fila(5, "2026-09-23 10:00", "/operarios/9", "DELETE", estado=409),
        _fila(6, "2026-09-23 10:01", "/operarios/9", "DELETE",
              detalle={"antes": {"nombre": "Juan", "apellido": "Pereyra", "categoría": "MEDIO OFICIAL",
                                 "sector": "MECANIZADO"}}),
        _fila(7, "2026-09-23 10:02", "/operarios/9", "DELETE"),
    ]
    h = H.historia_de_la_persona(list(reversed(movs)))  # el orden de entrada no importa
    assert h["nombre"] == "Juan Pereyra"
    assert h["nombres"] == ["Juan Perez", "Juan Pérez", "Juan Pereyra"]
    assert h["renombres"] == {2: ("Juan Perez", "Juan Pérez", True), 3: ("Juan Pérez", "Juan Pereyra", False)}
    assert h["al_momento"][1] == "Juan Perez" and h["al_momento"][6] == "Juan Pereyra"
    assert h["baja"]["id"] == 6
    assert h["identidad"]["categoria"] == "MEDIO OFICIAL" and h["identidad"]["sector"] == "MECANIZADO"

    p = H.persona_dada_de_baja(9, h)
    assert p == {"id": 9, "nombre": "Juan Pereyra", "categoria": "MEDIO OFICIAL", "sector": "MECANIZADO",
                 "activo": False, "dada_de_baja": True,
                 "baja": {"cuando": "2026-09-23T10:01:00", "quien": LUCAS}}
    # Sin nada que la nombre, igual se la puede elegir.
    assert H.persona_dada_de_baja(9, H.historia_de_la_persona([]))["nombre"] == "Persona #9"


async def _lista(cliente):
    r = await cliente.get("/auditoria/historial/personas")
    assert r.status_code == 200, r.text
    return r.json()["personas"]


async def test_alta_cambio_de_nombre_y_baja_quedan_en_su_linea_de_tiempo(app_real):
    """Por los endpoints de verdad y el middleware de verdad: dar de alta a Pedro Gonzalez,
    corregirle el apellido a González, darlo de baja (primero pide confirmar, después se
    fuerza) y, con la persona ya borrada, que siga en la lista y cuente las tres cosas."""
    r = await app_real.post("/operarios", json={"nombre": "Pedro", "apellido": "Gonzalez",
                                                 "categoria": "OFICIAL", "sector": "MECANIZADO"})
    assert r.status_code == 200, r.text
    nuevo = r.json()["data"]["id"]
    r = await app_real.put(f"/operarios/{nuevo}", json={
        "nombre": "Pedro", "apellido": "González", "categoria": "OFICIAL", "sector": "MECANIZADO",
        "disponible": True, "hora_inicio": "07:00", "hora_fin": "16:00", "dni": "30111222"})
    assert r.status_code == 200, r.text
    # Lo que tiene en otras tablas con su número: un paso elegido a mano (se le suelta al
    # borrarlo) y un plan (que no se borra).
    async with app_real.sesiones() as s:
        await s.execute(text("UPDATE orden_trabajo_proceso SET id_operario = :o WHERE id = :p"),
                        {"o": nuevo, "p": OTP2})
        s.add(Planificacion(orden_id=OT, proceso_id=101, id_orden_trabajo_proceso=OTP2, id_operario=nuevo,
                            inicio_min=120, fin_min=180, duracion_min=60, prioridad_peso=1,
                            nombre_proceso="FRESA", id_planificacion_lote=LOTE_SEPT,
                            descripcion_lote="Planificación septiembre 2026",
                            creado_en=d("2026-09-14 17:00")))
        await s.commit()

    r = await app_real.delete(f"/operarios/{nuevo}")
    assert r.status_code == 409, r.text  # avisar, no bloquear: pide confirmar
    r = await app_real.delete(f"/operarios/{nuevo}", params={"forzar": "true"})
    assert r.status_code == 200 and r.json()["status"], r.text

    # La fila del registro: la frase y quién era, sin datos personales.
    fila = await _ultima(app_real.sesiones, f"/operarios/{nuevo}", "DELETE")
    assert fila.descripcion == "Lucas Longchamps dio de baja a Pedro González"
    assert json.loads(fila.detalle)["antes"] == {"nombre": "Pedro", "apellido": "González",
                                                 "categoría": "OFICIAL", "sector": "MECANIZADO"}
    assert "30111222" not in fila.detalle

    # 1. Sigue en la lista para elegir, después de las cargadas y marcada.
    personas = await _lista(app_real)
    assert [p["dada_de_baja"] for p in personas] == [False, False, True]
    baja = personas[-1]
    assert baja["id"] == nuevo and baja["nombre"] == "Pedro González" and baja["activo"] is False
    assert baja["categoria"] == "OFICIAL" and baja["sector"] == "MECANIZADO"
    assert baja["baja"]["quien"] == "Lucas Longchamps" and baja["baja"]["cuando"]
    r = await app_real.get("/auditoria/historial/personas", params={"buscar": "gonzá"})
    assert [p["id"] for p in r.json()["personas"]] == [nuevo]

    # 2. Su línea de tiempo, sin la fila de `operario`.
    r = await app_real.get(f"/auditoria/historial/personas/{nuevo}")
    assert r.status_code == 200, r.text
    h = r.json()
    assert h["avisos"] == []
    assert h["persona"] == baja
    por_titulo = {e["titulo"]: e for e in h["eventos"]}
    alta = por_titulo["dio de alta a Pedro Gonzalez"]
    renombre = por_titulo["cambió el nombre de Pedro Gonzalez a Pedro González"]
    fin = por_titulo["dio de baja a Pedro González"]
    assert (alta["tipo"], renombre["tipo"], fin["tipo"]) == ("alta", "ficha", "baja")
    assert all(e["quien"] == "Lucas Longchamps" and e["salio_bien"] for e in (alta, renombre, fin))
    assert alta["cuando"] <= renombre["cuando"] <= fin["cuando"]
    assert not renombre["deducido"]
    # Del mismo guardado, lo que no es el nombre: el DNI se dice que cambió, no a qué.
    assert not [l for l in renombre["lineas"] if l.startswith(("nombre:", "apellido:"))]
    assert "30111222" not in r.text
    # El intento que pidió confirmar, también.
    intento = por_titulo["intentó dar de baja a Pedro González (no se pudo: error 409)"]
    assert intento["tipo"] == "baja" and not intento["salio_bien"] and "confirmar" in intento["nota"]
    assert {t["tipo"] for t in h["tipos"]} >= {"alta", "ficha", "baja"}
    # Lo demás no se rompe: el paso que se le soltó al borrarlo (del historial de pasos,
    # que la nombra) y el plan que le había dado un paso (que conserva su número).
    soltado = por_titulo["le sacó el paso 2 — FRESA de la OT 15300"]
    assert soltado["quien"] == "Lucas Longchamps" and soltado["ot"] == {"id": OT, "numero": 15300}
    assert por_titulo["confirmó el plan «Planificación septiembre 2026», que le dio 1 paso en 1 OT"]

    # Las cargadas siguen como antes.
    h7 = await _historial(app_real, "personas", 7)
    assert h7["persona"]["dada_de_baja"] is False and h7["persona"]["nombre"] == "Juan Perez"
    r = await app_real.get("/auditoria/historial/personas/424242")
    assert r.status_code == 404


async def test_una_baja_de_antes_se_arma_con_lo_que_quedo_en_el_registro(api, base):
    """Filas escritas antes de este cambio: el alta sin número (se la reconoce por el
    nombre), dos guardados viejos (el segundo le corrigió el apellido) y una baja que no
    dice a quién. El nombre sale de los guardados, y la baja igual se cuenta.

    El límite, a propósito: si el primer guardado registrado ya traía otro nombre que el
    del alta, el alta no se puede atar (no hay cómo saber que era ella) y no se adivina."""
    async with base() as s:
        s.add_all([
            _mov(d("2026-09-02 08:00:00"), "/operarios", metodo="POST", accion="creó", entidad="persona",
                 id_entidad=None, descripcion=f"{LUCAS} creó persona — Marta Diaz",
                 detalle={"datos": {"nombre": "Marta", "apellido": "Diaz", "categoria": "MEDIO OFICIAL"}}),
            _mov(d("2026-09-05 10:00:00"), "/operarios/31", entidad="persona", id_entidad="31",
                 detalle={"datos": {"nombre": "Marta", "apellido": "Diaz", "categoria": "MEDIO OFICIAL"}}),
            _mov(d("2026-09-12 10:00:00"), "/operarios/31", entidad="persona", id_entidad="31",
                 detalle={"datos": {"nombre": "Marta", "apellido": "Díaz", "categoria": "MEDIO OFICIAL"}}),
            _mov(d("2026-09-20 16:00:00"), "/operarios/31", metodo="DELETE", accion="eliminó",
                 entidad="persona", id_entidad="31", descripcion=f"{LUCAS} eliminó persona #31"),
            # Un DELETE que salió mal de alguien que nunca existió: no es una baja.
            _mov(d("2026-09-20 16:05:00"), "/operarios/32", metodo="DELETE", accion="eliminó",
                 entidad="persona", id_entidad="32", estado=500),
        ])
        await s.commit()

    r = await api.get("/auditoria/historial/personas")
    personas = r.json()["personas"]
    assert [(p["id"], p["nombre"], p["dada_de_baja"]) for p in personas] == [
        (8, "Ana Gomez", False), (7, "Juan Perez", False), (31, "Marta Díaz", True)]
    assert personas[-1]["baja"] == {"cuando": "2026-09-20T16:00:00", "quien": LUCAS}

    h = await _historial(api, "personas", 31)
    assert h["persona"]["nombre"] == "Marta Díaz" and h["persona"]["categoria"] == "MEDIO OFICIAL"
    titulos = [e["titulo"] for e in h["eventos"]]
    assert titulos == ["dio de baja a Marta Díaz", "cambió el nombre de Marta Diaz a Marta Díaz",
                       "guardó la ficha de Marta Diaz", "dio de alta a Marta Diaz"]
    alta, renombre = h["eventos"][3], h["eventos"][1]
    assert alta["deducido"] and "por el nombre" in alta["nota"]
    assert renombre["deducido"] and renombre["lineas"] == []
    # El 32 nunca existió: el DELETE que falló no alcanza para inventarle una historia.
    r = await api.get("/auditoria/historial/personas/32")
    assert r.status_code == 404
