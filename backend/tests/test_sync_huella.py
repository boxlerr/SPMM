"""El sync trabaja sólo si cambió algo (scripts/sync_huella.py; pedido de Julián del 25/09).

«Hacelo cada 10 min al sync, y que funcione sólo si hay un cambio en el Integral». Cada
pasada arranca con dos huellas baratas (una del Integral, otra de SPMM) y las compara con
las de la última pasada completa que salió bien. Lo que persigue este archivo:

  1. Sin cambios, la pasada no hace NADA más: ni clientes, ni artículos, ni espejo, ni
     desfasaje. Un renglón de log.
  2. Con un cambio en el Integral, pasada completa. Con un cambio SÓLO en las tablas del
     espejo de SPMM (el backend viejo de Render, si se despierta, escribe ahí), pasada
     completa y un WARNING: el espejo lo restituye.
  3. Ante la duda, completa: una huella que no se lee, más de 3 horas desde la última
     completa, o forzar=true. Saltear por error es lo único que no puede pasar.
  4. Si la pasada completa no terminó bien, no se guardan las huellas (la próxima corre
     entera otra vez).
  5. Con SPMM como dueño, la huella de SPMM no mira lo que edita la gente.
  6. Que las huellas miren TODAS las columnas que lee el sync del Integral y que escribe
     el espejo en SPMM: se comparan con las consultas de verdad, no con una lista a mano.

No toca ninguna base de verdad salvo SQLite en memoria y, si está SPMM_PG_PRUEBAS, un
Postgres LOCAL descartable (como test_migraciones_al_arrancar).
"""
from __future__ import annotations

import inspect
import logging
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import pytest
from sqlalchemy import text

from backend.infrastructure import migraciones
from backend.scripts import importar_materia_prima_legacy as I
from backend.scripts import sync_db
from backend.scripts import sync_huella as H

AHORA = datetime(2026, 9, 25, 10, 0)


# ─────────────────────────── un mundo de mentira ───────────────────────────


class _Sesion:
    """La sesión de SPMM: anota el SQL. Las huellas y sync_estado van por funciones de
    sync_huella que el mundo reemplaza, así que acá sólo llega el resto de la pasada."""

    def __init__(self, sql):
        self.sql = sql

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, clausula, params=None):
        self.sql.append(str(clausula))

        class _R:
            def mappings(self):
                return []

            def __iter__(self):
                return iter([])

        return _R()

    async def commit(self):
        pass

    async def rollback(self):
        pass


def _resultado_completo():
    """Un Resultado de importar() que dejó SPMM igual al Integral: corrió todo, sin fallo,
    con todas las lecturas del Integral con filas."""
    res = I.Resultado(I.PASOS_ESPEJO, True)
    viejo = {nombre: [{"x": 1}] for nombre in I.LECTURAS if nombre != "recortes"}
    res.ctx = I.Contexto(None, viejo, True, 10)
    for paso in I.PASOS_ESPEJO:
        res.ctx.paso(paso)
    return res


class Mundo:
    """El Integral, SPMM y sync_estado de mentira, y lo pesado del sync anotado en vez de
    corrido (clientes, artículos, espejo, 7b, desfasaje)."""

    def __init__(self, monkeypatch, modo="integral"):
        self.modo = modo
        self.pesado: list[str] = []      # lo que la pasada completa llama
        self.leido: list[str] = []       # lo que se le pidió al Integral además de la huella
        self.sql: list[str] = []
        self.guardadas: list[tuple] = []
        self.visto: list[datetime] = []
        self.integral = {t: (100, 7, 700) for t in H.tablas_integral(modo)}
        self.spmm = {t: f"10:{i}" for i, t in enumerate(H._columnas_spmm(modo))}
        self.guardado: H.Guardado | None = None
        self.falla_integral = self.falla_spmm = self.falla_estado = False
        self.espejo = _resultado_completo
        self.espejo_levanta: Exception | None = None
        self.al_correr_el_espejo = None
        self.desfasaje_ok = True
        self.upsert_levanta: Exception | None = None

        monkeypatch.setenv("MATERIA_PRIMA_DUENO", modo)
        monkeypatch.setattr(sync_db, "SessionLocal", lambda: _Sesion(self.sql))
        monkeypatch.setattr(sync_db, "_leer", self._leer)
        monkeypatch.setattr(sync_db, "_ahora_ar", lambda: AHORA)
        monkeypatch.setattr(sync_db, "_upsert", self._upsert)
        monkeypatch.setattr(sync_db, "_espejo_del_integral", self._espejo)
        monkeypatch.setattr(sync_db, "_altas_y_precios_del_viejo", self._7b)
        monkeypatch.setattr(sync_db, "_avisar_desfasaje", self._desfasaje)
        monkeypatch.setattr(H, "leer_estado", self._leer_estado)
        monkeypatch.setattr(H, "leer_huella_spmm", self._huella_spmm)
        monkeypatch.setattr(H, "guardar_estado", self._guardar)
        monkeypatch.setattr(H, "marcar_visto", self._marcar)

    # ── el Integral ──
    async def _leer(self, sql, params=None, tope_seg=None):
        if sql == H.consulta_integral(self.modo):
            assert tope_seg, "la huella del Integral no puede colgar el sync"
            if self.falla_integral:
                raise ConnectionError("el Integral no contesta")
            return [{"tabla": t, "filas": f, "xor_h": x, "suma": s}
                    for t, (f, x, s) in self.integral.items()]
        self.leido.append(sql)
        return []

    async def huella_integral(self):
        return await H.leer_huella_integral(self._leer, self.modo)

    # ── SPMM ──
    async def _leer_estado(self, session):
        if self.falla_estado:
            raise RuntimeError('relation "sync_estado" does not exist')
        return self.guardado

    async def _huella_spmm(self, session, modo):
        assert modo == self.modo
        if self.falla_spmm:
            raise RuntimeError("SPMM no contesta")
        return dict(self.spmm)

    async def _guardar(self, session, huella_integral, huella_spmm, ultima_completa, ahora):
        self.guardadas.append((huella_integral, huella_spmm, ultima_completa))

    async def _marcar(self, session, ahora):
        self.visto.append(ahora)

    async def guardar_como_ultima(self, hace=timedelta(minutes=10)):
        """sync_estado como si la última pasada completa hubiera sido hace `hace`, con el
        Integral y SPMM como están ahora."""
        self.guardado = H.Guardado(await self.huella_integral(), dict(self.spmm), AHORA - hace)

    # ── lo pesado ──
    async def _upsert(self, session, tabla, filas, claves, columnas, cols_update=None):
        self.pesado.append(f"upsert {tabla}")
        if self.upsert_levanta:
            raise self.upsert_levanta
        return 0, 0

    async def _espejo(self, session):
        self.pesado.append("espejo")
        if self.espejo_levanta:
            raise self.espejo_levanta
        if self.al_correr_el_espejo:
            self.al_correr_el_espejo()
        return self.espejo()

    async def _7b(self, session):
        self.pesado.append("7b")
        return 0, 0

    async def _desfasaje(self, session):
        self.pesado.append("desfasaje")
        return self.desfasaje_ok


