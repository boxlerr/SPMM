"""
RF-24: la migración de permisos y el catálogo.

Tres cosas dicen cuáles son las áreas, las secciones, los roles y la matriz inicial:
el .sql (la fuente, lo que se corre a mano), su copia en migraciones.py (lo que se
aplica solo al arrancar) y el catálogo de core/permisos.py (contra lo que validan las
dependencias y con lo que se siembran los tests). Si se separan, producción queda con
una matriz distinta de la que se probó y nadie se entera. Esto las ata.

Y la regla que más importa del deploy: todos los usuarios de hoy son admin y tienen
que seguir entrando y viendo todo. La migración no puede tocar ninguna fila existente.
"""
import ast
import re
from pathlib import Path

import pytest
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.core.permisos import (
    AREAS,
    MATRIZ_ROL_AREA,
    MATRIZ_ROL_SECCION,
    NIVELES,
    ROL_ADMIN,
    ROLES,
    SECCIONES,
)
from backend.domain.Permisos import (
    TABLAS_DE_PERMISOS,
    AreaPermiso,
    Rol,
    RolArea,
    RolSeccion,
    SeccionPermiso,
)
from backend.domain.Usuario import Usuario
from backend.infrastructure import migraciones
from backend.infrastructure.db import Base

NOMBRE = "2026-09-22_permisos_por_rol_y_area"
RAIZ = Path(__file__).resolve().parents[2]
SQL = (RAIZ / "backend" / "scripts" / "migrations" / f"{NOMBRE}.sql").read_text()
MODULO = next(sentencias for nombre, sentencias in migraciones.MIGRACIONES if nombre == NOMBRE)


def _sin_notas(sql: str) -> str:
    return re.sub(r"(?m)^\s*--[^\n]*\n?", "", sql)


def _sentencias_del_sql() -> list[str]:
    """Parte el .sql en sentencias por los `;` que están FUERA de un literal (los
    COMMENT tienen `;` adentro)."""
    sentencias, actual, en_literal = [], [], False
    for ch in _sin_notas(SQL):
        if ch == "'":
            en_literal = not en_literal
        if ch == ";" and not en_literal:
            sentencias.append("".join(actual).strip())
            actual = []
            continue
        actual.append(ch)
    sentencias.append("".join(actual).strip())
    return [s for s in sentencias if s]


def _normalizar(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"\( ", "(", re.sub(r" \)", ")", s))


def _inserts(sentencias) -> list[tuple[str, list[tuple]]]:
    """[(tabla, [fila, ...]), ...] de cada INSERT, en orden, con las filas leídas como
    tuplas de Python. Entiende las dos formas que usa la migración: `VALUES ... ON
    CONFLICT` (el catálogo) y `SELECT ... FROM (VALUES ...) AS v` (la siembra única)."""
    resultado = []
    for s in sentencias:
        for parte in re.split(r"(?i)(?=insert into )", _normalizar(s)):
            m = re.match(
                r"(?is)insert into (\w+) \([^)]*\) "
                r"(?:select .*? from \(values (.*?)\) as v|values (.*?) on conflict)",
                parte,
            )
            if not m:
                continue
            valores = m.group(2) or m.group(3)
            filas = [
                ast.literal_eval(
                    "(" + re.sub(r"\bTRUE\b", "True", re.sub(r"\bFALSE\b", "False", t)) + ",)"
                )
                for t in re.findall(r"\(([^()]*)\)", valores)
            ]
            resultado.append((m.group(1), filas))
    return resultado


def _primera_siembra(inserts) -> dict[str, list[tuple]]:
    """{tabla: filas} del PRIMER insert a cada tabla (el de `rol` que va después, el que
    asegura el admin, se mira aparte)."""
    sembrado = {}
    for tabla, filas in inserts:
        sembrado.setdefault(tabla, filas)
    return sembrado


INSERTS_SQL = _inserts(_sentencias_del_sql())
INSERTS_MODULO = _inserts(MODULO)
SEMBRADO_SQL = _primera_siembra(INSERTS_SQL)
SEMBRADO_MODULO = _primera_siembra(INSERTS_MODULO)


