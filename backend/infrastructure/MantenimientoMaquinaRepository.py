"""El mantenimiento preventivo de las máquinas (RF-10): lecturas y escrituras.
Ver domain/MantenimientoMaquina.py y application/MantenimientoMaquinaService.py."""
from __future__ import annotations

from sqlalchemy import delete, func, select

from backend.domain.MantenimientoMaquina import (
    MantenimientoAviso,
    MantenimientoConfig,
    MantenimientoDestinatario,
    MantenimientoHecho,
)
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Usuario import Usuario


class MantenimientoMaquinaRepository:
    def __init__(self, db):
        self.db = db

    # ── la configuración ──

    async def config(self, id_maquinaria: int) -> MantenimientoConfig | None:
        return await self.db.get(MantenimientoConfig, id_maquinaria)

    async def configs(self) -> dict[int, MantenimientoConfig]:
        return {c.id_maquinaria: c for c in (await self.db.execute(select(MantenimientoConfig))).scalars().all()}

    async def maquinas(self) -> list:
        """(id, nombre, frecuencia en días, estado) de todas: la lista es corta (~31)."""
        return list((await self.db.execute(
            select(Maquinaria.id, Maquinaria.nombre, Maquinaria.frecuencia_mantenimiento_dias,
                   Maquinaria.estado_operativo)
        )).all())

    # ── el historial ──

    async def hechos(self, id_maquinaria: int) -> list[MantenimientoHecho]:
        return list((await self.db.execute(
            select(MantenimientoHecho).where(MantenimientoHecho.id_maquinaria == id_maquinaria)
            .order_by(MantenimientoHecho.fecha.desc(), MantenimientoHecho.id.desc())
        )).scalars().all())

    async def ultimo_hecho_por_maquina(self) -> dict[int, object]:
        return {r[0]: r[1] for r in (await self.db.execute(
            select(MantenimientoHecho.id_maquinaria, func.max(MantenimientoHecho.fecha))
            .group_by(MantenimientoHecho.id_maquinaria)
        )).all()}

    async def hecho(self, id_maquinaria: int, id_registro: int) -> MantenimientoHecho | None:
        return (await self.db.execute(
            select(MantenimientoHecho).where(MantenimientoHecho.id == id_registro,
                                             MantenimientoHecho.id_maquinaria == id_maquinaria)
        )).scalar_one_or_none()

    # ── a quién le llega ──

    async def destinatarios(self, id_maquinaria: int) -> list:
        """Los usuarios elegidos que todavía existen, con su email y si están activos."""
        return list((await self.db.execute(
            select(Usuario.id_usuario, Usuario.nombre, Usuario.apellido, Usuario.email, Usuario.activo)
            .join(MantenimientoDestinatario, MantenimientoDestinatario.id_usuario == Usuario.id_usuario)
            .where(MantenimientoDestinatario.id_maquinaria == id_maquinaria)
            .order_by(Usuario.nombre, Usuario.apellido)
        )).all())

    async def emails_de(self, ids_maquina: list[int]) -> dict[int, list[str]]:
        """{máquina: emails} de los elegidos ACTIVOS y con email. Los demás no reciben."""
        if not ids_maquina:
            return {}
        salida: dict[int, list[str]] = {}
        for id_m, email in (await self.db.execute(
            select(MantenimientoDestinatario.id_maquinaria, Usuario.email)
            .join(Usuario, Usuario.id_usuario == MantenimientoDestinatario.id_usuario)
            .where(MantenimientoDestinatario.id_maquinaria.in_(list(ids_maquina)),
                   Usuario.activo.is_(True))
        )).all():
            if email and email.strip():
                salida.setdefault(id_m, []).append(email.strip())
        return salida

    async def usuarios_con_email(self) -> list:
        """Los que pueden recibir el aviso: activos y con email."""
        return [u for u in (await self.db.execute(
            select(Usuario.id_usuario, Usuario.nombre, Usuario.apellido, Usuario.email)
            .where(Usuario.activo.is_(True))
            .order_by(Usuario.nombre, Usuario.apellido)
        )).all() if (u.email or "").strip()]

    async def reemplazar_destinatarios(self, id_maquinaria: int, ids_usuario: list[int]) -> None:
        await self.db.execute(delete(MantenimientoDestinatario)
                              .where(MantenimientoDestinatario.id_maquinaria == id_maquinaria))
        for id_u in ids_usuario:
            self.db.add(MantenimientoDestinatario(id_maquinaria=id_maquinaria, id_usuario=id_u))

    # ── los avisos que ya salieron ──

    async def claves_avisadas(self) -> set[tuple[int, str]]:
        return {(r[0], r[1]) for r in (await self.db.execute(
            select(MantenimientoAviso.id_maquinaria, MantenimientoAviso.clave)
        )).all()}

    async def avisos(self, id_maquinaria: int, cuantos: int = 10) -> list[MantenimientoAviso]:
        return list((await self.db.execute(
            select(MantenimientoAviso).where(MantenimientoAviso.id_maquinaria == id_maquinaria)
            .order_by(MantenimientoAviso.creado_en.desc(), MantenimientoAviso.id.desc())
            .limit(cuantos)
        )).scalars().all())