@pytest.fixture
def mundo(monkeypatch):
    return Mundo(monkeypatch)


def _mensajes(caplog, nivel=None):
    return [r.getMessage() for r in caplog.records
            if r.name == "app" and (nivel is None or r.levelno == nivel)]


COMPLETA = ["upsert cliente", "upsert articulo", "espejo", "desfasaje"]


# ─────────────────────────── 1. sin cambios, nada ───────────────────────────


async def test_sin_cambios_no_hace_nada_mas(mundo, caplog):
    await mundo.guardar_como_ultima()
    with caplog.at_level(logging.DEBUG, logger="app"):
        assert await sync_db.run_sync() == "sin_cambios"
    assert mundo.pesado == [], "ni clientes, ni artículos, ni espejo, ni desfasaje"
    assert mundo.leido == [], "al Integral, sólo la consulta de la huella"
    assert mundo.sql == [], "ni las semillas"
    assert mundo.guardadas == []
    assert mundo.visto == [AHORA], "sólo la hora en que miró"
    mensajes = _mensajes(caplog)
    assert len(mensajes) == 1, mensajes
    assert re.fullmatch(r"sync: sin cambios en el Integral ni en SPMM desde 09:50 — no se hace "
                        r"nada \(\d+ ms\)", mensajes[0]), mensajes[0]


async def test_sin_cambios_no_depende_del_orden_de_las_filas(mundo):
    """La huella es un dict: que el Integral devuelva las tablas en otro orden no es un
    cambio."""
    await mundo.guardar_como_ultima()
    mundo.integral = dict(reversed(list(mundo.integral.items())))
    assert await sync_db.run_sync() == "sin_cambios"


# ─────────────────────────── 2. qué dispara la pasada completa ───────────────────────────


async def test_un_cambio_en_el_integral_corre_entera_y_guarda(mundo, caplog):
    await mundo.guardar_como_ultima()
    mundo.integral["otrabajoMprimas"] = (100, 8, 701)  # Carolina marcó «pedido» en una línea
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == COMPLETA
    assert any("sync: pasada completa — cambió el Integral: otrabajoMprimas" in m
               for m in _mensajes(caplog, logging.INFO))
    assert _mensajes(caplog, logging.WARNING) == []
    # La del Integral leída al empezar, la de SPMM al terminar, y la hora del arranque.
    assert mundo.guardadas == [(await mundo.huella_integral(), mundo.spmm, AHORA)]


async def test_una_fila_nueva_en_el_integral_es_un_cambio(mundo, caplog):
    await mundo.guardar_como_ultima()
    mundo.integral["caniera"] = (101, 7, 700)
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert any("cambió el Integral: caniera (100 → 101 filas)" in m for m in _mensajes(caplog))


async def test_un_cambio_solo_en_spmm_corre_entera_restituye_y_avisa(mundo, caplog):
    """El backend viejo de Render se despertó y pisó marcas de la materia prima: el
    Integral no cambió, SPMM sí. Pasada completa, WARNING, y el espejo lo deja como
    estaba (acá, el espejo de mentira devuelve la huella de antes)."""
    await mundo.guardar_como_ultima()
    antes = dict(mundo.spmm)
    mundo.spmm["orden_trabajo_pieza"] = "10:999"

    def _restituye():
        mundo.spmm = dict(antes)

    mundo.al_correr_el_espejo = _restituye
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == COMPLETA
    avisos = _mensajes(caplog, logging.WARNING)
    assert len(avisos) == 1, avisos
    assert avisos[0].startswith(
        "sync: SPMM cambió sin cambio en el Integral: alguien escribió en tablas del espejo "
        "(¿el backend viejo de Render?) — se restituye"), avisos[0]
    assert "orden_trabajo_pieza" in avisos[0]
    assert any("sync: restituido — orden_trabajo_pieza quedaron como en la pasada completa anterior"
               in m for m in _mensajes(caplog, logging.INFO))
    assert mundo.guardadas and mundo.guardadas[-1][1] == antes


