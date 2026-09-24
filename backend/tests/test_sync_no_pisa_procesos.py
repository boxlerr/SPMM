"""
Tests del corte del sync (reunión Metlo 2-jul-2026):
`sync_db.run_sync()` NO debe volver a ejecutar la "ruta de procesos"
(los procesos por OT) que pisaba lo editado en SPMM, pero SÍ debe seguir
sincronizando el resto (clientes y artículos).

Desde la reunión del 23/09/2026 los pasos 7 (stock de las piezas) y 8 (líneas de las OT)
están apagados. Qué se trae de la materia prima depende de quién es el dueño
(application/materia_prima/dueno.py):

  · con SPMM como dueño (así corren estos tests salvo que pidan otra cosa:
    conftest.materia_prima_con_spmm_como_dueno) lo único que sigue llegando del viejo al
    catálogo son los códigos nuevos y el último precio de compra (paso 7b), y sólo
    después de la importación. Los tests del 7b lo prueban contra una base de verdad
    (SQLite), porque ahí lo que importa es QUÉ escribe;
  · con el Sistema Integral como dueño (la prueba piloto) corre el ESPEJO: la misma
    importación que el script, en cada pasada. Los tests del final prueban que el sync
    elija bien y que el espejo no lo tumbe.

No toca ninguna base: se mockea la sesión de SPMM y también la lectura del legacy.
Antes solo se mockeaba la sesión, así que el test salía a buscar de verdad la base
on-prem por DuckDNS: si estaba caída o lenta, fallaba por algo que no tenía nada que
ver con lo que quiere verificar.

Las afirmaciones son sobre el SQL que el sync emite HOY. Estaban escritas contra la
implementación de SQL Server (`MERGE dbo.orden_trabajo`), que dejó de existir en la
migración a Postgres: el sync pasó a INSERT ... ON CONFLICT y el test quedó
afirmando sentencias que ya no se ejecutan.
"""

# Filas de mentira para cada consulta al legacy. Alcanza con una por tabla: lo que se
# verifica es qué RUTAS del sync corren, no cuántas filas mueven.
FILAS_POR_QUERY = {
    "Q_CLIENTES": [{"id_viejo": 1, "nombre": "CLIENTE UNO", "fantasia": None, "abreviatura": None,
                    "direccion": None, "localidad": None, "cuit": None, "telefono": None,
                    "celular": None, "mail": None, "web": None, "obs": None}],
    "Q_ARTICULOS": [{"cod_articulo": "ART-1", "descripcion": "Articulo uno", "abreviatura": "A1"}],
    "Q_PROCESOS": [{"nombre": "TORNEADO"}],
    # El catálogo del viejo (paso 7b): un código que SPMM no tiene y uno que sí, con
    # precio más nuevo. Así, si el paso corre, tiene algo que insertar y algo que
    # actualizar.
    "Q_CATALOGO_VIEJO": [
        {"Idpieza": "PZA-NUEVA", "descripcion": "Pieza nueva", "unitario": 10, "unidad": "UN",
         "fecha": "20/09/2026", "insumo": 2, "stockactual": 5},
        {"Idpieza": "PZA-1", "descripcion": "Pieza uno", "unitario": 12, "unidad": "UN",
         "fecha": "21/09/2026", "insumo": 2, "stockactual": 7},
    ],
}


def _fila_ot():
    """Una OT con todas las columnas que el sync copia (COLS_OT + claves)."""
    import backend.scripts.sync_db as sync_db
    fila = {c: None for c in sync_db.COLS_OT}
    fila.update({
        "id_otvieja": 1,
        "_prioridad": "NORMAL",
        "_sector": "SIN SECTOR",
        "_cod_articulo": "ART-1",
        "_cliente_viejo": 1,
    })
    return fila


