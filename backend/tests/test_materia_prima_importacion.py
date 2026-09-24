"""La importación de la materia prima del viejo (scripts/importar_materia_prima_legacy.py).

Mientras el Sistema Integral sea el dueño (la prueba piloto) la corre el ESPEJO del sync en
cada pasada, y a mano se corre las veces que haga falta (con --ots, sobre unas OT). Lo que
persigue este archivo:

  1. **Que el emparejado de líneas SPMM ↔ viejo cambie una línea por otra.** Las líneas
     se actualizan EN SU LUGAR porque consumo_material las apunta por id; si la 2ª tanda
     de un insumo (15714 RUL002 4 + 6) pisara la 1ª, el consumo quedaría colgado de la
     cantidad equivocada. Es la función pura legado.emparejar_lineas.
  2. **Que la importación pise lo que es de SPMM**: una línea o una pieza cargada en SPMM,
     el proveedor que alguien eligió en la ficha, el mínimo, una OT de SPMM que el viejo
     usa con el mismo número para otro trabajo.
  3. **Que una segunda corrida cambie algo** si el viejo no cambió (se corre en cada pasada
     del sync), o que no refleje lo que el viejo sí cambió (una OT que se quedó sin
     líneas, la marca «no lleva» que se sacó, un casillero que se mudó).
  4. **Que le falte una columna el día del corte**: lo que el script necesita tiene que
     existir en los modelos.

La ESCRITURA (UPDATE/INSERT con unnest, las copias de seguridad, la transacción de la
corrida con su candado y un savepoint por paso) es SQL de Postgres: se probó de punta a
punta contra un Postgres local con una copia de producción (dos --aplicar seguidos dejan
las 11 tablas con la misma huella md5; dos corridas a la vez, la segunda no hace nada). Acá corre
la corrida EN SECO sobre SQLite, que es la misma lógica sin el último paso: cada paso
calcula qué haría y lo aplica en memoria para que el siguiente lo vea.
"""
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from backend.application.materia_prima.legado import emparejar_lineas, una_fila_por_codigo
from backend.application.materia_prima.semilla import sembrar_formatos
from backend.domain.Articulo import Articulo
from backend.domain.Cliente import Cliente
from backend.domain.ConsumoMaterial import ConsumoMaterial
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
from backend.domain.Pieza import Pieza
from backend.domain.Prioridad import Prioridad
from backend.domain.Proveedor import Proveedor
from backend.domain.Sector import Sector
from backend.infrastructure.db import Base
from backend.scripts import importar_materia_prima_legacy as I

HOY = date(2026, 9, 24)


# ─────────────────────────── 1. el emparejado de líneas ───────────────────────────

def test_empareja_por_codigo_y_numero_de_aparicion():
    """La 1ª ABR117 de SPMM con la 1ª del viejo, la 2ª con la 2ª. El código se compara
    como en el viejo (sin mayúsculas ni espacios de las puntas)."""
    spmm = [{"id": 1, "codigo": "RUL002"}, {"id": 2, "codigo": " abr117"},
            {"id": 3, "codigo": "RUL002"}, {"id": 4, "codigo": "VIE001"}]
    viejo = [{"idpieza": "ABR117 "}, {"idpieza": "rul002"}, {"idpieza": "RUL002"},
             {"idpieza": "RUL002"}, {"idpieza": "NUE001"}]
    pares, nuevas, sobrantes = emparejar_lineas(spmm, viejo)
    assert [(s["id"], v["idpieza"]) for s, v in pares] == [(2, "ABR117 "), (1, "rul002"), (3, "RUL002")]
    # La 3ª RUL002 del viejo no tiene pareja en SPMM: es una línea nueva, igual que NUE001.
    assert nuevas == [viejo[3], viejo[4]]
    assert sobrantes == [spmm[3]]


def test_dos_lineas_iguales_de_spmm_son_dos_lineas():
    """Se distinguen por identidad, no por contenido: dos líneas idénticas de SPMM (la
    misma pieza cargada dos veces) no se confunden cuando el viejo tiene una sola."""
    a, b = {"codigo": "X"}, {"codigo": "X"}
    pares, nuevas, sobrantes = emparejar_lineas([a, b], [{"idpieza": "X"}])
    assert pares[0][0] is a and nuevas == []
    assert len(sobrantes) == 1 and sobrantes[0] is b


def test_emparejado_con_objetos_y_otros_nombres_de_campo():
    spmm = [SimpleNamespace(id=7, cod="TOR013")]
    viejo = [SimpleNamespace(cod_viejo=" tor013")]
    pares, nuevas, sobrantes = emparejar_lineas(spmm, viejo, "cod", "cod_viejo")
    assert [(s.id, v.cod_viejo) for s, v in pares] == [(7, " tor013")]
    assert nuevas == [] and sobrantes == []
    assert emparejar_lineas([], []) == ([], [], [])


# ─────────────────────────── 2. piezas sueltas del script ───────────────────────────

@pytest.mark.parametrize("a, b, iguales", [
    (4.86, 4.8600000001, True),
    (__import__("decimal").Decimal("4.860"), 4.86, True),   # la base devuelve Decimal
    (" ", None, True),                                     # el viejo guarda ' ' por vacío
    ("TELLO ", "TELLO", True),
    (0, None, False),                                      # 0 es un dato; NULL no
    (True, 1, True),
    (date(2026, 9, 22), date(2026, 9, 22), True),
    (date(2026, 9, 22), date(2026, 9, 23), False),
])
def test_igual_compara_como_la_base(a, b, iguales):
    assert I._igual(a, b) is iguales


def test_codigo_repetido_en_el_viejo_se_queda_con_el_precio_mas_nuevo():
    """dbo.pieza repite '50%004' y '001': la fila que describe la última compra manda."""
    filas = [
        {"Idpieza": "50%004", "fecha": "01/01/2020", "descripcion": "VIEJA"},
        {"Idpieza": "50%004 ", "fecha": "05/05/2024", "descripcion": "NUEVA"},
        {"Idpieza": "50%004", "fecha": "basura", "descripcion": "SIN FECHA"},
        {"Idpieza": "  ", "fecha": "05/05/2024", "descripcion": "SIN CODIGO"},
    ]
    por = una_fila_por_codigo(filas, HOY)
    assert list(por) == ["50%004"]
    assert por["50%004"]["descripcion"] == "NUEVA"


def test_pasos_en_el_orden_de_la_spec_y_en_seco_por_defecto():
    a = I._args(["--pasos", "canera, insumos"])
    assert a.pasos == ["insumos", "canera"] and a.aplicar is False and a.db_url is None
    assert I._args([]).pasos == list(I.PASOS)
    with pytest.raises(SystemExit):
        I._args(["--pasos", "insumos,stok"])


