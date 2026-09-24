/**
 * «Estado y control» de la OT (RF-11): las ocho casillas de la ficha del sistema viejo.
 *
 * Julián, 23/09, con la foto de la ficha vieja: «tiene que estar, hacelo, ponelo en las
 * órdenes de trabajo; si no está alguna opción creala en la db y en la orden». Van en el
 * MISMO orden que allá, que es como las busca el taller:
 *
 *   PROGRAMADA · EN PROCESO · FINALIZADO TOTAL · FINALIZADO PARCIAL (Cant.)
 *   CONTROLADO · FINALIZADO PARA PINTAR · FINALIZADO TERCERIZACIÓN FINAL ·
 *   FINALIZADO TERCERIZACIÓN INTERMEDIA
 *
 * Las cuatro primeras ya existían en la base; las otras cuatro y el «Cant.» del parcial
 * los agregó la migración del 23/09 (backend/scripts/migrations/2026-09-23_estados_de_control_ot.sql).
 *
 * Todo lo de acá está escrito para que el front nuevo contra el backend que está hoy en
 * producción (3422285, que no conoce las casillas nuevas) se vea como hoy: si la OT no
 * trae el campo, las listas no muestran nada de más y la ficha avisa en chico.
 */

import type { ColumnaExport } from "@/lib/exportar";

/** Las casillas que agregó RF-11 (las que el backend viejo no conoce). */
export const CASILLAS_NUEVAS = [
    "controlado",
    "finalizado_para_pintar",
    "finalizado_tercerizacion_final",
    "finalizado_tercerizacion_intermedia",
] as const;
export type CasillaNueva = (typeof CASILLAS_NUEVAS)[number];

export type CasillaDeEstado =
    | "programada"
    | "en_proceso"
    | "finalizadototal"
    | "finalizadoparcial"
    | CasillaNueva;

/**
 * Las ocho, en el orden de la ficha vieja. `ayuda` va en el title de la casilla y sólo
 * la tienen las que HACEN algo en SPMM además de quedar marcadas: qué significa cada
 * etapa lo sabe el taller, y acá no se inventa.
 */
export const CASILLAS_DE_ESTADO: { clave: CasillaDeEstado; rotulo: string; ayuda?: string }[] = [
    { clave: "programada", rotulo: "Programada" },
    { clave: "en_proceso", rotulo: "En proceso" },
    {
        clave: "finalizadototal",
        rotulo: "Finalizado total",
        ayuda: "La OT sale de las listas de pendientes y pasa al Historial.",
    },
    {
        clave: "finalizadoparcial",
        rotulo: "Finalizado parcial",
        ayuda: "En «Cant.» va cuántas unidades se terminaron. No es lo entregado: eso va en «Cant Entregada».",
    },
    {
        clave: "controlado",
        rotulo: "Controlado",
        ayuda: "Al guardar queda registrado quién la marcó y cuándo (y en Auditoría).",
    },
    { clave: "finalizado_para_pintar", rotulo: "Finalizado para pintar" },
    { clave: "finalizado_tercerizacion_final", rotulo: "Finalizado tercerización final" },
    { clave: "finalizado_tercerizacion_intermedia", rotulo: "Finalizado tercerización intermedia" },
];

/** 1 / true = marcada. Todo lo demás (0, null, ausente) = no. */
export const marcada = (v: unknown): boolean => v === 1 || v === true || v === "1";

/** ¿El backend que contestó sabe de las casillas nuevas? El de 3422285 no las manda. */
export const conoceEstadosDeControl = (o: object | null | undefined): boolean =>
    !!o && "controlado" in o;

/** Lo que tiene cada fila de una lista, venga de /ordenes o de /ordenes-resumen. */
export interface ConEstadoDeControl {
    controlado?: number | boolean | null;
    controlado_por?: string | null;
    controlado_en?: string | null;
    finalizado_para_pintar?: number | boolean | null;
    finalizado_tercerizacion_final?: number | boolean | null;
    finalizado_tercerizacion_intermedia?: number | boolean | null;
    finalizadoparcial?: number | boolean | null;
    cantidad_finalizada_parcial?: number | null;
}

/** Los chips cortos de una fila: sólo las etapas de control y terminación que tiene. */
export const ETAPAS: { clave: CasillaNueva; corto: string; filtro: FiltroControl }[] = [
    { clave: "controlado", corto: "Controlada", filtro: "controlada" },
    { clave: "finalizado_para_pintar", corto: "Para pintar", filtro: "para_pintar" },
    { clave: "finalizado_tercerizacion_intermedia", corto: "Terc. intermedia", filtro: "terc_intermedia" },
    { clave: "finalizado_tercerizacion_final", corto: "Terc. final", filtro: "terc_final" },
];

export const etapasDe = (o: ConEstadoDeControl) => ETAPAS.filter((e) => marcada(o[e.clave]));

// ---------------------------------------------------------------------------------
// Filtro de las listas
// ---------------------------------------------------------------------------------

export type FiltroControl =
    | "ALL"
    | "controlada"
    | "sin_controlar"
    | "para_pintar"
    | "terc_intermedia"
    | "terc_final";

export const ROTULO_FILTRO_CONTROL: Record<FiltroControl, string> = {
    ALL: "Todas",
    controlada: "Controladas",
    sin_controlar: "Sin controlar",
    para_pintar: "Finalizado para pintar",
    terc_intermedia: "Finalizado terc. intermedia",
    terc_final: "Finalizado terc. final",
};

export const OPCIONES_FILTRO_CONTROL = Object.keys(ROTULO_FILTRO_CONTROL) as FiltroControl[];