class _FakeResult:
    """Resultado vacío, pero con la forma que consume sync_db.

    Le faltaba `mappings()`, que es lo que usan `_upsert` y `_mapa` desde que el sync
    pasó a Postgres: la sincronización explotaba en el primer catálogo y el test se
    quedaba mirando un SQL a medio ejecutar. `first()` y `all()` son las del paso 7b.
    """

    def __init__(self, filas=None):
        self._filas = filas or []
        self.rowcount = len(self._filas)

    def mappings(self):
        return self._filas

    def fetchall(self):
        return self._filas

    def fetchone(self):
        return self._filas[0] if self._filas else None

    def first(self):
        return self._filas[0] if self._filas else None

    def all(self):
        return self._filas

    def scalar(self):
        return None

    def __iter__(self):
        return iter(self._filas)


class _FakeSession:
    """Sesión falsa que registra el SQL y contesta lo justo para que el sync avance.

    `importada`: si la importación de materia prima ya corrió (alguna pieza con
    origen). Es la guarda del paso 7b.
    """

    def __init__(self, sink, importada=False):
        self._sink = sink
        self._importada = importada

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, clause, params=None):
        sql = str(clause)
        self._sink.append(sql)
        # Los mapas de "clave vieja -> id nuevo" tienen que devolver ALGO, si no la
        # materia prima descarta todas las filas por OT/pieza inexistente y el paso
        # nunca llega a emitir su INSERT.
        #
        # Se compara la sentencia completa que arma `_mapa` y no un "FROM orden_trabajo"
        # suelto: eso también matchea `FROM orden_trabajo_pieza`, y devolverle a ESA
        # consulta las filas del mapa de OTs hace que el upsert busque columnas que no
        # existen.
        limpio = " ".join(sql.split())
        if limpio == "SELECT id_otvieja, id FROM orden_trabajo":
            return _FakeResult([{"id_otvieja": 1, "id": 100}])
        if limpio == "SELECT cod_pieza, id FROM pieza":
            return _FakeResult([{"cod_pieza": "PZA-1", "id": 200}])
        # Paso 7b: la guarda y las piezas que ya están (PZA-1, con un precio viejo).
        if "WHERE pieza.origen IS NOT NULL" in limpio:
            return _FakeResult([(1,)] if self._importada else [])
        if limpio.startswith("SELECT pieza.id, pieza.cod_pieza, pieza.fecha_ultimo_precio FROM pieza"):
            return _FakeResult([(200, "PZA-1", None)])
        return _FakeResult()

    async def commit(self):
        pass

    async def rollback(self):
        pass


async def _correr_sync_capturando(importada=False):
    import backend.scripts.sync_db as sync_db

    executed = []
    original_session = sync_db.SessionLocal
    original_leer = sync_db._leer

    async def _leer_falso(sql, params=None):
        for nombre, filas in FILAS_POR_QUERY.items():
            if sql is getattr(sync_db, nombre):
                return filas
        if sql is sync_db.Q_OTS:
            return [_fila_ot()]
        return []

    sync_db.SessionLocal = lambda: _FakeSession(executed, importada)
    sync_db._leer = _leer_falso
    try:
        await sync_db.run_sync()
    finally:
        sync_db.SessionLocal = original_session
        sync_db._leer = original_leer
    return "\n".join(executed)


async def test_run_sync_no_ejecuta_la_ruta_de_procesos():
    sql = await _correr_sync_capturando()
    # Lo central del corte: los procesos por OT los maneja SPMM y solo SPMM.
    assert "orden_trabajo_proceso" not in sql


async def test_run_sync_sigue_sincronizando_el_resto():
    """Lo que el sync TODAVÍA trae del sistema viejo: clientes y artículos.

    Y, una vez hecha la importación de materia prima, los códigos nuevos del catálogo
    y su último precio (paso 7b). Nada de eso se carga en SPMM."""
    sql = await _correr_sync_capturando(importada=True)
    assert "INSERT INTO cliente (" in sql
    assert "INSERT INTO articulo (" in sql
    assert "INSERT INTO pieza (" in sql, "el código nuevo del viejo tiene que entrar"
    assert "INSERT INTO pieza_precio (" in sql, "y su precio de compra, al historial"


