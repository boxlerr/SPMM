"use client";

/**
 * Los datos de la cañera y lo que se hace con ella: pedirla, ubicar una OT en un
 * casillero, moverla, liberarla y liberar de una vez las terminadas.
 *
 * POR QUÉ UN HOOK Y NO UN FETCH EN LA GRILLA
 *
 * La cañera se ve en dos lados a la vez: la solapa Cañera (grande) y arriba de
 * Pendientes (compacta), donde además cada línea muestra los casilleros de su OT y
 * tiene «Ubicar». Si la grilla compacta pidiera lo suyo y la fila lo suyo, ubicar la OT
 * desde una fila dejaba la grilla de arriba mintiendo hasta recargar. Con esto hay UNA
 * cañera por pantalla: la que dibuja la grilla es la misma de la que salen los chips de
 * las filas y los casilleros libres del «Ubicar».
 *
 * OPTIMISTA, CON LA MISMA MECÁNICA QUE LAS LÍNEAS
 *
 * Lo que se ve es la última cañera que mandó el servidor MÁS los cambios que todavía no
 * contestó (cada uno es una función que la transforma). Cuando contesta bien, su
 * respuesta pasa a ser la base y el cambio se saca de la lista; cuando contesta mal, se
 * saca y listo: la pantalla vuelve sola a como estaba, sin fotos que restaurar ni
 * carreras entre dos cambios seguidos. Los pedidos van en fila (uno por vez) porque
 * cada respuesta es la cañera ENTERA: si dos se cruzaran, la vieja pisaría a la nueva.
 *
 * El 409 («E4 tiene la OT 15692», «No existe la OT 158010 en SPMM») pregunta con el
 * diálogo de la pantalla y, si la persona dice que sí, repite con `?forzar=true`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import {
    COLUMNAS_CANERA,
    FILAS_CANERA,
    ahoraISO,
    mpDelete,
    mpGet,
    mpPost,
    mpPut,
    normalizarCelda,
    numeroDeOcupacion,
    partirCelda,
    usuarioActual,
    type AsignarCeldaIn,
    type Canera,
    type EstadoMaterial,
    type LiberarTerminadas,
    type MoverCeldaIn,
    type MpRespuesta,
    type Ocupacion,
} from "@/lib/materiaPrima";
import type { Confirmar } from "./PendientesForzar";

/** Lo que se sabe de la OT al ubicarla desde una fila: para que el casillero se pinte bien ya, antes de la respuesta. */
export interface DatosDeOT {
    id_orden_trabajo?: number | null;
    cliente?: string | null;
    articulo?: string | null;
    estado_material?: EstadoMaterial | null;
}

export interface EstadoCanera {
    /** La cañera como se ve: la del servidor más los cambios que todavía no contestó. */
    canera: Canera | null;
    cargando: boolean;
    error: string | null;
    sinServidor: boolean;
    /** Hay algún cambio esperando respuesta. */
    guardando: boolean;
    recargar: () => Promise<void>;
    /** Ubicar una OT (el número que ve la gente) en un casillero. `true` si quedó. */
    asignar: (celda: string, numero: number | string, datos?: DatosDeOT) => Promise<boolean>;
    mover: (id: number, celda: string) => Promise<boolean>;
    liberar: (id: number) => Promise<boolean>;
    /** Libera todos los casilleros de OT terminadas. Devuelve cuántos, o null si falló. */
    liberarTerminadas: () => Promise<number | null>;
}

type Cambio = { n: number; aplicar: (c: Canera) => Canera };

/**
 * Las cañeras montadas a la vez (Pendientes y la solapa Cañera quedan montadas las dos
 * al cambiar de solapa) se avisan entre sí cada vez que el servidor manda una nueva:
 * ubicar una OT desde Pendientes y abrir la solapa Cañera tiene que mostrarla ahí, sin
 * «Actualizar».
 */
const oyentes = new Set<(c: Canera, origen: number) => void>();
let ultimaInstancia = 0;
const avisarOtras = (c: Canera, origen: number) => oyentes.forEach((f) => f(c, origen));

/** Lo que manda el servidor, con los arreglos siempre presentes (un backend a medio hacer no rompe la grilla). */
function normalizarCanera(c: Partial<Canera> | null | undefined): Canera {
    return {
        columnas: c?.columnas?.length ? c.columnas : [...COLUMNAS_CANERA],
        filas: c?.filas?.length ? c.filas : [...FILAS_CANERA],
        ocupaciones: Array.isArray(c?.ocupaciones) ? c!.ocupaciones : [],
    };
}

