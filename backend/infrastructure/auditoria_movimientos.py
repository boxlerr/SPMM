"""El registro de TODO lo que alguien crea, edita o elimina en el sistema.

POR QUÉ ESTÁ EN UN SOLO LUGAR Y NO EN CADA SERVICIO

Pedido de Julián (15/09): «log en auditoría de cada cosa que se haga, se agregue,
edite o elimine de TODO». Lo que había hasta hoy auditaba UNA cosa —los intentos de
planificar— y nada más: borrar un operario, cambiarle los minutos a un proceso,
renombrar un rango o tocar una OT no dejaba ningún rastro. Con el taller ya cargando
los datos de verdad, «¿quién cambió esto?» no tenía respuesta.

Se podría haber puesto una llamada en cada servicio: son 78 endpoints de escritura, y
el próximo que alguien agregue no la va a tener — que es exactamente cómo se llegó a
esto, porque la auditoría de planificación se escribió a mano en su endpoint y
ninguna otra pantalla la copió. El middleware es un solo lugar y **no se puede
olvidar**: toda escritura pasa por ahí, incluidas las que todavía no existen.

QUÉ GUARDA

Quién, cuándo, qué acción, sobre qué cosa, con qué datos, cuánto tardó y si salió
bien. La acción sale del método HTTP y la cosa, del camino — así una pantalla nueva
queda auditada sin escribir una línea.

QUÉ NO GUARDA, A PROPÓSITO

  · Las lecturas. Un GET no cambia nada y guardarlos ahogaría el registro: son casi
    todo el tráfico y ninguno contesta «quién tocó esto».
  · Contraseñas y tokens: el valor se reemplaza por «***» antes de guardar. Un
    registro de auditoría es justo el lugar donde una credencial no puede terminar.
    Que un usuario se creó o que alguien cambió su clave SÍ queda; con qué clave, no.
  · El contenido de los archivos. Subir un plano manda el PDF entero; guardarlo sería
    duplicar el archivo en cada fila. Del cuerpo de esas llamadas no se lee nada.
  · Entrar y salir. `usuario.ultimo_login` ya lo dice y el cuerpo del login es una
    contraseña.
  · Marcar una notificación como leída. Una por campanita, y no cambia nada del
    trabajo: sería la mitad del registro diciendo nada.

REGLAS

  · NUNCA rompe el pedido. Si el registro falla, se loguea y la operación sigue: es
    peor no poder guardar una OT porque falló la auditoría que quedarse sin la fila.
  · Se escribe DESPUÉS de la respuesta, así que también quedan los intentos que
    fallaron — que son los que más se preguntan.
  · Sesión propia, corta. La del endpoint ya se cerró, y si el pedido terminó en
    rollback esa sesión está envenenada: escribir ahí sería perder la fila justo en
    el caso que más interesa.
"""
import json
import re
from datetime import datetime, timedelta, timezone

from backend.commons.loggers.logger import logger
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento

# Hora local del taller, sin zona, como todas las fechas de la base.
_AR = timezone(timedelta(hours=-3))


def ahora_ar() -> datetime:
    return datetime.now(_AR).replace(tzinfo=None)


# El método HTTP dicho como lo diría una persona.
ACCION = {"POST": "creó", "PUT": "editó", "PATCH": "editó", "DELETE": "eliminó"}

# El primer tramo del camino -> cómo se llama esa cosa en el taller. Lo que no esté
# acá se guarda igual con el nombre crudo del camino: es preferible una fila con un
# nombre feo que ninguna fila. Por eso esto es un diccionario y no una validación.
ENTIDAD = {
    "ordenes": "orden de trabajo",
    "ordenes-trabajo-piezas": "materia prima de la OT",
    "consumos-material": "consumo de material",
    "procesos": "proceso",
    "operarios": "persona",
    "maquinarias": "máquina",
    "rangos": "categoría",
    "sectores": "sector",
    "clientes": "cliente",
    "articulos": "artículo",
    "planos": "plano",
    "piezas": "materia prima",
    "prioridades": "prioridad",
    "planificar": "planificación",
    "planificacion": "planificación",
    "incidencias": "incidencia",
    "config": "configuración",
    "availability": "calendario del taller",
    "notificaciones": "notificación",
    "usuarios": "usuario",
    "auth": "usuario",
    # RF-24: la administración de permisos. La frase buena la deja el endpoint
    # (armar_fila, `resumen`); esto es para los intentos que no pasaron.
    "permisos": "permisos",
}

