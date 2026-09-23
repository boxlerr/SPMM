"""Dónde queda la copia automática que se arma antes de cada restauración (RF-19).

EN EL MISMO STORAGE QUE LOS PLANOS, SIN CONFIGURAR NADA NUEVO

El backend ya habla con Supabase Storage para los planos (storage_planos.py), con la
clave secreta del proyecto y un bucket PRIVADO. La copia de antes de restaurar va ahí
mismo, en su carpeta (`copias-de-seguridad/`): mismas credenciales, mismo bucket,
ninguna variable de entorno ni bucket nuevo que dar de alta a mano. Nada de esto llega
al navegador por una URL de Storage: se baja por la API, con el token de siempre y
sólo el admin.

Estas copias traen TODOS los datos, y el bucket es el mismo que sirve los planos a
cualquiera que los vea. Por eso lo que sirve o borra planos no toca esta carpeta
(storage_planos.ruta_permitida_para_planos, en PlanoService), y una restauración no
acepta una fila de `plano` que apunte acá (storage_planos.es_ruta_de_plano). Si algún
día se quiere más aislamiento, el cambio es un bucket propio y privado: sólo PREFIJO y
las tres llamadas de abajo.

Si Storage no está configurado o rechaza la subida, la restauración NO sigue sola: el
admin tiene que haber bajado él mismo la copia del estado actual en ese momento (ver
CopiaSeguridadAPI). Nunca se restaura sin una copia de lo que había.

El barrido de objetos huérfanos de los planos (scripts/planos/migrar_planos_a_storage.py
--huerfanos) saltea esta carpeta: ninguna fila de `plano` apunta a una copia, y sin eso
las borraría.
"""
import asyncio
import json
from typing import BinaryIO

from backend.infrastructure import storage_planos
from backend.infrastructure.copias_de_seguridad import NOMBRE_DE_ARCHIVO

PREFIJO = storage_planos.CARPETA_COPIAS


class DepositoEnStorage:
    donde = "el almacenamiento de Supabase (carpeta «copias-de-seguridad»)"

    def disponible(self) -> bool:
        try:
            storage_planos._credenciales()
            return True
        except RuntimeError:
            return False

    async def guardar(self, nombre: str, archivo: BinaryIO) -> str:
        if not NOMBRE_DE_ARCHIVO.match(nombre):
            raise ValueError(f"Nombre de copia inválido: {nombre!r}")
        archivo.seek(0)
        datos = archivo.read()
        ruta = PREFIJO + nombre
        await storage_planos.subir(ruta, datos, "application/zip")
        return ruta

    async def listar(self) -> list[dict]:
        cuerpo = json.dumps({
            "prefix": PREFIJO,
            "limit": 100,
            "offset": 0,
            "sortBy": {"column": "name", "order": "desc"},
        }).encode("utf-8")
        crudo = await asyncio.to_thread(
            storage_planos._pedir, "POST", f"object/list/{storage_planos.BUCKET}",
            cuerpo, "application/json",
        )
        copias = []
        for item in json.loads(crudo or b"[]"):
            nombre = item.get("name") or ""
            # Sólo las que tienen la forma de una copia: la carpeta no tiene otra cosa,
            # pero lo que no se reconoce no se ofrece para bajar.
            if item.get("id") is None or not NOMBRE_DE_ARCHIVO.match(nombre):
                continue
            copias.append({
                "nombre": nombre,
                "tamano": (item.get("metadata") or {}).get("size"),
            })
        return copias

    async def bajar(self, nombre: str) -> bytes:
        if not NOMBRE_DE_ARCHIVO.match(nombre):
            raise ValueError(f"Nombre de copia inválido: {nombre!r}")
        return await storage_planos.bajar(PREFIJO + nombre)
