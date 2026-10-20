/**
 * El aviso que sale al entrar y la fecha en castellano que usa. SEPARADO de la lista de
 * novedades (lib/novedades.ts) a propósito.
 *
 * Esto lo importan el cartel (components/AvisoAlEntrar.tsx), el megáfono del menú
 * (components/BotonAviso.tsx) y el estado que comparten (hooks/useAvisoAlEntrar.ts), que
 * viven en el layout. Lo que importa el layout viaja en el JavaScript de TODAS las
 * pantallas. Hasta el 20/10/2026 el aviso estaba dentro de lib/novedades.ts y, como el
 * empaquetador no separa una constante de las demás del mismo archivo, cada pantalla se
 * bajaba también la lista entera de novedades (130 KB, unos 41 KB comprimidos: el 18% de
 * lo que baja cualquier pantalla) para mostrar sólo este cartel. La lista completa la
 * importa nada más que la página de Novedades.
 *
 * Regla: este archivo no importa nada de lib/novedades.ts (sería volver a lo de antes).
 */

/** Fecha ISO -> "14 de agosto de 2026". */
export const formatFechaNovedad = (fecha: string) => {
    const [y, m, d] = fecha.split("-").map(Number);
    return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
        .format(new Date(y, (m || 1) - 1, d || 1));
};

/* ────────────────────────────────────────────────────────────────────────────
 * EL AVISO QUE SALE AL ENTRAR
 *
 * Un cartel que se abre solo la primera vez que alguien entra después de un
 * cambio grande, y no vuelve a salir solo. Desde el 25/09/2026 se lo puede volver a
 * abrir con el megáfono de abajo del menú, que lleva un puntito mientras no se leyó
 * (components/BotonAviso.tsx). Nace de la semana del 11 al 15/09/2026:
 * el taller frenó el uso del sistema porque los procesos se le veían
 * desordenados, y avisar eso por WhatsApp no alcanza — el que abre el sistema
 * un lunes a la mañana no leyó el grupo.
 *
 * Para cambiarlo: se edita el texto de acá y SE CAMBIA EL `id`. El id es lo que
 * decide si a alguien ya se le mostró y si ya lo leyó (se guarda en el navegador),
 * así que cambiar el texto sin cambiar el id no se lo muestra a nadie que ya lo
 * cerró ni le prende el puntito del megáfono.
 *
 * Para apagarlo: `export const AVISO_AL_ENTRAR = null;`
 * ──────────────────────────────────────────────────────────────────────────── */

export type AvisoBloque = {
    /** Título del bloque. */
    titulo: string;
    /** Una línea por cosa. Sin nombres internos, igual que las novedades. */
    puntos: string[];
    /** Aclaración al pie del bloque, cuando hace falta explicar el porqué. */
    nota?: string;
};

export type AvisoAlEntrar = {
    /** Cambiarlo hace que el cartel vuelva a salirle a todos. */
    id: string;
    fecha: string;
    titulo: string;
    bajada: string;
    bloques: AvisoBloque[];
    /** Texto del botón que cierra. */
    cerrar: string;
};

export const AVISO_AL_ENTRAR: AvisoAlEntrar | null = {
    // 24/09: sale la pantalla Materia prima en plena prueba piloto (semana del 28/09, SPMM
    // en paralelo con el Sistema Integral). El cartel dice lo contrario de lo que se
    // había escrito para cuando SPMM sea el dueño («ahora se cargan acá»): durante la
    // prueba se cargan ALLÁ, y si el que carga órdenes todo el día creyera otra cosa,
    // cargaría dos veces. Cuando SPMM pase a ser el dueño, va un cartel nuevo (con otro
    // `id`, así vuelve a salir) que diga que desde ese día se cargan acá.
    id: "2026-09-24-materia-prima-piloto",
    fecha: "2026-09-24",
    titulo: "Materias primas: se ven acá, se siguen cargando en el Sistema Integral",
    // Decía «Esto sale una sola vez»: desde el 25/09 también se abre a pedido, desde el
    // megáfono, y ahí esa frase no se entendía. Cambiar el texto sin cambiar el `id` no
    // se lo vuelve a mostrar a nadie (ver arriba), que es lo que se quiere.
    bajada:
        "Si lo cerrás, lo volvés a abrir con el megáfono de abajo del menú de la izquierda. Y todo queda en Novedades.",
    bloques: [
        {
            titulo: "Durante la prueba piloto",
            puntos: [
                "**Las materias primas se siguen cargando en el Sistema Integral**, como siempre: lo que lleva cada orden y lo que se pide.",
                "**Acá se ven con sus marcas reales** (pedido, reservado, disponible, en producción) **y se actualizan solas cada 10 minutos.** Podés recorrer la carga completa (modo práctica), pero acá no se guarda nada, para que nada se cargue dos veces.",
                "**Hay una pantalla nueva, «Materia prima»**, en el menú de la izquierda, debajo de Operaciones. Y en cada orden, la solapa Materias Primas muestra lo mismo.",
            ],
        },
        {
            titulo: "La pantalla Materia prima",
            puntos: [
                "**Pendientes:** lo que falta comprar para las órdenes de la semana, con el proveedor y la fecha que prometió.",
                "**Insumos:** el catálogo, con los mismos códigos del Sistema Integral. Cada insumo tiene su stock, sus recortes, en qué órdenes se usó y sus precios.",
                "**Cañera:** en qué estante quedó el material cortado de cada orden.",
            ],
            nota:
                "Cuando termine la prueba, las materias primas se van a cargar acá y el Sistema Integral va a quedar para facturas y remitos. Ese día se avisa.",
        },
    ],
    cerrar: "Entendido",
};
