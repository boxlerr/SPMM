"""Mandar un email (RF-10: el aviso de mantenimiento). Resend, por su API HTTP.

POR QUÉ ESTÁ ACÁ Y ASÍ

La configuración de Resend ya estaba (core/config.py: RESEND_API_KEY y FROM_EMAIL) pero
nadie mandaba nada: el mail de recuperar contraseña quedó como TODO en AuthService. Este
es el primer envío real, y se escribió para que el día que se configure el servicio de
verdad (al final del proyecto, con Cloud Scheduler) ande sin tocar código, y hasta
entonces no rompa nada:

  · Sin RESEND_API_KEY no se intenta: devuelve SIN_CONFIGURAR y quien llama lo anota.
  · Un error de red, un 4xx o un 5xx de Resend no levanta: devuelve FALLO con el motivo.
  · Un email por destinatario, no uno con todos en «Para»: así nadie ve la dirección de
    los demás (la lista de usuarios con su email es confidencial).

Sin dependencias nuevas: urllib de la biblioteca estándar, en un hilo aparte para no
frenar el loop. La imagen de Cloud Run no tiene httpx (sólo está en requirements-dev).

LOS TESTS NO MANDAN NADA: la guardia (tests/guardia_de_la_base.py) vacía RESEND_API_KEY y
bloquea cualquier socket que no sea local; además, `ENVIADOR` se puede pisar con uno de
mentira para ver a quién se le habría mandado.
"""
from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Iterable, Optional

from backend.commons.loggers.logger import logger
from backend.core.config import settings

URL_RESEND = "https://api.resend.com/emails"
TIMEOUT_SEG = 10

SIN_CONFIGURAR = "SIN_CONFIGURAR"
ENVIADO = "ENVIADO"
PARCIAL = "PARCIAL"
FALLO = "FALLO"
SIN_DESTINATARIOS = "SIN_DESTINATARIOS"


@dataclass
class ResultadoEmail:
    estado: str
    enviados: int = 0
    fallidos: int = 0
    # Qué falló, corto y sin direcciones (se guarda en la base y se lee en pantalla).
    detalle: Optional[str] = None
    # A quién se le mandó bien (sólo para quien llama; no se guarda).
    a_quien: list[str] = field(default_factory=list)


def _clave() -> str:
    # El entorno manda sobre lo que se leyó al importar: así un deploy que agrega la
    # variable no necesita que nadie toque settings.
    return (os.getenv("RESEND_API_KEY") or settings.RESEND_API_KEY or "").strip()


def _remitente() -> str:
    return (os.getenv("FROM_EMAIL") or settings.FROM_EMAIL or "").strip()


class EnviadorResend:
    """El que manda de verdad. Uno por proceso (ver ENVIADOR)."""

    def configurado(self) -> bool:
        return bool(_clave() and _remitente())

    def _post(self, cuerpo: dict) -> None:
        pedido = urllib.request.Request(
            URL_RESEND,
            data=json.dumps(cuerpo).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {_clave()}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(pedido, timeout=TIMEOUT_SEG) as r:  # noqa: S310 (URL fija)
            if r.status >= 300:
                raise RuntimeError(f"Resend contestó {r.status}")

    async def enviar_uno(self, para: str, asunto: str, texto: str) -> None:
        await asyncio.to_thread(self._post, {
            "from": _remitente(),
            "to": [para],
            "subject": asunto[:200],
            "text": texto,
        })


# Se pisa en los tests con uno que anota en vez de mandar.
ENVIADOR = EnviadorResend()


async def enviar(destinatarios: Iterable[str], asunto: str, texto: str) -> ResultadoEmail:
    """Manda el mismo email a cada destinatario, de a uno. NUNCA levanta."""
    lista = []
    for d in destinatarios or ():
        d = (d or "").strip()
        if d and d not in lista:
            lista.append(d)
    if not lista:
        return ResultadoEmail(SIN_DESTINATARIOS)

    enviador = ENVIADOR
    try:
        configurado = enviador.configurado()
    except Exception:
        configurado = False
    if not configurado:
        logger.info("Email: el servidor no tiene RESEND_API_KEY / FROM_EMAIL; no se mandó «%s».", asunto)
        return ResultadoEmail(SIN_CONFIGURAR, detalle="El servidor todavía no tiene configurado el envío de emails.")

    ok, errores = [], []
    for para in lista:
        try:
            await enviador.enviar_uno(para, asunto, texto)
            ok.append(para)
        except urllib.error.HTTPError as e:
            errores.append(f"el servicio de mail contestó {e.code}")
        except Exception as e:  # red caída, timeout, lo que sea: no rompe la corrida
            errores.append(type(e).__name__)
    if errores:
        logger.warning("Email: «%s» no salió a %d de %d destinatarios (%s).",
                       asunto, len(errores), len(lista), "; ".join(sorted(set(errores))))
    estado = ENVIADO if not errores else (PARCIAL if ok else FALLO)
    detalle = None
    if errores:
        detalle = (f"No salió a {len(errores)} de {len(lista)}: "
                   + "; ".join(sorted(set(errores))))[:500]
    return ResultadoEmail(estado, enviados=len(ok), fallidos=len(errores), detalle=detalle, a_quien=ok)
