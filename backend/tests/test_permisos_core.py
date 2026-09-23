"""
RF-24: las reglas puras de permisos (backend/core/permisos.py).

La primera mitad es el PORT de don-joaquin/src/lib/permisos-usuarios-core.test.ts,
caso por caso y con los mismos nombres: si las reglas de acá y las de allá dicen cosas
distintas, uno de estos tests lo tiene que ver. La segunda mitad son los casos que
allá no estaban escritos y acá importan (la entrada por usuario que usa la API, los
vencimientos en el borde, lo que pasa con un nivel que no se entiende).
"""
from datetime import datetime, timedelta
from itertools import product

import pytest

from backend.core.permisos import (
    AREAS,
    NIVELES,
    ROL_ADMIN,
    SECCIONES,
    DatosDePermisos,
    EntradaSeccion,
    PermisosUsuario,
    mapa_overrides_vigentes,
    nivel_para_metodo,
    permisos_de,
    resolver_nivel_seccion,
    resolver_permisos,
    resolver_usuarios_con_seccion,
    validar_area,
    validar_nivel,
    validar_seccion,
)

# ───────────────────── port de permisos-usuarios-core.test.ts ─────────────────────
#
# Espejo de la configuración real de DJ: rol admin con área caja en write, el resto
# sin caja, y caja_saldo confidencial (solo dirección). Acá el rol ya es el código.

ROL_ADM = "administrativo"
ROL_OPERATIVO = "operativo"

BARBARA = "u-barbara"  # admin
NICO = "u-nico"  # administrativo + override de caja_saldo
PAULA = "u-paula"  # administrativo, sin caja_saldo
LUCAS = "u-lucas"  # operativo, sin caja_saldo


def entrada(**over) -> EntradaSeccion:
    base = dict(
        usuarios=[
            (BARBARA, ROL_ADMIN),
            (NICO, ROL_ADM),
            (PAULA, ROL_ADM),
            (LUCAS, ROL_OPERATIVO),
        ],
        es_confidencial=True,
        nivel_por_rol_seccion={},
        nivel_por_rol_area={ROL_ADMIN: "write"},
        extra_area={},
        extra_seccion={NICO: "write"},
    )
    base.update(over)
    return EntradaSeccion(**base)


class TestResolverNivelSeccionConfidencial:
    """resolverNivelSeccion — subsección confidencial (caja_saldo)"""

    def test_da_todo_al_rol_admin(self):
        assert resolver_nivel_seccion(entrada(), BARBARA) == "admin"

    def test_cierra_la_seccion_a_quien_no_la_tiene_otorgada(self):
        assert resolver_nivel_seccion(entrada(), PAULA) == "none"
        assert resolver_nivel_seccion(entrada(), LUCAS) == "none"

    def test_abre_la_seccion_con_un_override_por_usuario(self):
        assert resolver_nivel_seccion(entrada(), NICO) == "write"

    def test_no_la_abre_con_el_area_sola_confidencial_exige_otorgarla(self):
        nivel = resolver_nivel_seccion(entrada(extra_area={PAULA: "write"}), PAULA)
        assert nivel == "none"

    def test_la_otorga_por_rol_cuando_existe_rol_secciones(self):
        nivel = resolver_nivel_seccion(entrada(nivel_por_rol_seccion={ROL_ADM: "read"}), PAULA)
        assert nivel == "read"

    def test_desmarcada_como_confidencial_hereda_el_nivel_del_area(self):
        nivel = resolver_nivel_seccion(
            entrada(es_confidencial=False,
                    nivel_por_rol_area={ROL_ADMIN: "write", ROL_ADM: "write"}),
            PAULA,
        )
        assert nivel == "write"

    def test_no_confidencial_el_override_de_rol_solo_restringe_nunca_supera_al_area(self):
        base = dict(es_confidencial=False, nivel_por_rol_area={ROL_ADM: "read"})
        assert resolver_nivel_seccion(
            entrada(**base, nivel_por_rol_seccion={ROL_ADM: "admin"}), PAULA
        ) == "read"
        assert resolver_nivel_seccion(
            entrada(**base, nivel_por_rol_seccion={ROL_ADM: "none"}), PAULA
        ) == "none"