async def test_si_no_queda_como_estaba_lo_dice(mundo, caplog):
    """Lo que escribieron no lo pisa el espejo (o el Integral cambió mientras corría): no se
    puede decir «restituido»."""
    await mundo.guardar_como_ultima()
    mundo.spmm["pieza"] = "10:999"
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    avisos = _mensajes(caplog, logging.WARNING)
    assert any("siguen distintas de la pasada completa anterior: pieza" in m for m in avisos), avisos
    assert not any("restituido" in m for m in _mensajes(caplog))


async def test_una_ot_cargada_en_spmm_corre_entera_sin_alarma(mundo, caplog):
    """Las OT, los clientes y los artículos se cargan en SPMM: cambian lo que decide el
    desfasaje y a qué OT va la materia prima, pero no son una alarma."""
    await mundo.guardar_como_ultima()
    mundo.spmm["orden_trabajo"] = "11:5"
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == COMPLETA
    assert _mensajes(caplog, logging.WARNING) == []
    assert any("cambiaron OT, clientes o artículos en SPMM: orden_trabajo (10 → 11 filas)" in m
               for m in _mensajes(caplog))


async def test_borrar_una_ot_en_spmm_no_es_una_pisada_de_render(mundo, caplog):
    """Borrar una OT con materia prima (OrdenTrabajoRepository.delete) borra sus líneas y
    sus cortes, libera su cañera y suelta su plan semanal: cambian cuatro tablas del espejo
    sin que cambie el Integral. Antes eso daba el WARNING «¿Render?» y, al terminar,
    «siguen distintas» (las líneas de una OT borrada no vuelven). Con orden_trabajo
    cambiando de filas, es una pasada completa con un renglón INFO."""
    await mundo.guardar_como_ultima()
    mundo.spmm["orden_trabajo"] = "9:4"
    for tabla in H.ARRASTRA_LA_OT:
        mundo.spmm[tabla] = "9:123"
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == COMPLETA
    assert _mensajes(caplog, logging.WARNING) == []
    assert any("se dieron de alta o de baja OT en SPMM" in m and "orden_trabajo (10 → 9 filas)" in m
               for m in _mensajes(caplog, logging.INFO))
    assert not any("restituido" in m for m in _mensajes(caplog))


def test_lo_que_una_baja_de_ot_no_toca_sigue_dando_la_alarma():
    """La excepción es sólo para lo que arrastra la OT, y sólo si orden_trabajo cambió de
    filas: una OT editada (misma cantidad de filas) junto con líneas pisadas es la alarma
    de siempre, y una pieza pisada también, aunque se haya borrado una OT."""
    integral = {"cliente": "1:2:3", "_modo": "integral"}
    base = {"orden_trabajo": "10:1", "orden_trabajo_pieza": "50:1", "pieza": "20:1",
            "canera_ocupacion": "5:1", "plan_semanal": "70:1"}
    guardado = H.Guardado(integral, base, AHORA - timedelta(minutes=10))

    borrada = dict(base, orden_trabajo="9:0", orden_trabajo_pieza="47:2", canera_ocupacion="4:2",
                   plan_semanal="70:2")
    d = H.decidir(guardado, integral, borrada, AHORA)
    assert d.completa and not d.alerta and "alta o de baja" in d.motivo

    d = H.decidir(guardado, integral, dict(borrada, pieza="20:9"), AHORA)
    assert d.alerta and d.tablas_espejo == ["pieza"], "sólo lo que la baja no explica"

    editada = dict(base, orden_trabajo="10:7", orden_trabajo_pieza="50:9")
    d = H.decidir(guardado, integral, editada, AHORA)
    assert d.alerta and d.tablas_espejo == ["orden_trabajo_pieza"]


def test_arrastra_la_ot_son_tablas_del_espejo():
    assert set(H.ARRASTRA_LA_OT) <= set(H._columnas_spmm("integral")) - set(H.TABLAS_APP)


async def test_una_ot_que_entra_a_mitad_de_la_pasada_hace_correr_la_siguiente(mundo, caplog):
    """importar_ot_legacy mete una OT MIENTRAS corre la pasada, después de que el espejo leyó
    las OT: esa OT no recibió su materia prima. Si se guardara la huella de SPMM del final
    (que ya la incluye), la siguiente diría «sin cambios» y la OT quedaría sin líneas hasta
    la red de seguridad (medido en local el 25/09 con la 15924). Se guarda lo de al empezar
    en esa tabla: la siguiente corre entera, sin alarma, y la de después ya no."""
    await mundo.guardar_como_ultima()
    mundo.integral["otrabajoMprimas"] = (100, 8, 701)
    al_empezar = dict(mundo.spmm)

    def _entra_una_ot():
        mundo.spmm["orden_trabajo"] = "11:5"
        mundo.spmm["orden_trabajo_pieza"] = "10:888"   # lo que escribió el espejo: normal

    mundo.al_correr_el_espejo = _entra_una_ot
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    guardada = mundo.guardadas[-1][1]
    assert guardada["orden_trabajo"] == al_empezar["orden_trabajo"], "lo de al empezar"
    assert guardada["orden_trabajo_pieza"] == "10:888", "las del espejo, lo que quedó escrito"
    assert any("sync: orden_trabajo cambiaron mientras corría la pasada" in m
               for m in _mensajes(caplog, logging.INFO))

    mundo.al_correr_el_espejo = None
    mundo.guardado = H.Guardado(mundo.guardadas[-1][0], guardada, AHORA - timedelta(minutes=10))
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert _mensajes(caplog, logging.WARNING) == [], "una OT nueva no es la alarma de Render"
    assert any("cambiaron OT, clientes o artículos en SPMM: orden_trabajo (10 → 11 filas)" in m
               for m in _mensajes(caplog))
    assert mundo.guardadas[-1][1] == mundo.spmm, "sin nada a mitad, lo del final"

    mundo.guardado = H.Guardado(mundo.guardadas[-1][0], mundo.guardadas[-1][1],
                                AHORA - timedelta(minutes=10))
    assert await sync_db.run_sync() == "sin_cambios"