def test_url_de_destino(monkeypatch):
    """Con --db-url, esa tal cual (sin driver ni parámetros: asyncpg no los entiende).
    Sin ella, la de Supabase pasada al pooler 6543: el 5432 admite 15 clientes para
    todo el proyecto y la app ocupa la mayoría."""
    assert I._url("postgresql+asyncpg://u:p@127.0.0.1:5432/spmm?ssl=disable") == \
        "postgresql://u:p@127.0.0.1:5432/spmm"
    # Sin leer el .env de verdad: cargaría en el entorno de los tests las claves que la
    # guardia vació.
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: False)
    monkeypatch.setenv("SUPABASE_DB_URL", "postgres://u:p@db.ejemplo:5432/postgres?sslmode=require")
    assert I._url(None) == "postgresql://u:p@db.ejemplo:6543/postgres"


def test_proveedor_del_viejo():
    datos = I._proveedor_desde_legacy({
        "idProveedor": 12, "Descripcion": " ", "fantasia": "TELLO", "cuit": "20-1", "telefono": None,
        "celular": "", "mail": "x@y", "direccion": "D" * 300, "localidad": None, "obs": None,
        "inactivo": True})
    assert datos["razon_social"] == "TELLO"          # sin razón social, la fantasía
    assert datos["celular"] is None and len(datos["direccion"]) == 200
    assert datos["inactivo"] == 1
    assert I._proveedor_desde_legacy({"idProveedor": 9, "Descripcion": None, "fantasia": None,
                                      "inactivo": 0})["razon_social"] == "PROVEEDOR 9"


@pytest.mark.parametrize("texto, es_cero", [
    ("0", True), ("00", True), ("0.0", True), ("0,0", True), ("0mm", True),
    ("10", False), ("0.5", False), ("1525x3", False),
])
def test_recorte_cero_no_es_un_tramo(texto, es_cero):
    assert bool(I._RECORTE_CERO.match(texto)) is es_cero


def test_lo_que_el_script_necesita_existe_en_los_modelos():
    """Si alguien renombra una columna del modelo, que falle acá y no el día del corte
    (el script aborta si falta algo, pero ese día no hay tiempo de arreglarlo)."""
    for tabla, columnas in I.REQUERIDO.items():
        del_modelo = set(Base.metadata.tables[tabla].columns.keys())
        assert set(columnas) <= del_modelo, (tabla, set(columnas) - del_modelo)
    assert set(I.COLS_LINEA) <= set(Base.metadata.tables["orden_trabajo_pieza"].columns.keys())
    assert set(I.COLS_PROVEEDOR) <= set(Base.metadata.tables["proveedor"].columns.keys())


def test_nunca_escribe_lo_que_es_de_spmm_en_la_pieza():
    """El mínimo y su aviso los carga el pañol en SPMM (el viejo nunca los tuvo); el stock
    lo escribe sólo el paso stock, como caché de los movimientos; el código no se toca."""
    assert not {"stock_minimo", "stock_bajo_avisado_en", "stockactual", "cod_pieza"} & set(I.COLS_PIEZA)


# ─────────────────────────── 3. la corrida en seco sobre SQLite ───────────────────────────

class _Fila(dict):
    """Una fila como las de asyncpg: por nombre y por posición."""

    def __getitem__(self, clave):
        if isinstance(clave, int):
            return list(self.values())[clave]
        return super().__getitem__(clave)


_FECHAS = {"fecha", "fecha_ultimo_precio", "fecha_proveedor", "fecha_entrega"}


class _ConexionSQLite:
    """Lo único de asyncpg que usa una corrida en seco (fetch de SELECTs sin parámetros),
    sobre la sesión SQLite de los tests. SQLite devuelve las fechas como texto en una
    consulta cruda: se vuelven fecha como lo haría asyncpg."""

    def __init__(self, session):
        self.session = session

    async def fetch(self, sql, *args):
        assert not args, "la corrida en seco no manda parámetros"
        filas = []
        for r in (await self.session.execute(text(sql))).mappings().all():
            f = dict(r)
            for k in _FECHAS & set(f):
                if isinstance(f[k], str):
                    f[k] = (date.fromisoformat(f[k]) if len(f[k]) == 10
                            else datetime.fromisoformat(f[k]))
            filas.append(_Fila(f))
        return filas


# El número del cliente ACME en el viejo (cliente.id_viejo): la OT de SPMM es la del viejo
# si coinciden número, artículo, cliente y fecha (I.ots_del_viejo).
CLIENTE_VIEJO = 4

PIEZA_VIEJO = {"unitario": 0, "unidad": "UN", "fecha": "", "insumo": 2, "material": " ",
               "formato": " ", "t1": 0, "t2": 0, "t3": 0, "t4": None, "t5": None, "medida": 0,
               "estante": "A", "letra": "A", "nro": "1", "proveedor": " ", "obs": "", "inactivo": 0}


def _pieza_viejo(codigo, descripcion, **extra):
    return {**PIEZA_VIEJO, "Idpieza": codigo, "descripcion": descripcion, **extra}


def _linea_viejo(ot, codigo, cantidad, un="Un", **extra):
    fila = {"Idot": ot, "idpieza": codigo, "descripcion": f"DESC {codigo.strip()}",
            "cantidad": cantidad, "un": un, "proveedor": "", "observaciones": "", "pendiente": 0,
            "reserva": 0, "creserva": 0.0, "disponible": 0, "pedido": 0,
            "fechaprov": datetime(1900, 1, 1), "usado": 1, "fechaProvE": "  /  /    "}
    fila.update(extra)
    return fila