def _secciones_de_migraciones_posteriores() -> list[tuple]:
    """Las secciones que agrega una migración POSTERIOR a ésta (un INSERT INTO seccion ...
    ON CONFLICT DO NOTHING). Hoy: auditoria_ingresos (2026-09-23_seccion_ingresos_
    confidencial, la revisión de RF-25). La siembra original ya corrió en producción: una
    sección nueva va en su propia migración, no editando ésa."""
    nombres = [n for n, _ in migraciones.MIGRACIONES]
    filas = []
    for _, sentencias in migraciones.MIGRACIONES[nombres.index(NOMBRE) + 1:]:
        for tabla, nuevas in _inserts(sentencias):
            if tabla == "seccion":
                filas += nuevas
    return filas


SECCIONES_POSTERIORES = _secciones_de_migraciones_posteriores()
# Todas las secciones que termina teniendo la base: la siembra y las que vinieron después.
SECCIONES_SEMBRADAS = SEMBRADO_SQL["seccion"] + SECCIONES_POSTERIORES


# ─────────────────────────── las tres fuentes dicen lo mismo ───────────────────────────


def _es_siembra(s: str) -> bool:
    return s.lstrip().lower().startswith(("insert", "with"))


def test_los_insert_del_modulo_son_los_del_sql():
    del_sql = [_normalizar(s) for s in _sentencias_del_sql() if _es_siembra(s)]
    del_modulo = [_normalizar(s) for s in MODULO if _es_siembra(s)]
    assert len(del_sql) == 4  # área, sección, la siembra única de roles y el admin
    assert del_modulo == del_sql
    assert INSERTS_MODULO == INSERTS_SQL


def test_el_modulo_aplica_todas_las_sentencias_del_sql_y_en_el_mismo_orden():
    """Más estricto que el test general de firmas: acá se compara el DDL entero.
    El orden importa: las FK apuntan a tablas creadas antes, y los INSERT de seccion
    necesitan las áreas."""
    del_sql = [_normalizar(s) for s in _sentencias_del_sql() if not s.lower().startswith("comment")]
    del_modulo = [_normalizar(s) for s in MODULO if not s.lower().startswith("comment")]
    assert del_modulo == del_sql


def test_la_siembra_es_el_catalogo():
    assert SEMBRADO_SQL["area"] == [(a.codigo, a.nombre, a.orden) for a in AREAS]
    # En el orden del catálogo, no en el de las migraciones: la que vino después va al
    # lado de las de su área.
    assert sorted(SECCIONES_SEMBRADAS) == sorted(
        (s.codigo, s.area, s.nombre, s.orden, s.confidencial) for s in SECCIONES
    )
    assert SEMBRADO_SQL["rol"] == list(ROLES)
    assert sorted(SEMBRADO_SQL["rol_area"]) == sorted(
        (rol, area, nivel) for rol, fila in MATRIZ_ROL_AREA.items() for area, nivel in fila.items()
    )
    assert sorted(SEMBRADO_SQL["rol_seccion"]) == sorted(
        (rol, sec, nivel) for rol, fila in MATRIZ_ROL_SECCION.items() for sec, nivel in fila.items()
    )
    assert SEMBRADO_MODULO == SEMBRADO_SQL


# ─────────────────────────── el catálogo tiene sentido ───────────────────────────


def test_catalogo_consistente():
    codigos_area = [a.codigo for a in AREAS]
    codigos_seccion = [s.codigo for s in SECCIONES]
    assert len(set(codigos_area)) == len(codigos_area)
    assert len(set(codigos_seccion)) == len(codigos_seccion)
    assert not set(codigos_area) & set(codigos_seccion), "un código no puede ser área y sección"
    for s in SECCIONES:
        assert s.area in codigos_area, f"{s.codigo} cuelga de un área que no existe"
    for c in codigos_area + codigos_seccion:
        # Entran en las columnas VARCHAR(40) y no traen nada raro.
        assert re.fullmatch(r"[a-z][a-z0-9_]{1,39}", c), c
    for codigo, nombre in ROLES:
        assert re.fullmatch(r"[a-z][a-z0-9_]{1,19}", codigo)  # usuario.rol es VARCHAR(20)
        assert nombre


def test_la_matriz_es_completa_y_valida():
    roles = {c for c, _ in ROLES}
    assert set(MATRIZ_ROL_AREA) == roles, "cada rol tiene su fila en la matriz, aunque sea none"
    for rol, fila in MATRIZ_ROL_AREA.items():
        assert set(fila) == {a.codigo for a in AREAS}, f"a {rol} le falta alguna área"
        assert set(fila.values()) <= set(NIVELES)
    for rol, fila in MATRIZ_ROL_SECCION.items():
        assert rol in roles
        for sec, nivel in fila.items():
            assert sec in {s.codigo for s in SECCIONES}
            assert nivel in NIVELES
    assert set(MATRIZ_ROL_AREA[ROL_ADMIN].values()) == {"admin"}
    assert {"admin", "supervisor", "operario"} <= roles  # los tres del SRS (RF-24)