class TestResolverUsuariosConSeccion:
    """resolverUsuariosConSeccion — quién es 'dirección' en la caja"""

    def test_son_direccion_los_admin_y_quien_tenga_caja_saldo_otorgado(self):
        direccion = resolver_usuarios_con_seccion(entrada(), "read")
        assert sorted(direccion) == sorted([BARBARA, NICO])

    def test_los_operadores_quedan_afuera_sus_movimientos_siguen_visibles(self):
        direccion = resolver_usuarios_con_seccion(entrada(), "read")
        assert PAULA not in direccion
        assert LUCAS not in direccion

    def test_respeta_min_nivel_con_read_otorgado_no_alcanza_para_write(self):
        con_read = entrada(extra_seccion={NICO: "read"})
        assert NICO in resolver_usuarios_con_seccion(con_read, "read")
        assert NICO not in resolver_usuarios_con_seccion(con_read, "write")


class TestMapaOverridesVigentes:
    AHORA = datetime(2026, 7, 29, 12, 0, 0)

    def test_ignora_los_vencidos_y_conserva_los_permanentes(self):
        mapa = mapa_overrides_vigentes(
            [
                {"id_usuario": "a", "nivel": "write", "vence_en": None},
                {"id_usuario": "b", "nivel": "write", "vence_en": datetime(2026, 7, 28, 12, 0)},
                {"id_usuario": "c", "nivel": "read", "vence_en": datetime(2026, 8, 30, 12, 0)},
            ],
            self.AHORA,
        )
        assert mapa.get("a") == "write"
        assert "b" not in mapa
        assert mapa.get("c") == "read"

    # ─── lo que DJ no tenía escrito ───

    def test_el_que_vence_justo_ahora_ya_no_cuenta(self):
        """DJ descarta `vence_en <= ahora`: en el instante exacto ya venció."""
        mapa = mapa_overrides_vigentes(
            [{"id_usuario": "a", "nivel": "write", "vence_en": self.AHORA}], self.AHORA
        )
        assert mapa == {}
        un_segundo_despues = self.AHORA + timedelta(seconds=1)
        mapa = mapa_overrides_vigentes(
            [{"id_usuario": "a", "nivel": "write", "vence_en": un_segundo_despues}], self.AHORA
        )
        assert mapa == {"a": "write"}

    def test_indexa_por_la_clave_que_se_pida(self):
        mapa = mapa_overrides_vigentes(
            [{"area_codigo": "planos", "nivel": "read", "vence_en": None}],
            self.AHORA, clave="area_codigo",
        )
        assert mapa == {"planos": "read"}


class TestResolverNivelSeccionBordes:
    def test_un_usuario_que_no_esta_no_tiene_nada(self):
        assert resolver_nivel_seccion(entrada(), "u-nadie") == "none"

    def test_sin_rol_no_tiene_nada_salvo_lo_otorgado(self):
        e = entrada(usuarios=[("x", None)], es_confidencial=False,
                    nivel_por_rol_area={ROL_ADM: "write"})
        assert resolver_nivel_seccion(e, "x") == "none"
        e.extra_seccion = {"x": "read"}
        assert resolver_nivel_seccion(e, "x") == "read"

    def test_el_override_de_persona_en_el_area_sube_la_seccion_no_confidencial(self):
        e = entrada(es_confidencial=False, nivel_por_rol_area={ROL_ADM: "read"},
                    extra_area={PAULA: "write"}, extra_seccion={})
        assert resolver_nivel_seccion(e, PAULA) == "write"

    def test_el_override_de_rol_restringe_aun_con_el_area_subida_por_persona(self):
        e = entrada(es_confidencial=False, nivel_por_rol_area={ROL_ADM: "read"},
                    extra_area={PAULA: "write"}, nivel_por_rol_seccion={ROL_ADM: "read"},
                    extra_seccion={})
        assert resolver_nivel_seccion(e, PAULA) == "read"

    def test_el_override_de_persona_en_la_seccion_supera_la_restriccion_del_rol(self):
        e = entrada(es_confidencial=False, nivel_por_rol_area={ROL_ADM: "write"},
                    nivel_por_rol_seccion={ROL_ADM: "none"}, extra_seccion={PAULA: "read"})
        assert resolver_nivel_seccion(e, PAULA) == "read"

    def test_lo_de_la_persona_nunca_resta(self):
        e = entrada(es_confidencial=False, nivel_por_rol_area={ROL_ADM: "write"},
                    extra_area={PAULA: "read"}, extra_seccion={PAULA: "none"})
        assert resolver_nivel_seccion(e, PAULA) == "write"


