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
  · Marcar una notificación como leída. Una por campanita, y no cambia nada del
    trabajo: sería la mitad del registro diciendo nada.

ENTRAR, SALIR Y EQUIVOCARSE LA CONTRASEÑA (RF-25, 23/09)

Hasta el 23/09 no se guardaban: `usuario.ultimo_login` decía la última entrada y el
cuerpo del login es una contraseña. Pero el SRS pide «un log de todas las acciones de
cada usuario», y quién entró, cuándo salió y quién estuvo probando claves son las
preguntas de control más básicas. Ahora quedan, con reglas propias (ver «INGRESOS Y
SALIDAS», más abajo): del cuerpo de esos pedidos no se lee NADA —ni siquiera se
parsea—, la fila la arma el endpoint con lo que sabe (qué cuenta, por qué no entró) y
se agrega de dónde vino el pedido (IP y navegador).

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
    # RF-19: bajar, revisar y restaurar una copia. Ídem: la frase la deja el endpoint.
    "backups": "copia de seguridad",
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
    # «/operarios/5/ausencias» (RF-06): cargarle una ausencia a alguien no es editar a
    # la persona. La frase buena, con los días y el motivo, la deja el endpoint.
    "ausencias": "ausencias",
    # /permisos/roles/..., /permisos/usuarios/..., /permisos/secciones/...
    "roles": "de un rol",
    "usuarios": "de una persona",
    "secciones": "confidencialidad",
    # /backups/automaticas/{nombre}/descargar: la que se guardó sola antes de restaurar.
    "automaticas": "automática",
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
    # RF-19. Bajar una copia es un GET que el endpoint anota a mano (por método sería
    # «get»); revisar y restaurar son POST que no crean nada.
    "descargar": "descargó",
    "revisar": "revisó",
    "restauracion": "restauró",
}


def describir(metodo: str, ruta: str, estado: int, usuario: str | None,
              etiqueta: str | None = None) -> tuple[str, str, str | None, str]:
    """(accion, entidad, id_entidad, frase). La frase es lo único que se lee."""
    accion = ACCION.get(metodo) or (ACCION_LECTURA if metodo == "GET" else metodo.lower())
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


# Marcar una notificación como leída no se registra: sería la mitad del registro sin
# contar nada. (Entrar y salir SÍ, desde el 23/09: ver «INGRESOS Y SALIDAS».)
#
# Y lo que se pega el servidor a sí mismo tampoco. Cloud Scheduler llama a
# `POST /internal/sync` cada 30 minutos: son 48 renglones por día que dicen «alguien
# creó internal › sync» —sin persona, porque no hay ninguna— y en una semana serían
# más de 300, tapando lo que este registro viene a contestar. El sync ya se loguea
# solo, con sus números, en Cloud Run. Descubierto el mismo día que salió esto: a las
# tres horas de vida, 7 de las 9 filas eran el cron.
SIN_AUDITAR = (
    ("POST", "/auth/refresh"),
    ("POST", "/auth/token"),
    ("PUT", "/notificaciones/leer-todas"),
    ("PUT", "/notificaciones/"),   # /notificaciones/{id}/leida
    ("POST", "/internal/"),        # el cron del sync, cada 30 minutos
)

# Caminos donde el cuerpo NO se lee: el de un plano ES el archivo, y copiarlo al
# registro sería guardar el PDF de nuevo en cada fila. Y los de credenciales (RF-25):
# ahí el cuerpo ES la contraseña (o el enlace de recuperación), así que ni se parsea.
# Lo que la fila necesita saber —qué cuenta, por qué no entró— lo deja el endpoint.
SIN_CUERPO = ("/planos", "/auth/login", "/auth/change-password", "/auth/reset-password",
              "/auth/forgot-password")

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


# Las lecturas no se guardan (ver arriba), salvo UNA cosa: que alguien sin permiso
# intente LEER lo que es sólo del administrador y que se lleva todos los datos de una —
# bajar una copia de seguridad completa (RF-19)—. La lectura que sí pasa la anota el
# propio endpoint (CopiaSeguridadAPI); el intento rechazado (401/403) lo corta la
# política del router antes de llegar al endpoint, y sin esto no quedaría en ningún lado.
LECTURAS_VIGILADAS = ("/backups/",)
ACCION_LECTURA = "consultó"