def test_a_guardar_solo_retiene_las_tablas_de_la_app():
    inicio = {"orden_trabajo": "1:1", "cliente": "1:1", "pieza": "1:1"}
    fin = {"orden_trabajo": "2:2", "cliente": "1:1", "pieza": "2:2"}
    assert H.a_guardar(inicio, fin) == (
        {"orden_trabajo": "1:1", "cliente": "1:1", "pieza": "2:2"}, ["orden_trabajo"])
    assert H.a_guardar(None, fin) == (fin, []), "sin la de al empezar, la del final"
    assert H.a_guardar(inicio, inicio) == (inicio, [])


async def test_si_cambian_los_dos_corre_entera_sin_alarma(mundo, caplog):
    """Con el Integral cambiado, SPMM no tiene por qué quedar como antes: se dice qué
    cambió y no se levanta la alarma de Render."""
    await mundo.guardar_como_ultima()
    mundo.integral["otrabajoMprimas"] = (100, 8, 701)
    mundo.spmm["orden_trabajo_pieza"] = "10:999"
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert _mensajes(caplog, logging.WARNING) == []
    assert any("cambió el Integral: otrabajoMprimas; y en SPMM: orden_trabajo_pieza" in m
               for m in _mensajes(caplog))


# ─────────────────────────── 3. ante la duda, completa ───────────────────────────


@pytest.mark.parametrize("que_falla,guarda", [
    ("falla_integral", False),   # sin la huella del Integral no hay qué guardar
    ("falla_spmm", False),       # tampoco la de SPMM al terminar
    ("falla_estado", True),      # sin sync_estado (la migración no corrió): corre y guarda
])
async def test_una_huella_que_no_se_lee_corre_entera(mundo, caplog, que_falla, guarda):
    await mundo.guardar_como_ultima()
    setattr(mundo, que_falla, True)
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == COMPLETA
    assert bool(mundo.guardadas) is guarda
    assert any(m.startswith("sync: no se pudo leer") for m in _mensajes(caplog, logging.WARNING))


async def test_sin_nada_guardado_corre_entera(mundo, caplog):
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == COMPLETA
    assert any("no hay huellas guardadas" in m for m in _mensajes(caplog))
    assert len(mundo.guardadas) == 1


@pytest.mark.parametrize("hace,esperado", [
    (timedelta(hours=2, minutes=59), "sin_cambios"),
    (timedelta(hours=3), "completa"),
    (timedelta(hours=3, minutes=1), "completa"),
    (timedelta(minutes=-5), "completa"),  # una última completa «en el futuro» (el reloj)
])
async def test_la_red_de_seguridad_de_tres_horas(mundo, hace, esperado):
    await mundo.guardar_como_ultima(hace=hace)
    assert await sync_db.run_sync() == esperado
    assert mundo.pesado == ([] if esperado == "sin_cambios" else COMPLETA)


async def test_forzar_corre_entera(mundo, caplog):
    await mundo.guardar_como_ultima()
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync(forzar=True) == "completa"
    assert mundo.pesado == COMPLETA
    assert any("sync: pasada completa — pedida a mano (forzar=true)" in m for m in _mensajes(caplog))
    assert len(mundo.guardadas) == 1


# ─────────────────────────── 4. si la completa falla, no guarda ───────────────────────────


def _con_fallo():
    res = _resultado_completo()
    res.fallo = ("lineas", "TimeoutError: la segunda lectura del Integral no contestó en 30 s")
    return res


def _ocupado():
    res = I.Resultado(I.PASOS_ESPEJO, True)
    res.ocupado = True
    return res


def _sin_migracion():
    res = I.Resultado(I.PASOS_ESPEJO, True)
    res.faltan = ["falta la tabla material"]
    return res


def _lectura_vacia():
    res = _resultado_completo()
    res.ctx.viejo["lineas"] = []
    return res


def _tope():
    res = _resultado_completo()
    lineas = next(p for p in res.pasos if p.nombre == "lineas")
    lineas.contar("líneas que no se borran por el tope de la pasada", 900)
    return res


@pytest.mark.parametrize("como", ["espejo levanta", "paso que falla", "candado ocupado",
                                  "sin migración", "lectura vacía", "tope de borrado",
                                  "desfasaje", "clientes"])
async def test_una_pasada_completa_que_falla_no_guarda_las_huellas(mundo, caplog, como):
    await mundo.guardar_como_ultima()
    mundo.integral["otrabajoMprimas"] = (100, 8, 701)
    if como == "espejo levanta":
        mundo.espejo_levanta = ConnectionError("el Integral no contesta")
    elif como == "paso que falla":
        mundo.espejo = _con_fallo
    elif como == "candado ocupado":
        mundo.espejo = _ocupado
    elif como == "sin migración":
        mundo.espejo = _sin_migracion
    elif como == "lectura vacía":
        mundo.espejo = _lectura_vacia
    elif como == "tope de borrado":
        mundo.espejo = _tope
    elif como == "desfasaje":
        mundo.desfasaje_ok = False
    else:
        mundo.upsert_levanta = RuntimeError("se cayó la conexión")
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "con_errores"
    assert mundo.guardadas == [], "la próxima pasada tiene que correr entera otra vez"
    assert any("no se guardan las huellas" in m for m in _mensajes(caplog, logging.WARNING))


