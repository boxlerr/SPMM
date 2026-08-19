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