async def test_run_sync_ya_no_escribe_la_materia_prima():
    """Con SPMM como dueño de la materia prima (pasos 7 y 8 apagados, espejo apagado).

    El paso 8 reescribía las líneas de las OT en cada pasada con marcas inventadas
    (pedido = cantidad > 0, disponible = 1) y el 7 le ponía 0 al stock de toda pieza
    que alguna vez estuvo en una OT. Si alguien los reactiva, falla acá. Se corre con la
    importación hecha, que es cuando el paso 7b sí escribe en el catálogo."""
    sql = await _correr_sync_capturando(importada=True)
    assert "orden_trabajo_pieza" not in sql, "las líneas de las OT se cargan en SPMM"
    assert "stockactual" not in sql, "el stock es la suma de los movimientos de SPMM"
    assert "UPDATE pieza SET descripcion" not in sql
    for tabla in ("pieza_movimiento", "pieza_recorte", "canera_ocupacion",
                  "orden_trabajo_pieza_corte"):
        assert tabla not in sql, f"el sync no tiene nada que hacer en {tabla}"


async def test_sin_importacion_el_paso_7b_no_trae_nada():
    """Antes de la importación el catálogo de SPMM está a medias (sin tipo, sin fecha
    del último precio): cada código «nuevo» entraría con datos que la importación iba a
    pisar, y sin fecha todos los precios parecerían más nuevos. Así que espera."""
    sql = await _correr_sync_capturando(importada=False)
    assert "INSERT INTO pieza (" not in sql
    assert "pieza_precio" not in sql
    assert "UPDATE pieza" not in sql


async def test_run_sync_ya_no_trae_ordenes_ni_procesos():
    """Desde el 2/9 las OT se crean todas en SPMM.

    Antes el sync hacía un UPSERT por `id_otvieja` cada 5 minutos y le devolvía a cada
    OT lo que decía el legacy —fechas, cantidades, prioridad, sector—, así que lo que
    se corregía acá se perdía solo y sin aviso. Y el catálogo de procesos daba de alta
    un proceso nuevo por cada variante de tipeo del sistema viejo, sin rango ni máquina.

    Este test es el que impide que vuelva sin querer: si alguien reactiva cualquiera de
    las dos rutas, falla acá y no en la cara del taller dos semanas después."""
    sql = await _correr_sync_capturando()
    assert "INSERT INTO orden_trabajo (" not in sql, "las OT ya no se traen del legacy"
    assert "INSERT INTO proceso (" not in sql, "el catálogo de procesos se carga en SPMM"
    # Y tampoco el bloque de zombies, que daba por finalizada toda OT que el legacy no
    # listara como pendiente.
    assert "SET finalizadototal" not in sql


# ─────────────────────── el sync no nombra lo que es de SPMM ───────────────────────

def _codigo_sin_comentarios(ruta):
    """El fuente sin comentarios ni docstrings: lo que el programa HACE. Los comentarios
    de los pasos apagados nombran justamente las tablas que ya no se tocan."""
    import ast

    arbol = ast.parse(ruta.read_text(encoding="utf-8"))
    for nodo in ast.walk(arbol):
        cuerpo = getattr(nodo, "body", None)
        if (isinstance(cuerpo, list) and cuerpo and isinstance(cuerpo[0], ast.Expr)
                and isinstance(cuerpo[0].value, ast.Constant) and isinstance(cuerpo[0].value.value, str)):
            cuerpo[0] = ast.Pass()
    return ast.unparse(arbol)


