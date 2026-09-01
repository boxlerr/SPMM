/**
 * Novedades del sistema — lo que fue cambiando, contado para quien usa las pantallas.
 *
 * Pedido de Julián (14/08/2026): tener en SPMM lo mismo que en Don Joaquín, una
 * sección donde el equipo de Longchamps ve qué cambió sin tener que enterarse
 * abriendo una pantalla que no reconoce.
 *
 * Es una lista escrita a mano y a propósito: los mensajes de commit hablan de
 * archivos y de causas, no de lo que ve Lucas cuando entra a Operaciones.
 *
 * Reglas para escribir una novedad:
 *  - Contala desde la pantalla y en segunda persona: "ya podés sacar una OT de la
 *    planificación", no "se agregó el endpoint quitar-ordenes".
 *  - Nada de nombres internos: ni tablas, ni componentes, ni "el endpoint". Si la
 *    palabra no está escrita en la pantalla, no va.
 *  - El título es UNA línea y dice qué se puede hacer ahora. El `detalle` cuenta
 *    cómo era antes o dónde está el botón.
 *  - `fecha` es el día que salió a producción, en ISO (YYYY-MM-DD).
 *  - `id` es un slug corto y ESTABLE.
 *  - Las más nuevas van arriba de todo.
 */

/**
 * Qué clase de cambio es. Define el ícono y el rótulo con el que se dibuja:
 *  - `nuevo`: algo que antes no se podía hacer.
 *  - `mejora`: se podía, pero ahora se hace mejor o más rápido.
 *  - `arreglo`: andaba mal y ya no.
 */
export type NovedadTipo = "nuevo" | "mejora" | "arreglo";

export type Novedad = {
    /** Slug corto y estable. */
    id: string;
    /** Día en que salió a producción (YYYY-MM-DD). */
    fecha: string;
    tipo: NovedadTipo;
    /** En qué pantalla se nota ("Operaciones", "Recursos", "Configuración"...). */
    seccion: string;
    /** Qué se puede hacer ahora, en una línea y sin nombres internos. */
    titulo: string;
    /** Cómo era antes o dónde está: lo que hace que se entienda sola. */
    detalle?: string;
    /** A dónde lleva si la tocan. */
    href?: string;
};