def _viejo():
    """Un viejo chiquito con los casos de verdad del relevamiento."""
    return {
        "material": [
            {"idMAterial": 1, "Descripcion": "ACERO", "calidad": "SAE 1010"},
            {"idMAterial": 16, "Descripcion": "ACERO", "calidad": "SAE 1045"},
            {"idMAterial": 12, "Descripcion": "PLASTICOS", "calidad": "UHMW/APM"},
        ],
        "proveedor": [
            {"idProveedor": 4, "Descripcion": "ACEROS LAVALLE ", "fantasia": "ACEROS LAVALLE",
             "cuit": "30-1", "telefono": None, "celular": None, "mail": None, "direccion": None,
             "localidad": None, "obs": None, "inactivo": 0},
            {"idProveedor": 340, "Descripcion": "ACEROS CAS SA.", "fantasia": "ACEROS",
             "cuit": None, "telefono": None, "celular": None, "mail": None, "direccion": None,
             "localidad": None, "obs": None, "inactivo": 1},
        ],
        "pieza": [
            _pieza_viejo("ABC040", "BARRA CUADRADO 38.1mm    ACERO SAE 1045", insumo=0,
                         material="ACERO", formato="BARRA CUADRADO", t1=38.1, unitario=61673.3066,
                         unidad="MTS", fecha="06/02/2026", estante="C1", letra="D", nro="6",
                         proveedor="ACEROS LAVALLE"),
            # Mismo código que la de SPMM, con minúscula y espacio adelante; el proveedor
            # no está en la lista: queda el que eligieron a mano en SPMM.
            _pieza_viejo(" tor013", "TORNILLO M8", proveedor="DIMAR", fecha="10/09/2026", unitario=5),
            _pieza_viejo("50%004", "CINTA VIEJA", insumo=1, fecha="01/01/2020"),
            _pieza_viejo("50%004", "CINTA NUEVA", insumo=1, fecha="05/05/2024"),
            _pieza_viejo("NUE001", "NUEVO DEL VIEJO", fecha="20/09/2026", unitario=10),
            _pieza_viejo("SPM001", "DEL VIEJO CON CODIGO DE SPMM"),
        ],
        "historial": [
            {"Idpieza": "ABC040", "precio": 61673.3066, "fecha": "06/02/2026"},
            {"Idpieza": "ABC040", "precio": 58265.625, "fecha": "03/09/2025"},
            {"Idpieza": "ABC040", "precio": 61673.3066, "fecha": "06/02/2026"},   # repetida
            {"Idpieza": "0", "precio": 100, "fecha": "06/02/2026"},              # compra sin código
            {"Idpieza": "ABC040", "precio": 0, "fecha": "07/02/2026"},
            {"Idpieza": "ABC040", "precio": 10, "fecha": "13/10/201 "},          # truncada
            {"Idpieza": "NOEXISTE", "precio": 10, "fecha": "06/02/2026"},
        ],
        "movstock": [
            {"IdPIEZA": "ABC040", "FECHA": datetime(2021, 12, 30), "COMENTARIO": "", "DEBE": 4.86, "ot": None},
            {"IdPIEZA": "ABC040", "FECHA": datetime(2024, 4, 29), "COMENTARIO": "", "DEBE": 1.0, "ot": None},
            {"IdPIEZA": "abc040", "FECHA": datetime(2024, 4, 29), "COMENTARIO": "", "DEBE": -1.0, "ot": None},
            {"IdPIEZA": "ABC040", "FECHA": datetime(2024, 4, 30), "COMENTARIO": "", "DEBE": 0, "ot": None},
            {"IdPIEZA": "NOEXISTE", "FECHA": datetime(2024, 4, 29), "COMENTARIO": "", "DEBE": 3, "ot": None},
        ],
        "recortes": [
            {"idpieza": "ABC040", "recorte": "2777"},
            {"idpieza": "ABC040", "recorte": "1525x3"},
            {"idpieza": "ABC040", "recorte": "2777"},          # otro tramo igual: otro recorte
            {"idpieza": "ABC040", "recorte": "0"},             # renglón vacío de la grilla
            {"idpieza": "NOEXISTE", "recorte": "100"},
        ],
        "lineas": [
            _linea_viejo(15692, "ABC040", 0.2, "Mts", pedido=1, disponible=1, proveedor="ACEROS LAVALLE",
                         observaciones="E4 - soporte", fechaprov=datetime(2026, 9, 22)),
            _linea_viejo(15692, "TOR013", 4, pedido=1, proveedor="DIMAR"),
            _linea_viejo(15692, "tor013", 6, usado=0),       # 2ª tanda del mismo insumo
            _linea_viejo(15692, "ZZZ999", 1),                # código que no es una pieza
            _linea_viejo(15917, "ABC040", 9, "Mts"),        # OT de otro artículo en SPMM
            _linea_viejo(14534, "ABC040", 2.3, "Mts", pedido=1, pendiente=1, reserva=1, creserva=2.0),
            _linea_viejo(99999, "ABC040", 1),                # OT que no está en SPMM
        ],
        "otrabajo": [
            {"idot": 15692, "idarticulo": "A-100", "idcliente": CLIENTE_VIEJO,
             "fecha": datetime(2026, 9, 1), "NOLLEVAMP": 0},
            {"idot": 15917, "idarticulo": "C-VIEJO", "idcliente": CLIENTE_VIEJO,
             "fecha": datetime(2026, 9, 1), "NOLLEVAMP": 1},
            {"idot": 14534, "idarticulo": "a-100 ", "idcliente": CLIENTE_VIEJO,
             "fecha": datetime(2026, 9, 1, 0, 0), "NOLLEVAMP": 1},
        ],
        "cortes": [
            {"idot": 15692, "idpieza": "TOR013", "cant": 3.0, "largo": "1093"},
            {"idot": 15692, "idpieza": "tor013", "cant": 1.0, "largo": "1220x2440"},
            {"idot": 15692, "idpieza": "TOR013", "cant": 0.0, "largo": "50"},
            {"idot": 15692, "idpieza": "ABC040", "cant": 1.0, "largo": "CONFIRMAR"},
            {"idot": 15692, "idpieza": "XXX", "cant": 1.0, "largo": "10"},
            {"idot": 15917, "idpieza": "ABC040", "cant": 1.0, "largo": "10"},
        ],
        "canera": [
            {"ubicacion": "11", "ot": 15692},
            {"ubicacion": "71", "ot": 156920},    # la OT con un 0 de más: no se adivina
            {"ubicacion": "101", "ot": 99999},
            {"ubicacion": "155", "ot": 14534},
            {"ubicacion": "161", "ot": 15692},    # columna 16: no está en la grilla
            {"ubicacion": "81", "ot": None},
        ],
    }


async def _spmm(session):
    """SPMM antes de la importación: lo que dejó el sync (origen NULL, marcas inventadas)
    más algo cargado en SPMM que no se puede tocar."""
    await sembrar_formatos(session)
    session.add_all([
        Prioridad(id=1, descripcion="Normal"), Sector(id=1, nombre="Taller"),
        Articulo(id=1, cod_articulo="A-100", descripcion="Bandeja", abreviatura="B"),
        Articulo(id=2, cod_articulo="B-SPMM", descripcion="Alta en SPMM", abreviatura="S"),
        Cliente(id=1, id_viejo=CLIENTE_VIEJO, nombre="ACME"),
        Proveedor(id=5, razon_social="ELEGIDO A MANO"),
    ])
    await session.flush()  # el proveedor antes que la pieza que lo apunta (sin relationship, el ORM no ordena)
    session.add_all([
        Pieza(id=1, cod_pieza="ABC040", descripcion="BARRA CUADRADO 38.1mm    ACERO SAE 1045",
              unidad="MTS", unitario=50.0, stockactual=11.5, stock_minimo=2.0),
        Pieza(id=2, cod_pieza="TOR013", descripcion="TORNILLO", unidad="UN", stockactual=0.0,
              id_proveedor=5),
        Pieza(id=3, cod_pieza="VIE001", descripcion="YA NO ESTA EN EL VIEJO", stockactual=0.0),
        Pieza(id=4, cod_pieza="SPM001", descripcion="ALTA EN SPMM", origen="spmm", stockactual=0.0),
        Pieza(id=5, cod_pieza="50%004", descripcion="X"),
        Pieza(id=6, cod_pieza="50%004", descripcion="X"),
    ])
    for id_ot, numero, articulo in ((10, 15692, 1), (11, 15917, 2), (12, 14534, 1)):
        session.add(OrdenTrabajo(
            id=id_ot, id_otvieja=numero, id_prioridad=1, id_sector=1, id_articulo=articulo,
            id_cliente=1, unidades=1, fecha_orden=datetime(2026, 9, 1),
            fecha_entrada=datetime(2026, 9, 1), fecha_prometida=datetime(2026, 10, 1)))
    await session.flush()

    def linea(id, ot, pieza, cantidad, **extra):
        return OrdenTrabajoPieza(id=id, id_orden_trabajo=ot, id_pieza=pieza, cantidad=cantidad,
                                 unidad="Un", pedido=1, disponible=1, cantusada=0, **extra)
    session.add_all([
        linea(101, 10, 1, 0.15),
        linea(102, 10, 2, 4),
        linea(103, 10, 3, 1),                    # ya no está en el viejo: se borra
        linea(104, 10, 5, 1),                    # tampoco, pero tiene consumos
        linea(105, 10, 4, 2, origen="spmm"),     # cargada en SPMM
        linea(106, 11, 1, 5),                    # OT de SPMM que el viejo usa para otra cosa
    ])
    session.add(ConsumoMaterial(id_orden_trabajo=10, id_pieza=5, id_orden_trabajo_pieza=104,
                                cantidad=1, fecha=datetime(2026, 9, 20)))
    await session.commit()