def test_el_sync_no_nombra_las_tablas_de_materia_prima_de_spmm():
    """Estático: se LEE sync_db.py, no se lo corre.

    Las tablas nuevas de materia prima (movimientos de stock, recortes, cortes de cada
    línea, cañera), las líneas de las OT y el stock de las piezas son de SPMM cuando SPMM
    es el dueño: ahí el sync no las toca (test_con_spmm_el_sync_no_corre_el_espejo). Con
    el Integral como dueño el ESPEJO sí las escribe, pero no desde acá: llama a importar()
    del script de importación, el único lugar que las escribe, y sólo desde
    _espejo_del_integral (test_el_sync_llega_a_la_importacion_solo_por_el_espejo). Si un
    cambio futuro del sync las mete en una consulta propia, esto falla antes de que pise
    lo que se cargó acá. Mismo cuidado que test_consumo_material con consumo_material."""
    from pathlib import Path

    codigo = _codigo_sin_comentarios(
        Path(__file__).resolve().parents[1] / "scripts" / "sync_db.py").lower()
    prohibidos = (
        "pieza_movimiento", "piezamovimiento",
        "pieza_recorte", "piezarecorte",
        "canera_ocupacion", "caneraocupacion",
        "orden_trabajo_pieza_corte", "ordentrabajopiezacorte",
        "orden_trabajo_pieza", "ordentrabajopieza",
        "stockactual",
    )
    for nombre in prohibidos:
        assert nombre not in codigo, f"el sync nombra {nombre}: eso ahora es de SPMM"


# ─────────────────────── paso 7b contra una base de verdad ───────────────────────

import pytest  # noqa: E402
from datetime import date  # noqa: E402

from sqlalchemy import select  # noqa: E402

from backend.domain.Material import Material  # noqa: E402
from backend.domain.MaterialCalidad import MaterialCalidad  # noqa: E402
from backend.domain.Pieza import Pieza  # noqa: E402
from backend.domain.PiezaPrecio import PiezaPrecio  # noqa: E402
from backend.domain.Proveedor import Proveedor  # noqa: E402

HOY = date(2026, 9, 24)


def _del_viejo(codigo, descripcion="X", unitario=0, fecha="", **extra):
    fila = {"Idpieza": codigo, "descripcion": descripcion, "unitario": unitario,
            "unidad": "UN", "fecha": fecha, "insumo": 2, "material": " ", "formato": " ",
            "t1": 0, "t2": 0, "t3": 0, "t4": None, "t5": None, "medida": None,
            "estante": "A", "letra": "A", "nro": "1", "proveedor": "", "obs": "",
            "inactivo": 0}
    fila.update(extra)
    return fila


async def _catalogo_importado(session):
    """Lo que deja la importación: piezas con origen y fecha del último precio."""
    from backend.application.materia_prima.semilla import sembrar_formatos

    await sembrar_formatos(session)
    acero = Material(nombre="ACERO", letra_codigo="A")
    session.add(acero)
    await session.flush()
    session.add(MaterialCalidad(id_material=acero.id, nombre="SAE 1045"))
    session.add(Proveedor(id_legacy=4, razon_social="ACEROS LAVALLE", fantasia="ACEROS LAVALLE"))
    session.add_all([
        Pieza(id=1, cod_pieza="ABC040", descripcion="BARRA CUADRADO 38.1mm ACERO SAE 1045",
              unitario=100.0, unidad="MTS", stockactual=4.86, tipo="insumo",
              fecha_ultimo_precio=date(2026, 9, 1), origen="legacy", stock_minimo=2.0,
              estante="C1", letra="D", nro="6"),
        Pieza(id=2, cod_pieza=" TOR013", descripcion="TORNILLO", unitario=5.0, unidad="UN",
              stockactual=10.0, tipo="insumo_desc", fecha_ultimo_precio=None, origen="legacy"),
        Pieza(id=3, cod_pieza="SIN001", descripcion="SIN PRECIO", unitario=7.0, unidad="UN",
              stockactual=0.0, fecha_ultimo_precio=date(2026, 9, 10), origen="legacy"),
    ])
    await session.commit()