# El segundo tramo, cuando dice más que el primero. «/rangos/7/procesos» no es editar
# la categoría: es cambiarle qué procesos cubre, que es OTRA cosa y la que se pregunta.
SUBENTIDAD = {
    "skills": "capacidades",
    "skills-nativas": "capacidades",
    "rangos": "categorías",
    "maquinarias": "máquinas",
    "procesos": "procesos",
    "estado": "estado",
    "status": "estado",
    "observaciones": "observaciones",
    "entrega": "fecha de entrega",
    "reorder": "orden de los pasos",
    "linea": "un paso",
    "restaurar": "restauración de una versión",
    "borradores": "borrador",
    "lote": "plan",
    "quitar-ordenes": "quitar órdenes",
    "availability": "calendario",
    "leer-todas": "leídas",
    "leida": "leída",
    "pendientes": "pendientes",
    "confirmar": "confirmación",
    # «/consumos-material/5/anular»: el consumo no se borra, se anula. Sin esto el
    # renglón diría «editó consumo de material #5» y no se sabría que fue la anulación.
    "anular": "anulación",
    # «/piezas/5/stock-minimo» (RF-14): cambiarle el mínimo a una materia prima no es
    # editarla —sus datos son del sistema viejo—, es decidir desde cuándo avisar.
    "stock-minimo": "stock mínimo",
    # /permisos/roles/..., /permisos/usuarios/..., /permisos/secciones/...
    "roles": "de un rol",
    "usuarios": "de una persona",
    "secciones": "confidencialidad",
}

# Nombres de campo cuyo VALOR no puede terminar en el registro. Cubre los DTO de hoy
# (password / current_password / new_password / confirm_password / token) y deja
# margen para los de mañana.
SECRETO = re.compile(r"pass|token|secret|clave|contrase|hash|credencial|authorization", re.I)

# De dónde sacar el nombre de lo recién creado. En un alta el número todavía no está
# en la dirección, así que «creó persona» sin más no le dice nada a nadie: con esto
# dice «creó persona — JUAN PEREZ».
ETIQUETAS = ("nombre", "descripcion", "titulo", "razon_social", "numero_ot",
             "id_otvieja", "codigo", "username", "detalle", "nombre_proceso")

# Tope del detalle guardado. Un plan confirmado manda cientos de filas y una OT con
# muchos pasos también: no hace falta la copia entera para saber qué se hizo.
TOPE_DETALLE = 4000
TOPE_TEXTO = 300

# Más que esto no se lee: es un archivo, no un formulario.
TOPE_CUERPO = 256 * 1024


def _limpiar(valor, profundidad=0, por_lista=False):
    """Los datos del pedido, sin secretos y sin archivos.

    `por_lista` invierte la regla para los caminos de credenciales: guarda sólo los
    campos conocidos y tapa todo lo demás. Ver POR_LISTA.
    """
    if profundidad > 6:
        return "…"
    if isinstance(valor, dict):
        salida = {}
        for k, v in valor.items():
            if SECRETO.search(str(k)) or (por_lista and str(k) not in SE_PUEDE_GUARDAR):
                salida[k] = "***"
            elif isinstance(v, str) and len(v) > TOPE_TEXTO:
                # El base64 de un plano, o una observación larguísima: se dice cuánto
                # medía en vez de copiarlo.
                salida[k] = f"<{len(v)} caracteres>"
            else:
                salida[k] = _limpiar(v, profundidad + 1, por_lista)
        return salida
    if isinstance(valor, list):
        if len(valor) > 20:
            return ([_limpiar(v, profundidad + 1, por_lista) for v in valor[:20]]
                    + [f"… y {len(valor) - 20} más"])
        return [_limpiar(v, profundidad + 1, por_lista) for v in valor]
    if isinstance(valor, str) and len(valor) > TOPE_TEXTO:
        return f"<{len(valor)} caracteres>"
    return valor


def _etiqueta(cuerpo) -> str | None:
    """Cómo se llama lo que se acaba de tocar, si el cuerpo lo dice."""
    if not isinstance(cuerpo, dict):
        return None
    for clave in ETIQUETAS:
        v = cuerpo.get(clave)
        if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
            texto = str(v).strip()
            # El apellido al lado del nombre, que es como se los nombra en el taller.
            if clave == "nombre" and isinstance(cuerpo.get("apellido"), str):
                texto = f"{texto} {cuerpo['apellido']}".strip()
            return texto[:60]
    return None


# Qué tramo es un "cuál" y no un "qué": un id, una fecha (el calendario del taller se
# direcciona por día) o el uuid de un lote del plan.
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                   r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _es_identificador(tramo: str) -> bool:
    return tramo.isdigit() or bool(_FECHA.match(tramo)) or bool(_UUID.match(tramo))