/**
 * `useCanera({ confirmar })`. `activo: false` no pide nada (la grilla que recibe los
 * datos de afuera igual llama al hook: los hooks no pueden ser condicionales).
 */
export function useCanera({ activo = true, confirmar }: { activo?: boolean; confirmar: Confirmar }): EstadoCanera {
    const [base, setBase] = useState<Canera | null>(null);
    const [cambios, setCambios] = useState<Cambio[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);

    const ultimaCarga = useRef(0);
    const contador = useRef(0);
    const idTemporal = useRef(0);
    const fila = useRef<Promise<unknown>>(Promise.resolve());
    const confirmarRef = useRef(confirmar);
    useEffect(() => {
        confirmarRef.current = confirmar;
    }, [confirmar]);
    const baseRef = useRef<Canera | null>(null);
    baseRef.current = base;
    const [yo] = useState(() => ++ultimaInstancia);

    useEffect(() => {
        if (!activo) return;
        const oir = (c: Canera, origen: number) => {
            if (origen !== yo) setBase(c);
        };
        oyentes.add(oir);
        return () => {
            oyentes.delete(oir);
        };
    }, [activo, yo]);

    const recargar = useCallback(async () => {
        const n = ++ultimaCarga.current;
        setCargando(true);
        const r = await mpGet<Canera>(`${API_URL}/materia-prima/canera`);
        if (n !== ultimaCarga.current) return;
        setCargando(false);
        setSinServidor(r.sinServidor);
        if (!r.ok || !r.data) {
            setError(r.error ?? "No se pudo traer la cañera.");
            return;
        }
        setError(null);
        const nueva = normalizarCanera(r.data);
        setBase(nueva);
        avisarOtras(nueva, yo);
    }, [yo]);

    useEffect(() => {
        if (activo) void recargar();
    }, [activo, recargar]);

    const canera = useMemo(
        () => (base ? cambios.reduce((c, cambio) => cambio.aplicar(c), base) : null),
        [base, cambios],
    );

    const quitar = (n: number) => setCambios((cs) => cs.filter((c) => c.n !== n));

    /**
     * Un cambio: se ve ya (`aplicar`), se manda en fila (`pedir`), y la respuesta —la
     * cañera entera— pasa a ser la base. 409 → pregunta; «no» → se deshace sin avisar
     * (lo decidió la persona); error → se deshace y avisa.
     */
    const operar = useCallback(
        async <T,>(o: {
            aplicar: (c: Canera) => Canera;
            pedir: (forzar: boolean) => Promise<MpRespuesta<T>>;
            canera: (d: T) => Canera | null | undefined;
            aviso: string;
            error: string;
        }): Promise<T | null> => {
            if (!baseRef.current) {
                toast.error("La cañera todavía no cargó. Probá de nuevo en un momento.");
                return null;
            }
            const n = ++contador.current;
            setCambios((cs) => [...cs, { n, aplicar: o.aplicar }]);
            const correr = async (): Promise<T | null> => {
                let r = await o.pedir(false);
                if (r.requiereConfirmacion) {
                    const si = await confirmarRef.current({ titulo: o.aviso, motivo: r.error ?? "" });
                    if (!si) {
                        quitar(n);
                        return null;
                    }
                    r = await o.pedir(true);
                }
                if (r.ok && r.data) {
                    const nueva = o.canera(r.data);
                    if (nueva) {
                        const c = normalizarCanera(nueva);
                        setBase(c);
                        avisarOtras(c, yo);
                    }
                    quitar(n);
                    return r.data;
                }
                quitar(n);
                // Modo práctica: lo optimista ya volvió atrás y el cartelito lo explica.
                if (!r.practica) toast.error(r.error ?? o.error);
                return null;
            };
            const p = fila.current.then(correr, correr);
            fila.current = p.catch(() => null);
            return p;
        },
        [yo],
    );

    const asignar = useCallback(
        async (celda: string, numero: number | string, datos?: DatosDeOT) => {
            const c = normalizarCelda(celda);
            const partes = partirCelda(c);
            if (!c || !partes) {
                toast.error(`«${celda}» no es un casillero: va una letra de la A a la O y un número del 1 al 9 (por ejemplo E4).`);
                return false;
            }
            const texto = String(numero).trim();
            if (!texto) {
                toast.error("Falta el número de OT.");
                return false;
            }
            // El número va como número si lo es: así lo busca el backend entre las OT de
            // SPMM. Si no (un número del viejo con letras), va el texto y el backend avisa.
            const num: number | string = /^\d+$/.test(texto) ? Number(texto) : texto;
            const temporal: Ocupacion = {
                id: --idTemporal.current,
                celda: c,
                columna: partes.columna,
                fila: partes.fila,
                id_orden_trabajo: datos?.id_orden_trabajo ?? null,
                numero_ot: typeof num === "number" ? num : null,
                ot_texto: typeof num === "string" ? num : null,
                cliente: datos?.cliente ?? null,
                articulo: datos?.articulo ?? null,
                estado_material: datos?.estado_material ?? null,
                finalizada: false,
                desde: ahoraISO(),
                asignado_por: usuarioActual(),
            };
            const cuerpo: AsignarCeldaIn = { celda: c, numero_ot: num };
            const r = await operar<Canera>({
                aplicar: (cn) => ({ ...cn, ocupaciones: [...cn.ocupaciones, temporal] }),
                pedir: (forzar) => mpPost<Canera>(`${API_URL}/materia-prima/canera`, cuerpo, { forzar }),
                canera: (d) => d,
                aviso: `Ubicar la OT ${texto} en ${c}`,
                error: `No se pudo ubicar la OT ${texto} en ${c}.`,
            });
            return r !== null;
        },
        [operar],
    );

    const mover = useCallback(
        async (id: number, celda: string) => {
            const c = normalizarCelda(celda);
            const partes = partirCelda(c);
            if (!c || !partes) {
                toast.error(`«${celda}» no es un casillero de la cañera.`);
                return false;
            }
            if (id < 0) {
                toast.error("Esperá un momento: todavía se está guardando ese casillero.");
                return false;
            }
            const actual = baseRef.current?.ocupaciones.find((o) => o.id === id);
            const r = await operar<Canera>({
                aplicar: (cn) => ({
                    ...cn,
                    ocupaciones: cn.ocupaciones.map((o) =>
                        o.id === id ? { ...o, celda: c, columna: partes.columna, fila: partes.fila } : o,
                    ),
                }),
                pedir: (forzar) => {
                    const cuerpo: MoverCeldaIn = { celda: c };
                    return mpPut<Canera>(`${API_URL}/materia-prima/canera/${id}/mover`, cuerpo, { forzar });
                },
                canera: (d) => d,
                aviso: `Mover ${actual ? `la OT ${numeroDeOcupacion(actual)} ` : ""}a ${c}`,
                error: `No se pudo mover a ${c}.`,
            });
            return r !== null;
        },
        [operar],
    );

    const liberar = useCallback(
        async (id: number) => {
            if (id < 0) {
                toast.error("Esperá un momento: todavía se está guardando ese casillero.");
                return false;
            }
            const actual = baseRef.current?.ocupaciones.find((o) => o.id === id);
            const r = await operar<Canera>({
                aplicar: (cn) => ({ ...cn, ocupaciones: cn.ocupaciones.filter((o) => o.id !== id) }),
                pedir: () => mpDelete<Canera>(`${API_URL}/materia-prima/canera/${id}`),
                canera: (d) => d,
                aviso: `Liberar ${actual?.celda ?? "el casillero"}`,
                error: `No se pudo liberar ${actual?.celda ?? "el casillero"}.`,
            });
            return r !== null;
        },
        [operar],
    );

    const liberarTerminadas = useCallback(async () => {
        const r = await operar<LiberarTerminadas>({
            aplicar: (cn) => ({ ...cn, ocupaciones: cn.ocupaciones.filter((o) => !o.finalizada) }),
            pedir: () => mpPost<LiberarTerminadas>(`${API_URL}/materia-prima/canera/liberar-terminadas`),
            canera: (d) => d.canera,
            aviso: "Liberar los casilleros de las OT terminadas",
            error: "No se pudieron liberar los casilleros de las OT terminadas.",
        });
        return r ? (r.liberadas ?? 0) : null;
    }, [operar]);

    // Memorizado: es el valor del contexto de Pendientes, y un objeto nuevo en cada
    // dibujo redibujaría los chips de todas las filas con cada letra del buscador.
    const guardando = cambios.length > 0;
    return useMemo(
        () => ({ canera, cargando, error, sinServidor, guardando, recargar, asignar, mover, liberar, liberarTerminadas }),
        [canera, cargando, error, sinServidor, guardando, recargar, asignar, mover, liberar, liberarTerminadas],
    );
}

