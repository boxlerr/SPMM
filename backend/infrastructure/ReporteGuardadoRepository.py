"""Los reportes personalizados guardados (RF-23). Sólo lee y escribe la tabla: quién puede
qué lo decide application/ReportesGuardadosService.py."""
from sqlalchemy import func, or_, select

from backend.domain.ReporteGuardado import ReporteGuardado


class ReporteGuardadoRepository:
    def __init__(self, db):
        self.db = db

    async def visibles_para(self, id_usuario: int) -> list[ReporteGuardado]:
        """Los de la persona y los compartidos, por nombre."""
        return list((await self.db.execute(
            select(ReporteGuardado)
            .where(or_(ReporteGuardado.id_usuario == id_usuario, ReporteGuardado.compartido.is_(True)))
            .order_by(func.lower(ReporteGuardado.nombre), ReporteGuardado.id)
        )).scalars().all())

    async def cuantos_de(self, id_usuario: int) -> int:
        return (await self.db.execute(
            select(func.count()).select_from(ReporteGuardado)
            .where(ReporteGuardado.id_usuario == id_usuario)
        )).scalar() or 0

    async def buscar(self, id_reporte: int) -> ReporteGuardado | None:
        return await self.db.get(ReporteGuardado, id_reporte)

    async def guardar(self, reporte: ReporteGuardado) -> ReporteGuardado:
        self.db.add(reporte)
        await self.db.commit()
        await self.db.refresh(reporte)
        return reporte

    async def borrar(self, reporte: ReporteGuardado) -> None:
        await self.db.delete(reporte)
        await self.db.commit()