def _releer_de(viejo, relecturas=None):
    """La segunda lectura del viejo antes de borrar: por defecto, lo mismo que la primera
    (`viejo["lineas"]`); `relecturas` anota qué OT se releyeron."""
    async def releer(numeros):
        if relecturas is not None:
            relecturas.append(sorted(numeros))
        return [l for l in viejo["lineas"] if l["Idot"] in set(numeros)]
    return releer


async def _correr(session, viejo, estado=None, ots=None, releer=None, **kw):
    ctx = I.Contexto(_ConexionSQLite(session), I.filtrar_ots(viejo, ots), aplicar=False,
                     ejemplos=10, ots=ots, releer=releer or _releer_de(viejo), **kw)
    ctx.hoy = HOY
    ctx.estado = estado or await I.Estado().cargar(ctx.conn)
    for nombre in I.PASOS:
        await I.FUNCIONES[nombre](ctx)
    return ctx, {p.nombre: p for p in ctx.pasos}


@pytest.mark.asyncio
async def test_corrida_en_seco_de_punta_a_punta(session):
    await _spmm(session)
    ctx, pasos = await _correr(session, _viejo())
    est = ctx.estado
    c = {n: p.conteos for n, p in pasos.items()}

    # Catálogos: los materiales del viejo tal cual, las calidades de la tabla + las de
    # las descripciones (ACERO SAE 1045 está en las dos: una sola vez).
    assert c["catalogos"]["materiales nuevos"] == 2
    assert c["catalogos"]["calidades nuevas"] == 3
    assert {m["nombre"]: m["letra_codigo"] for m in est.materiales} == {"ACERO": "A", "PLASTICOS": "P"}
    assert c["proveedores"]["proveedores nuevos"] == 2
    assert c["proveedores"]["  inactivos (de los nuevos)"] == 1

    # Insumos: se actualizan en su lugar (mismo id), se agrega el que falta, se apaga el
    # que el viejo ya no tiene; lo dado de alta en SPMM no se toca.
    assert c["insumos"]["piezas en SPMM que cambian (UPDATE, conservan id)"] == 4
    assert c["insumos"]["códigos que faltan en SPMM (INSERT)"] == 1
    assert c["insumos"]["sólo en SPMM → inactivo=1 (no se borran)"] == 1
    assert c["insumos"]["dados de alta en SPMM y también en el viejo (no se tocan)"] == 1
    piezas = {p["id"]: p for p in est.piezas}
    abc = piezas[1]
    assert (abc["tipo"], abc["origen"], abc["sistema_medida"], abc["medida1"]) == ("insumo", "legacy", "mm", 38.1)
    assert abc["id_formato"] is not None and abc["id_material"] is not None and abc["id_calidad"] is not None
    assert (abc["estante"], abc["letra"], abc["nro"]) == ("C1", "D", "6")
    assert abc["fecha_ultimo_precio"] == date(2026, 2, 6) and abc["unitario"] == pytest.approx(61673.3066)
    lavalle = next(p["id"] for p in est.proveedores if p["id_legacy"] == 4)
    assert abc["id_proveedor"] == lavalle
    tor = piezas[2]
    assert tor["descripcion"] == "TORNILLO M8" and tor["proveedor"] == "DIMAR"
    assert tor["id_proveedor"] == 5, "el texto no nombra a nadie de la lista: queda el elegido a mano"
    assert (tor["estante"], tor["letra"], tor["nro"]) == (None, None, None), "A/A/1 no es un lugar"
    assert piezas[5]["descripcion"] == piezas[6]["descripcion"] == "CINTA NUEVA"
    assert piezas[3]["inactivo"] == 1
    assert piezas[4]["descripcion"] == "ALTA EN SPMM" and piezas[4]["origen"] == "spmm"
    nueva = next(p for p in est.piezas if p["cod_pieza"] == "NUE001")
    assert nueva["origen"] == "legacy" and nueva["stockactual"] == 0.0

    # Precios: limpios y sin repetir.
    assert c["precios"]["precios nuevos (origen import)"] == 2
    assert c["precios"]["ya estaban (o repetidas en el viejo)"] == 1
    for motivo in ("descartadas: compra sin código ('0' o vacío)", "descartadas: precio 0 o negativo",
                   "descartadas: fecha ilegible", "descartadas: código que no existe"):
        assert c["precios"][motivo] == 1, motivo

    # Stock: MOVSTOCK es el saldo; lo que no tiene movimientos queda en 0 (el
    # stockactual del viejo, 11.5, era suma de compras).
    assert c["stock"]["movimientos nuevos (origen legacy)"] == 3
    assert (c["stock"]["descartadas: DEBE = 0"], c["stock"]["descartadas: código que no existe"]) == (1, 1)
    assert piezas[1]["stockactual"] == pytest.approx(4.86)
    assert piezas[5]["stockactual"] == 0.0

    # Recortes: cada fila es un tramo (los dos '2777' son dos), el '0' no.
    assert c["recortes"]["recortes nuevos (origen legacy)"] == 3
    assert c["recortes"]["descartados: vacíos o '0' (no son un tramo)"] == 1
    assert c["recortes"]["huérfanos (el código no existe)"] == 1

    # Líneas: las marcas REALES, en su lugar; la 2ª tanda es otra línea; lo de SPMM y la
    # OT de otro artículo no se tocan; la que tiene consumos se apaga en vez de borrarse.
    assert c["lineas"]["OT de SPMM con líneas en el viejo"] == 2
    assert c["lineas"]["OT de SPMM que no son la del Integral (no se tocan)"] == 1
    assert c["lineas"]["líneas que cambian (UPDATE, conservan id)"] == 2
    assert c["lineas"]["líneas nuevas (INSERT)"] == 3
    assert c["lineas"]["líneas que ya no están en el viejo (DELETE, con copia)"] == 1
    assert c["lineas"]["  ídem pero con consumos o stock: usado=0 en vez de borrar"] == 1
    assert c["lineas"]["piezas creadas inactivas (código de línea sin pieza)"] == 1
    assert c["lineas"]["OT que pasan a «no lleva materia prima»"] == 1
    assert any("OT 15917" in a for a in pasos["lineas"].advertencias)
    lineas = {l["id"]: l for l in est.lineas}
    l101 = lineas[101]
    assert (l101["cantidad"], l101["unidad"], l101["pedido"], l101["disponible"], l101["usado"]) == (0.2, "Mts", 1, 1, 1)
    assert (l101["proveedor"], l101["id_proveedor"], l101["observaciones"]) == ("ACEROS LAVALLE", lavalle, "E4 - soporte")
    assert (l101["fecha_proveedor"], l101["orden"], l101["origen"]) == (date(2026, 9, 22), 1, "legacy")
    assert (lineas[102]["cantidad"], lineas[102]["pedido"], lineas[102]["disponible"], lineas[102]["orden"]) == (4, 1, 0, 2)
    assert 103 not in lineas
    assert lineas[104]["usado"] == 0
    assert lineas[105]["origen"] == "spmm" and lineas[105]["cantidad"] == 2
    assert lineas[106]["cantidad"] == 5 and lineas[106]["origen"] is None
    tanda2 = [l for l in est.lineas if l["id_orden_trabajo"] == 10 and l.get("orden") == 3]
    assert len(tanda2) == 1 and (tanda2[0]["id_pieza"], tanda2[0]["cantidad"], tanda2[0]["usado"]) == (2, 6, 0)
    de_14534 = [l for l in est.lineas if l["id_orden_trabajo"] == 12]
    assert [(l["en_produccion"], l["reserva"], l["cantidad_reservada"]) for l in de_14534] == [(1, 1, 2.0)]
    ots = {o["id_otvieja"]: o for o in est.ots.values()}
    assert ots[14534]["no_lleva_materia_prima"] == 1
    assert ots[15917]["no_lleva_materia_prima"] == 0, "la del viejo es otra OT"

    # Cortes: a la PRIMERA línea de ese (OT, código); lo ilegible queda como texto.
    assert [(x["cantidad"], x["largo_mm"], x["ancho_mm"]) for x in est.cortes[102]] == [(3, 1093, None), (1, 1220, 2440)]
    assert [(x["largo_mm"], x["texto_original"]) for x in est.cortes[101]] == [(None, "CONFIRMAR")]
    assert c["cortes"]["cortes huérfanos (su OT no tiene esa línea)"] == 1
    assert c["cortes"]["cortes descartados: cantidad 0"] == 1
    assert c["cortes"]["cortes de OT de SPMM que no son la del Integral (no se tocan)"] == 1

    # Cañera: número de columna + fila; lo que no es una OT de SPMM, como texto.
    celdas = {(o["columna"], o["fila"]): (o["id_orden_trabajo"], o["ot_texto"]) for o in est.canera}
    assert celdas == {("A", 1): (10, None), ("G", 1): (None, "156920"), ("J", 1): (None, "99999"),
                      ("O", 5): (12, None)}
    assert c["canera"]["números ×10 (quedan como texto)"] == 1
    assert c["canera"]["ubicaciones que no se entienden"] == 1
    assert c["canera"]["casilleros sin número de OT (se saltean)"] == 1


