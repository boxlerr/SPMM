"""
Toda ruta que el frontend llama tiene que existir en el backend.

El 3/9 Matías no pudo entrar al sistema: la pantalla de «Elegí tu contraseña» le
respondía **Not Found** y lo dejaba encerrado ahí, sin poder hacer otra cosa. El
backend estaba bien y deployado; el front pedía `POST /change-password` cuando el
endpoint vive en `POST /auth/change-password` — el router de auth tiene
`prefix="/auth"` y a esas dos llamadas se les había olvidado.

Es una clase de bug que no se ve en code review ni la ataja TypeScript (la URL es
un string) y que solo aparece cuando alguien la usa. Este test la ataja sola:
junta las URLs que el front arma con `${API_URL}/...` y las compara contra la
tabla de rutas real de FastAPI.

Si este test se pone en rojo, hay dos arreglos posibles y hay que elegir bien:
corregir la URL en el front, o —si el endpoint de verdad falta— escribirlo.
"""
import re
from pathlib import Path

import pytest

from backend.presentation.main import app

FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src"

# `${API_URL}` seguido de la ruta, hasta la comilla que cierra el template string o
# hasta un `?` (los query params no son parte de la ruta).
LLAMADA = re.compile(r"\$\{API_URL\}(/[^`\"'?\s]*)")


def _segmentos(ruta: str) -> list[str]:
    """Parte una ruta en segmentos; los parámetros quedan como None (comodín)."""
    salida = []
    for seg in ruta.strip("/").split("/"):
        if not seg:
            continue
        # `${id}` del front y `{id_usuario}` de FastAPI son lo mismo: un comodín.
        salida.append(None if ("${" in seg or seg.startswith("{")) else seg)
    return salida


def _rutas_del_backend() -> list[list[str | None]]:
    return [_segmentos(r.path) for r in app.routes if getattr(r, "path", None)]


def _existe(ruta_front: str, rutas_backend) -> bool:
    pedida = _segmentos(ruta_front)
    for real in rutas_backend:
        if len(real) != len(pedida):
            continue
        if all(r is None or p is None or r == p for r, p in zip(real, pedida)):
            return True
    return False


def _llamadas_del_front() -> list[tuple[str, str]]:
    """Devuelve (ruta, archivo:linea) de cada `${API_URL}/...` del frontend."""
    encontradas = []
    for archivo in sorted(FRONT.rglob("*.ts")) + sorted(FRONT.rglob("*.tsx")):
        for nro, linea in enumerate(archivo.read_text(encoding="utf-8").splitlines(), 1):
            for ruta in LLAMADA.findall(linea):
                encontradas.append((ruta, f"{archivo.relative_to(FRONT)}:{nro}"))
    return encontradas


@pytest.mark.skipif(not FRONT.exists(), reason="sin el frontend en el repo no hay nada que comparar")
def test_ninguna_llamada_del_front_apunta_a_una_ruta_que_no_existe():
    rutas_backend = _rutas_del_backend()
    llamadas = _llamadas_del_front()

    # Si el regex dejara de matchear, el test pasaría sin revisar nada.
    assert len(llamadas) > 20, f"se esperaban muchas llamadas y se encontraron {len(llamadas)}"

    huerfanas = [
        f"  {origen} → {ruta}"
        for ruta, origen in llamadas
        if not _existe(ruta, rutas_backend)
    ]

    assert not huerfanas, (
        "El front llama rutas que el backend no tiene (el usuario ve «Not Found»):\n"
        + "\n".join(sorted(set(huerfanas)))
    )


@pytest.mark.skipif(not FRONT.exists(), reason="sin el frontend en el repo no hay nada que comparar")
def test_cambiar_password_pega_en_el_endpoint_con_prefijo_auth():
    """
    El caso concreto que dejó a Matías afuera, clavado aparte: las dos pantallas de
    contraseña —la de primer ingreso y la de Configuración— tienen que pegarle a
    `/auth/change-password`. Sin el prefijo el endpoint devuelve 404 y la pantalla
    de primer ingreso no tiene salida: es la única puerta al sistema.
    """
    pantallas = [
        FRONT / "components" / "usuarios" / "PrimerIngreso.tsx",
        FRONT / "components" / "usuarios" / "CambiarPassword.tsx",
    ]
    for pantalla in pantallas:
        assert pantalla.exists(), f"falta {pantalla}"
        codigo = pantalla.read_text(encoding="utf-8")
        llamadas = LLAMADA.findall(codigo)
        assert "/auth/change-password" in llamadas, (
            f"{pantalla.name} no le pega a /auth/change-password (encontrado: {llamadas})"
        )
        assert "/change-password" not in llamadas, (
            f"{pantalla.name} llama /change-password sin el prefijo /auth → 404"
        )


def test_el_backend_expone_change_password_bajo_auth():
    """La otra mitad del contrato: que el endpoint siga estando donde el front lo busca."""
    rutas = {r.path for r in app.routes if getattr(r, "path", None)}
    assert "/auth/change-password" in rutas
    assert "/change-password" not in rutas
