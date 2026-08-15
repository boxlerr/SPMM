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
