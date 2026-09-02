"""
Tests del corte del sync (reunión Metlo 2-jul-2026):
`sync_db.run_sync()` NO debe volver a ejecutar la "ruta de procesos"
(los procesos por OT) que pisaba lo editado en SPMM, pero SÍ debe seguir
sincronizando el resto (cabecera de OT, catálogo de procesos, materia prima).

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
    "Q_PIEZAS": [{"cod_pieza": "PZA-1", "descripcion": "Pieza uno", "unitario": 10,
                  "unidad": "u", "stockactual": 5}],
    "Q_MATERIA_PRIMA": [{"_id_otvieja": 1, "_cod_pieza": "PZA-1", "cantidad": 2, "unidad": "u",
                         "pedido": 0, "disponible": 0, "cantusada": 0}],
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
    quedaba mirando un SQL a medio ejecutar.
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

    def scalar(self):
        return None

    def __iter__(self):
        return iter(self._filas)


class _FakeSession:
    """Sesión falsa que registra el SQL y contesta lo justo para que el sync avance."""

    def __init__(self, sink):
        self._sink = sink

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
        return _FakeResult()

    async def commit(self):
        pass

    async def rollback(self):
        pass


async def _correr_sync_capturando():
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

    sync_db.SessionLocal = lambda: _FakeSession(executed)
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
    """Lo que el sync TODAVÍA trae del sistema viejo.

    Clientes, artículos, piezas y la materia prima de las OT que ya están importadas.
    Nada de eso se pisa con lo que se carga en SPMM."""
    sql = await _correr_sync_capturando()
    assert "INSERT INTO orden_trabajo_pieza (" in sql  # materia prima
    assert "INSERT INTO cliente (" in sql
    assert "INSERT INTO articulo (" in sql
    assert "INSERT INTO pieza (" in sql


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