def test_el_tope_se_reconoce_con_la_clave_de_la_importacion():
    """_espejo_incompleto reconoce el tope por su conteo («… por el tope …»): si la
    importación le cambia el nombre, esto falla antes de que una pasada frenada por el tope
    guarde huellas y las siguientes no reintenten."""
    fuente = inspect.getsource(I.paso_lineas)
    claves = re.findall(r'paso\.contar\("([^"]*por el tope[^"]*)"', fuente)
    assert claves == ["líneas que no se borran por el tope de la pasada"], claves
    assert sync_db._espejo_incompleto(_tope()) is not None
    assert sync_db._espejo_incompleto(_resultado_completo()) is None
    assert sync_db._espejo_incompleto(None) is None, "sin Postgres no hay espejo que reflejar"


def test_las_lecturas_vacias_que_mira_son_las_de_la_importacion():
    for nombre in sync_db._LECTURAS_QUE_NO_PUEDEN_VENIR_VACIAS:
        assert nombre in I.LECTURAS, nombre


# ─────────────────────────── 5. SPMM como dueño ───────────────────────────


async def test_con_spmm_como_dueno_no_mira_lo_que_edita_la_gente(monkeypatch, caplog):
    mundo = Mundo(monkeypatch, modo="spmm")
    assert set(H._columnas_spmm("spmm")) == set(H.TABLAS_APP)
    consulta = H.consulta_spmm("spmm")
    for tabla in ("pieza", "orden_trabajo_pieza", "pieza_movimiento", "pieza_precio",
                  "canera_ocupacion", "proveedor", "material"):
        assert not re.search(rf"\bFROM {tabla}\b", consulta), tabla
    # Del Integral, lo que lee el sync en ese modo: clientes, artículos, piezas (7b), desfasaje.
    assert set(H.tablas_integral("spmm")) == {"cliente", "articulo", "pieza", "otrabajo"}

    await mundo.guardar_como_ultima()
    assert await sync_db.run_sync() == "sin_cambios"
    assert mundo.pesado == []
    mundo.integral["pieza"] = (100, 9, 709)   # un código nuevo facturado en el Integral
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert mundo.pesado == ["upsert cliente", "upsert articulo", "7b", "desfasaje"]
    assert _mensajes(caplog, logging.WARNING) == []


async def test_cambiar_de_dueno_corre_entera(monkeypatch, caplog):
    """La huella del Integral lleva el modo: pasar de un dueño al otro es un cambio."""
    mundo = Mundo(monkeypatch, modo="integral")
    await mundo.guardar_como_ultima()
    otro = Mundo(monkeypatch, modo="spmm")
    otro.guardado = mundo.guardado
    with caplog.at_level(logging.INFO, logger="app"):
        assert await sync_db.run_sync() == "completa"
    assert any("sync: pasada completa — cambió el dueño de la materia prima (integral → spmm)" in m
               for m in _mensajes(caplog)), _mensajes(caplog)
    assert _mensajes(caplog, logging.WARNING) == []


# ─────────────────────────── la decisión, sola ───────────────────────────


def test_decidir_ante_la_duda_completa():
    h = {"a": "1"}
    g = H.Guardado(h, h, AHORA - timedelta(minutes=5))
    assert not H.decidir(g, h, h, AHORA).completa
    assert H.decidir(g, h, h, AHORA, forzar=True).completa
    assert H.decidir(g, None, h, AHORA).completa
    assert H.decidir(g, h, None, AHORA).completa
    assert H.decidir(None, h, h, AHORA).completa
    assert H.decidir(H.Guardado(None, h, AHORA), h, h, AHORA).completa
    assert H.decidir(H.Guardado(h, h, None), h, h, AHORA).completa
    # Una tabla que aparece o desaparece es un cambio.
    assert H.decidir(g, {"a": "1", "b": "2"}, h, AHORA).motivo == (
        "cambió el Integral: b (nueva en la huella)")
    assert H.decidir(g, h, {}, AHORA).completa


def test_un_json_roto_en_sync_estado_es_como_no_tener_nada():
    assert H._cargar("{no es json") is None
    assert H._cargar("[1, 2]") is None
    assert H._cargar(None) is None
    assert H._cargar('{"a": "1"}') == {"a": "1"}


# ─────────────────────────── 6. las huellas miran lo que hay que mirar ───────────────────────────

_PALABRAS_SQL = {"select", "as", "ltrim", "rtrim", "isnull", "case", "when", "then", "else",
                 "end", "null", "from", "where", "and", "or", "not", "is", "in", "cast",
                 "distinct", "nullif", "dbo", "physloc"}


def _identificadores(sql: str) -> set[str]:
    """Las columnas que nombra una consulta (en minúscula): sin alias, literales, marcas de
    format ni prefijos de tabla."""
    sql = re.sub(r"'[^']*'", " ", sql)
    sql = re.sub(r"\{\w+\}", " ", sql)
    sql = re.sub(r"\bAS\s+\w+", " ", sql, flags=re.I)
    sql = re.sub(r"\bFROM\s+dbo\.\w+(\s+\w+)?", " FROM ", sql, flags=re.I)
    sql = re.sub(r"\b\w+\.", "", sql)
    return {w.lower() for w in re.findall(r"[A-Za-z_]\w*", sql)} - _PALABRAS_SQL