@pytest.mark.asyncio
async def test_la_segunda_corrida_no_cambia_nada(session):
    """Se corre cuantas veces se quiera (el espejo del sync, en cada pasada): con el viejo
    igual, cero cambios. Los cambios son los de I.CAMBIOS, lo que suma el renglón del log
    del espejo: cada clave tiene que ser un conteo que el paso lleva de verdad, si no el
    espejo diría «sin cambios» con cambios."""
    await _spmm(session)
    viejo = _viejo()
    ctx, primera = await _correr(session, viejo)
    for paso, claves in I.CAMBIOS.items():
        for clave in claves:
            assert clave in primera[paso].conteos, (paso, clave)
    assert I.Resultado(I.PASOS, False).cambios() == {}
    _, pasos = await _correr(session, viejo, estado=ctx.estado)
    for paso, claves in I.CAMBIOS.items():
        for clave in claves:
            assert pasos[paso].conteos[clave] == 0, (paso, clave)


@pytest.mark.asyncio
async def test_si_el_viejo_movio_la_canera_se_cierra_y_se_vuelve_a_abrir(session):
    """La cañera legacy se reescribe: la ocupación vieja se cierra (queda el historial) y
    se abre la nueva. Lo que se ubicó en SPMM no se pisa."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    ctx.estado.canera.append({"id": -999, "columna": "B", "fila": 2, "id_orden_trabajo": 12,
                              "ot_texto": None, "origen": "spmm"})
    viejo["canera"] = [{"ubicacion": "11", "ot": 14534}, {"ubicacion": "22", "ot": 15692}]
    _, pasos = await _correr(session, viejo, estado=ctx.estado)
    c = pasos["canera"].conteos
    # Se cierran A1 (cambió de OT), G1, J1 y O5 (ya no están); se abre A1 con la otra OT.
    # B2 la ocupa una asignación de SPMM: no se pisa, se avisa.
    assert c["ocupaciones del viejo que se cierran (hasta = ahora)"] == 4
    assert c["ocupaciones nuevas (origen legacy)"] == 1
    assert any("B2" in a for a in pasos["canera"].advertencias)
    celdas = {(o["columna"], o["fila"]): (o["id_orden_trabajo"], o["origen"]) for o in ctx.estado.canera}
    assert celdas == {("A", 1): (12, "legacy"), ("B", 2): (12, "spmm")}


# ─────────────────────────── 4. gana el Integral, en cada pasada ───────────────────────────

@pytest.mark.asyncio
async def test_una_ot_que_en_el_viejo_se_quedo_sin_lineas_pierde_las_de_aca(session):
    """Si Carolina saca en el Integral la última línea de una OT, el espejo la tiene que
    sacar acá también: antes sólo se miraban las OT con alguna línea en el viejo, y la
    línea quedaba para siempre. La que tiene consumos se apaga en vez de borrarse; la
    cargada en SPMM no se toca; la OT de otro artículo, tampoco."""
    await _spmm(session)
    viejo = _viejo()
    viejo["lineas"] = [l for l in viejo["lineas"] if l["Idot"] not in (15692, 15917)]
    ctx, pasos = await _correr(session, viejo)
    c = pasos["lineas"].conteos
    assert c["OT sin ninguna línea en el viejo (se van las de acá)"] == 1
    lineas = {l["id"]: l for l in ctx.estado.lineas}
    assert not {101, 102, 103} & set(lineas), "las de 15692 se van"
    assert lineas[104]["usado"] == 0, "la que tiene consumos se apaga"
    assert lineas[105]["origen"] == "spmm", "la cargada en SPMM queda"
    assert lineas[106]["cantidad"] == 5, "la OT de otro artículo no se toca"


@pytest.mark.asyncio
async def test_una_ot_que_el_viejo_no_tiene_no_pierde_sus_lineas(session):
    """Una OT que el viejo no tiene en su cabecera (dada de alta en SPMM) no se mira."""
    await _spmm(session)
    viejo = _viejo()
    viejo["lineas"] = [l for l in viejo["lineas"] if l["Idot"] != 15692]
    viejo["otrabajo"] = [o for o in viejo["otrabajo"] if o["idot"] != 15692]
    ctx, pasos = await _correr(session, viejo)
    assert pasos["lineas"].conteos["OT sin ninguna línea en el viejo (se van las de acá)"] == 0
    assert {101, 102, 103, 104} <= {l["id"] for l in ctx.estado.lineas}


@pytest.mark.asyncio
async def test_la_marca_no_lleva_se_saca_si_el_viejo_la_saco(session):
    """Gana el Integral también en «no lleva materia prima»: se pone y se saca. La OT del
    viejo que en SPMM es de otro artículo no se toca en ningún sentido."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    ots = {o["id_otvieja"]: o for o in ctx.estado.ots.values()}
    assert ots[14534]["no_lleva_materia_prima"] == 1
    ots[15917]["no_lleva_materia_prima"] = 1     # como si la hubiesen marcado en SPMM
    for o in viejo["otrabajo"]:
        o["NOLLEVAMP"] = 0
    _, pasos = await _correr(session, viejo, estado=ctx.estado)
    assert pasos["lineas"].conteos["OT que dejan de ser «no lleva materia prima»"] == 1
    assert ots[14534]["no_lleva_materia_prima"] == 0
    assert ots[15917]["no_lleva_materia_prima"] == 1, "la del viejo es otra OT"


