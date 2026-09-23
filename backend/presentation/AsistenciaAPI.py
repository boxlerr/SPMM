"""La asistencia y el tiempo efectivo de cada persona (RF-06), en su ficha.

  GET    /operarios/{id}/ausencias                el historial y el total de días del período
  POST   /operarios/{id}/ausencias                cargar una ausencia de un día o de un período
  PUT    /operarios/{id}/ausencias/{id_ausencia}  corregir fechas, motivo u observación
  DELETE /operarios/{id}/ausencias/{id_ausencia}  borrar una cargada por error
  GET    /operarios/{id}/tiempos                  sus pasos de OT: estimado, corrido y efectivo

Las reglas: application/AusenciaService.py y application/TiemposOperarioService.py.
Qué pide cada ruta está en core/permisos_rutas.py, política «asistencia»: leer con
Recursos u Operaciones (la ficha se abre desde las dos), cargar y corregir con la
solapa Recurso humano, que es la que edita a la persona.

El Activo / Ausente NO pasa por acá: sigue siendo el PUT /operarios/{id} de siempre, y
es el guardado de la persona el que deja anotado el cambio con su fecha.
"""
from fastapi import APIRouter, Depends, Request

from backend.application.AusenciaService import AusenciaService, fecha_corta, leer_fecha
from backend.application.TiemposOperarioService import TiemposOperarioService
from backend.commons.loggers.logger import logger
from backend.core.security import get_current_user
from backend.dto.AusenciaRequestDTO import CargarAusenciaDTO, CorregirAusenciaDTO
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


def _dejar_dicho(request: Request, frase: str) -> None:
    """La frase de Auditoría › Todo lo que se hizo. Por método sería «creó persona ›
    ausencias #12», sin decir qué días ni por qué."""
    try:
        request.state.auditoria = {"frase": frase}
    except Exception:
        pass


def _que_dias(a: dict) -> str:
    desde, hasta = leer_fecha(a.get("desde"), "desde"), leer_fecha(a.get("hasta"), "hasta")
    if hasta and hasta != desde:
        return f"del {fecha_corta(desde)} al {fecha_corta(hasta)}"
    return f"el {fecha_corta(desde)}"


def _quien(a: dict, id_operario: int) -> str:
    return a.get("persona") or f"la persona #{id_operario}"


def _por_que(a: dict) -> str:
    return f" ({a['motivo_texto'].lower()})" if a.get("motivo_texto") else ""


@router.get("/operarios/{id_operario}/ausencias")
async def historial(id_operario: int, desde: str | None = None, hasta: str | None = None,
                    db=Depends(get_db)):
    logger.info(f"API - Inicio GET /operarios/{id_operario}/ausencias ({desde} → {hasta})")
    return await AusenciaService(db).historial(id_operario, desde, hasta)


@router.post("/operarios/{id_operario}/ausencias")
async def cargar(id_operario: int, dto: CargarAusenciaDTO, request: Request, db=Depends(get_db),
                 usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio POST /operarios/{id_operario}/ausencias ({dto.desde} → {dto.hasta})")
    salida = await AusenciaService(db).cargar(
        id_operario, dto.desde, dto.hasta, dto.motivo, dto.observacion, usuario=usuario)
    a = salida.data
    _dejar_dicho(request, f"cargó una ausencia de {_quien(a, id_operario)} {_que_dias(a)}{_por_que(a)}")
    return salida


@router.put("/operarios/{id_operario}/ausencias/{id_ausencia}")
async def corregir(id_operario: int, id_ausencia: int, dto: CorregirAusenciaDTO,
                   request: Request, db=Depends(get_db),
                   usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio PUT /operarios/{id_operario}/ausencias/{id_ausencia}")
    salida = await AusenciaService(db).corregir(
        id_operario, id_ausencia, dto.model_dump(exclude_unset=True), usuario=usuario)
    a = salida.data
    _dejar_dicho(request, f"corrigió la ausencia de {_quien(a, id_operario)} {_que_dias(a)}{_por_que(a)}")
    return salida


@router.delete("/operarios/{id_operario}/ausencias/{id_ausencia}")
async def borrar(id_operario: int, id_ausencia: int, request: Request, db=Depends(get_db),
                 usuario: dict = Depends(get_current_user)):
    logger.info(f"API - Inicio DELETE /operarios/{id_operario}/ausencias/{id_ausencia}")
    salida = await AusenciaService(db).borrar(id_operario, id_ausencia, usuario=usuario)
    a = salida.data
    _dejar_dicho(request, f"borró la ausencia de {_quien(a, id_operario)} {_que_dias(a)}{_por_que(a)}")
    return salida


@router.get("/operarios/{id_operario}/tiempos")
async def tiempos(id_operario: int, desde: str | None = None, hasta: str | None = None,
                  db=Depends(get_db)):
    logger.info(f"API - Inicio GET /operarios/{id_operario}/tiempos ({desde} → {hasta})")
    return await TiemposOperarioService(db).tareas(id_operario, desde, hasta)