def _tabla_del_integral(sql: str) -> str:
    return re.search(r"FROM\s+dbo\.(\w+)", sql, re.I).group(1).lower()


def _consultas_del_sync(modo: str) -> list[str]:
    """Lo que lee del Integral una pasada completa en ese modo."""
    consultas = [sync_db.Q_CLIENTES, sync_db.Q_ARTICULOS, sync_db._Q_YA_ENTREGADAS]
    if modo == "spmm":
        return consultas + [sync_db.Q_CATALOGO_VIEJO]
    # El espejo: las lecturas de los pasos del espejo (LECTURAS; la de piezas es la del 7b).
    for nombre, (consulta, usan) in I.LECTURAS.items():
        if set(usan) & set(I.PASOS_ESPEJO):
            consultas.append(consulta or sync_db.Q_CATALOGO_VIEJO)
    return consultas


@pytest.mark.parametrize("modo", ["integral", "spmm"])
def test_la_huella_del_integral_mira_todas_las_columnas_que_lee_el_sync(modo):
    """Una columna que el sync lee y la huella no mira es un cambio del Integral que el
    sync no ve hasta la red de seguridad. Se sacan de las consultas de verdad: si alguien
    agrega una columna a Q_LINEAS (o una lectura nueva al espejo) sin sumarla a la huella,
    falla acá."""
    por_tabla = {tabla.split(".")[1].lower(): _identificadores("SELECT " + columnas + " FROM x")
                 for tabla, columnas in H.tablas_integral(modo).values()}
    for consulta in _consultas_del_sync(modo):
        tabla = _tabla_del_integral(consulta)
        assert tabla in por_tabla, f"la huella no mira dbo.{tabla} ({consulta.strip()[:60]}…)"
        faltan = _identificadores(consulta) - por_tabla[tabla]
        assert not faltan, f"la huella de dbo.{tabla} no mira {sorted(faltan)}"


def test_run_sync_no_lee_consultas_que_la_huella_no_cubre():
    """Q_OTS, Q_PENDIENTES y Q_PROCESOS no están en la huella porque run_sync no las corre
    (el sync de OT y de procesos está apagado desde el 2/9). Si vuelven, hay que sumarlas."""
    import ast
    import textwrap

    arbol = ast.parse(textwrap.dedent(inspect.getsource(sync_db.run_sync)))
    nombres = {n.id for n in ast.walk(arbol) if isinstance(n, ast.Name)}
    for nombre in ("Q_OTS", "Q_PENDIENTES", "Q_PROCESOS"):
        assert nombre not in nombres, f"run_sync volvió a leer {nombre}: sumar sus columnas a la huella"
    # Y las que sí lee, las lee (si no, la lista de _consultas_del_sync quedó vieja).
    assert {"Q_CLIENTES", "Q_ARTICULOS"} <= nombres


def test_cada_fila_es_un_md5_de_todas_sus_columnas():
    """BINARY_CHECKSUM no veía ediciones combinadas en la misma fila (cantidad 20→21 junto
    con pendiente 0→1: 1.306 líneas reales con el mismo checksum) ni un nvarchar(max) más
    allá del principio. Ahora cada fila es HASHBYTES('MD5') del texto de TODAS sus
    columnas, los textos largos enteros (obs va como columna, no aparte)."""
    for nombre, (tabla, columnas) in H.tablas_integral("integral").items():
        fila = H._fila(nombre, columnas)
        assert fila.startswith("HASHBYTES('MD5', CONCAT_WS(NCHAR(31), "), nombre
        assert "BINARY_CHECKSUM" not in fila and "CHECKSUM(" not in fila, nombre
        for columna in H._columnas(columnas):
            assert columna in fila, (nombre, columna)
            if columna != "%%physloc%%":
                assert f"IIF({columna} IS NULL, '1', '0')" in fila, (nombre, columna)
    for nombre in ("cliente", "Proveedor"):
        assert "obs" in H._columnas(H.tablas_integral("integral")[nombre][1]), nombre


def test_float_y_fechas_se_escriben_siempre_igual_y_enteros():
    """Sin estilo, SQL Server escribe un float con 6 cifras (1234567 y 1234568 darían lo
    mismo) y una fecha sin segundos: los float van por sus bits y las fechas en ISO 8601."""
    fila = H._fila("otrabajoMprimas", H.tablas_integral("integral")["otrabajoMprimas"][1])
    assert "CONVERT(varchar(16), CAST(cantidad AS binary(8)), 2)" in fila
    assert "CONVERT(varchar(16), CAST(creserva AS binary(8)), 2)" in fila
    assert "CONVERT(varchar(23), fechaprov, 126)" in fila
    assert "CONVERT(varchar(16), %%physloc%%, 2)" in fila
    assert "CONVERT(varchar(8), CAST(cant AS binary(4)), 2)" in H._fila(
        "otcortesmp", H.tablas_integral("integral")["otcortesmp"][1])
    # Cada columna tipada existe en su tabla (un nombre mal escrito dejaría la columna con
    # el formato por defecto sin que nada falle).
    tablas = H.tablas_integral("integral")
    for nombre, tipos in H._TIPOS.items():
        assert set(tipos) <= set(H._columnas(tablas[nombre][1])), nombre
        assert set(tipos.values()) <= {"float", "real", "fecha"}, nombre


def test_del_plan_semanal_solo_la_ventana_del_espejo():
    consulta = H.consulta_integral("integral", date(2026, 9, 25))
    assert "FROM dbo.plansemanal WHERE fecha >= '20260727' AND fecha < '20261123')" in consulta
    assert consulta.count(" WHERE ") == 1, "el resto de las tablas, enteras"
    assert "plansemanal" not in H.consulta_integral("spmm", date(2026, 9, 25)), "sin espejo, no se lee"


