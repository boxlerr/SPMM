/**
 * El estado del material de una OT, definido UNA sola vez.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * La misma decisión —qué dice la columna Material— estaba escrita en cinco lugares
 * (las tres listas de órdenes, la vista previa del plan y la tarjeta de celular), y
 * los cinco terminaban en el mismo `else` rojo que decía «Sin Stock». Cuando algo se
 * escribe cinco veces, tarde o temprano una copia opina distinto; acá pasó algo peor,
 * que fue que las cinco opinaban mal lo mismo.
 *
 * LAS DOS «NADAS»
 *
 * El backend devuelve cuatro estados, no tres:
 *
 *   ok        → todas las piezas están disponibles.
 *   pedido    → falta alguna, pero está encargada al proveedor.
 *   sin_stock → falta alguna y NO está pedida. Esto sí es un problema de material.
 *   sin_datos → la orden no tiene NINGUNA pieza cargada.
 *
 * `sin_datos` no significa que falte material: significa que nadie cargó la lista.
 * Son cosas opuestas —una hay que salir a comprarla, la otra hay que ir a cargarla— y
 * hasta hoy se pintaban iguales, en rojo, con la palabra «Sin Stock».
 *
 * Y hay una quinta, que no viene del backend sino de una casilla de la OT:
 *
 *   no_lleva  → el taller marcó que esta orden NO necesita material.
 *
 * Sin ella, «no lleva» y «nadie la cargó» se ven iguales —las dos sin piezas— y son
 * otra vez opuestas: una hay que saltearla y la otra hay que ir a cargarla. Gana
 * sobre todo lo demás: si la orden no lleva material, qué dicen las piezas da igual.
 *
 * Es exactamente el mismo error que ya se había corregido con los planos, donde
 * `tiene_plano = 0` tapaba dos casos distintos y hubo que separar «no lleva» de
 * «falta». Ahí la conclusión fue la misma: dos nadas distintas no se dibujan igual.
 *
 * POR QUÉ IMPORTA MÁS DE LO QUE PARECE
 *
 * De las 175 OT abiertas, 17 están en `sin_datos` y NINGUNA en `sin_stock`. O sea que
 * todo el rojo de esa columna venía de datos que nadie cargó. Y no se podían cargar
 * desde SPMM: el 11/09 se decidió que el sistema viejo sigue siendo el dueño de las
 * materias primas y que el sync las sigue trayendo, así que la solapa de la OT es de
 * sólo lectura. Era un rojo del que no se podía salir desde acá.
 *
 * Lo único de materias primas que sí es nuestro es la casilla «no lleva»: metadato de
 * SPMM sobre la orden, que el sync no mira ni pisa.
 */

export type EstadoMaterial = "ok" | "pedido" | "sin_stock" | "sin_datos" | "no_lleva";

export type MaterialResumen = {
    clave: EstadoMaterial;
    /** Lo que se lee en la columna. Corto, entra en una celda. */
    rotulo: string;
    /** La frase entera, para el title al pasar el mouse. */
    titulo: string;
    /** Clases del chip. */
    clases: string;
    /** Qué ícono le toca; el componente del chip lo traduce. */
    icono: "ok" | "reloj" | "alerta" | "interrogante" | "nada";
    /**
     * ¿Falta material DE VERDAD? Sólo `sin_stock`.
     *
     * Es lo único que puede frenar una planificación. `sin_datos` no cuenta: no saber
     * no es lo mismo que no tener, y planificar una orden de la que no cargamos el
     * material no rompe nada — en el peor de los casos el material aparece después.
     */
    faltaMaterial: boolean;
};

/** Normaliza lo que viene del backend. Ausente = nadie cargó nada.
 *
 *  `noLleva` es la casilla de la orden y gana sobre el estado de las piezas: una orden
 *  marcada como que no lleva material no tiene piezas justamente por eso, y mostrarla
 *  como «sin cargar» mandaría a alguien a buscar algo que no existe. */
export const claveMaterial = (estado?: string | null, noLleva?: boolean | number | null): EstadoMaterial => {
    if (noLleva === true || noLleva === 1) return "no_lleva";
    if (estado === "ok" || estado === "pedido" || estado === "sin_stock") return estado;
    return "sin_datos";
};

const RESUMENES: Record<EstadoMaterial, Omit<MaterialResumen, "clave">> = {
    no_lleva: {
        rotulo: "No lleva",
        titulo: "Esta orden no necesita materia prima. Lo marcó el taller, no es que falte cargarla.",
        clases: "bg-slate-100 text-slate-600 hover:bg-slate-200 border-slate-200",
        icono: "nada",
        faltaMaterial: false,
    },
    ok: {
        rotulo: "OK",
        titulo: "El material está disponible para producción.",
        clases: "bg-green-50 text-green-700 hover:bg-green-100 border-green-200",
        icono: "ok",
        faltaMaterial: false,
    },
    pedido: {
        rotulo: "Pedido",
        titulo: "Falta material, pero ya está pedido al proveedor.",
        clases: "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200",
        icono: "reloj",
        faltaMaterial: false,
    },
    sin_stock: {
        rotulo: "Sin stock",
        titulo: "Falta material y no está pedido al proveedor. Hay que encargarlo.",
        clases: "bg-red-100 text-red-700 hover:bg-red-200 border-red-200",
        icono: "alerta",
        faltaMaterial: true,
    },
    sin_datos: {
        // Gris, no rojo: no hay nada que arreglar en el taller, hay algo que cargar.
        rotulo: "Sin cargar",
        titulo:
            "Esta orden no tiene cargada la lista de material. No quiere decir que falte: quiere decir que no se sabe.",
        clases: "bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200",
        icono: "interrogante",
        faltaMaterial: false,
    },
};

export const resumirMaterial = (
    estado?: string | null,
    noLleva?: boolean | number | null,
): MaterialResumen => {
    const clave = claveMaterial(estado, noLleva);
    return { clave, ...RESUMENES[clave] };
};

/**
 * Orden para la columna: primero lo que hay que salir a resolver.
 *
 * `sin_datos` va después de `sin_stock` y antes de `pedido`: es una tarea de
 * escritorio, no de compras, pero sigue siendo algo que falta.
 */
export const rankMaterial = (estado?: string | null, noLleva?: boolean | number | null): number => {
    switch (claveMaterial(estado, noLleva)) {
        case "sin_stock": return 0;
        case "sin_datos": return 1;
        case "pedido": return 2;
        case "ok": return 3;
        // Última: no hay nada que hacer con ella, ni comprar ni cargar.
        case "no_lleva": return 4;
    }
};
