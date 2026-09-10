from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.infrastructure.db import Base


class Plano(Base):
    """Un plano cuelga de una OT o de un ARTÍCULO, nunca de nada.

    El plano de artículo es el del producto: se carga una vez y lo ven todas las OTs
    de ese artículo. El de OT es el caso puntual —una modificación, un croquis que
    vale solo para ese trabajo—. La base lo garantiza con ck_plano_destino
    (2026-09-06_planos_por_articulo.sql); acá las dos FK son nullable porque cada
    plano usa una sola.
    """

    __tablename__ = "plano"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String(255), nullable=False)
    descripcion = Column(String(500))
    tipo_archivo = Column(String(20))

    # El archivo vive en Supabase Storage (bucket privado `planos`) y acá queda la ruta
    # del objeto. `archivo` es el camino viejo —el blob adentro de la base— y sigue
    # nullable para los planos que todavía no se movieron: quien lee mira storage_path
    # primero y cae al blob si no hay. Ver 2026-09-09_planos_en_storage.sql y
    # backend/infrastructure/storage_planos.py.
    storage_path = Column(String(400), nullable=True)
    archivo = Column(LargeBinary, nullable=True)
    # Bytes del archivo. Con el archivo afuera de la base no hay octet_length que valga,
    # y los listados muestran el peso (el front decide con eso si baja la miniatura).
    tamano = Column(Integer, nullable=True)
    fecha_subida = Column(DateTime, default=datetime.utcnow)

    id_orden_trabajo = Column(Integer, ForeignKey("orden_trabajo.id"), nullable=True)
    id_articulo = Column(Integer, ForeignKey("articulo.id"), nullable=True)

    # De dónde salió el archivo si vino de la carpeta de Drive del taller. Sirve para
    # reimportar sin duplicar: se busca por drive_file_id y, si el md5 cambió, se
    # reemplaza el archivo de esta misma fila en vez de crear otro plano.
    drive_file_id = Column(String(120), nullable=True)
    drive_md5 = Column(String(64), nullable=True)
    drive_modificado = Column(DateTime, nullable=True)

    #relacion con ots
    orden_trabajo = relationship("OrdenTrabajo", back_populates="planos")

    # Sin back_populates: Articulo no declara la contraparte, igual que en
    # OrdenTrabajo.articulo. Agregarla obligaría a tocar Articulo, que lo escribe el
    # sync, y no hace falta: siempre se navega del plano al artículo.
    articulo = relationship("Articulo")