/** Las más nuevas arriba. Al agregar una, va al principio de la lista. */
export const NOVEDADES: Novedad[] = [
    {
        id: "confirmar-no-borra-otros-borradores",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Confirmar un plan ya no se lleva puestos los demás planes sin confirmar",
        detalle:
            "Al confirmar una tanda grande desaparecía media lista de «Planes sin confirmar». Se borraba todo plan guardado cuyas OT estuvieran dentro de la tanda que estabas confirmando, aunque fuera de otro día, de otra tanda o de otra persona; con 176 OT eso era casi toda la lista. Ahora confirmar saca de ahí únicamente el plan que confirmaste y el resto queda donde estaba. Lo que ya se borró no vuelve, pero en Auditoría ves qué OT tenía cada tanda para volver a calcularla.",
        href: "/operaciones",
    },
    {
        id: "aviso-llega-con-la-solucion-tildada",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "«Ir a arreglarlo» te deja la solución tildada: solo confirmás",
        detalle:
            "Antes el botón te dejaba parado en la fila correcta de Recursos, pero con la lista de rangos vacía: había que acordarse de cuál era y buscarlo entre treinta. Ahora el aviso viaja con la propuesta: llegás y ya está tildada, en celeste, con el botón de guardar encendido — mirás y guardás. Además el aviso ahora DICE cuáles son («Cargale OFICIAL o MEDIO OFICIAL: son los que ya aceptan las máquinas donde se hace»), así que se entiende antes de tocar nada. No se guarda nada solo: si la propuesta no va, la sacás con la cruz.",
        href: "/operaciones",
    },
    {
        id: "responsive-tablet-y-telefono",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Todo el sistema",
        titulo: "El sistema se puede usar en tablet y en teléfono",
        detalle:
            "En pantallas de menos de 1024 el menú de la izquierda se quedaba fijo y opaco tapando los primeros 256px: en una tablet no se veía ni el título ni la columna de los tildes. Ahora se corre del todo y se abre con el botón, como en el teléfono. De paso: en el planificador ya se puede tildar una OT desde el teléfono (a la tarjeta le faltaba la casilla), los filtros de prioridad se arrastran de costado en vez de cortarse, las cinco pestañas de Recursos se acomodan en varias filas, la barra de «cambios sin guardar» dejó de taparle el botón de planificar, y el panel de carga de operarios arranca plegado cuando la pantalla es angosta para no comerse la tabla.",
        href: "/operaciones",
    },
    {
        id: "borrador-no-se-pisa",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Planificar de nuevo ya no se come el borrador anterior",
        detalle:
            "Cada plan sin confirmar se guarda solo para que lo puedas retomar. El problema era que el sistema seguía escribiendo SIEMPRE sobre el mismo renglón: calculabas un plan nuevo y el borrador de antes quedaba reemplazado por el nuevo, con el nombre y la fecha del viejo. Así un borrador de 8 OT apareció un día con 1 sola. Ahora cada cálculo nuevo deja su propio borrador y los anteriores quedan enteros; retomar uno y recalcularlo sí sigue actualizando ese mismo, que es lo que uno espera. Ojo: lo que ya se pisó no se puede recuperar.",
        href: "/operaciones",
    },
    {
        id: "planificar-abre-sin-tildar",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Planificar abre sin nada tildado: elegís vos qué entra",
        detalle:
            "Antes abrías y ya estaban las 176 OT marcadas, así que planificar de más era un click y elegir de verdad era destildar 170. Ahora arranca en cero. Para tildar de a montones está el casillero de la cabecera de la lista, que suma o saca solo las filas que estás viendo: filtrás urgentes, tildás todas, cambiás a retrasadas, tildás todas, y se van sumando. «Volver» desde la vista previa te devuelve la tanda intacta; salir del planificador sí empieza de nuevo.",
        href: "/operaciones",
    },
    {
        id: "ver-solo-las-tildadas",
        fecha: "2026-09-01",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Tocá «N seleccionadas» y ves solo las OT que elegiste",
        detalle:
            "Con 176 renglones, encontrar las 3 que tildaste era scrollear a ojo. Ahora el contador es un botón: lo tocás y la lista queda con esas nada más, para repasarlas antes de calcular. Podés destildar ahí mismo sin que la fila desaparezca de golpe, y volvés a la lista completa tocándolo de nuevo.",
        href: "/operaciones",
    },
    {
        id: "carga-operarios-scrollea",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El panel de carga de operarios volvió a scrollear",
        detalle:
            "En la vista previa, la lista de la derecha se cortaba donde terminaba el panel y no había manera de llegar a los operarios de abajo: con el taller entero solo se veían los tres o cuatro primeros. Ahora scrollea normal.",
        href: "/operaciones",
    },
    {
        id: "avisos-sin-numerito-ni-barra",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos perdieron el numerito y la barra de color de la izquierda",
        detalle:
            "Cada aviso arrastraba dos adornos pegados al borde izquierdo —un número en un círculo gris y una barra de color— que no decían nada y le comían lugar al título, que es lo único que hay que poder leer de un saque. Se fueron los dos. Si era Alta o Media se sigue viendo igual: lo dice con todas las letras el cartelito rojo o ámbar del principio.",
        href: "/operaciones",
    },
    {
        id: "avisos-titulos-uniformes",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Todos los avisos se titulan igual: primero de quién habla, después qué le pasa",
        detalle:
            "Quedaban dos avisos que arrancaban sin los dos puntos y uno que enumeraba las ocho máquinas en el título y se iba de renglón. Ahora los siete tienen la misma forma —«Soldadura con MIG: su máquina no acepta el rango que pide»— y el nombre del trabajo va escrito como se escribe, con las siglas en mayúscula. Si abrís un borrador viejo vas a ver los textos de cuando se calculó: tocá «Volver a revisar» y salen con el formato nuevo.",
        href: "/operaciones",
    },
    {
        id: "filtros-suman-seleccion",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Cambiar de filtro ya no te borra las OT que habías elegido",
        detalle:
            "En el paso de elegir qué OT entran al plan, cada vez que tocabas un filtro la selección se rehacía con lo que quedaba a la vista: marcabas las urgentes, pasabas a retrasadas y las urgentes se perdían sin avisar —el contador caía de 18 a 6 y los días estimados con él—. Ahora la selección se suma: elegís por urgentes, después por retrasadas, después por cliente, y vas viendo cómo crecen los días acumulados. Lo que destildás a mano queda destildado aunque vuelvas a pasar por su filtro, y el tilde de la cabecera agrega o saca sólo las que estás viendo. Para arrancar de cero está «Deseleccionar todas».",
        href: "/operaciones",
    },
    {
        id: "filtro-cierra-ot-desplegadas",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Al cambiar de filtro, las OT que dejaste abiertas se cierran",
        detalle:
            "En esa misma lista podés desplegar una OT para ver sus procesos. Antes las abiertas quedaban abiertas al filtrar, así que después de mirar tres o cuatro la pantalla aparecía llena de bandas desplegadas de OT que ya no estabas mirando y no se entendía qué tenías adelante. Ahora cada cambio de filtro deja la lista plegada y se lee de un vistazo; la OT que quieras seguir mirando la volvés a abrir con la flecha.",
        href: "/operaciones",
    },
    {
        id: "vista-previa-procesos-a-mano",
        fecha: "2026-08-31",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Lo que agregás a mano al plan se ve, se corrige y se puede deshacer",
        detalle:
            "En la vista previa, todo lo que sumás con «Agregar OTs» queda marcado en violeta —la OT con el cartelito «A mano» y cada proceso suelto con el suyo— así se distingue de lo que armó el planificador solo. Si te equivocaste, la X del proceso lo saca sin tocar el resto de la OT, y el botón «Deshacer» de arriba devuelve toda la última tanda. Al elegir procesos sueltos ahora sólo se pueden tildar los del paso 1 o 2: un proceso posterior necesita que la pieza haya pasado por los anteriores, y si el orden de la OT está mal, hay que corregirlo en la OT. Antes lo agregado se mezclaba con el resto y la única forma de arrepentirse era tirar la OT entera.",
        href: "/operaciones",
    },
    {
        id: "avisos-abren-la-ot",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Desde el aviso llegás a la OT de un click",
        detalle:
            "Cada aviso muestra el número de las OT que toca y, al tocarlo, la tabla se abre en esa fila con los procesos desplegados y la deja resaltada: ahí mismo le elegís la persona y la máquina. Antes el número estaba en chico y había que bajar a buscar la OT entre todas las demás; si algún filtro la tapaba, ahora se limpian solos y te avisa.",
        href: "/operaciones",
    },
    {
        id: "avisos-recurso-maquina-recurso-humano",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Cada aviso empieza diciendo de qué recurso habla",
        detalle:
            "Antes el aviso arrancaba por el nombre del proceso y el motivo aparecía a mitad del texto, escrito distinto cada vez: mirando la pantalla no se podía contestar «¿cuál es la traba acá?». Ahora todos empiezan igual y con las mismas cuatro palabras posibles: Recurso máquina · Rango, Recurso máquina · Capacidad, Recurso humano · Rango o Recurso humano · Skill. Al lado se lee qué tiene hoy y qué le piden —«Medio oficial → Oficial»—, que es el resumen del problema en dos palabras. Los rótulos viejos («Sin gente», «Cuello», «Terceros») no decían a qué pantalla ir a arreglarlo.",
        href: "/operaciones",
    },
    {
        id: "marcar-avisos-como-resueltos",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Podés dar un aviso por resuelto y sacarlo de la lista",
        detalle:
            "Los avisos naranjas (Media) no traban nada y se quedan siempre en pantalla, porque son recomendaciones: con un lote grande de OT terminaban tapando las trabas rojas de verdad. Ahora cada aviso tiene un tilde para darlo por resuelto y hay un «Marcar todo listo» arriba: bajan a la tira verde con el nombre de lo que resolviste y la cifra de «Trabas sin resolver» los descuenta. No cambia el plan ni toca ningún dato, y se deshace uno por uno o entero. Ojo: el que manda es el recálculo — si el problema sigue, el aviso vuelve a la lista.",
        href: "/operaciones",
    },
    {
        id: "avisos-media-boton-ir-a-arreglarlo",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos naranjas también te llevan a arreglarlos",
        detalle:
            "Los avisos que no traen botón de «Aplicar y recalcular» —porque qué rango va lo sabe el taller, no el sistema— ahora tienen «Ir a arreglarlo»: abre Recursos en otra pestaña, parado en la máquina, el proceso o la persona que hay que tocar, sin perder el borrador. Cuando volvés a la pestaña de la planificación, el sistema se fija solo si cambió algo en Recursos y recalcula para mostrarte qué quedó resuelto.",
        href: "/operaciones",
    },
    {
        id: "recurso-humano-en-todas-las-pantallas",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "General",
        titulo: "Se dice «recurso humano» en todos lados, no operario ni persona",
        detalle:
            "El mismo dato se llamaba Operario en una pantalla, Persona en otra y Cantidad de empleados en una tercera. Ahora es «Recurso humano» y «Cantidad de recurso humano» en todas: en la carga de procesos de la OT, en la lista de planificación, en la vista previa, en el cronograma, en el tablero y en Recursos. Las máquinas, igual: «Recurso maquinaria». Es solo cómo se lee — no cambió ningún dato ni ninguna cuenta.",
    },
    {
        id: "un-proceso-varias-veces-en-la-ot",
        fecha: "2026-08-28",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Un proceso puede repetirse en la misma OT, como está cargado en el sistema viejo",
        detalle:
            "Si una OT pasa tres veces por el torno CNC, en el sistema viejo son tres renglones. Acá entraba uno solo: los demás se perdían o se sumaban dentro del primero, así que veías un bloque enorme en un paso en lugar de las pasadas repartidas entre los otros procesos. Ahora entran todas y cada una lleva su paso, su tiempo y su estado por separado: podés marcar terminada la primera pasada y dejar pendiente la tercera. Al agregar procesos sueltos al plan también las elegís de a una. Ojo: si una OT tiene un proceso repetido y no debería, eso viene así del sistema viejo — se copia tal cual y lo corregís vos.",
        href: "/operaciones",
    },
    {
        id: "maquinas-muestran-su-limitacion",
        fecha: "2026-08-28",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Al elegir la máquina ves su limitación, no solo el nombre",
        detalle:
            "La limitación que cargás en Recursos —«Falla en avance automático», «No entra material de más de 3 metros»— ahora aparece en el desplegable, en un renglón chico debajo del nombre de cada máquina. Antes solo estaba en Recursos: para saberlo había que salir de la planificación, buscar la máquina y volver, así que en la práctica se elegía a ciegas. Cuando la máquina elegida tiene una limitación, el casillero queda en ámbar y el texto completo se lee apoyando el mouse encima. Se ve igual en la vista previa, en la lista de planificación y en el detalle de una tarea del cronograma. Ojo: es un dato para vos, el planificador automático no lo tiene en cuenta al repartir el trabajo.",
        href: "/operaciones",
    },
    {
        id: "avisos-dicen-quien-puede-y-que-pasa",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos ahora separan quién puede hacer el trabajo de qué pasa con la máquina",
        detalle:
            "Antes un mismo aviso mezclaba las dos cosas y no se entendía: decía que la máquina no se reservaba y más abajo que el rango «hoy lo tienen 3 personas», así que no quedaba claro si había gente o no había nadie. Ahora el aviso arranca contestando lo primero —«Quién lo hace no es el problema: lo pueden hacer 6 personas y se hace igual»— y recién después explica lo de la máquina y qué se pierde: que queda figurando libre y otra OT puede tomarla a la misma hora. El título dice el proceso y qué le pasa, en un renglón. Y donde un arreglo NO sirve, ahora te lo dice: cargar la habilidad a mano no destraba cuando lo que no coincide es lo que pide el trabajo con lo que pide la máquina. Además cada aviso es ahora una tarjeta con el problema a la izquierda y qué hacer a la derecha, con el botón para aplicarlo a la vista sin tener que abrir nada: entran seis donde antes entraban cuatro.",
        href: "/operaciones",
    },
    {
        id: "planificador-entra-mas-en-pantalla",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Entran muchas más OTs en pantalla, en los dos pasos",
        detalle:
            "Al elegir las OTs entraban 4 y ahora entran unas 7: los chips de arriba subieron al lado del título, se fue una banda blanca que sobraba arriba de la tabla y las filas ocupan lo que tienen que ocupar. En la vista previa el período del plan pasó a ser la primera cifra de arriba, del mismo tamaño que las demás y no un cartelito perdido; las cifras dejaron de flotar sueltas; la tira de avisos arranca plegada cuando no quedó ninguna traba sin resolver (si quedó alguna, se abre igual que siempre); y el panel de Carga de operarios se pliega a un costado cuando querés que la tabla respire, y vuelve donde estaba.",
        href: "/operaciones",
    },
    {
        id: "persona-en-el-proceso-de-la-ot",
        fecha: "2026-08-26",
        tipo: "nuevo",
        seccion: "Operaciones › Nueva OT",
        titulo: "Al cargar una OT ya podés decir quién hace cada proceso",
        detalle:
            "En el paso Procesos apareció la columna Persona, al lado de Máquina. Si elegís a alguien, el plan lo respeta aunque el rango no se lo habilite: es tu decisión, no la del sistema. Dejalo en «Sin asignar» y el planificador elige como hasta ahora. El candado amarillo te marca las filas donde forzaste máquina o persona, y «Traer historial» ahora también te repone quién lo hizo la vez pasada.",
        href: "/operaciones",
    },
    {
        id: "avisos-del-plan-mas-claros",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos del plan dicen qué pasa, con los nombres bien escritos",
        detalle:
            "Los procesos salían en minúscula y sin siglas —«soldadura con mig», «torno t1»— y costaba reconocerlos. Ahora se leen como se escriben: «Soldadura con MIG», «Torno T1», «Preparación de soldadora MIG». Y el título dice qué pasa en vez de cómo lo llama el sistema: donde antes decía «se hace sin reservar la máquina» ahora dice «la máquina queda libre y otra OT puede tomarla», y cada aviso distingue si no hay máquina cargada, si el trabajo va a mano, o si el rango del proceso no coincide con el de la máquina. La explicación quedó en frases cortas y se aclara cuándo cargar la habilidad a mano destraba y cuándo no.",
        href: "/operaciones",
    },
    {
        id: "avisos-formato-unico",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Las trabas y los avisos se leen de un vistazo: todos con el mismo formato",
        detalle:
            "Cada aviso arrancaba a su manera —uno con el nombre de un proceso, otro con una cifra, otro con «Hay trabajo asignado a…»— y había que leerlos enteros para saber de qué hablaba cada uno. Ahora todos empiezan por la cosa que tiene el problema y siguen con lo que le pasa, y a la izquierda hay una columna fija que dice de qué se trata: CUELLO, SIN MÁQUINA, SIN RANGO, SIN GENTE, VACANTE o TERCEROS. Además se bajó la negrita: resalta los nombres de máquinas, procesos, rangos y personas, y las cifras — nada más.",
        href: "/operaciones",
    },
    {
        id: "planificador-pantalla-completa",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Planificar ocupa la pantalla entera: se terminaron las ventanas flotantes",
        detalle:
            "Antes elegir las OTs y revisar el plan eran dos ventanas grises flotando arriba de Operaciones, que se cerraban con un click al costado y no dejaban ver el menú. Ahora es una pantalla, con el menú de la izquierda a la vista y el mismo recorrido de siempre: Paso 1 elegís las OTs, Paso 2 revisás el plan y confirmás. Arriba del plan quedan las cuatro cifras que importan —OTs, procesos, carga total y trabas sin resolver— en grande y sin tener que buscarlas, con el período del plan al lado de la bajada en vez de colgando solo abajo. Y las dos pantallas usan el ancho completo: se sacó un margen de más que dejaba cinco centímetros en blanco a cada lado, y se le quitó aire a los filtros para que entren varias filas más de la lista sin tener que scrollear.",
        href: "/operaciones",
    },
    {
        id: "avisos-se-revisan-solos",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Si arreglás un aviso en Recursos, al volver aparece resuelto y el plan se rehace solo",
        detalle:
            "Antes había que acordarse de tocar «Volver a revisar»: ibas a Recursos, cargabas el rango que el aviso te pedía, volvías al borrador y el aviso seguía igual de rojo aunque el problema ya no existiera. Ahora, al volver a la pantalla, el sistema se fija solo si cambió algo en Recursos; si cambió, recalcula y lo que se arregló queda tachado en verde como «Resuelto». Si no tocaste nada, no te hace esperar. El botón sigue estando por si querés forzarlo, y cuando tenés cambios hechos a mano en el plan te avisa en vez de pisártelos.",
        href: "/operaciones",
    },
    {
        id: "avisos-llevan-al-dato",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "El «Recursos › Procesos» de cada aviso ahora es un link que te deja parado en el dato",
        detalle:
            "Era un cartelito gris que no hacía nada: había que salir del plan, buscar la pantalla, elegir la pestaña y encontrar el proceso entre 414. Ahora lo tocás y se abre en otra pestaña, ya en la pestaña correcta, con el buscador cargado y la fila abierta lista para editar. Además el detalle de cada aviso se lee de entrada, sin tener que desplegarlo.",
        href: "/operaciones",
    },
    {
        id: "plan-filtros-y-columnas",
        fecha: "2026-08-26",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "La tabla del plan tiene Filtros y Columnas",
        detalle:
            "Con 40 OTs la tabla no entra en la pantalla. «Filtros» te deja ver solo las que llegan tarde, las que quedaron sin operario o sin máquina, las forzadas, o buscar por cliente, código o proceso. «Columnas» apaga las que no mirás, y se acuerda de tu elección. Ojo: filtran lo que ves, no lo que se guarda — al confirmar se guarda el plan completo, y te lo avisa arriba de la tabla.",
        href: "/operaciones",
    },
    {
        id: "borrador-conserva-retoques",
        fecha: "2026-08-26",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Retomar un borrador ya no pierde los cambios que hiciste a mano",
        detalle:
            "Al retomar un plan sin confirmar volvían las asignaciones del planificador y se perdía cada máquina, operario y horario que habías acomodado vos. Ahora vuelven tal cual los dejaste, junto con las OTs que habías forzado.",
        href: "/operaciones",
    },
    {
        id: "recursos-procesos-no-se-cae",
        fecha: "2026-08-26",
        tipo: "arreglo",
        seccion: "Recursos › Procesos",
        titulo: "La pestaña Procesos ya no se cae con un proceso recién creado",
        detalle:
            "Si creabas un proceso y entrabas a la pestaña sin recargar la página, la pantalla quedaba en blanco con un error. Ahora ese proceso muestra un guion en la columna «Quién puede hacerlo» hasta que se actualizan los datos, y el resto de la lista se ve igual.",
        href: "/recursos",
    },
    {
        id: "botones-en-todos-los-avisos",
        fecha: "2026-08-19",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Casi todos los avisos se resuelven con el botón, y ya no te ofrece arreglos que no sirven",
        detalle:
            "El botón «Aplicar y recalcular» aparecía solo cuando el cambio era sobre una única máquina; si eran varias había que ir a Recursos y hacer el mismo cambio a mano, una por una. Ahora las toca a todas de una, y sigue diciéndote a cuánta gente le abrís la máquina antes de que la toques. También tiene botón el arreglo de «volvé a encenderle esta tarea a fulano», que es el más común y el más seguro. Y se sacó un consejo que no servía: cuando la máquina pide un rango que no tiene ninguna persona —como las soldadoras MIG, que piden MEDIO OFICIAL y hoy nadie lo tiene—, el aviso te ofrecía cargarle ese rango al proceso y eso no cambiaba nada. Ahora te dice la verdad: que esas máquinas hoy no las puede reservar nadie, para ningún trabajo.",
        href: "/operaciones",
    },
    {
        id: "borradores-de-planificacion",
        fecha: "2026-08-19",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "El plan que calculaste ya no se pierde: queda como borrador",
        detalle:
            "Antes, si cerrabas la vista previa sin confirmar, se perdía todo: el cálculo de varios minutos y cada cambio que hubieras hecho a mano. Ahora se guarda solo, apenas termina de calcular y cada vez que cambiás una máquina, un operario o un horario. En Planificar Órdenes tenés arriba el botón «Retomar borrador»: lo abrís y aparece tal cual lo dejaste, sin volver a calcular. Se guarda en dos lados a la vez — en tu computadora, así sobrevive a un corte de luz o a cerrar la ventana sin querer, y en el sistema, así lo abre cualquiera desde cualquier máquina. Si el borrador tiene más de una hora te avisa que los datos pudieron cambiar, y podés recalcular con un botón. Cuando confirmás el plan, el borrador se borra solo.",
        href: "/operaciones",
    },
    {
        id: "barra-de-avance-y-lote-de-la-semana",
        fecha: "2026-08-19",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Ves cómo avanza el cálculo, y ya no te avisa por planificar la semana entera",
        detalle:
            "Mientras planifica ahora hay una barra con el avance, la etapa en la que va y los segundos que lleva, en vez de un cartelito que decía «Calculando planificación...» sin moverse. Y el aviso de «lote grande» dejó de saltar a las 30 órdenes: aparece recién pasadas las 50, porque 35 o 40 juntas es la semana normal. Además ya no te recomienda partir el lote, que era justo lo que no había que hacer: si planificás en dos tandas, la segunda no ve las máquinas que reservó la primera y los dos planes se pisan.",
        href: "/operaciones",
    },
    {
        id: "soldadura-reserva-la-soldadora",
        fecha: "2026-08-19",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "La soldadura ya reserva la soldadora, y el pulido dejó de ocuparla",
        detalle:
            "Hasta ahora la soldadura salía con «No necesita» en la columna Maquinaria: las cuatro soldadoras del taller no quedaban tomadas por nadie. Y al revés, trabajos de banco como el pulido se quedaban una máquina que no usan —en el armario de LKM, el pulido reservaba la soldadora TIG y se la bloqueaba a la OT que sí la necesitaba—. Ahora la soldadura con TIG y la soldadura con MIG toman cada una su máquina, que no se sustituyen entre sí, y el trabajo que no se hace en una máquina determinada se planifica sin reservar ninguna y te lo dice.",
        href: "/operaciones",
    },
    {
        id: "avisos-dicen-la-causa-real",
        fecha: "2026-08-19",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos dicen los nombres completos y la causa real",
        detalle:
            "Ya no aparece «y 1 más»: cuando un aviso nombra gente, máquinas o rangos, los lista a todos, porque son justo los que hay que ir a tocar. Si un proceso lo puede hacer alguien pero lo tiene apagado en su ficha, el aviso ahora lo dice con nombre y apellido en vez de «ningún operario disponible lo tiene» —y el primer arreglo que ofrece es volver a encenderlo, que es un click—. Cuando un aviso pide un rango, aclara que alcanza con uno de la lista y no con todos. Y si el mismo nombre de proceso aparece dos veces en el catálogo, te avisa por qué se repite el aviso.",
        href: "/operaciones",
    },
    {
        id: "resolver-desde-el-aviso",
        fecha: "2026-08-18",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos ahora se resuelven con un botón, sin salir de la vista previa",
        detalle:
            "Cuando un aviso se arregla cargando un rango, al lado de la solución hay un botón «Aplicar y recalcular»: lo tocás, se guarda el cambio y el plan se vuelve a calcular solo, con las fechas actualizadas. El aviso desaparece únicamente si de verdad se resolvió. El botón aparece solo cuando el cambio es uno y claro (un proceso o una máquina); si hay varias máquinas en juego te manda a Recursos para que elijas vos. Y cada opción dice a cuánta gente le abre la máquina antes de que la toques.",
        href: "/operaciones",
    },
    {
        id: "maquinas-en-cola-y-fechas-visibles",
        fecha: "2026-08-18",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Si la máquina está ocupada, ahora hace cola en vez de quedarse sin máquina",
        detalle:
            "Cuando había más trabajo que máquinas, el sistema dejaba procesos «Sin asignar» en la columna Maquinaria en lugar de correr la fecha. Ahora hace lo lógico: espera su turno en la máquina y la fecha se corre al día siguiente. Además, arriba de la vista previa ves el período real del plan (de cuándo a cuándo y cuántos días), cada OT tiene una columna «Trabajo» que dice cuándo arranca y cuándo termina, y si algo no entró aparece un botón para ampliar el rango dos semanas y recalcular. Los avisos ahora resaltan en negrita la máquina, el rango o la persona que hay que tocar, y cuentan hasta qué fecha llega el trabajo.",
        href: "/operaciones",
    },
    {
        id: "buscador-varias-ots-y-avisos-claros",
        fecha: "2026-08-16",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Podés buscar varias OTs juntas y los avisos se leen mejor",
        detalle:
            "En el buscador de Planificar Órdenes ahora podés pegar varias OTs juntas — «13345 13343» o «#13345, #13343» — y aparecen todas; el # y los espacios ya no molestan, y también busca por N° de pedido. Las OTs que tildás suben primeras en la lista. Y los avisos de la vista previa se rediseñaron: letra más grande, cada uno dice si es traba o aviso, podés abrir varios a la vez, y solo aparece en rojo lo que de verdad quedó sin resolver. Si un proceso sale sin máquina porque el rango de la máquina no coincide con el del proceso, ahora hay un aviso que te dice exactamente qué cargar y dónde.",
        href: "/operaciones",
    },
    {
        id: "auditoria",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Auditoría",
        titulo: "Nueva sección Auditoría: queda registro de cada planificación",
        detalle:
            "En el menú de la izquierda hay una sección nueva. Cada vez que alguien calcula una vista previa o confirma un plan queda registrado: qué OTs, cuánto tardó, cuántos procesos salieron y — si falló — el error exacto. También se ven los borrados. Antes un intento que fallaba no dejaba rastro y no había forma de saber qué pasó.",
        href: "/auditoria",
    },
    {
        id: "planificador-mas-rapido-y-avisos-cortos",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El cálculo ya no se muere y los avisos son cortos",
        detalle:
            "Hoy un cálculo se murió a mitad de camino porque el servidor se quedó sin memoria, y otro tardó un minuto entero. Se le dio más memoria y se ajustó el cálculo a la máquina real. Además: los avisos de la vista previa ahora son una línea por problema (tocás para ver el detalle y cómo se arregla), los avisos repetidos se unieron en uno, y si un cálculo falla te lo dice con el motivo en vez de quedarse en «Calculando planificación...» para siempre. Los toasts de «sin stock» y «sin procesos» ahora nombran la OT por el número que ves en la lista.",
        href: "/operaciones",
    },
    {
        id: "rangos-desde-maquina-y-proceso",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Recursos",
        titulo: "Ahora ves y arreglás los rangos desde la máquina y desde el proceso",
        detalle:
            "En Maquinarias, la columna Rangos te dice quién puede usar cada una y las que no tienen ninguna salen marcadas: tocás el aviso y las cargás ahí mismo, sin ir a Rangos. En Procesos hay una columna “Quién puede hacerlo” con la misma idea, y avisa los dos casos que después frenan un plan: el que no tiene rango (se lo lleva cualquiera) y el que tiene rangos que no tiene ningún operario (no lo hace nadie). El botón “Ver los que frenan un plan” filtra solo los que están en OTs abiertas, para no perderte entre los cientos del catálogo viejo.",
        href: "/recursos",
    },
    {
        id: "fechas-dentro-del-turno",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Las fechas del plan ya no se pasan del horario del taller",
        detalle:
            "El plan calculaba días de 555 minutos y mostraba trabajos terminando 17:30 o 18:00, cuando el turno cierra 16:00. Ahora usa la jornada real (07:00 a 16:00 con desayuno y almuerzo), así que las fechas que ves —y las que le prometés al cliente— son las que se pueden cumplir. Como consecuencia el mismo trabajo ocupa más días que antes: no es que haya más trabajo, es que antes la cuenta estaba mal.",
        href: "/operaciones",
    },
    {
        id: "horarios-por-operario",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El plan respeta el horario de cada uno y no planifica sábados",
        detalle:
            "El horario que cargás en la ficha del operario ahora se usa: a quien entra 09:00 no se le pone trabajo a las 07:00. Y como hoy nadie tiene el sábado marcado como día de trabajo, el plan dejó de usarlo — antes contaba 5 horas por persona por semana que en realidad no existen.",
        href: "/operaciones",
    },
    {
        id: "tercerizados-marcados",
        fecha: "2026-08-15",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los trabajos tercerizados se ven como tercerizados",
        detalle:
            "Aparecían en rojo como “sin operario asignado”, igual que un proceso al que le falta cargar un rango. Ahora llevan la etiqueta Tercerizado: siguen en el plan porque ocupan lugar en la secuencia de la OT y hay que esperarlos, pero no los hace nadie del taller y no hay nada que corregir.",
        href: "/operaciones",
    },
    {
        id: "vacantes-fuera-del-plan",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Los puestos “VACANTE — A CUBRIR” dejaron de recibir trabajo",
        detalle:
            "El plan les cargaba horas como si fueran personas, así que ese trabajo figuraba hecho y en realidad no lo hacía nadie. Ahora quedan fuera del plan y, cuando un proceso solo lo podía hacer un puesto vacante, el aviso te dice qué rango hace falta cubrir. Los puestos siguen en Recursos, marcados como no disponibles.",
        href: "/recursos",
    },
    {
        id: "feriados-no-se-pierden",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Disponibilidad",
        titulo: "Los feriados que cargás ya no se borran solos",
        detalle:
            "Los días no laborables se guardaban en un archivo del servidor y se perdían cada vez que se actualizaba el sistema: cargabas un feriado, andaba un rato, y después el día volvía a aparecer como laborable. Ahora se guardan como el resto de los datos. Los que ya tenías cargados se pasaron solos.",
        href: "/operaciones",
    },
    {
        id: "por-que-no-entra",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "La vista previa te dice qué traba el plan y cómo se arregla",
        detalle:
            "Arriba de la vista previa aparece un panel con lo que está frenando la planificación: un proceso que no puede hacer nadie porque nadie tiene el rango, una máquina sola para más trabajo del que entra, o trabajo asignado a un puesto vacante. Cada aviso dice a cuántas OTs y cuántas horas afecta, y abajo las formas de resolverlo con la pantalla donde se hace. Antes esto salía como “sin asignar” o “sin máquina” y no había forma de saber por qué.",
        href: "/operaciones",
    },
    {
        id: "planificacion-vuelve-a-guardar",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Confirmar una planificación vuelve a guardarla",
        detalle:
            "Al confirmar, la planificación fallaba con un error que hablaba de intentar con menos órdenes, y no era el volumen: no se guardaba ninguna, ni siquiera con una sola OT. Ya se guarda normal. Y cuando borrás una planificación queda registrado qué se borró y cuándo.",
        href: "/operaciones",
    },
    {
        id: "procesos-largos-entran",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Los procesos de muchas horas ya entran en el plan",
        detalle:
            "Un proceso que duraba más que un tramo de trabajo no entraba en ninguna parte y se llevaba puesto todo lo que venía después en esa OT: la OT aparecía casi entera como 'sin lugar' aunque hubiera gente libre. Ahora se reparte en varios tramos, siempre con la misma persona y la misma máquina, y la OT entra completa.",
        href: "/operaciones",
    },
    {
        id: "plan-con-maquina",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El plan ahora dice en qué máquina va cada trabajo",
        detalle:
            "Los procesos de producción salían siempre 'sin máquina', y como nadie tenía máquina asignada, dos OTs podían quedar agendadas en el mismo torno a la misma hora. Ahora cada trabajo sale con su máquina y no se pisan entre sí.",
        href: "/operaciones",
    },
    {
        id: "plano-sin-archivo",
        fecha: "2026-08-15",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "La columna Plano distingue la OT que no tiene el archivo cargado",
        detalle:
            "Antes decía Sí en casi todas porque venía marcado del sistema viejo. Ahora dice Sí solo si el plano está cargado de verdad, y 'Sin archivo' cuando figura con plano pero no hay nada adjunto. Importa porque solo el plano real limita el trabajo a quienes saben leer planos: con la marca vieja quedaban afuera del plan los pasantes y los ayudantes.",
        href: "/operaciones",
    },
    {
        id: "reparto-por-rango",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Embalado y pintura dejan de caer en los oficiales",
        detalle:
            "Las tareas que admiten ayudante o ingresante se le podían asignar a cualquiera, así que terminaban en oficiales. Ahora cada tarea va solo a quien tiene el rango que la habilita. También se arregló que la preparación de una máquina quedara pegada al proceso siguiente aunque no tuvieran nada que ver: la preparación de la soldadora se la llevaba el tornero.",
        href: "/operaciones",
    },
    {
        id: "recursos-maquinas-sin-rango",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Recursos",
        titulo: "Se ve qué máquinas no tienen rango y qué rangos no tienen máquina",
        detalle:
            "En Maquinarias hay una columna Rangos y un aviso arriba con las máquinas que no tienen ninguno: esas el planificador no se las asigna a nadie. En Rangos, al lado de cada nombre dice cuántas máquinas habilita, y avisa si no habilita ninguna o si no lo tiene ningún operario.",
        href: "/recursos",
    },
    {
        id: "operario-no-disponible",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Recursos",
        titulo: "Marcar a alguien como no disponible ahora saca su trabajo del plan",
        detalle:
            "El estado estaba en el perfil pero el planificador lo ignoraba y le seguía cargando tareas. Sirve para vacaciones y licencias, y también para los puestos 'VACANTE — A CUBRIR', que no son personas y hasta ahora recibían trabajo.",
        href: "/recursos",
    },
    {
        id: "ot-planificadas-filtros",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Filtros a la vista en Órdenes de Trabajo Planificadas",
        detalle:
            "Arriba de la lista tenés filtros por estado (pendientes, en producción, terminadas, pendientes de entrega), por prioridad, por entrega, y combos de cliente y operario. Antes solo había un buscador y para encontrar algo tenías que scrollear. Además cada OT se puede contraer, así entran muchas más en pantalla.",
        href: "/operaciones",
    },
    {
        id: "planificadas-completadas",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Las OTs ya entregadas se mueven solas a la pestaña Completadas",
        detalle:
            "En Planificadas quedaban OTs que decían 'Entrega completa' y ensuciaban la lista de lo que falta hacer. Ahora se van a la pestaña Completadas, al lado de Diaria, y siguen estando ahí para consultarlas.",
        href: "/operaciones",
    },
    {
        id: "quitar-ot-planificacion",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Ya podés sacar una OT de la planificación sin borrar todo el lote",
        detalle:
            "Si planificaste una OT por error, tildala en la lista y tocá el tachito de arriba a la derecha: sale de la planificación y vuelve a estar disponible para planificar. El resto del lote no se toca. Sin nada tildado, el tachito sigue eliminando la planificación entera como antes.",
        href: "/operaciones",
    },
    {
        id: "orden-todas-las-columnas",
        fecha: "2026-08-14",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Se puede ordenar por cualquier columna de la lista de planificadas",
        detalle:
            "Antes solo ordenaban algunas. Ahora también N° Pedido, Material, Proceso, Plano, Entrega, Aprobado x y Pedido x. Cada columna arranca para el lado que sirve: las cantidades (Cant., Prioridad, Proceso, OT) de mayor a menor, y Material, Plano y Entrega mostrando primero lo que falta. Proceso ordena por cantidad de procesos de la OT y abajo del 'Sí' te dice cuántos están terminados sobre el total.",
        href: "/operaciones",
    },
    {
        id: "novedades-seccion",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Novedades",
        titulo: "Hay una sección de Novedades en el menú",
        detalle:
            "Cada vez que se sube algo que se nota, queda anotado acá con la fecha, de lo más nuevo a lo más viejo.",
        href: "/novedades",
    },
    {
        id: "rangos-quien-lo-tiene",
        fecha: "2026-08-13",
        tipo: "mejora",
        seccion: "Configuración › Rangos",
        titulo: "Cada rango muestra quiénes lo tienen y la fila entera es clickeable",
        detalle:
            "Las filas son más compactas y se ve de una qué operarios están en cada rango, sin tener que abrir uno por uno.",
        href: "/configuracion",
    },
    {
        id: "rangos-editar-procesos",
        fecha: "2026-08-13",
        tipo: "nuevo",
        seccion: "Configuración › Rangos",
        titulo: "Se pueden editar los procesos y las máquinas que habilita cada rango",
        detalle:
            "Además, ya se puede borrar un rango que tenga procesos asignados: antes tiraba error y no dejaba.",
        href: "/configuracion",
    },
];

/** Ordenadas de lo más nuevo a lo más viejo. */
export const novedadesOrdenadas = (items: Novedad[] = NOVEDADES) =>
    [...items].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

/** Fecha ISO -> "14 de agosto de 2026". */
export const formatFechaNovedad = (fecha: string) => {
    const [y, m, d] = fecha.split("-").map(Number);
    return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
        .format(new Date(y, (m || 1) - 1, d || 1));
};

export const TIPO_META: Record<NovedadTipo, { label: string; cls: string; dot: string }> = {
    nuevo: { label: "Nuevo", cls: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
    mejora: { label: "Mejora", cls: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    arreglo: { label: "Arreglo", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
};