def se_audita_el_rechazo(metodo: str, ruta: str, estado: int) -> bool:
    return (metodo == "GET" and estado in (401, 403)
            and any(ruta.startswith(p) for p in LECTURAS_VIGILADAS))


def se_lee_el_cuerpo(ruta: str, content_type: str, largo: int) -> bool:
    if any(p in ruta for p in SIN_CUERPO):
        return False
    if largo > TOPE_CUERPO:
        return False
    return content_type.startswith("application/json")


# ─────────────────────────── INGRESOS Y SALIDAS (RF-25) ───────────────────────────
#
# El SRS pide «registrar un log de todas las acciones realizadas por cada usuario», y
# Julián lo pidió completo: quién entró, cuándo salió, quién se equivocó la clave y
# desde dónde. Hasta el 23/09 esto no quedaba en ningún lado: el login estaba en
# SIN_AUDITAR y la única huella era `usuario.ultimo_login` (una fecha, la última).
#
# Reglas propias, porque son los pedidos con credenciales:
#
#   · Del cuerpo no se lee NADA (SIN_CUERPO): ni la contraseña, ni el enlace de
#     recuperación, ni siquiera el nombre tipeado. Lo que la fila necesita lo deja el
#     endpoint en `request.state.auditoria["acceso"]` (ver `resumen_de_intento`).
#   · Nunca contraseña, token ni hash, en ninguna columna. Lo prueba
#     tests/test_auditoria_ingresos.py buscando los valores en TODA la fila.
#   · El AUTOR es sólo quien se identificó bien: el que entró (su contraseña lo
#     prueba), el que salió o cambió su clave (su sesión lo prueba). Un intento fallido
#     NO tiene autor —no sabemos quién tipeó—: la cuenta que se intentó usar va en
#     `id_entidad` y en la frase, igual que el bloqueo de RF-26. Es la regla de toda la
#     tabla: no inventar autores.
#   · Si el nombre tipeado no es de ninguna cuenta, se guarda RECORTADO (a lo sumo 3
#     letras, nunca más de la mitad: «jua…»). Es lo que la gente tipea cuando se
#     equivoca de casilla: una contraseña en el campo de usuario no puede terminar acá.
#   · De dónde: la IP y el navegador («Chrome en Windows»), si el pedido los trae.
#     La IP es la ÚLTIMA de X-Forwarded-For: la agrega el frente de Google delante de
#     Cloud Run y el navegador no la puede inventar (la primera sí). Sin esa cabecera,
#     la del socket. Es un dato para orientarse, no una prueba.
#   · Una salida que no se pudo (sesión ya vencida) no se guarda: no hay a quién
#     atribuirla y no cerró nada.
#
# DECISIÓN CONSERVADORA (pendiente de confirmar con el taller): la sesión dura 30 días y
# la gente casi nunca toca «Salir», así que «salió» es sólo cuando alguien aprieta el
# botón. Que se le venza la sesión o cierre el navegador no deja fila: no hay pedido.

# El camino -> qué es. Sólo POST: son los únicos métodos de esas rutas.
RUTAS_DE_ACCESO = {
    "/auth/login": "ingreso",
    "/auth/logout": "salida",
    "/auth/change-password": "cambio_de_clave",
    "/auth/reset-password": "restablecimiento",
    "/auth/forgot-password": "pedido_de_recuperacion",
}

ACCION_INGRESO = "ingresó"
ACCION_SALIDA = "salió"
ACCION_FALLIDO = "intento fallido"
ACCION_CAMBIO_CLAVE = "cambió su clave"
ACCION_RESTABLECIO = "restableció clave"
ACCION_PIDIO = "pidió recuperar"

# Lo que muestra la vista «Ingresos» de Auditoría. `bloqueó` (lo pone el sistema al 5º
# error, RF-26) y `desbloqueó` (el admin) ya existían: van acá porque contestan lo mismo.
ACCIONES_DE_ACCESO = (
    ACCION_INGRESO, ACCION_SALIDA, ACCION_FALLIDO, ACCION_CAMBIO_CLAVE,
    ACCION_RESTABLECIO, ACCION_PIDIO, "bloqueó", "desbloqueó",
)
# Entrar y salir no son «hacer algo»: no cuentan como acciones de la persona.
ACCIONES_DE_SESION = (ACCION_INGRESO, ACCION_SALIDA)
# Sobre qué son esas filas. «usuario» es la del bloqueo y el desbloqueo (RF-26).
ENTIDAD_SESION = "sesión"
ENTIDAD_CLAVE = "contraseña"
ENTIDADES_DE_ACCESO = (ENTIDAD_SESION, ENTIDAD_CLAVE, "usuario")

