"""Los reportes personalizados que cada uno guarda con nombre (RF-23).

LAS REGLAS

  · Es de quien lo guardó: sólo esa persona lo cambia o lo borra. Tampoco un admin toca
    el de otro (si quiere uno parecido, lo abre y lo guarda como suyo).
  · Compartirlo con todos es de un admin (rol de la BASE, no el del token).
  · Se guarda sólo lo que pasa la validación del catálogo CON LOS PERMISOS DE QUIEN GUARDA:
    nadie guarda un reporte de algo que no puede ver.
  · Al listar, cada reporte se vuelve a validar con los permisos de QUIEN MIRA. Uno
    compartido que esa persona no puede correr (es de Auditoría y no tiene Auditoría) no
    se le muestra; uno suyo que dejó de poder correr (le sacaron un permiso) se le muestra
    marcado, para que lo pueda borrar.
"""
from __future__ import annotations

import json
from typing import Optional

from pydantic import BaseModel, Field

from backend.application.ReportesService import ReporteSinPermiso, validar
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.core.permisos import PermisosUsuario
from backend.domain.ReporteGuardado import ReporteGuardado
from backend.infrastructure.ReporteGuardadoRepository import ReporteGuardadoRepository
from backend.infrastructure.estado_ordenes import ahora_ar

# Cuántos puede guardar una persona. Es para que un error de la pantalla (un botón que
# guarda en cada tecla) no llene la tabla, no un límite de uso: nadie arma 200 reportes.
TOPE_POR_PERSONA = 200


class ReporteGuardadoDTO(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    descripcion: Optional[str] = Field(None, max_length=500)
    config: dict
    # Al crear, None es «no». Al editar, None es «como estaba».
    compartido: Optional[bool] = None


def _fecha(valor) -> Optional[str]:
    return valor.replace(microsecond=0).isoformat() if valor else None


class ReportesGuardadosService:
    def __init__(self, db):
        self.db = db
        self.repo = ReporteGuardadoRepository(db)

    # ── lo que ve la pantalla ──

    def _para_pantalla(self, r: ReporteGuardado, id_usuario: int, permisos: PermisosUsuario) -> dict:
        try:
            config = json.loads(r.config)
        except ValueError:
            config = None
        disponible, motivo = True, None
        try:
            if config is None:
                raise BusinessException("El reporte guardado está dañado y no se puede abrir.")
            validar(config, permisos)
        except (BusinessException, ReporteSinPermiso) as e:
            disponible, motivo = False, e.message
        return {
            "id": r.id,
            "nombre": r.nombre,
            "descripcion": r.descripcion,
            "fuente": r.fuente,
            "config": config,
            "compartido": bool(r.compartido),
            "es_mio": r.id_usuario == id_usuario,
            "autor": r.usuario,
            "creado_en": _fecha(r.creado_en),
            "modificado_en": _fecha(r.modificado_en),
            "disponible": disponible,
            "motivo": motivo,
        }

    async def listar(self, id_usuario: int, permisos: PermisosUsuario) -> list[dict]:
        salida = []
        for r in await self.repo.visibles_para(id_usuario):
            fila = self._para_pantalla(r, id_usuario, permisos)
            # El compartido de otro que esta persona no puede correr, no existe para ella.
            if not fila["es_mio"] and not fila["disponible"]:
                continue
            salida.append(fila)
        return salida

    # ── guardar, cambiar, borrar ──

    def _nombre(self, dto: ReporteGuardadoDTO) -> str:
        nombre = " ".join(dto.nombre.split())
        if not nombre:
            raise BusinessException("Ponele un nombre al reporte.")
        return nombre

    async def _nombre_libre(self, id_usuario: int, nombre: str, salvo: Optional[int] = None):
        for r in await self.repo.visibles_para(id_usuario):
            if r.id_usuario == id_usuario and r.id != salvo and r.nombre.lower() == nombre.lower():
                raise BusinessException(f"Ya tenés un reporte que se llama «{nombre}». Elegí otro nombre.")

    def _config_validada(self, dto: ReporteGuardadoDTO, permisos: PermisosUsuario) -> tuple[str, str]:
        plan = validar(dto.config, permisos)
        limpia = plan.config.model_dump(mode="json", exclude_none=True)
        return plan.fuente.codigo, json.dumps(limpia, ensure_ascii=False)

    async def crear(self, dto: ReporteGuardadoDTO, id_usuario: int, es_admin: bool,
                    autor: Optional[str], permisos: PermisosUsuario) -> dict:
        if dto.compartido and not es_admin:
            raise ReporteSinPermiso("Compartir un reporte con todos es de un administrador.")
        nombre = self._nombre(dto)
        fuente, config = self._config_validada(dto, permisos)
        if await self.repo.cuantos_de(id_usuario) >= TOPE_POR_PERSONA:
            raise BusinessException(
                f"Ya tenés {TOPE_POR_PERSONA} reportes guardados. Borrá alguno que no uses para guardar este.")
        await self._nombre_libre(id_usuario, nombre)
        reporte = await self.repo.guardar(ReporteGuardado(
            nombre=nombre,
            descripcion=(dto.descripcion or "").strip() or None,
            fuente=fuente,
            config=config,
            id_usuario=id_usuario,
            usuario=(autor or "").strip() or None,
            compartido=bool(dto.compartido),
            creado_en=ahora_ar(),
        ))
        return self._para_pantalla(reporte, id_usuario, permisos)

    async def _suyo(self, id_reporte: int, id_usuario: int) -> ReporteGuardado:
        reporte = await self.repo.buscar(id_reporte)
        # Uno ajeno y no compartido «no existe» para esta persona: ni siquiera se le dice
        # que lo hay.
        if reporte is None or (reporte.id_usuario != id_usuario and not reporte.compartido):
            raise NotFoundException("Ese reporte guardado no existe (o ya lo borraron).")
        if reporte.id_usuario != id_usuario:
            raise ReporteSinPermiso(
                "Sólo quien guardó este reporte lo puede cambiar o borrar. Si querés uno "
                "parecido, abrilo y guardalo como tuyo.")
        return reporte

    async def editar(self, id_reporte: int, dto: ReporteGuardadoDTO, id_usuario: int, es_admin: bool,
                     permisos: PermisosUsuario) -> dict:
        reporte = await self._suyo(id_reporte, id_usuario)
        if dto.compartido is not None and bool(dto.compartido) != bool(reporte.compartido) and not es_admin:
            raise ReporteSinPermiso("Compartir un reporte con todos (o dejar de compartirlo) es de un administrador.")
        nombre = self._nombre(dto)
        fuente, config = self._config_validada(dto, permisos)
        await self._nombre_libre(id_usuario, nombre, salvo=reporte.id)
        reporte.nombre = nombre
        reporte.descripcion = (dto.descripcion or "").strip() or None
        reporte.fuente = fuente
        reporte.config = config
        if dto.compartido is not None:
            reporte.compartido = bool(dto.compartido)
        reporte.modificado_en = ahora_ar()
        reporte = await self.repo.guardar(reporte)
        return self._para_pantalla(reporte, id_usuario, permisos)

    async def borrar(self, id_reporte: int, id_usuario: int) -> dict:
        reporte = await self._suyo(id_reporte, id_usuario)
        datos = {"id": reporte.id, "nombre": reporte.nombre}
        await self.repo.borrar(reporte)
        return datos