# ───────────────────── la entrada por usuario (la que usa la API) ─────────────────────


def _datos(**over) -> DatosDePermisos:
    return DatosDePermisos(**{"rol": "operario", **over})


class TestResolverPermisos:
    def test_admin_es_admin_en_todo_aunque_sus_filas_digan_otra_cosa(self):
        r = resolver_permisos(_datos(
            rol=ROL_ADMIN,
            rol_areas={a.codigo: "none" for a in AREAS},
            rol_secciones={s.codigo: "none" for s in SECCIONES},
            confidenciales={s.codigo: True for s in SECCIONES},
        ))
        assert set(r["areas"].values()) == {"admin"}
        assert set(r["secciones"].values()) == {"admin"}
        assert set(r["areas"]) == {a.codigo for a in AREAS}
        assert set(r["secciones"]) == {s.codigo for s in SECCIONES}

    def test_inactivo_no_tiene_nada_ni_siendo_admin(self):
        r = resolver_permisos(_datos(rol=ROL_ADMIN, activo=False))
        assert set(r["areas"].values()) == {"none"}
        assert set(r["secciones"].values()) == {"none"}

    def test_sin_filas_no_hay_nada(self):
        r = resolver_permisos(_datos())
        assert set(r["areas"].values()) == {"none"}
        assert set(r["secciones"].values()) == {"none"}

    def test_un_rol_que_no_existe_resuelve_a_nada(self):
        r = resolver_permisos(_datos(rol="jefe_de_planta"))
        assert set(r["areas"].values()) == {"none"}

    def test_el_area_es_el_maximo_entre_rol_y_persona(self):
        r = resolver_permisos(_datos(rol_areas={"planos": "read"},
                                     usuario_areas={"planos": "write", "clientes": "read"}))
        assert r["areas"]["planos"] == "write"
        assert r["areas"]["clientes"] == "read"
        r = resolver_permisos(_datos(rol_areas={"planos": "write"},
                                     usuario_areas={"planos": "read"}))
        assert r["areas"]["planos"] == "write"

    def test_la_seccion_hereda_el_area(self):
        r = resolver_permisos(_datos(rol_areas={"operaciones": "write"}))
        for s in ("operaciones_ordenes", "operaciones_planificador",
                  "operaciones_recurso_humano", "operaciones_materia_prima"):
            assert r["secciones"][s] == "write"

    def test_el_override_de_rol_restringe_y_nunca_sube(self):
        r = resolver_permisos(_datos(
            rol_areas={"operaciones": "read"},
            rol_secciones={"operaciones_planificador": "none", "operaciones_ordenes": "admin"},
        ))
        assert r["secciones"]["operaciones_planificador"] == "none"
        assert r["secciones"]["operaciones_ordenes"] == "read"

    def test_confidencial_cerrada_aunque_tenga_el_area_en_admin(self):
        r = resolver_permisos(_datos(rol_areas={"configuracion": "admin", "dashboard": "admin"}))
        assert r["secciones"]["configuracion_usuarios"] == "none"
        assert r["secciones"]["dashboard_rendimiento"] == "none"

    def test_confidencial_se_abre_por_rol_aun_sin_el_area(self):
        r = resolver_permisos(_datos(rol_secciones={"dashboard_rendimiento": "read"}))
        assert r["areas"]["dashboard"] == "none"
        assert r["secciones"]["dashboard_rendimiento"] == "read"

    def test_confidencial_se_abre_por_persona(self):
        r = resolver_permisos(_datos(rol_areas={"dashboard": "read"},
                                     usuario_secciones={"dashboard_rendimiento": "read"}))
        assert r["secciones"]["dashboard_rendimiento"] == "read"

    def test_la_marca_de_la_base_pisa_al_catalogo(self):
        """Desmarcada desde la pantalla, hereda; marcada, se cierra."""
        r = resolver_permisos(_datos(rol_areas={"dashboard": "read", "operaciones": "write"},
                                     confidenciales={"dashboard_rendimiento": False,
                                                     "operaciones_materia_prima": True}))
        assert r["secciones"]["dashboard_rendimiento"] == "read"
        assert r["secciones"]["operaciones_materia_prima"] == "none"

    def test_un_nivel_que_no_se_entiende_no_abre_nada(self):
        r = resolver_permisos(_datos(rol_areas={"planos": "mucho"},
                                     usuario_areas={"clientes": "todo"}))
        assert r["areas"]["planos"] == "none"
        assert r["areas"]["clientes"] == "none"

    def test_un_override_de_rol_que_no_se_entiende_cierra_la_seccion(self):
        r = resolver_permisos(_datos(rol_areas={"operaciones": "write"},
                                     rol_secciones={"operaciones_ordenes": "???"}))
        assert r["secciones"]["operaciones_ordenes"] == "none"

    def test_areas_y_secciones_de_mas_en_la_base_se_ignoran(self):
        r = resolver_permisos(_datos(rol_areas={"area_vieja": "write"},
                                     usuario_secciones={"seccion_vieja": "write"}))
        assert "area_vieja" not in r["areas"]
        assert "seccion_vieja" not in r["secciones"]