/** ¿La OT pasa el filtro? Con el backend viejo (sin el campo) sólo pasa «Todas»: mejor
 *  una lista vacía que diga por qué que una lista que mienta. */
export function cumpleFiltroControl(o: ConEstadoDeControl, filtro: FiltroControl): boolean {
    switch (filtro) {
        case "ALL": return true;
        case "controlada": return marcada(o.controlado);
        case "sin_controlar": return conoceEstadosDeControl(o) && !marcada(o.controlado);
        case "para_pintar": return marcada(o.finalizado_para_pintar);
        case "terc_intermedia": return marcada(o.finalizado_tercerizacion_intermedia);
        case "terc_final": return marcada(o.finalizado_tercerizacion_final);
    }
}

// ---------------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------------

/** Sí / No, o vacío si el backend no mandó el campo (no se sabe, no es «No»). */
const siNo = (o: object, clave: string) =>
    conoceEstadosDeControl(o) ? marcada((o as any)[clave]) : null;

/**
 * Lo de «Estado y control» de una fila en una sola celda, para el PDF de las listas:
 *
 *   Parcial: 3 · Controlada · Terc. final
 *   por Lucas Longchamps, 23/09/2026 14:05
 *
 * Las etapas con las mismas palabras que los chips de la pantalla. Vacío si no tiene
 * nada marcado o si el backend no mandó los campos (no se sabe, no es «nada»).
 */
export function estadoYControlEnUnaCelda(o: ConEstadoDeControl): string {
    if (!conoceEstadosDeControl(o)) return "";
    const partes: string[] = [];
    // La cantidad sale siempre que esté cargada, aunque la casilla no esté marcada: es un
    // dato guardado aparte y esconderlo en el archivo lo perdía. Sin la casilla, dice que
    // es la cantidad y no que la OT está en parcial.
    const cant = o.cantidad_finalizada_parcial;
    if (cant !== null && cant !== undefined)
        partes.push(marcada(o.finalizadoparcial) ? `Parcial: ${cant}` : `Cant. parcial: ${cant}`);
    partes.push(...etapasDe(o).map((e) => e.corto));
    const renglones = partes.length ? [partes.join(" · ")] : [];
    if (marcada(o.controlado)) {
        const quien = [o.controlado_por?.trim(), cuandoLegible(o.controlado_en)].filter(Boolean).join(", ");
        if (quien) renglones.push(`por ${quien}`);
    }
    return renglones.join("\n");
}

/**
 * Las columnas de «Estado y control» para el Exportar de las listas de OT. Van al final
 * de cada archivo para no correr las columnas que ya usaba alguien en su planilla.
 *
 * En Excel y CSV, una columna por dato (se filtran y se suman). En el PDF, UNA sola
 * columna con todo junto: las listas ya llegan a 17 columnas en una A4 apaisada, y con
 * siete más el PDF partía el N° de OT («1519 / 8»), los clientes y los títulos a mitad
 * de palabra (verificación del 24/09).
 */
export function columnasEstadoYControl<T extends object>(): ColumnaExport<T>[] {
    const planilla: ColumnaExport<T>["formatos"] = ["xlsx", "csv"];
    return [
        {
            titulo: "Fin. parcial (cant.)",
            tipo: "entero",
            formatos: planilla,
            // Siempre que esté cargada, con la casilla marcada o no (ver estadoYControlEnUnaCelda).
            valor: (o: any) => o.cantidad_finalizada_parcial ?? null,
        },
        { titulo: "Controlado", tipo: "booleano", formatos: planilla, valor: (o) => siNo(o, "controlado") },
        { titulo: "Controlado por", formatos: planilla, valor: (o: any) => (marcada(o.controlado) ? o.controlado_por ?? "" : "") },
        { titulo: "Controlado el", tipo: "fechaHora", formatos: planilla, valor: (o: any) => (marcada(o.controlado) ? o.controlado_en ?? null : null) },
        { titulo: "Fin. para pintar", tipo: "booleano", formatos: planilla, valor: (o) => siNo(o, "finalizado_para_pintar") },
        { titulo: "Fin. terc. final", tipo: "booleano", formatos: planilla, valor: (o) => siNo(o, "finalizado_tercerizacion_final") },
        { titulo: "Fin. terc. intermedia", tipo: "booleano", formatos: planilla, valor: (o) => siNo(o, "finalizado_tercerizacion_intermedia") },
        { titulo: "Estado y control", formatos: ["pdf"], valor: (o) => estadoYControlEnUnaCelda(o as ConEstadoDeControl) },
    ];
}

/** «Programada, Finalizado parcial (3), Controlado» — para la ficha exportada. */
export function resumenEstadoYControl(v: Partial<Record<CasillaDeEstado, unknown>> & { cantidad_finalizada_parcial?: unknown }): string {
    const cant = v.cantidad_finalizada_parcial;
    const hayCant = cant !== null && cant !== undefined && cant !== "";
    const partes = CASILLAS_DE_ESTADO.filter((c) => marcada(v[c.clave]))
        .map((c) => (c.clave === "finalizadoparcial" && hayCant ? `${c.rotulo} (${cant})` : c.rotulo));
    // Cargada sin la casilla: igual sale (es un dato guardado), dicho como cantidad.
    if (hayCant && !marcada(v.finalizadoparcial)) partes.push(`Cant. finalizada parcial: ${cant}`);
    return partes.join(", ");
}

/** «23/09/2026 14:05» de una fecha del backend (sin zona: se lee tal cual). */
export function cuandoLegible(iso?: string | null): string {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
    if (!m) return "";
    return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`;
}
