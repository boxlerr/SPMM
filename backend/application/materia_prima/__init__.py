"""Materia prima en SPMM (reunión del 23/09/2026: la gestión pasa del sistema viejo a SPMM).

El núcleo que comparten las tres APIs de la sección (catálogo de insumos, materias
primas de la OT, pendientes y cañera) y la importación del viejo:

  reglas.py   funciones PURAS: descripción y código de un insumo, pulgadas, cortes,
              historial. Una sola implementación: el front pide la vista previa al
              backend en vez de repetirlas.
  stock.py    el stock como suma de movimientos (físico / reservado / libre), registrar
              y anular movimientos, y el caché pieza.stockactual.
  estado.py   el estado del material de una OT (la columna Material de las listas) y
              si la OT ya arrancó.
  canera.py   la grilla de la cañera: celdas, ocupaciones vigentes y las de cada OT.
  semilla.py  la lista de formatos (la misma que siembra la migración).
  usuario.py  quién es el usuario del token, como lo estampa el resto del sistema.

NINGUNA FUNCIÓN DE ACÁ HACE COMMIT. Trabajan sobre la sesión que reciben (flush a lo
sumo): el servicio que las llama decide cuándo termina la transacción. Así una
operación de varias partes —marcar disponible una línea reservada crea el egreso de
stock y actualiza la línea— queda entera o no queda.
"""