def test_filtrar_ots_deja_el_catalogo_entero():
    viejo = I.filtrar_ots(_viejo(), [14534])
    assert [l["Idot"] for l in viejo["lineas"]] == [14534]
    assert [o["idot"] for o in viejo["otrabajo"]] == [14534]
    assert [c["ot"] for c in viejo["canera"]] == [14534]
    assert viejo["cortes"] == []
    for nombre in ("pieza", "historial", "movstock", "recortes", "material", "proveedor"):
        assert viejo[nombre] == _viejo()[nombre], nombre
    assert I.filtrar_ots(_viejo(), None) == _viejo()


@pytest.mark.asyncio
async def test_con_ots_solo_se_tocan_esas_ot(session):
    """--ots 14534: sus líneas, sus cortes y su casillero, como en el viejo. Las otras OT
    no se miran: ni sus líneas (aunque difieran del viejo) ni sus casilleros (que no estén
    en lo leído no quiere decir que se liberaron). El catálogo corre entero."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)                    # la importación de todo
    lineas = {l["id"]: l for l in ctx.estado.lineas}
    lineas[101]["cantidad"] = 99                              # 15692 quedó distinta del viejo
    # En el viejo 14534 se mudó de O5 a B3.
    viejo["canera"] = [{"ubicacion": "11", "ot": 15692}, {"ubicacion": "23", "ot": 14534}]
    _, pasos = await _correr(session, viejo, estado=ctx.estado, ots=[14534])
    assert lineas[101]["cantidad"] == 99, "15692 no es de --ots"
    assert pasos["lineas"].conteos["OT de SPMM con líneas en el viejo"] == 1
    celdas = {(o["columna"], o["fila"]): o["id_orden_trabajo"] or o["ot_texto"] for o in ctx.estado.canera}
    assert celdas == {("A", 1): 10, ("G", 1): "156920", ("J", 1): "99999", ("B", 3): 12}
    c = pasos["canera"].conteos
    assert c["ocupaciones del viejo que se cierran (hasta = ahora)"] == 1   # O5
    assert c["ocupaciones nuevas (origen legacy)"] == 1                     # B3
    assert pasos["insumos"].conteos["códigos en el viejo (normalizados)"] == 5, "el catálogo, entero"


@pytest.mark.asyncio
async def test_con_ots_el_casillero_que_ahora_es_de_esa_ot_se_cierra_aunque_sea_de_otra(session):
    """Si el viejo dice que A1 ahora es de 14534, la ocupación de 15692 en A1 se cierra
    aunque 15692 no esté en --ots: no puede haber dos vigentes en el mismo casillero."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    viejo["canera"] = [{"ubicacion": "11", "ot": 14534}]
    await _correr(session, viejo, estado=ctx.estado, ots=[14534])
    vigentes = {(o["columna"], o["fila"]): o["id_orden_trabajo"] for o in ctx.estado.canera}
    assert vigentes[("A", 1)] == 12 and ("O", 5) not in vigentes


def test_ots_por_linea_de_comandos():
    assert I._args(["--ots", "15692, #14534,15243"]).ots == [15692, 14534, 15243]
    assert I._args([]).ots is None
    for malo in ("15692,abc", ",", "15.692"):
        with pytest.raises(SystemExit):
            I._args(["--ots", malo])


def test_por_el_pooler():
    """La regla del script y del espejo del sync: el 5432 de Supabase pasa al 6543, sin
    driver ni parámetros. Una base local en otro puerto queda como está."""
    assert I.por_el_pooler("postgresql+asyncpg://u:p@aws-0.pooler.supabase.com:5432/postgres?ssl=require") == \
        "postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres"
    assert I.por_el_pooler("postgresql://postgres@127.0.0.1:55432/spmm_e2e") == \
        "postgresql://postgres@127.0.0.1:55432/spmm_e2e"