// ═══════════════════════════ lo que se deriva ═══════════════════════════

/** «E4» → las ocupaciones vigentes de ese casillero (en el viejo, a veces más de una). */
export function ocupacionesPorCelda(c: Canera | null): Map<string, Ocupacion[]> {
    const m = new Map<string, Ocupacion[]>();
    for (const o of c?.ocupaciones ?? []) {
        const celda = normalizarCelda(o.celda) ?? `${o.columna}${o.fila}`;
        const lista = m.get(celda);
        if (lista) lista.push(o);
        else m.set(celda, [o]);
    }
    return m;
}

/** id de OT → sus casilleros, ordenados («E4», «E5»). Sólo las OT de SPMM. */
export function celdasPorOT(c: Canera | null): Map<number, string[]> {
    const m = new Map<number, string[]>();
    for (const o of c?.ocupaciones ?? []) {
        if (o.id_orden_trabajo === null || o.id_orden_trabajo === undefined) continue;
        const lista = m.get(o.id_orden_trabajo);
        if (lista) {
            if (!lista.includes(o.celda)) lista.push(o.celda);
        } else {
            m.set(o.id_orden_trabajo, [o.celda]);
        }
    }
    for (const lista of m.values()) lista.sort(compararCeldas);
    return m;
}

/** A1, A2 … A9, B1: columna y después fila (no «A10» antes que «A2», que acá no hay, pero por las dudas). */
export function compararCeldas(a: string, b: string): number {
    return a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a.localeCompare(b);
}