# Por qué no se pudo, en castellano. Los códigos los pone AuthService (self.intento).
MOTIVOS = {
    "clave_incorrecta": "contraseña incorrecta",
    "se_bloqueo": "contraseña incorrecta, y con esa la cuenta quedó bloqueada",
    "cuenta_bloqueada": "la cuenta estaba bloqueada (no se miró la contraseña)",
    "usuario_inactivo": "la cuenta está desactivada",
    "usuario_inexistente": "ese usuario no existe",
    "no_verificado": "no se pudo verificar y se le pidió que pruebe de nuevo",
    "clave_actual_incorrecta": "la contraseña actual no es correcta",
    "enlace_invalido": "el enlace no es válido",
    "enlace_vencido": "el enlace venció",
    "error": "error del sistema",
}


def tipo_de_acceso(metodo: str, ruta: str) -> str | None:
    """«ingreso», «salida»… o None si el pedido no es de credenciales."""
    if metodo != "POST":
        return None
    return RUTAS_DE_ACCESO.get(ruta.rstrip("/") or "/")


def recortar_tipeado(texto) -> str:
    """Lo tipeado en «usuario» cuando no es de ninguna cuenta: a lo sumo 3 caracteres y
    nunca más de la mitad. «juancito» -> «jua…», «ana» -> «a…», «x» -> «…».

    Alcanza para reconocer un error de tipeo («luc…» era Lucas) y no para leer una
    contraseña escrita en la casilla equivocada, que es lo que pasa cuando alguien se
    apura."""
    t = str(texto or "").strip()
    if not t:
        return "(vacío)"
    return t[:min(3, len(t) // 2)] + "…"


def resumen_de_intento(intento: dict | None) -> dict:
    """Lo que el endpoint deja en `request.state.auditoria["acceso"]`, a partir de lo que
    anotó AuthService (self.intento). Lo tipeado sale recortado acá: el texto entero no
    pasa de esta función."""
    intento = dict(intento or {})
    salida = {}
    for clave in ("id_usuario", "cuenta", "nombre", "motivo", "intentos_restantes",
                  "bloqueado_hasta"):
        if intento.get(clave) is not None:
            salida[clave] = intento[clave]
    if salida.get("id_usuario") is None and intento.get("tipeado") is not None:
        salida["tipeado"] = recortar_tipeado(intento["tipeado"])
    return salida


_NAVEGADORES = (
    ("Edg", "Edge"), ("OPR/", "Opera"), ("SamsungBrowser/", "Samsung Internet"),
    ("Firefox/", "Firefox"), ("FxiOS/", "Firefox"), ("CriOS/", "Chrome"),
    ("Chrome/", "Chrome"), ("Chromium/", "Chrome"), ("Safari/", "Safari"),
)
_SISTEMAS = (
    ("Windows", "Windows"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"),
    ("CrOS", "Chromebook"), ("Macintosh", "Mac"), ("Mac OS X", "Mac"), ("Linux", "Linux"),
)


def describir_navegador(agente: str | None) -> str | None:
    """«Chrome en Windows», «Safari en iPhone». Sin versión: es para reconocer un
    equipo de un vistazo, no para un inventario. Lo que no se reconoce (un script)
    dice el programa: «programa (curl)»."""
    a = (agente or "").strip()
    if not a:
        return None
    nav = next((n for marca, n in _NAVEGADORES if marca in a), None)
    so = next((s for marca, s in _SISTEMAS if marca in a), None)
    if nav and so:
        return f"{nav} en {so}"
    if nav or so:
        return nav or so
    return f"programa ({a.split('/')[0].split(' ')[0][:30]})"


def origen_del_pedido(cabeceras, cliente: str | None = None) -> dict:
    """{ip, navegador, agente} de un pedido, con lo que haya. Ver arriba por qué la IP es
    la ÚLTIMA de X-Forwarded-For."""
    salida = {}
    ip = None
    reenviado = (cabeceras.get("x-forwarded-for") or "") if cabeceras else ""
    partes = [p.strip() for p in reenviado.split(",") if p.strip()]
    if partes:
        ip = partes[-1]
    ip = ip or cliente
    if ip:
        salida["ip"] = str(ip)[:64]
    agente = (cabeceras.get("user-agent") or "") if cabeceras else ""
    if agente:
        salida["navegador"] = describir_navegador(agente)
        salida["agente"] = agente[:200]
    return salida


def _quien_es_la_cuenta(acceso: dict) -> str:
    """«lucas (Lucas Longchamps)», o «lucas» si no hay nombre."""
    cuenta = acceso.get("cuenta")
    nombre = acceso.get("nombre")
    if cuenta and nombre and nombre.strip().lower() != str(cuenta).strip().lower():
        return f"«{cuenta}» ({nombre})"
    return f"«{cuenta or nombre}»"


def _motivo(acceso: dict, estado: int) -> str:
    """Por qué no se pudo. Sin código es que el pedido no llegó al endpoint (el
    endpoint siempre deja uno): lo frenó la validación —que en esta app contesta 400,
    no 422 (exception_handlers)— o la sesión."""
    codigo = acceso.get("motivo")
    if codigo in MOTIVOS:
        texto = MOTIVOS[codigo]
    elif estado in (400, 422):
        texto = ("el pedido llegó incompleto o con datos que no son válidos (por ejemplo, "
                 "las contraseñas nuevas no coinciden)")
    elif estado in (401, 403):
        texto = "la sesión no es válida"
    else:
        texto = MOTIVOS["error"]
    if estado >= 500 or texto == MOTIVOS["error"]:
        texto += f" (código {estado})"
    return texto


def _fila_de_acceso(tipo: str, *, usuario: dict | None, metodo: str, ruta: str,
                    estado: int, duracion_ms: int, resumen: dict | None,
                    origen: dict | None) -> AuditoriaMovimiento | None:
    """La fila de un ingreso, una salida o un cambio de clave (ver arriba las reglas).
    None = no se guarda (una salida que no se pudo)."""
    acceso = dict((resumen or {}).get("acceso") or {})
    bien = estado < 400
    id_cuenta = acceso.get("id_usuario")
    motivo = None if bien else _motivo(acceso, estado)

    # Quién la hizo (sólo si se identificó bien) y sobre qué cuenta.
    id_autor, autor = None, None
    if usuario:
        id_autor = usuario.get("id_usuario")
        partes = [usuario.get("nombre") or "", usuario.get("apellido") or ""]
        autor = " ".join(p for p in partes if p).strip() or usuario.get("username")
    entidad = ENTIDAD_SESION
    id_entidad = str(id_cuenta) if id_cuenta is not None else None

    if tipo == "ingreso":
        if bien:
            accion = ACCION_INGRESO
            id_autor = id_cuenta
            autor = acceso.get("nombre") or acceso.get("cuenta")
            frase = f"{autor or 'alguien'} entró al sistema"
        else:
            accion = ACCION_FALLIDO
            id_autor, autor = None, None
            if id_cuenta is not None:
                frase = f"Intento fallido de entrar como {_quien_es_la_cuenta(acceso)}: {motivo}"
                restantes = acceso.get("intentos_restantes")
                if acceso.get("motivo") == "clave_incorrecta" and restantes:
                    frase += (f". Le queda 1 intento" if restantes == 1
                              else f". Le quedan {restantes} intentos")
            elif acceso.get("motivo") == "usuario_inexistente":
                frase = ("Intento fallido de entrar con un usuario que no existe "
                         f"(«{acceso.get('tipeado') or '(vacío)'}»)")
            elif acceso.get("tipeado"):
                frase = f"Intento fallido de entrar como «{acceso['tipeado']}»: {motivo}"
            else:
                frase = f"Intento fallido de entrar: {motivo}"
    elif tipo == "salida":
        if not bien or not usuario:
            return None
        accion = ACCION_SALIDA
        id_entidad = str(id_autor) if id_autor is not None else None
        frase = f"{autor or 'alguien'} salió del sistema"
    elif tipo == "cambio_de_clave":
        accion = ACCION_CAMBIO_CLAVE
        entidad = ENTIDAD_CLAVE
        id_entidad = str(id_autor) if id_autor is not None else None
        frase = (f"{autor or 'alguien'} cambió su contraseña" if bien
                 else f"{autor or 'alguien'} no pudo cambiar su contraseña: {motivo}")
    elif tipo == "restablecimiento":
        # Con el enlace del mail, sin sesión: la cuenta es de quien tiene el enlace, que
        # no es lo mismo que haberse identificado. Sin autor, como un intento.
        accion = ACCION_RESTABLECIO
        entidad = ENTIDAD_CLAVE
        id_autor, autor = None, None
        if bien and id_cuenta is not None:
            frase = (f"Se restableció la contraseña de {_quien_es_la_cuenta(acceso)} "
                     "con el enlace de recuperación")
        elif bien:
            frase = "Se restableció una contraseña con el enlace de recuperación"
        elif id_cuenta is not None:
            frase = (f"No se pudo restablecer la contraseña de {_quien_es_la_cuenta(acceso)}: "
                     f"{motivo}")
        else:
            frase = f"Intento de restablecer una contraseña que no se pudo: {motivo}"
    else:  # pedido_de_recuperacion: el endpoint contesta siempre lo mismo (no revela nada)
        accion = ACCION_PIDIO
        entidad = ENTIDAD_CLAVE
        id_autor, autor = None, None
        codigo = acceso.get("motivo")
        if id_cuenta is not None and codigo in (None, "ok"):
            frase = f"Se pidió recuperar la contraseña de {_quien_es_la_cuenta(acceso)}"
        elif id_cuenta is not None:
            frase = (f"Se pidió recuperar la contraseña de {_quien_es_la_cuenta(acceso)} "
                     f"y no se mandó nada: {MOTIVOS.get(codigo, MOTIVOS['error'])}")
        elif codigo == "usuario_inexistente":
            frase = ("Se pidió recuperar la contraseña de un correo que no está registrado "
                     f"(«{acceso.get('tipeado') or '(vacío)'}»)")
        else:
            frase = "Se pidió recuperar una contraseña y no se pudo procesar"

    datos = {"resultado": "bien" if bien else "no se pudo"}
    if motivo:
        datos["motivo"] = motivo
    for clave in ("cuenta", "tipeado", "intentos_restantes", "bloqueado_hasta"):
        if acceso.get(clave) is not None:
            datos[clave] = acceso[clave]
    datos.update(origen or {})
    try:
        detalle = json.dumps(_limpiar(datos), ensure_ascii=False, default=str)[:TOPE_DETALLE]
    except Exception:
        detalle = None

    return AuditoriaMovimiento(
        creado_en=ahora_ar(),
        id_usuario=id_autor,
        usuario=str(autor)[:120] if autor else None,
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


def armar_fila(*, usuario: dict | None, metodo: str, ruta: str, estado: int,
               duracion_ms: int, cuerpo=None, parametros: dict | None = None,
               resumen: dict | None = None,
               origen: dict | None = None) -> AuditoriaMovimiento | None:
    """La fila lista para guardar. Separada de `registrar` para poder probarla sin base.

    `resumen` es lo que dejó dicho el endpoint (request.state.auditoria), para los
    cambios en los que el pedido solo no cuenta la historia —los de permisos—:
      · "frase": lo que pasó, sin el autor («le dio a Matías «Clientes» ...»). Reemplaza
        la frase armada por método y camino, sólo si el pedido salió bien.
      · "antes" / "despues": cómo estaba y cómo quedó. Van al detalle.
      · "acceso": en los pedidos de credenciales (RF-25), qué cuenta y por qué no entró.

    `origen` (IP y navegador) sólo lo usan esos pedidos. None = no se guarda nada.
    """
    tipo = tipo_de_acceso(metodo, ruta)
    if tipo:
        return _fila_de_acceso(tipo, usuario=usuario, metodo=metodo, ruta=ruta,
                               estado=estado, duracion_ms=duracion_ms, resumen=resumen,
                               origen=origen)

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
        fila = armar_fila(**kwargs)
        if fila is None:
            return
        db.add(fila)
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

    Existe por el bloqueo de cuenta (RF-26): lo dispara un login. Desde RF-25 el login
    también deja su fila («intento fallido»), pero el bloqueo es OTRO hecho —la cuenta
    queda cerrada 15 minutos— y se busca aparte: es lo que se pregunta cuando alguien
    llama diciendo «no puedo entrar».

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