@pytest.mark.asyncio
async def test_el_renglon_del_espejo(session):
    """Lo que el sync loguea en cada pasada: qué pasos cambiaron cuánto, o «sin cambios»."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    res = I.Resultado(I.PASOS, False)
    res.ctx, res.segundos = ctx, 3.21
    cambios = res.cambios()
    assert cambios["lineas"] >= 5 and cambios["canera"] == 4 and "proveedores" in cambios
    assert res.renglon().startswith("catalogos ") and res.renglon().endswith("avisos; 3.2 s)")

    ctx2 = I.Contexto(_ConexionSQLite(session), viejo, aplicar=False, ejemplos=10,
                      releer=_releer_de(viejo))
    ctx2.hoy, ctx2.estado = HOY, ctx.estado
    for nombre in I.PASOS:
        await I.FUNCIONES[nombre](ctx2)
    res.ctx = ctx2
    assert res.cambios() == {}
    assert res.renglon().startswith("sin cambios (")

    sin = I.Resultado(I.PASOS, True)
    sin.faltan = ["falta la tabla material"]
    assert "no está aplicada" in sin.renglon() and "falta la tabla material" in sin.renglon()
    ocupado = I.Resultado(I.PASOS, True)
    ocupado.ocupado = True
    assert "candado" in ocupado.renglon()


@pytest.mark.asyncio
async def test_escrituras_cuenta_solo_lo_que_escribe():
    """Para no releer todo SPMM después de un paso que no escribió nada."""
    class _Conn:
        async def execute(self, sql, *a):
            return "OK"

        async def fetch(self, sql, *a):
            return []

        async def fetchval(self, sql, *a):
            return 1

    c = I._Escrituras(_Conn())
    await c.execute("SET LOCAL lock_timeout = '10s'")
    await c.fetch("SELECT 1")
    await c.fetchval("SELECT pg_try_advisory_xact_lock($1)", I.CANDADO)
    assert c.escrituras == 0
    await c.execute("  update pieza SET x = 1")
    await c.fetch("INSERT INTO pieza (x) SELECT 1 RETURNING id")
    await c.execute("DELETE FROM orden_trabajo_pieza WHERE id = 1")
    await c.execute("CREATE TABLE IF NOT EXISTS x AS SELECT 1")
    assert c.escrituras == 4


def test_los_pasos_del_espejo():
    """Todos menos recortes (sólo agrega: repetido cada pocos minutos engorda, no refleja)."""
    assert I.PASOS_ESPEJO == tuple(p for p in I.PASOS if p != "recortes")
    assert set(I.CAMBIOS) == set(I.PASOS)


# ───────────── 5. lo que enseñó el arreglo del sync para la prueba piloto ─────────────
# (rama fix/sync-mp-marcas-reales, 24/09/2026: no se sube, esta sección lo reemplaza)

def _ctx_identidad(ots_spmm, cabecera, repetidos=()):
    est = SimpleNamespace(ots={o["id_otvieja"]: o for o in ots_spmm}, numeros_repetidos=set(repetidos))
    return SimpleNamespace(estado=est, viejo={"otrabajo": cabecera})


def _ot(numero, articulo="A-100", cliente=CLIENTE_VIEJO, fecha=datetime(2026, 9, 1, 0, 0)):
    return {"id": numero - 15000, "id_otvieja": numero, "cod_articulo": articulo,
            "cliente_viejo": cliente, "fecha_orden": fecha}


def _cab(numero, articulo="A-100", cliente=CLIENTE_VIEJO, fecha=datetime(2026, 9, 1)):
    return {"idot": numero, "idarticulo": articulo, "idcliente": cliente, "fecha": fecha, "NOLLEVAMP": 0}


def test_una_ot_es_la_del_viejo_si_coinciden_articulo_cliente_y_fecha():
    """SPMM numera sus OT nuevas con max+1 y el Integral por su lado: el 24/09 la próxima
    OT de SPMM iba a salir 15919, que el Integral ya había usado. Con el número no
    alcanza; con el artículo tampoco (el mismo artículo se fabrica muchas veces)."""
    ots = [_ot(15692), _ot(15919, cliente=9), _ot(15920, fecha=datetime(2026, 9, 24, 10, 5)),
           _ot(15921, articulo="OTRO"), _ot(15922), _ot(15923, articulo=" a-100 "), _ot(15924)]
    cabecera = [_cab(15692), _cab(15919), _cab(15920), _cab(15921), _cab(15922),
                _cab(15923, fecha="2026-09-01 00:00:00")]
    iguales, distintas = I.ots_del_viejo(_ctx_identidad(ots, cabecera, repetidos={15922}))
    assert iguales == {15692, 15923}, "el artículo se compara normalizado; la fecha, por el día"
    assert set(distintas) == {15919, 15920, 15921, 15922}
    assert "cliente 9 en SPMM y 4 en el Integral" in distintas[15919]
    assert "fecha 24/09/2026 en SPMM y 01/09/2026 en el Integral" in distintas[15920]
    assert "artículo OTRO en SPMM y A-100 en el Integral" in distintas[15921]
    assert "más de una OT" in distintas[15922]
    # 15924 el Integral no la tiene: no hay contra qué comparar, no se toca.
    assert 15924 not in iguales and 15924 not in distintas


@pytest.mark.asyncio
async def test_una_ot_de_spmm_con_el_numero_de_otra_del_viejo_no_se_toca(session):
    """14534 en SPMM es de otro cliente que la 14534 del viejo: sus líneas, su «no lleva» y
    su casillero no se tocan, y el casillero del viejo queda como texto. Se avisa."""
    await _spmm(session)
    viejo = _viejo()
    for o in viejo["otrabajo"]:
        if o["idot"] == 14534:
            o["idcliente"] = 99
    ctx, pasos = await _correr(session, viejo)
    c = pasos["lineas"].conteos
    assert c["OT de SPMM que no son la del Integral (no se tocan)"] == 2   # 15917 y 14534
    assert not [l for l in ctx.estado.lineas if l["id_orden_trabajo"] == 12], "no se trajo su línea"
    assert ctx.estado.ots[14534]["no_lleva_materia_prima"] == 0
    assert any("OT 14534" in a and "cliente 4 en SPMM y 99 en el Integral" in a
               for a in pasos["lineas"].alertas)
    celdas = {(o["columna"], o["fila"]): (o["id_orden_trabajo"], o["ot_texto"]) for o in ctx.estado.canera}
    assert celdas[("O", 5)] == (None, "14534")
    assert pasos["canera"].conteos["OT de SPMM que no son la del Integral (quedan como texto)"] == 1


@pytest.mark.asyncio
async def test_el_movimiento_de_stock_se_cuelga_solo_de_la_ot_que_es_la_del_viejo(session):
    await _spmm(session)
    viejo = _viejo()
    viejo["movstock"] = [
        {"IdPIEZA": "ABC040", "FECHA": datetime(2026, 9, 2), "COMENTARIO": "RETIRO", "DEBE": -1.0, "ot": 15692},
        {"IdPIEZA": "ABC040", "FECHA": datetime(2026, 9, 3), "COMENTARIO": "", "DEBE": -2.0, "ot": 15917},
    ]
    ctx, pasos = await _correr(session, viejo)
    assert pasos["stock"].conteos["movimientos nuevos (origen legacy)"] == 2
    movs = {m["fecha"].day: m for m in ctx.estado.movimientos_legacy}
    assert (movs[2]["id_orden_trabajo"], movs[2]["comentario"]) == (10, "RETIRO")
    # 15917 en SPMM es otra OT (otro artículo): el número queda en el comentario.
    assert (movs[3]["id_orden_trabajo"], movs[3]["comentario"]) == (None, "OT 15917 del sistema viejo")


@pytest.mark.asyncio
async def test_lo_que_esta_en_la_segunda_lectura_no_se_borra(session):
    """El Integral graba la solapa de materiales borrando y volviendo a insertar, y no lee
    con snapshot: la primera lectura puede caer en medio. Se borra sólo lo que falta en
    las DOS lecturas, y se relee sólo lo de las OT con algo para borrar."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)                        # la importación de todo
    antes = {l["id"] for l in ctx.estado.lineas if l["id_orden_trabajo"] == 10}
    a_medio_grabar = dict(viejo, lineas=[l for l in viejo["lineas"] if l["Idot"] != 15692])
    relecturas = []
    _, pasos = await _correr(session, a_medio_grabar, estado=ctx.estado,
                             releer=_releer_de(viejo, relecturas))
    c = pasos["lineas"].conteos
    assert relecturas == [[15692]]
    assert c["líneas que ya no están en el viejo (DELETE, con copia)"] == 0
    assert c["líneas que no se borran: están en la segunda lectura del viejo"] >= 3
    assert antes <= {l["id"] for l in ctx.estado.lineas}

    # Si en la segunda lectura TAMPOCO están, se van (menos lo cargado en SPMM y lo que
    # tiene consumos, que se apaga).
    _, pasos = await _correr(session, a_medio_grabar, estado=ctx.estado)
    c = pasos["lineas"].conteos
    assert c["líneas que ya no están en el viejo (DELETE, con copia)"] >= 3
    quedan = {l["id"]: l for l in ctx.estado.lineas if l["id_orden_trabajo"] == 10}
    assert set(quedan) == {104, 105} and quedan[104]["usado"] == 0


