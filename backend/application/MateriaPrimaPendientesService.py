"""Pendientes (la pantalla de compras de Maxi) y la cañera (spec §2.3).

QUÉ OT ENTRAN (EL UNIVERSO)

  · `ot=N`: esa OT (N es el número que ve la gente, id_otvieja), esté como esté y sin
    mirar la semana: pedirla por número es querer verla.
  · `todas_abiertas`: todas las OT abiertas (ni finalizadas ni suspendidas).
  · si no, una SEMANA (la de hoy si no se pide otra). De dónde sale depende de quién es el
    dueño de la materia prima (application/materia_prima/dueno.py), y la respuesta lo
    dice en `fuente_semana`:
      - 'integral' (la prueba piloto): las OT abiertas del PLAN SEMANAL DEL INTEGRAL de ese
        lunes (tabla plan_semanal, la trae el espejo del sync de dbo.plansemanal). Es lo
        que hace «Semana del …» en el Integral, y lo pidió la reunión con Lucas: Maxi elige
        la semana y ve las OT que el taller programó. El planificador de SPMM no sirve
        para esto durante la prueba: su plan está vacío (el 25/09, 0 filas en producción)
        y la semana salía siempre en 0. Una OT que sigue de una semana a otra el taller la
        vuelve a cargar en la semana siguiente, así que acá no se arrastra nada;
      - 'spmm': las abiertas que tienen algún proceso planificado en el planificador de
        SPMM que arranca antes de que termine el domingo. Incluye las que se arrastran de
        semanas anteriores: una OT planificada para el lunes pasado que sigue abierta sigue
        necesitando su material.

En los tres casos quedan afuera las OT marcadas «No lleva materias primas»: no hay nada
que comprarles.

LA SEMANA DEL PLANIFICADOR (con SPMM como dueño)

En el viejo salía de un plan semanal cargado a mano (plansemanal). Con SPMM como dueño la
reemplaza el plan: «cuándo arranca un proceso» es el «Inicio estimado» que muestra el Gantt, calculado
con LA MISMA conversión que GET /planificacion (PlanificacionAPI.obtener_planificacion):
cada fila del plan se lee con su propio arranque (`inicio_base`, o el deducido de su
`creado_en` para los planes anteriores al 11/09) y sus minutos de trabajo se pasan a
fecha con `_convertir_minutos_a_fecha`, salteando domingos y días bloqueados. Si la
cuenta viviera dos veces, Pendientes y el Gantt terminarían diciendo semanas distintas
para la misma OT.

`fecha_requerida` de cada OT es ese inicio estimado más temprano (cuándo hace falta el
material); sin plan, null.

LAS LÍNEAS

Las que se usan (usado = 1) de esas OT. El filtro de radio: `pendientes` (lo que no está
disponible), `parciales` (TODAS las líneas de las OT que tienen parte disponible y parte
no) y `todas`. El resumen de las tarjetas se cuenta ANTES del radio (las tarjetas son el
radio), pero después del buscador y del proveedor: resume lo que se está mirando.

LA CAÑERA

Asignar, mover y liberar escriben canera_ocupacion; la lectura (la grilla con cada OT,
su estado de material y si ya terminó) es application/materia_prima/canera.py. Un
casillero tiene a lo sumo una OT vigente: en Postgres lo cuida un índice único parcial y
en SQLite de tests el mismo índice del modelo, pero la regla la cuida ESTE servicio igual,
para contestar un 409 que diga quién está ahí y no un error de la base.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, time, timedelta

from sqlalchemy.exc import IntegrityError

from backend.application.MateriaPrimaOTService import Resultado, a_json, lineas_a_dict
from backend.application.materia_prima.canera import canera_vigente, celda_texto, celdas_de_ots, parse_celda
from backend.application.materia_prima.dueno import INTEGRAL, dueno
from backend.application.materia_prima.estado import ots_en_curso
from backend.application.materia_prima.usuario import nombre_solo
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.domain.CaneraOcupacion import CaneraOcupacion
from backend.infrastructure.DiaBloqueadoRepository import feriados_sin_romper
from backend.infrastructure.MateriaPrimaOTRepository import MateriaPrimaOTRepository
from backend.infrastructure.MateriaPrimaPendientesRepository import MateriaPrimaPendientesRepository
from backend.infrastructure.auditoria_movimientos import ahora_ar
from backend.infrastructure.estado_ordenes import fecha_o_nada

FILTROS = ("pendientes", "parciales", "todas")
LARGO_OT_TEXTO = 20

# El número de OT (id_otvieja) es INTEGER. Uno más grande no puede ser una OT, y
# mandarlo igual a Postgres no da «no existe»: asyncpg no lo puede ni codificar y el
# pedido termina en 500 (SQLite, el de los tests, lo acepta callado).
MAXIMO_NUMERO_OT = 2_147_483_647
# Sólo dígitos ASCII: str.isdigit() dice que sí a «²» o a «١٢», que int() no entiende.
_SOLO_DIGITOS = re.compile(r"^[0-9]+$")


def lunes_de(dia: date) -> date:
    return dia - timedelta(days=dia.weekday())


def _normalizado(texto) -> str:
    """Para buscar: sin acentos, sin mayúsculas y con espacios simples. «METALÚRGICA JR»
    y «metalurgica  jr» son el mismo proveedor escrito por dos personas."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFKD", str(texto or ""))
        if not unicodedata.combining(c)
    )
    return " ".join(sin_acentos.casefold().split())