def test_ningun_rol_que_no_sea_admin_arranca_con_una_confidencial_abierta():
    confidenciales = {s.codigo for s in SECCIONES if s.confidencial}
    assert {"configuracion_usuarios", "dashboard_rendimiento"} <= confidenciales
    for rol, fila in MATRIZ_ROL_SECCION.items():
        if rol == ROL_ADMIN:
            continue
        for sec, nivel in fila.items():
            if sec in confidenciales:
                assert nivel == "none", f"{rol} arranca con {sec} abierta"


def test_cada_item_del_menu_tiene_su_area():
    """Las áreas salen del menú. Un ítem nuevo sin área no lo gobierna nadie.

    Novedades no tiene área a propósito: es de todos (ver core/permisos.py)."""
    sidebar = (RAIZ / "frontend" / "src" / "components" / "Sidebar.tsx").read_text()
    hrefs = re.findall(r'href:\s*"(/[^"]*)"', sidebar)
    assert hrefs, "no encontré los ítems del menú"
    sin_area = {"/novedades"}
    codigos = {a.codigo for a in AREAS}
    for href in hrefs:
        if href in sin_area:
            continue
        assert href.strip("/").replace("-", "_") in codigos, f"el ítem {href} no tiene área"


# ─────────────────────────── seguridad del deploy ───────────────────────────


def _codigo(sentencias) -> str:
    return "\n".join(_normalizar(s).lower() for s in sentencias)


@pytest.mark.parametrize("fuente", ["sql", "modulo"])
def test_no_toca_ninguna_fila_existente(fuente):
    """Nada de UPDATE, DELETE, DROP ni TRUNCATE. Todos los usuarios de hoy son admin y
    siguen siéndolo; admin_permanente arranca en FALSE para todos."""
    codigo = _codigo(_sentencias_del_sql() if fuente == "sql" else MODULO)
    for prohibido in ("update ", "delete from", "drop ", "truncate", "alter column", "create type"):
        assert prohibido not in codigo, f"la migración ({fuente}) tiene {prohibido!r}"
    assert "add column if not exists admin_permanente boolean not null default false" in codigo
    siembra = [s for s in codigo.split("\n") if s.startswith(("insert", "with"))]
    # Ningún INSERT va a usuario.
    assert "insert into usuario " not in codigo
    # El catálogo no pisa lo que se haya cambiado desde la pantalla (la marca de
    # confidencial, los nombres).
    catalogo = [s for s in siembra if s.startswith(("insert into area ", "insert into seccion "))]
    assert len(catalogo) == 2 and all(s.endswith("on conflict (codigo) do nothing") for s in catalogo)
    # Los roles y su matriz se siembran UNA vez: sólo si la tabla rol está vacía, y las
    # filas de la matriz sólo para los roles que se acaban de crear. Así un override o un
    # rol que se borre desde la pantalla no vuelve con el deploy siguiente.
    (unica,) = [s for s in siembra if s.startswith("with ")]
    assert "where not exists (select 1 from rol)" in unica
    assert unica.count("where v.rol_codigo in (select codigo from roles_sembrados)") == 2
    assert "on conflict" not in unica
    # Y el admin, siempre: es el rol de todos los usuarios de hoy.
    assert siembra[-1] == ("insert into rol (codigo, nombre) values ('admin', 'administrador') "
                           "on conflict (codigo) do nothing")


def test_las_secciones_que_vienen_despues_no_pisan_nada():
    """Una sección agregada después (auditoria_ingresos) entra con ON CONFLICT DO NOTHING
    y sin tocar ninguna fila: si ya estaba, o si se le cambió la marca de confidencial
    desde la pantalla, queda como está. Y la del 23/09 arranca cerrada."""
    nombres = [n for n, _ in migraciones.MIGRACIONES]
    for nombre, sentencias in migraciones.MIGRACIONES[nombres.index(NOMBRE) + 1:]:
        for s in sentencias:
            n = _normalizar(s).lower()
            if n.startswith("insert into seccion "):
                assert n.endswith("on conflict (codigo) do nothing"), nombre
            if "seccion" in n:
                for prohibido in ("update ", "delete from", "drop ", "truncate"):
                    assert prohibido not in n, (nombre, prohibido)
    assert ("auditoria_ingresos", "auditoria", "Ingresos y actividad por persona", 13, True) \
        in SECCIONES_POSTERIORES