@pytest.mark.asyncio
async def test_con_la_lectura_de_lineas_vacia_no_se_borra_nada(session):
    """Una lectura vacía de TODAS las líneas es una lectura que falló: sin esto, cada OT
    de la cabecera quedaba «sin ninguna línea» y se borraba todo."""
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    n_antes = len(ctx.estado.lineas)
    vacio = dict(viejo, lineas=[])
    _, pasos = await _correr(session, vacio, estado=ctx.estado,
                             releer=lambda numeros: pytest.fail("no hay nada que releer"))
    c = pasos["lineas"].conteos
    assert c["líneas que ya no están en el viejo (DELETE, con copia)"] == 0
    assert c["  ídem pero con consumos o stock: usado=0 en vez de borrar"] == 0
    assert len(ctx.estado.lineas) == n_antes
    assert any("ninguna línea" in a for a in pasos["lineas"].alertas)


@pytest.mark.asyncio
async def test_por_encima_del_tope_el_espejo_no_borra_ninguna_y_a_mano_sigue(session):
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    sin_15692 = dict(viejo, lineas=[l for l in viejo["lineas"] if l["Idot"] != 15692])
    ids_antes = {l["id"] for l in ctx.estado.lineas}

    # 15692 se quedó sin líneas en el viejo: se van sus 4 líneas legacy (la 104, con
    # consumos, ya quedó apagada en la primera corrida; la 105 es de SPMM).
    # El espejo (frena) con tope 3 → no se toca ninguna.
    _, pasos = await _correr(session, sin_15692, estado=ctx.estado, releer=_releer_de(sin_15692),
                             tope_borrado=3, frenar_en_tope=True)
    c = pasos["lineas"].conteos
    assert c["líneas que no se borran por el tope de la pasada"] == 4
    assert c["líneas que ya no están en el viejo (DELETE, con copia)"] == 0
    assert {l["id"] for l in ctx.estado.lineas} == ids_antes
    assert any("tope de 3" in a for a in pasos["lineas"].alertas)

    # En el tope justo, sí.
    _, pasos = await _correr(session, sin_15692, estado=ctx.estado, releer=_releer_de(sin_15692),
                             tope_borrado=4, frenar_en_tope=True)
    assert pasos["lineas"].conteos["líneas que ya no están en el viejo (DELETE, con copia)"] == 4
    assert not [a for a in pasos["lineas"].alertas if "tope" in a]


@pytest.mark.asyncio
async def test_a_mano_por_encima_del_tope_avisa_y_borra(session):
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    sin_15692 = dict(viejo, lineas=[l for l in viejo["lineas"] if l["Idot"] != 15692])
    _, pasos = await _correr(session, sin_15692, estado=ctx.estado, releer=_releer_de(sin_15692),
                             tope_borrado=1)
    assert pasos["lineas"].conteos["líneas que ya no están en el viejo (DELETE, con copia)"] == 4
    assert any("corrida a mano: se sigue" in a for a in pasos["lineas"].alertas)


@pytest.mark.asyncio
async def test_lecturas_vacias_del_catalogo_los_cortes_y_la_canera_no_borran_nada(session):
    await _spmm(session)
    viejo = _viejo()
    ctx, _ = await _correr(session, viejo)
    est = ctx.estado
    inactivas = sum(1 for p in est.piezas if p.get("inactivo") == 1)
    con_cortes = {i for i, c in est.cortes.items() if c}
    vigentes = len(est.canera)
    vacio = dict(viejo, pieza=[], cortes=[], canera=[])
    _, pasos = await _correr(session, vacio, estado=est)
    assert sum(1 for p in est.piezas if p.get("inactivo") == 1) == inactivas
    assert {i for i, c in est.cortes.items() if c} == con_cortes and con_cortes
    assert len(est.canera) == vigentes and vigentes
    for nombre in ("insumos", "cortes", "canera"):
        assert pasos[nombre].alertas, nombre


def test_el_borrado_vuelve_a_mirar_los_consumos_en_el_mismo_delete():
    """Estático (el DELETE es SQL de Postgres; se probó en el ensayo general): una línea
    con consumos o movimientos no se borra nunca, aunque se los hayan cargado después de
    leer SPMM (la API de consumos no la frena el dueño de la materia prima)."""
    import inspect

    fuente = " ".join(inspect.getsource(I.paso_lineas).split())
    borrado = fuente[fuente.index('"DELETE FROM orden_trabajo_pieza'):]
    borrado = borrado[:borrado.index("[b[")]
    assert "NOT EXISTS (SELECT 1 FROM consumo_material" in borrado
    assert "NOT EXISTS (SELECT 1 FROM pieza_movimiento" in borrado
    assert I._filas_afectadas("DELETE 3") == 3 and I._filas_afectadas(None) is None


def test_la_relectura_pide_las_mismas_columnas_solo_de_esas_ot():
    assert I.Q_LINEAS_DE_ESTAS_OT.startswith(I.Q_LINEAS.rstrip())
    assert I.Q_LINEAS_DE_ESTAS_OT.format(ids="1,2").rstrip().endswith("WHERE Idot IN (1,2)")
    assert I.TOPE_BORRADO_LINEAS == 400


def test_la_importacion_lee_los_consumos_pero_no_los_escribe():
    """consumo_material es de SPMM (el taller carga lo consumido acá, también durante la
    prueba piloto). La importación —y con ella el espejo del sync— la LEE para no borrar
    una línea con consumos; escribirla, nunca. Se exige que, en el código (sin docstrings
    ni comentarios), el nombre de la tabla aparezca sólo detrás de un FROM de lectura: el
    SQL se arma con f-strings, así que buscar «INSERT INTO consumo_material» no alcanza.
    (Mismo control que el arreglo del sync para la prueba piloto.)"""
    import ast
    import inspect
    import re

    arbol = ast.parse(inspect.getsource(I))
    docstrings = set()
    for nodo in ast.walk(arbol):
        if isinstance(nodo, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            primero = nodo.body[0] if nodo.body else None
            if (isinstance(primero, ast.Expr) and isinstance(primero.value, ast.Constant)
                    and isinstance(primero.value.value, str)):
                docstrings.add(id(primero.value))
    textos = [n.value.lower() for n in ast.walk(arbol)
              if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings
              and "consumo_material" in n.value.lower()]
    assert textos, "la importación lee consumo_material para no dejar consumos huérfanos"
    for texto in textos:
        for m in re.finditer(r"consumo_material", texto):
            antes = texto[:m.start()].split()
            assert antes[-1:] == ["from"] and antes[-2:-1] != ["delete"], texto.strip()