def test_el_orden_de_las_lineas_y_los_cortes_entra_en_la_huella():
    tablas = H.tablas_integral("integral")
    for nombre in ("otrabajoMprimas", "otcortesmp"):
        assert tablas[nombre][1].startswith("%%physloc%%"), nombre


def test_la_consulta_del_integral_es_una_sola_y_solo_lee():
    for modo in ("integral", "spmm"):
        consulta = H.consulta_integral(modo)
        assert consulta.count("SELECT '") == len(H.tablas_integral(modo))
        assert not re.search(r"\b(INSERT|UPDATE|DELETE|MERGE|EXEC|DROP|ALTER|INTO)\b", consulta, re.I)
        assert "COUNT_BIG(*)" in consulta and "CHECKSUM_AGG(h2)" in consulta
        assert "SUM(CAST(h1 AS BIGINT))" in consulta, "dos filas iguales se cancelan en el XOR"
        assert "CAST(SUBSTRING(b, 1, 4) AS INT) AS h1" in consulta
        assert "CAST(SUBSTRING(b, 5, 4) AS INT) AS h2" in consulta, "XOR y suma de bytes distintos"


def test_la_huella_de_spmm_mira_lo_que_escribe_el_espejo():
    columnas = {t: {c.strip() for c in cols.split(",")}
                for t, (cols, _) in H._columnas_spmm("integral").items()}
    assert set(I.COLS_PIEZA) | {"id", "cod_pieza", "stockactual"} <= columnas["pieza"]
    assert not {"stock_minimo", "stock_bajo_avisado_en"} & columnas["pieza"], (
        "las escribe SPMM también con el Integral como dueño: serían falsas alarmas")
    assert set(I.COLS_LINEA) | {"id", "id_orden_trabajo", "id_pieza"} <= columnas["orden_trabajo_pieza"]
    assert set(I.COLS_PROVEEDOR) | {"id", "id_legacy"} <= columnas["proveedor"]
    assert set(sync_db.COLS_CLIENTE) | {"id", "id_viejo"} <= columnas["cliente"]
    assert {"id_otvieja", "id_articulo", "id_cliente", "fecha_orden", "finalizadototal",
            "suspendida", "no_lleva_materia_prima", "fecha_entrega"} <= columnas["orden_trabajo"]
    for tabla in ("orden_trabajo_pieza_corte", "canera_ocupacion", "pieza_movimiento",
                  "pieza_precio", "material", "material_calidad", "articulo"):
        assert tabla in columnas, tabla
    assert {"semana", "fecha_original", "numero_ot", "id_orden_trabajo", "prioridad",
            "origen"} <= columnas["plan_semanal"]
    assert "plan_semanal" not in H._columnas_spmm("spmm"), "sin espejo nadie lo escribe"
    assert "WHERE hasta IS NULL" in H.consulta_spmm("integral"), "la cañera, sólo lo vigente"


def test_la_huella_solo_escribe_sync_estado():
    """Todo sync_huella.py es lectura salvo su propia fila: el sync sigue escribiendo la
    materia prima sólo por el espejo (test_sync_no_pisa_procesos)."""
    fuente = (Path(sync_db.__file__).parent / "sync_huella.py").read_text(encoding="utf-8")
    # «ON CONFLICT … DO UPDATE SET» es el mismo INSERT de sync_estado.
    destinos = set(re.findall(r"\b(?:INSERT INTO|(?<!DO )UPDATE|DELETE FROM)\s+(\w+)", fuente))
    assert destinos == {"sync_estado"}, destinos
    for modo in ("integral", "spmm"):
        assert not re.search(r"\b(INSERT|UPDATE|DELETE)\b", H.consulta_spmm(modo), re.I)


# ─────────────────────────── sync_estado, contra una base (SQLite) ───────────────────────────


def _ddl_sync_estado():
    sentencias = dict(migraciones.MIGRACIONES)["2026-09-25_sync_estado"]
    return [s for s in sentencias if s.startswith("CREATE TABLE")]


async def test_guardar_y_leer_sync_estado(session):
    for s in _ddl_sync_estado():
        await session.execute(text(s))
    assert await H.leer_estado(session) is None

    await H.guardar_estado(session, {"cliente": "1:2:3", "_modo": "integral"}, {"pieza": "4:5"},
                           AHORA, AHORA + timedelta(seconds=9))
    g = await H.leer_estado(session)
    assert g.huella_integral == {"cliente": "1:2:3", "_modo": "integral"}
    assert g.huella_spmm == {"pieza": "4:5"}
    assert g.ultima_completa == AHORA

    # Una sola fila: la segunda la pisa.
    await H.guardar_estado(session, {"cliente": "9"}, {"pieza": "9"}, AHORA + timedelta(hours=1),
                           AHORA + timedelta(hours=1))
    assert (await session.execute(text("SELECT count(*) FROM sync_estado"))).scalar() == 1
    g = await H.leer_estado(session)
    assert (g.huella_integral, g.ultima_completa) == ({"cliente": "9"}, AHORA + timedelta(hours=1))

    # Una pasada que no hace nada sólo anota cuándo miró.
    await H.marcar_visto(session, AHORA + timedelta(hours=2))
    fila = (await session.execute(text(
        "SELECT huella_integral, ultima_completa, actualizado_en FROM sync_estado"))).first()
    assert H._cargar(fila[0]) == {"cliente": "9"}
    assert H._fecha(fila[1]) == AHORA + timedelta(hours=1)
    assert H._fecha(fila[2]) == AHORA + timedelta(hours=2)