def partes_del_camino(ruta: str) -> tuple[str, str | None]:
    """«/ordenes/1081/procesos» -> («orden de trabajo › procesos», «1081»)."""
    tramos = [t for t in ruta.split("/") if t]
    if not tramos:
        return ("el sistema", None)
    # /auth/usuarios/3 y /config/availability: el primer tramo es el router, el que
    # nombra la cosa es el segundo.
    if tramos[0] in ("auth", "config", "api") and len(tramos) > 1:
        tramos = tramos[1:]

    entidad = ENTIDAD.get(tramos[0], tramos[0].replace("-", " "))
    id_entidad = next((t for t in tramos[1:] if _es_identificador(t)), None)

    # Lo que viene después del número afina la frase.
    resto = [t for t in tramos[1:] if not _es_identificador(t)]
    if resto:
        sub = SUBENTIDAD.get(resto[0])
        if sub:
            entidad = f"{entidad} › {sub}"
        elif not ENTIDAD.get(tramos[0]):
            # Camino que no conocemos: mejor decir el crudo entero que media verdad.
            entidad = f"{entidad} › {resto[0].replace('-', ' ')}"
    return (entidad, id_entidad)


# Tramos que no son una cosa sino un verbo propio. «POST /auth/usuarios/3/desbloquear»
# por método sería «creó usuario #3», que no es lo que pasó: nadie creó nada, alguien
# destrabó una cuenta (RF-26). Con esto la frase dice «desbloqueó usuario #3».
VERBO = {
    "desbloquear": "desbloqueó",
    # RF-03. «POST /ordenes/1081/pausar» no crea nada: para la OT (o un paso). La frase
    # buena, con el número de OT y el motivo, la deja el endpoint (PausaAPI); esto es
    # para los intentos que no pasaron, que igual tienen que decir qué se intentó.
    "pausar": "pausó",
    "reanudar": "reanudó",
}


def describir(metodo: str, ruta: str, estado: int, usuario: str | None,
              etiqueta: str | None = None) -> tuple[str, str, str | None, str]:
    """(accion, entidad, id_entidad, frase). La frase es lo único que se lee."""
    accion = ACCION.get(metodo, metodo.lower())
    verbo = next((VERBO[t] for t in ruta.split("/") if t in VERBO), None)
    if verbo:
        accion = verbo
    entidad, id_entidad = partes_del_camino(ruta)
    quien = usuario or "alguien"
    cual = f" #{id_entidad}" if id_entidad else ""
    frase = f"{quien} {accion} {entidad}{cual}"
    if etiqueta:
        frase += f" — {etiqueta}"
    if estado >= 400:
        frase += f" (no se pudo: error {estado})"
    return (accion, entidad, id_entidad, frase)