def test_las_dos_entradas_dicen_lo_mismo_en_todas_las_combinaciones():
    """La entrada por sección (espejo de DJ) y la entrada por usuario (la de la API)
    comparten la regla; esto recorre TODAS las combinaciones de niveles para una sección
    confidencial y una que no, y exige que den igual."""
    opciones = (None,) + NIVELES
    for conf, rol_area, rol_sec, extra_area, extra_sec in product(
        (False, True), NIVELES, opciones, opciones, opciones
    ):
        seccion = "dashboard_rendimiento"
        por_seccion = resolver_nivel_seccion(
            EntradaSeccion(
                usuarios=[("u", "operario")],
                es_confidencial=conf,
                nivel_por_rol_seccion={"operario": rol_sec} if rol_sec else {},
                nivel_por_rol_area={"operario": rol_area},
                extra_area={"u": extra_area} if extra_area else {},
                extra_seccion={"u": extra_sec} if extra_sec else {},
            ),
            "u",
        )
        por_usuario = resolver_permisos(_datos(
            rol_areas={"dashboard": rol_area},
            rol_secciones={seccion: rol_sec} if rol_sec else {},
            usuario_areas={"dashboard": extra_area} if extra_area else {},
            usuario_secciones={seccion: extra_sec} if extra_sec else {},
            confidenciales={seccion: conf},
        ))["secciones"][seccion]
        assert por_seccion == por_usuario, (conf, rol_area, rol_sec, extra_area, extra_sec)


# ───────────────────── PermisosUsuario ─────────────────────


class TestPermisosUsuario:
    def test_admin_alcanza_todo_incluso_lo_que_no_esta_en_el_mapa(self):
        p = PermisosUsuario(id_usuario=1, username="julian", rol=ROL_ADMIN, areas={}, secciones={})
        assert p.es_admin
        assert p.tiene_area("planos", "admin")
        assert p.tiene_seccion("configuracion_usuarios", "admin")

    def test_niveles(self):
        p = permisos_de(_datos(rol_areas={"planos": "read", "operaciones": "write"}), 5, "matias")
        assert p.tiene_area("planos", "read") and not p.tiene_area("planos", "write")
        assert p.tiene_area("operaciones", "write") and not p.tiene_area("operaciones", "admin")
        assert not p.tiene_area("clientes", "read")
        assert p.tiene_area("clientes", "none")

    def test_como_dict_es_lo_que_viaja_al_front(self):
        p = permisos_de(_datos(rol="supervisor"), 5, "matias", admin_permanente=False)
        d = p.como_dict()
        assert set(d) == {"rol", "es_admin", "admin_permanente", "areas", "secciones"}
        assert d["rol"] == "supervisor" and d["es_admin"] is False
        assert set(d["areas"]) == {a.codigo for a in AREAS}
        assert set(d["secciones"]) == {s.codigo for s in SECCIONES}


# ───────────────────── método HTTP y validaciones ─────────────────────


@pytest.mark.parametrize("metodo,nivel", [
    ("GET", "read"), ("HEAD", "read"), ("OPTIONS", "read"), ("get", "read"),
    ("POST", "write"), ("PUT", "write"), ("PATCH", "write"), ("DELETE", "write"),
    ("PROPFIND", "write"), ("", "write"),
])
def test_nivel_para_metodo(metodo, nivel):
    assert nivel_para_metodo(metodo) == nivel


def test_los_codigos_con_typo_revientan():
    with pytest.raises(ValueError):
        validar_area("operacion")
    with pytest.raises(ValueError):
        validar_seccion("usuarios")
    with pytest.raises(ValueError):
        validar_nivel("lectura")
    assert validar_area("operaciones").nombre == "Operaciones"