/**
 * De qué color va un casillero. Es la leyenda de la grilla:
 *
 *  · libre      → blanco.
 *  · lista      → verde: todo el material de la OT está disponible.
 *  · falta      → ámbar: a la OT le falta material (pedido, reservado, sin pedir o sin cargar).
 *  · terminada  → gris rayado: la OT ya se terminó, el casillero se puede liberar.
 *  · externa    → pizarra: el número no es una OT de SPMM (se anotó como texto).
 *
 * Con varias OT en el mismo casillero manda la que pide algo: si una espera material,
 * ámbar; si todas terminaron, rayado.
 */
export type TonoCelda = "libre" | "lista" | "falta" | "terminada" | "externa";

export function tonoDe(ocupaciones: Ocupacion[] | undefined): TonoCelda {
    if (!ocupaciones?.length) return "libre";
    const vivas = ocupaciones.filter((o) => !o.finalizada);
    if (!vivas.length) return "terminada";
    const deSPMM = vivas.filter((o) => o.id_orden_trabajo !== null && o.id_orden_trabajo !== undefined);
    if (!deSPMM.length) return "externa";
    const lista = (o: Ocupacion) => o.estado_material === "ok" || o.estado_material === "no_lleva";
    return deSPMM.every(lista) ? "lista" : "falta";
}

export const TONOS: Record<TonoCelda, { rotulo: string; celda: string; muestra: string }> = {
    libre: {
        rotulo: "Libre",
        celda: "bg-white border-gray-200 text-gray-300 hover:border-gray-300 hover:bg-gray-50",
        muestra: "bg-white border-gray-300",
    },
    lista: {
        rotulo: "Material listo",
        celda: "bg-green-100 border-green-300 text-green-900 hover:bg-green-200",
        muestra: "bg-green-100 border-green-300",
    },
    falta: {
        rotulo: "Falta material",
        celda: "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200",
        muestra: "bg-amber-100 border-amber-300",
    },
    terminada: {
        rotulo: "OT terminada (liberar)",
        // Rayado: se lee «esto ya no va» sin gritar, y en una fotocopia se distingue del blanco.
        celda:
            "border-gray-300 text-gray-500 hover:border-gray-400 " +
            "bg-[repeating-linear-gradient(135deg,#f3f4f6_0px,#f3f4f6_5px,#e5e7eb_5px,#e5e7eb_10px)]",
        muestra:
            "border-gray-300 bg-[repeating-linear-gradient(135deg,#f3f4f6_0px,#f3f4f6_3px,#d1d5db_3px,#d1d5db_6px)]",
    },
    externa: {
        rotulo: "No es una OT de SPMM",
        celda: "bg-slate-100 border-dashed border-slate-400 text-slate-700 hover:bg-slate-200",
        muestra: "bg-slate-100 border-dashed border-slate-400",
    },
};

// ═══════════════════════════ contexto (Pendientes) ═══════════════════════════

/**
 * La cañera de la pantalla, para las filas de Pendientes: sus chips y el «Ubicar» leen
 * de acá. Contexto y no una prop, para que un cambio en la cañera redibuje sólo esas
 * celdas y no las cientos de filas memorizadas.
 */
export interface ContextoCanera {
    estado: EstadoCanera;
    celdasPorOT: Map<number, string[]>;
}

export const CaneraContexto = createContext<ContextoCanera | null>(null);

export const useCaneraDePantalla = () => useContext(CaneraContexto);