# Entrar y salir no se registran: `usuario.ultimo_login` ya lo dice y el cuerpo del
# login es una contraseña. Marcar una notificación como leída tampoco: sería la mitad
# del registro sin contar nada.
#
# Y lo que se pega el servidor a sí mismo tampoco. Cloud Scheduler llama a
# `POST /internal/sync` cada 30 minutos: son 48 renglones por día que dicen «alguien
# creó internal › sync» —sin persona, porque no hay ninguna— y en una semana serían
# más de 300, tapando lo que este registro viene a contestar. El sync ya se loguea
# solo, con sus números, en Cloud Run. Descubierto el mismo día que salió esto: a las
# tres horas de vida, 7 de las 9 filas eran el cron.
SIN_AUDITAR = (
    ("POST", "/auth/login"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/refresh"),
    ("POST", "/auth/token"),
    ("PUT", "/notificaciones/leer-todas"),
    ("PUT", "/notificaciones/"),   # /notificaciones/{id}/leida
    ("POST", "/internal/"),        # el cron del sync, cada 30 minutos
)

# Caminos donde el cuerpo NO se lee: el de un plano ES el archivo, y copiarlo al
# registro sería guardar el PDF de nuevo en cada fila.
SIN_CUERPO = ("/planos",)

# Los caminos de credenciales se guardan AL REVÉS que el resto: en vez de tapar lo que
# parece secreto, se conserva sólo lo que se sabe que no lo es. En el resto del sistema
# un campo nuevo que nadie previó se guarda —y está bien, para eso es la auditoría—;
# acá un campo nuevo que nadie previó puede ser una contraseña, así que el que no está
# en la lista sale tapado. Cuesta perder un dato de vez en cuando y evita el único
# error que esta tabla no puede cometer.
POR_LISTA = ("/auth/",)
SE_PUEDE_GUARDAR = ("username", "email", "nombre", "apellido", "rol", "activo",
                    "id_usuario", "id", "primer_ingreso")


def se_audita(metodo: str, ruta: str) -> bool:
    if metodo not in ACCION:
        return False
    return not any(m == metodo and p in ruta for m, p in SIN_AUDITAR)


def se_lee_el_cuerpo(ruta: str, content_type: str, largo: int) -> bool:
    if any(p in ruta for p in SIN_CUERPO):
        return False
    if largo > TOPE_CUERPO:
        return False
    return content_type.startswith("application/json")


def armar_fila(*, usuario: dict | None, metodo: str, ruta: str, estado: int,
               duracion_ms: int, cuerpo=None, parametros: dict | None = None,
               resumen: dict | None = None) -> AuditoriaMovimiento:
    """La fila lista para guardar. Separada de `registrar` para poder probarla sin base.

    `resumen` es lo que dejó dicho el endpoint (request.state.auditoria), para los
    cambios en los que el pedido solo no cuenta la historia —los de permisos—:
      · "frase": lo que pasó, sin el autor («le dio a Matías «Clientes» ...»). Reemplaza
        la frase armada por método y camino, sólo si el pedido salió bien.
      · "antes" / "despues": cómo estaba y cómo quedó. Van al detalle.
    """
    nombre = None
    id_usuario = None
    if usuario:
        id_usuario = usuario.get("id_usuario")
        partes = [usuario.get("nombre") or "", usuario.get("apellido") or ""]
        nombre = " ".join(p for p in partes if p).strip() or usuario.get("username")

    accion, entidad, id_entidad, frase = describir(
        metodo, ruta, estado, nombre, _etiqueta(cuerpo)
    )
    resumen = resumen or {}
    if resumen.get("frase") and estado < 400:
        frase = f"{nombre or 'alguien'} {resumen['frase']}"

    detalle = None
    datos = {}
    por_lista = any(p in ruta for p in POR_LISTA)
    if parametros:
        datos["parametros"] = _limpiar(parametros, por_lista=por_lista)
    if cuerpo is not None:
        datos["datos"] = _limpiar(cuerpo, por_lista=por_lista)
    for clave in ("antes", "despues"):
        if clave in resumen:
            datos[clave] = _limpiar(resumen[clave], por_lista=por_lista)
    if datos:
        try:
            detalle = json.dumps(datos, ensure_ascii=False, default=str)[:TOPE_DETALLE]
        except Exception:
            detalle = None

    return AuditoriaMovimiento(
        creado_en=ahora_ar(),
        id_usuario=id_usuario,
        usuario=str(nombre)[:120] if nombre else None,
        accion=accion[:20],
        entidad=entidad[:80],
        id_entidad=id_entidad,
        descripcion=frase,
        metodo=metodo[:10],
        ruta=ruta[:300],
        estado=estado,
        duracion_ms=duracion_ms,
        detalle=detalle,
    )


async def registrar(db, **kwargs) -> None:
    """Guarda una fila. No levanta NUNCA: la auditoría no puede voltear una operación."""
    try:
        db.add(armar_fila(**kwargs))
        await db.commit()
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning(
            "Auditoría: no se pudo registrar %s %s: %s",
            kwargs.get("metodo"), kwargs.get("ruta"), e,
        )


async def registrar_evento(db, *, accion: str, entidad: str, id_entidad: str | None,
                           descripcion: str, metodo: str, ruta: str,
                           detalle: dict | None = None) -> None:
    """Una fila que no sale de un pedido sino de algo que decidió el sistema.

    Existe por el bloqueo de cuenta (RF-26): lo dispara un login, y el login no se
    audita (ver SIN_AUDITAR: su cuerpo es una contraseña). Sin esto, que una cuenta
    quedó bloqueada no lo diría ningún renglón — y es justo lo que se pregunta cuando
    alguien llama diciendo «no puedo entrar».

    Sin autor a propósito (`usuario` e `id_usuario` en NULL): no lo hizo una persona,
    y la regla de esta tabla es no inventar autores. Sin `estado`: no es la respuesta
    de un pedido, es un hecho, y un 4xx lo pintaría de «no se pudo» cuando sí pasó.

    Mismas garantías que `registrar`: no levanta NUNCA.
    """
    try:
        db.add(AuditoriaMovimiento(
            creado_en=ahora_ar(),
            id_usuario=None,
            usuario=None,
            accion=accion[:20],
            entidad=entidad[:80],
            id_entidad=id_entidad,
            descripcion=descripcion,
            metodo=metodo[:10],
            ruta=ruta[:300],
            estado=None,
            duracion_ms=None,
            detalle=(json.dumps(_limpiar(detalle), ensure_ascii=False, default=str)[:TOPE_DETALLE]
                     if detalle else None),
        ))
        await db.commit()
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning("Auditoría: no se pudo registrar «%s»: %s", descripcion, e)