def _tokens(texto) -> list[str]:
    return _normalizado(texto).split()


def _numero_ot(texto) -> int | None:
    """El número de OT de un filtro (`ot=15010`). None si no vino; 422 si no es un número.
    Puede ser más grande que MAXIMO_NUMERO_OT: el que llama sabe que ése no existe."""
    if texto is None or not str(texto).strip():
        return None
    limpio = str(texto).strip()
    if not _SOLO_DIGITOS.match(limpio):
        raise BusinessException(f"«{limpio}» no es un número de OT.")
    return int(limpio)


def _es_casillero_ocupado(error: IntegrityError) -> bool:
    """¿La base rechazó la fila porque el casillero ya tiene una OT vigente? Es el índice
    único parcial ux_canera_celda_vigente: Postgres lo nombra, SQLite nombra sus
    columnas. Cualquier otro rechazo (un CHECK) NO es «lo ocupó otra persona»."""
    texto = str(getattr(error, "orig", None) or error)
    return "ux_canera_celda_vigente" in texto or "canera_ocupacion.columna" in texto


class MateriaPrimaPendientesService:
    def __init__(self, db):
        self.db = db
        self.repo = MateriaPrimaPendientesRepository(db)
        self.repo_ot = MateriaPrimaOTRepository(db)

    # ─────────────────────────── el plan ───────────────────────────

    async def inicios_estimados(self, ids_ot) -> dict[int, datetime]:
        """{id_ot: el inicio estimado más temprano de sus procesos planificados}, con la
        conversión de GET /planificacion (ver el encabezado). Sólo las OT con plan.

        Una consulta para todas las OT, y una conversión por OT y por arranque de plan (no
        una por proceso): con el mismo arranque la conversión crece con los minutos, así
        que el proceso que arranca primero es el de menos minutos.
        """
        filas = await self.repo.plan_de_ots(ids_ot)
        if not filas:
            return {}
        # Adentro, como en GET /planificacion: el módulo del planificador arrastra el
        # solver (OR-Tools), y Pendientes no tiene por qué cargarlo al importarse.
        from backend.application.PlanificacionService import (
            _ahora_ar,
            _convertir_minutos_a_fecha,
            inicio_del_plan,
        )
        # Mismo formato que GET /planificacion ('YYYY-MM-DD'). Se leen sin el
        # autoarreglo de DiaBloqueadoRepository.listar (que crea la tabla y hace commit):
        # esto es una lectura en medio de otra y sólo necesita las fechas.
        feriados = [f.strftime("%Y-%m-%d") for f in await feriados_sin_romper(self.db)]

        minimos: dict[tuple[int, datetime], int] = {}
        for orden_id, inicio_min, inicio_base, creado_en in filas:
            # base_del_plan de GET /planificacion: el arranque guardado o, en los planes
            # anteriores al 11/09, el deducido del momento en que se guardó.
            base = inicio_base or inicio_del_plan(creado_en or _ahora_ar(), blocked_dates=feriados)
            clave = (orden_id, base)
            if clave not in minimos or inicio_min < minimos[clave]:
                minimos[clave] = inicio_min

        inicios: dict[int, datetime] = {}
        for (orden_id, base), minutos in minimos.items():
            fecha = datetime.fromisoformat(_convertir_minutos_a_fecha(minutos, base, feriados))
            if orden_id not in inicios or fecha < inicios[orden_id]:
                inicios[orden_id] = fecha
        return inicios

    # ─────────────────────────── Pendientes ───────────────────────────

    async def pendientes(self, semana: date | None = None, todas_abiertas: bool = False,
                         ot=None, filtro: str | None = "pendientes", search: str | None = None,
                         id_proveedor: int | None = None, proveedor: str | None = None) -> dict:
        filtro = (filtro or "pendientes").strip().lower()
        if filtro not in FILTROS:
            raise BusinessException(f"Filtro «{filtro}» desconocido: va {', '.join(FILTROS)}.")
        numero = _numero_ot(ot)

        rango = fuente = None
        if numero is not None:
            cabeceras = await self.repo.ots_por_numero(numero) if numero <= MAXIMO_NUMERO_OT else []
        else:
            cabeceras = await self.repo.ots_abiertas()
            if not todas_abiertas:
                lunes = lunes_de(semana or ahora_ar().date())
                rango = (lunes, lunes + timedelta(days=6))
                fuente = "integral" if dueno() == INTEGRAL else "spmm"
                if fuente == "integral":
                    # Las del plan semanal del Integral ese lunes, de las abiertas (y que
                    # llevan materia prima: ots_abiertas ya las filtró).
                    del_plan_semanal = await self.repo.ots_del_plan_semanal(lunes) or set()
                    cabeceras = [c for c in cabeceras if c[0].id in del_plan_semanal]

        inicios = await self.inicios_estimados([c[0].id for c in cabeceras])
        if fuente == "spmm":
            # «Antes de que termine el domingo»: < el lunes siguiente a las 00:00.
            corte = datetime.combine(rango[0] + timedelta(days=7), time(0, 0))
            cabeceras = [c for c in cabeceras if c[0].id in inicios and inicios[c[0].id] < corte]

        ots = {c[0].id: c for c in cabeceras}
        ids_ot = list(ots)
        filas = await self.repo_ot.lineas_con_pieza(ids_ot=ids_ot, solo_usadas=True)
        lineas = await lineas_a_dict(self.db, filas, self.repo_ot)
        celdas = await celdas_de_ots(self.db, ids_ot)
        en_curso = await ots_en_curso(self.db, ids_ot)

        # Por OT, sobre TODAS sus líneas usadas (antes del buscador): cuántas hay y cuántas
        # están listas. De ahí salen las columnas de la OT y el radio «Parciales».
        total_por_ot: dict[int, int] = {}
        listas_por_ot: dict[int, int] = {}
        for l in lineas:
            total_por_ot[l["id_orden_trabajo"]] = total_por_ot.get(l["id_orden_trabajo"], 0) + 1
            if l["disponible"]:
                listas_por_ot[l["id_orden_trabajo"]] = listas_por_ot.get(l["id_orden_trabajo"], 0) + 1
        parciales = {i for i, total in total_por_ot.items() if 0 < listas_por_ot.get(i, 0) < total}

        def requerida(id_ot):
            inicio = inicios.get(id_ot)
            return inicio.date() if inicio else None

        # Cada línea con lo de su OT que se muestra en la fila (`falta` ya viene: es de
        # la línea, ver MateriaPrimaOTService.falta_de).
        for l in lineas:
            orden, *_ = ots[l["id_orden_trabajo"]]
            l.update({
                "numero_ot": orden.id_otvieja,
                "fecha_ot": fecha_o_nada(orden.fecha_orden),
                "fecha_requerida": requerida(orden.id),
                "celdas": celdas.get(orden.id, []),
                "ot_en_curso": orden.id in en_curso,
            })

        # El buscador (código, descripción, proveedor: todos los tokens) y el proveedor.
        tokens = _tokens(search)
        tokens_proveedor = _tokens(proveedor)
        filtrando = bool(tokens or tokens_proveedor or id_proveedor is not None)
        if filtrando:
            def entra(l) -> bool:
                if id_proveedor is not None and l["id_proveedor"] != id_proveedor:
                    return False
                if tokens_proveedor:
                    del_proveedor = _normalizado(l["proveedor"])
                    if not all(t in del_proveedor for t in tokens_proveedor):
                        return False
                if tokens:
                    texto = _normalizado(f"{l['codigo']} {l['descripcion']} {l['proveedor'] or ''}")
                    if not all(t in texto for t in tokens):
                        return False
                return True
            lineas = [l for l in lineas if entra(l)]

        # El resumen: antes del radio (las tarjetas SON el radio), después del buscador.
        resumen = {
            "ot_count": len({l["id_orden_trabajo"] for l in lineas}) if filtrando else len(ots),
            # Una reserva parcial (falta > 0) cuenta como «a pedir», igual que el color de
            # la OT (estado.py) y el estadoLinea del front.
            "lineas_a_pedir": sum(1 for l in lineas if not l["disponible"] and l["falta"] > 0),
            "lineas_esperando": sum(1 for l in lineas
                                    if not l["disponible"] and l["falta"] <= 0),
            "lineas_listas": sum(1 for l in lineas if l["disponible"]),
        }

        if filtro == "pendientes":
            lineas = [l for l in lineas if not l["disponible"]]
        elif filtro == "parciales":
            lineas = [l for l in lineas if l["id_orden_trabajo"] in parciales]

        # Lo que falta pedir primero (falta > 0, reserva parcial incluida), después lo que
        # se espera y al final lo listo; dentro de cada grupo por número de OT y en el
        # orden de carga. El mismo orden que arma el front.
        lineas.sort(key=lambda l: (
            0 if (not l["disponible"] and l["falta"] > 0) else (2 if l["disponible"] else 1),
            l["numero_ot"] if l["numero_ot"] is not None else float("inf"),
            l["orden"] or 0,
            l["id"],
        ))

        lista_ots = []
        for orden, cliente, articulo, prioridad in ots.values():
            lista_ots.append({
                "id": orden.id,
                "numero_ot": orden.id_otvieja,
                "cliente": cliente,
                "articulo": articulo,
                "unidades": orden.unidades,
                "fecha_ot": fecha_o_nada(orden.fecha_orden),
                "fecha_prometida": fecha_o_nada(orden.fecha_prometida),
                "fecha_requerida": requerida(orden.id),
                "prioridad": prioridad,
                "celdas": celdas.get(orden.id, []),
                "ot_en_curso": orden.id in en_curso,
                "lineas_total": total_por_ot.get(orden.id, 0),
                "lineas_listas": listas_por_ot.get(orden.id, 0),
            })
        lista_ots.sort(key=lambda o: (o["numero_ot"] if o["numero_ot"] is not None else float("inf"), o["id"]))

        return a_json({
            "semana": {"desde": rango[0], "hasta": rango[1]} if rango else None,
            # De dónde salió la semana: 'integral' (su plan semanal) o 'spmm' (el
            # planificador); None si no se pidió una semana (ot=N o todas_abiertas).
            "fuente_semana": fuente,
            "resumen": resumen,
            "ots": lista_ots,
            "lineas": lineas,
        })

    # ─────────────────────────── cañera ───────────────────────────

    async def canera(self) -> dict:
        """GET /materia-prima/canera: la grilla y sus ocupaciones vigentes (la arma
        materia_prima/canera.canera_vigente), con `desde` sin microsegundos como toda
        fecha de la sección. Es también lo que devuelven asignar, mover y liberar: la
        pantalla redibuja con eso y no vuelve a pedir."""
        return a_json(await canera_vigente(self.db))

    async def _quien_esta(self, ocupacion: CaneraOcupacion) -> str:
        """«la OT N° 15010» o el texto anotado."""
        numero = await self.repo.numero_de_ot(ocupacion.id_orden_trabajo)
        if numero is not None:
            return f"la OT N° {numero}"
        return f"la OT {ocupacion.ot_texto}" if ocupacion.ot_texto else "otra OT"

    async def _escribir(self, trabajo, celda: str) -> None:
        """Corre las escrituras de la cañera y confirma. Si la base rechaza un casillero
        ocupado (otra persona lo ocupó entre la lectura y la escritura: el índice único
        parcial de Postgres lo frena), 409 para que se vuelva a mirar y se decida.

        Cualquier otro rechazo de la base (un CHECK: `hasta` antes que `desde`) es un
        error de verdad y sale como tal: ofrecer «Reemplazarla igual» ahí haría repetir
        algo que va a volver a fallar. En los dos casos se deshace todo, así la sesión
        no queda con la transacción abortada (Postgres no deja seguir usándola)."""
        try:
            await trabajo()
            await self.db.flush()
            await self.repo.confirmar()
        except IntegrityError as e:
            await self.repo.deshacer()
            if not _es_casillero_ocupado(e):
                logger.error(f"Service - Cañera: la base rechazó el cambio en {celda}: {e}")
                raise InfrastructureException("Error al guardar la cañera.") from e
            logger.warning(f"Service - Cañera: {celda} se ocupó mientras tanto ({e}).")
            raise ConfirmacionRequeridaException(
                f"{celda} se acaba de ocupar (lo cambió otra persona). ¿Reemplazarla igual?")
        except Exception:
            await self.repo.deshacer()
            raise

    async def asignar(self, celda: str, numero_ot, usuario: dict | None,
                      forzar: bool = False) -> Resultado:
        """Ubica una OT en un casillero. Dos avisos posibles, juntos en un solo 409:
        el casillero está ocupado (con forzar, se libera el anterior) y el número no es
        una OT de SPMM (con forzar, se anota tal cual en `ot_texto`)."""
        columna, fila = parse_celda(celda)
        nombre_celda = celda_texto(columna, fila)
        texto = str(numero_ot if numero_ot is not None else "").strip()
        if not texto:
            raise BusinessException("Falta el número de OT.")
        orden = None
        if _SOLO_DIGITOS.match(texto) and int(texto) <= MAXIMO_NUMERO_OT:
            orden = await self.repo.ot_por_numero(int(texto))
        if orden is None and len(texto) > LARGO_OT_TEXTO:
            raise BusinessException(f"El número de OT no puede pasar de {LARGO_OT_TEXTO} caracteres.")
        etiqueta = f"N° {orden.id_otvieja}" if orden else texto

        actual = await self.repo.vigente_en(columna, fila)
        if actual is not None and (
            (orden is not None and actual.id_orden_trabajo == orden.id)
            or (orden is None and actual.id_orden_trabajo is None and actual.ot_texto == texto)
        ):
            return Resultado(data=await self.canera(), frase=None)  # ya está ahí

        avisos = []
        if actual is not None:
            avisos.append(f"{nombre_celda} tiene {await self._quien_esta(actual)}: si seguís, se libera.")
        if orden is None:
            avisos.append(f"No existe la OT {texto} en SPMM: si seguís, se anota el número tal cual.")
        if avisos and not forzar:
            raise ConfirmacionRequeridaException(" ".join(avisos) + " ¿Hacerlo igual?")

        nombre = nombre_solo(usuario)
        ahora = ahora_ar()

        async def trabajo():
            if actual is not None:
                # Se cierra ANTES de insertar la nueva: el índice único parcial no deja
                # dos vigentes en el mismo casillero ni por un instante.
                actual.hasta = ahora
                actual.liberado_por = nombre
                await self.db.flush()
            await self.repo.agregar(CaneraOcupacion(
                columna=columna, fila=fila,
                id_orden_trabajo=orden.id if orden else None,
                ot_texto=None if orden else texto,
                desde=ahora, asignado_por=nombre, origen="spmm",
            ))

        liberada = await self._quien_esta(actual) if actual is not None else None
        await self._escribir(trabajo, nombre_celda)
        frase = f"ubicó la OT {etiqueta} en la cañera ({nombre_celda})"
        if liberada:
            frase += f", en lugar de {liberada}"
        return Resultado(data=await self.canera(), frase=frase)

    async def _ocupacion_vigente(self, id_ocupacion: int) -> CaneraOcupacion:
        ocupacion = await self.repo.ocupacion(id_ocupacion)
        if ocupacion is None:
            raise NotFoundException(f"No existe la ubicación {id_ocupacion} de la cañera.")
        return ocupacion

    async def mover(self, id_ocupacion: int, celda: str, usuario: dict | None,
                    forzar: bool = False) -> Resultado:
        """Pasa una OT a otro casillero. Se cierra la ocupación vieja y se abre una nueva
        (así queda el historial de dónde estuvo). Si el destino está ocupado, 409; con
        forzar se libera el destino."""
        ocupacion = await self._ocupacion_vigente(id_ocupacion)
        if ocupacion.hasta is not None:
            raise BusinessException(
                f"{ocupacion.celda} ya se liberó: actualizá la cañera y volvé a ubicar la OT.")
        columna, fila = parse_celda(celda)
        destino_celda = celda_texto(columna, fila)
        if (columna, fila) == (ocupacion.columna, ocupacion.fila):
            return Resultado(data=await self.canera(), frase=None)

        destino = await self.repo.vigente_en(columna, fila)
        if destino is not None and not forzar:
            raise ConfirmacionRequeridaException(
                f"{destino_celda} tiene {await self._quien_esta(destino)}: si seguís, se libera. "
                f"¿Hacerlo igual?")

        quien = await self._quien_esta(ocupacion)
        origen_celda = ocupacion.celda
        nombre = nombre_solo(usuario)
        ahora = ahora_ar()

        async def trabajo():
            for cerrar in (destino, ocupacion):
                if cerrar is not None:
                    cerrar.hasta = ahora
                    cerrar.liberado_por = nombre
            await self.db.flush()
            await self.repo.agregar(CaneraOcupacion(
                columna=columna, fila=fila,
                id_orden_trabajo=ocupacion.id_orden_trabajo, ot_texto=ocupacion.ot_texto,
                desde=ahora, asignado_por=nombre, origen="spmm",
            ))

        await self._escribir(trabajo, destino_celda)
        return Resultado(data=await self.canera(),
                         frase=f"movió {quien} de {origen_celda} a {destino_celda} en la cañera")

    async def liberar(self, id_ocupacion: int, usuario: dict | None) -> Resultado:
        """Libera un casillero: `hasta` = ahora. La fila queda (es el historial). Liberar
        uno ya liberado no hace nada."""
        ocupacion = await self._ocupacion_vigente(id_ocupacion)
        if ocupacion.hasta is not None:
            return Resultado(data=await self.canera(), frase=None)
        quien = await self._quien_esta(ocupacion)
        nombre = nombre_solo(usuario)

        async def trabajo():
            ocupacion.hasta = ahora_ar()
            ocupacion.liberado_por = nombre

        await self._escribir(trabajo, ocupacion.celda)
        return Resultado(data=await self.canera(),
                         frase=f"liberó {ocupacion.celda} de la cañera ({quien})")

    async def liberar_terminadas(self, usuario: dict | None) -> Resultado:
        """Libera todos los casilleros de OT ya finalizadas. En el viejo se liberaban a
        mano y se olvidaban (el 23/09 había 11 OT terminadas ocupando lugar)."""
        ocupaciones = await self.repo.vigentes_de_terminadas()
        nombre = nombre_solo(usuario)
        ahora = ahora_ar()

        async def trabajo():
            for ocupacion in ocupaciones:
                ocupacion.hasta = ahora
                ocupacion.liberado_por = nombre

        if ocupaciones:
            await self._escribir(trabajo, "la cañera")
        frase = (f"liberó {len(ocupaciones)} casillero{'s' if len(ocupaciones) != 1 else ''} "
                 f"de OT terminadas en la cañera") if ocupaciones else None
        return Resultado(data={"liberadas": len(ocupaciones), "canera": await self.canera()},
                         frase=frase)