def _agregadas_despues(tabla: str) -> set[str]:
    """Las columnas que una migración POSTERIOR le agrega a `tabla` (ADD COLUMN IF NOT
    EXISTS en las que vienen después de ésta en MIGRACIONES). Hoy: rol.pantalla_inicio
    (RF-28, 2026-09-22_pantalla_de_inicio)."""
    nombres = [n for n, _ in migraciones.MIGRACIONES]
    posteriores = migraciones.MIGRACIONES[nombres.index(NOMBRE) + 1:]
    agregadas = set()
    for _, sentencias in posteriores:
        for s in sentencias:
            m = re.match(rf"(?is)\s*alter table {tabla}\s+(.*)", s)
            if m:
                agregadas |= set(re.findall(r"(?i)add column if not exists (\w+)", m.group(1)))
    return agregadas


def test_el_orm_coincide_con_la_migracion():
    """Las tablas del ORM (con las que corren los tests) tienen las columnas del .sql, más
    las que les agrega una migración posterior (y ninguna otra)."""
    for tabla in TABLAS_DE_PERMISOS:
        m = re.search(
            rf"(?is)create table if not exists {tabla.name} \((.*?)\);", _sin_notas(SQL)
        )
        assert m, f"el .sql no crea {tabla.name}"
        cuerpo = m.group(1)
        columnas_sql = {
            linea.strip().split()[0]
            for linea in cuerpo.split(",\n")
            if linea.strip() and not re.match(r"(?i)\s*(primary key|constraint)", linea)
        }
        assert columnas_sql | _agregadas_despues(tabla.name) == {c.name for c in tabla.columns}, tabla.name
    assert "admin_permanente" in {c.name for c in Usuario.__table__.columns}
    assert _agregadas_despues("rol") == {"pantalla_inicio"}


@pytest.mark.asyncio
async def test_la_siembra_entra_en_las_tablas_del_orm_y_el_check_frena_un_nivel_raro():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[Usuario.__table__, *TABLAS_DE_PERMISOS]))
    Sesion = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Sesion() as s:
            await sembrar_permisos(s)
            assert len((await s.execute(select(RolArea))).all()) == len(SEMBRADO_SQL["rol_area"])
            assert len((await s.execute(select(SeccionPermiso))).all()) == len(SECCIONES)
        # Un rol nuevo: la fila buena entra y la del nivel raro la frena el CHECK (y no
        # una PK repetida o una FK, que también darían IntegrityError).
        async with Sesion() as s:
            s.add(Rol(codigo="pañolero", nombre="Pañolero"))
            await s.commit()
            await s.execute(insert(RolArea).values(
                rol_codigo="pañolero", area_codigo="planos", nivel="read"))
            await s.commit()
        async with Sesion() as s:
            with pytest.raises(IntegrityError, match="ck_rol_area_nivel|CHECK"):
                await s.execute(insert(RolArea).values(
                    rol_codigo="pañolero", area_codigo="clientes", nivel="mucho"))
                await s.commit()
    finally:
        await engine.dispose()


async def sembrar_permisos(sesion) -> None:
    """Siembra en una base de test EXACTAMENTE lo que siembra la migración (leído del
    .sql). La usan los tests de la API de permisos."""
    for codigo, nombre, orden in SEMBRADO_SQL["area"]:
        sesion.add(AreaPermiso(codigo=codigo, nombre=nombre, orden=orden))
    await sesion.flush()
    for codigo, area, nombre, orden, conf in SECCIONES_SEMBRADAS:
        sesion.add(SeccionPermiso(codigo=codigo, area_codigo=area, nombre=nombre,
                                  orden=orden, confidencial=conf))
    for codigo, nombre in SEMBRADO_SQL["rol"]:
        sesion.add(Rol(codigo=codigo, nombre=nombre))
    await sesion.flush()
    for rol, area, nivel in SEMBRADO_SQL["rol_area"]:
        sesion.add(RolArea(rol_codigo=rol, area_codigo=area, nivel=nivel))
    for rol, sec, nivel in SEMBRADO_SQL["rol_seccion"]:
        sesion.add(RolSeccion(rol_codigo=rol, seccion_codigo=sec, nivel=nivel))
    await sesion.commit()