# ─────────────────────────── /internal/sync?forzar=true ───────────────────────────


def test_el_endpoint_pasa_forzar_y_dice_que_hizo(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.presentation import main

    pedidos = []

    async def _run_sync(forzar=False):
        pedidos.append(forzar)
        return "completa" if forzar else "sin_cambios"

    monkeypatch.setenv("SYNC_TOKEN", "secreto-de-prueba")
    monkeypatch.setattr(main, "run_sync_once", _run_sync)
    cliente = TestClient(main.app)  # sin `with`: no dispara el startup
    cabecera = {"x-sync-token": "secreto-de-prueba"}
    r = cliente.post("/internal/sync", headers=cabecera)
    assert r.status_code == 200 and r.json()["pasada"] == "sin_cambios"
    r = cliente.post("/internal/sync?forzar=true", headers=cabecera)
    assert r.status_code == 200 and r.json()["pasada"] == "completa"
    assert pedidos == [False, True]
    assert cliente.post("/internal/sync?forzar=true").status_code == 401


# ─────────────── las consultas de SPMM contra un Postgres de verdad (descartable) ───────────────
#
# hashtextextended y ROW(...)::text son de Postgres: esto sólo corre con SPMM_PG_PRUEBAS
# apuntando a un Postgres LOCAL descartable (le borra el esquema public).

PG_URL = os.getenv("SPMM_PG_PRUEBAS")


def _pg_seguro(url) -> bool:
    try:
        return urlparse(url.replace("+asyncpg", "")).hostname in ("localhost", "127.0.0.1", "::1")
    except Exception:
        return False


pg = pytest.mark.skipif(not (PG_URL and _pg_seguro(PG_URL)), reason="sin SPMM_PG_PRUEBAS local")


@pg
async def test_pg_las_huellas_de_spmm_son_estables_y_ven_los_cambios():
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    from backend.infrastructure.db import Base
    from backend.tests.conftest import TEST_TABLES

    motor = create_async_engine(PG_URL, poolclass=NullPool)
    try:
        async with motor.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TEST_TABLES))
            for s in dict(migraciones.MIGRACIONES)["2026-09-25_sync_estado"]:
                await conn.execute(text(s))
            await conn.execute(text(
                "INSERT INTO pieza (id, cod_pieza, descripcion, stockactual, stock_minimo, origen) "
                "VALUES (1, 'ABC040', 'BARRA', 4.86, 2, 'legacy')"))
            await conn.execute(text("INSERT INTO prioridad (id, descripcion) VALUES (1, 'NORMAL')"))
            await conn.execute(text("INSERT INTO sector (id, nombre) VALUES (1, 'SIN SECTOR')"))
            await conn.execute(text("INSERT INTO articulo (id, cod_articulo, descripcion, abreviatura) "
                                    "VALUES (1, 'ART-1', 'Articulo uno', 'A1')"))
            await conn.execute(text(
                "INSERT INTO orden_trabajo (id, id_otvieja, id_prioridad, id_sector, id_articulo, "
                "no_lleva_plano, no_lleva_materia_prima, ttt1, fc, fecha_orden, fecha_entrada, "
                "fecha_prometida) VALUES (10, 15692, 1, 1, 1, 0, 0, 0, 0, '2026-09-01', "
                "'2026-09-01', '2026-09-30')"))
            await conn.execute(text(
                "INSERT INTO orden_trabajo_pieza (id, id_orden_trabajo, id_pieza, cantidad, pedido, "
                "disponible, origen) VALUES (100, 10, 1, 3, 0, 0, 'legacy')"))
        hacer = sessionmaker(motor, class_=AsyncSession, expire_on_commit=False)
        async with hacer() as s:
            primera = await H.leer_huella_spmm(s, "integral")
            assert set(primera) == set(H._columnas_spmm("integral"))
            assert primera["pieza"].startswith("1:") and primera["orden_trabajo_pieza"].startswith("1:")
            assert await H.leer_huella_spmm(s, "integral") == primera, "dos lecturas seguidas, iguales"

            # Lo que hacía el sync viejo de Render: pedido = 1, disponible = 1.
            await s.execute(text("UPDATE orden_trabajo_pieza SET pedido = 1, disponible = 1"))
            await s.commit()
            segunda = await H.leer_huella_spmm(s, "integral")
            assert H._distintas(primera, segunda) == ["orden_trabajo_pieza"]

            # El mínimo lo escribe SPMM aunque el Integral sea el dueño: no es un cambio.
            await s.execute(text("UPDATE pieza SET stock_minimo = 5"))
            await s.commit()
            assert await H.leer_huella_spmm(s, "integral") == segunda
            await s.execute(text("UPDATE pieza SET stockactual = 0"))
            await s.commit()
            assert H._distintas(segunda, await H.leer_huella_spmm(s, "integral")) == ["pieza"]

            # Con SPMM como dueño, sólo OT, clientes y artículos.
            assert set(await H.leer_huella_spmm(s, "spmm")) == set(H.TABLAS_APP)

            # Y sync_estado en Postgres: la fila se escribe y se relee.
            await H.guardar_estado(s, {"x": "1"}, segunda, AHORA, AHORA)
            await H.guardar_estado(s, {"x": "2"}, segunda, AHORA, AHORA)
            g = await H.leer_estado(s)
            assert (g.huella_integral, g.huella_spmm, g.ultima_completa) == ({"x": "2"}, segunda, AHORA)
    finally:
        await motor.dispose()