@pytest.mark.asyncio
async def test_7b_sin_importacion_no_escribe_nada(session):
    import backend.scripts.sync_db as sync_db

    session.add(Pieza(id=1, cod_pieza="ABC040", descripcion="X", unitario=1.0))
    await session.commit()
    n, u = await sync_db._altas_y_precios_del_viejo(
        session, [_del_viejo("NUE001", unitario=10, fecha="20/09/2026")], HOY)
    assert (n, u) == (0, 0)
    assert len((await session.execute(select(Pieza))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_7b_da_de_alta_el_codigo_nuevo_con_la_conversion_de_la_importacion(session):
    import backend.scripts.sync_db as sync_db

    await _catalogo_importado(session)
    nueva = _del_viejo(
        " ABC078 ", descripcion="BARRA CUADRADO 1/2\" (12,7mm)    ACERO SAE 1045", unitario=250.5,
        fecha="22/09/2026", insumo=0, material="ACERO", formato="BARRA CUADRADO", t1=1,
        proveedor="ACEROS LAVALLE", estante="C1", letra="D", nro="7")
    n, u = await sync_db._altas_y_precios_del_viejo(session, [nueva], HOY)
    assert (n, u) == (1, 1)

    pieza = (await session.execute(select(Pieza).where(Pieza.cod_pieza == "ABC078"))).scalar_one()
    assert pieza.origen == "legacy" and pieza.tipo == "insumo"
    assert pieza.sistema_medida == "pulgada" and pieza.medida1 == pytest.approx(12.7)
    assert pieza.id_formato is not None and pieza.id_material is not None
    assert pieza.id_calidad is not None, "la calidad sale de la descripción"
    assert pieza.id_proveedor is not None and pieza.proveedor == "ACEROS LAVALLE"
    assert (pieza.estante, pieza.letra, pieza.nro) == ("C1", "D", "7")
    assert pieza.unitario == pytest.approx(250.5)
    assert pieza.fecha_ultimo_precio == date(2026, 9, 22)
    assert pieza.stockactual is None, "el sync no escribe stock: sin movimientos, sin caché"
    assert pieza.stock_minimo is None
    precio = (await session.execute(select(PiezaPrecio).where(PiezaPrecio.id_pieza == pieza.id))).scalar_one()
    assert (precio.origen, precio.fecha, precio.precio) == ("compra", date(2026, 9, 22), pytest.approx(250.5))


@pytest.mark.asyncio
async def test_7b_trae_solo_el_precio_mas_nuevo_y_nada_mas(session):
    """De una pieza que ya está sólo cambia el precio, y sólo si el del viejo es más
    nuevo: la descripción, el stock, el tipo, la ubicación, el mínimo son de SPMM."""
    import backend.scripts.sync_db as sync_db

    await _catalogo_importado(session)
    viejo = [
        # Más nuevo que el de SPMM (01/09): entra. Todo lo demás distinto: no entra.
        _del_viejo("abc040", descripcion="OTRA COSA", unitario=130.0, fecha="23/09/2026",
                   stockactual=999, insumo=1, estante="M1", inactivo=1),
        # SPMM no tiene fecha del precio: cualquiera con fecha es más nuevo. El código
        # del viejo sin el espacio de adelante es el mismo.
        _del_viejo("TOR013", unitario=6.0, fecha="15/08/2026"),
        # Más viejo o igual que el de SPMM: no entra. Y sin precio, tampoco.
        _del_viejo("SIN001", unitario=8.0, fecha="10/09/2026"),
    ]
    n, u = await sync_db._altas_y_precios_del_viejo(session, viejo, HOY)
    assert (n, u) == (0, 2)

    session.expire_all()
    abc = await session.get(Pieza, 1)
    assert (abc.unitario, abc.fecha_ultimo_precio) == (pytest.approx(130.0), date(2026, 9, 23))
    assert abc.descripcion == "BARRA CUADRADO 38.1mm ACERO SAE 1045"
    assert (abc.stockactual, abc.tipo, abc.estante, abc.inactivo) == (pytest.approx(4.86), "insumo", "C1", 0)
    assert abc.stock_minimo == pytest.approx(2.0)
    tor = await session.get(Pieza, 2)
    assert (tor.unitario, tor.fecha_ultimo_precio) == (pytest.approx(6.0), date(2026, 8, 15))
    sin = await session.get(Pieza, 3)
    assert (sin.unitario, sin.fecha_ultimo_precio) == (pytest.approx(7.0), date(2026, 9, 10))

    # Otra pasada con lo mismo no duplica: ya no es más nuevo.
    assert await sync_db._altas_y_precios_del_viejo(session, viejo, HOY) == (0, 0)
    precios = (await session.execute(select(PiezaPrecio))).scalars().all()
    assert sorted((p.id_pieza, p.origen) for p in precios) == [(1, "compra"), (2, "compra")]


def test_el_sync_llega_a_la_importacion_solo_por_el_espejo():
    """Estático: la única puerta del sync a las tablas de materia prima es el espejo
    (_espejo_del_integral, que llama a importar()), y el espejo sólo se llama en la rama
    del Integral como dueño. Lo dinámico está en los tests de abajo."""
    import ast
    from pathlib import Path

    arbol = ast.parse((Path(__file__).resolve().parents[1] / "scripts" / "sync_db.py").read_text(encoding="utf-8"))
    funciones = {n.name: n for n in ast.walk(arbol) if isinstance(n, ast.AsyncFunctionDef | ast.FunctionDef)}
    donde = [nombre for nombre, f in funciones.items()
             if "importar_materia_prima_legacy" in ast.unparse(f)]
    assert donde == ["_espejo_del_integral"], donde
    llamadas = [nombre for nombre, f in funciones.items() if nombre != "_espejo_del_integral"
                and "_espejo_del_integral(" in ast.unparse(f)]
    assert llamadas == ["run_sync"], llamadas
    # Y en run_sync, en la rama de «SPMM no es el dueño».
    rama = next(n for n in ast.walk(funciones["run_sync"])
                if isinstance(n, ast.If) and "spmm_es_dueno()" in ast.unparse(n.test))
    assert "_espejo_del_integral(" not in ast.unparse(rama.body)
    assert "_espejo_del_integral(" in ast.unparse(rama.orelse)


# ─────────────────────── el dueño elige: 7b o el espejo del Integral ───────────────────────

class _Llamadas:
    """Un importar() de mentira que anota con qué lo llamaron."""

    def __init__(self, levanta=None):
        self.llamadas = []
        self.levanta = levanta

    async def __call__(self, pasos, **kw):
        from backend.scripts import importar_materia_prima_legacy as I

        self.llamadas.append({"pasos": tuple(pasos), **kw})
        if self.levanta:
            raise self.levanta
        return I.Resultado(pasos, kw.get("aplicar"))


@pytest.fixture
def importar_falso(monkeypatch):
    """importar() de mentira y la base de la app en un Supabase de mentira (nunca se
    conecta: importar() no corre)."""
    from backend.infrastructure import db
    from backend.scripts import importar_materia_prima_legacy as I

    falso = _Llamadas()
    monkeypatch.setattr(I, "importar", falso)
    monkeypatch.setattr(db, "PG_URL", "postgresql://u:p@db.ejemplo:5432/postgres?sslmode=require")
    return falso


async def test_con_spmm_el_sync_no_corre_el_espejo(monkeypatch, importar_falso):
    """SPMM dueño: el espejo apagado, el 7b como estaba, y ninguna tabla de SPMM."""
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "spmm")
    sql = await _correr_sync_capturando(importada=True)
    assert importar_falso.llamadas == []
    assert "INSERT INTO pieza_precio (" in sql, "el 7b sigue"
    for tabla in ("orden_trabajo_pieza", "stockactual", "pieza_movimiento", "pieza_recorte",
                  "canera_ocupacion", "orden_trabajo_pieza_corte"):
        assert tabla not in sql


@pytest.mark.parametrize("importada, respalda", [(False, True), (True, False)])
async def test_con_el_integral_corre_el_espejo_y_no_el_7b(monkeypatch, importar_falso, importada, respalda):
    """Integral dueño (y es el valor por defecto): el espejo con los pasos del espejo,
    escribiendo, callado, por el pooler 6543 y sin copias salvo la primera vez (ninguna
    pieza con origen: es la importación inicial). El 7b no corre: el espejo trae lo mismo."""
    from backend.scripts import importar_materia_prima_legacy as I

    monkeypatch.delenv("MATERIA_PRIMA_DUENO", raising=False)
    sql = await _correr_sync_capturando(importada=importada)
    assert len(importar_falso.llamadas) == 1
    llamada = importar_falso.llamadas[0]
    assert llamada["pasos"] == I.PASOS_ESPEJO and "recortes" not in llamada["pasos"]
    assert llamada["aplicar"] is True and llamada["silencioso"] is True
    assert llamada["respaldar"] is respalda
    assert llamada["db_url"] == "postgresql://u:p@db.ejemplo:6543/postgres"
    assert "INSERT INTO pieza (" not in sql and "pieza_precio" not in sql, "el 7b no corre"
    # Y el resto del sync sigue.
    assert "INSERT INTO cliente (" in sql


async def test_si_el_espejo_falla_el_sync_sigue(monkeypatch, importar_falso):
    """Un viejo que no contesta (o lo que sea) en el espejo no tumba el sync: el aviso de
    desfasaje (paso 9) igual corre."""
    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    importar_falso.levanta = ConnectionError("el viejo no contesta")
    sql = await _correr_sync_capturando(importada=True)
    assert len(importar_falso.llamadas) == 1
    assert "FROM orden_trabajo WHERE id_otvieja IS NOT NULL AND COALESCE(finalizadototal, 0) = 0" in " ".join(sql.split())


async def test_el_espejo_no_se_cae_si_falta_la_migracion(monkeypatch):
    """Sin la migración 2026-09-23_materia_prima, el espejo verdadero (importar() de
    verdad) no lee el viejo ni escribe nada: lo loguea y el sync sigue."""
    import asyncpg

    import backend.scripts.sync_db as sync_db
    from backend.infrastructure import db

    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    monkeypatch.setattr(db, "PG_URL", "postgresql://u:p@db.ejemplo:5432/postgres")
    conexiones = []

    class _SinMigracion:
        """Una base sin ninguna de las tablas nuevas."""

        async def fetch(self, sql, *args):
            conexiones.append(sql)
            return []

        async def fetchval(self, sql, *args):
            raise AssertionError("no debería llegar a más que la verificación")

        async def execute(self, sql, *args):
            raise AssertionError(f"no debería escribir: {sql}")

        async def close(self):
            pass

    async def _conectar(url, **kw):
        assert url == "postgresql://u:p@db.ejemplo:6543/postgres", url
        return _SinMigracion()

    monkeypatch.setattr(asyncpg, "connect", _conectar)

    async def _no_leer(sql, params=None):
        raise AssertionError("sin la migración no se lee el viejo")

    monkeypatch.setattr(sync_db, "_leer", _no_leer)
    resultado = await sync_db._espejo_del_integral(_FakeSession([]))
    assert resultado.faltan and "falta la tabla material" in resultado.faltan
    assert "no está aplicada" in resultado.renglon()
    assert len(conexiones) == 1, "sólo la verificación"

    # Y el sync entero no se cae (con su lectura del viejo de mentira de siempre).
    sql = await _correr_sync_capturando(importada=False)
    assert "INSERT INTO cliente (" in sql
    assert len(conexiones) == 2, "otra vez sólo la verificación: no pasó de ahí"


async def test_sin_postgres_el_espejo_no_corre(monkeypatch, importar_falso):
    from backend.infrastructure import db

    monkeypatch.setenv("MATERIA_PRIMA_DUENO", "integral")
    monkeypatch.setattr(db, "PG_URL", None)
    await _correr_sync_capturando(importada=True)
    assert importar_falso.llamadas == []
