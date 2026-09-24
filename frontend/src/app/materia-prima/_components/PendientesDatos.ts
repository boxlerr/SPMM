"use client";

/**
 * Los datos de Pendientes y el guardado automático de cada cambio.
 *
 * QUÉ SE PIDE
 *
 * El «universo» (qué OT) lo decide el servidor: la semana, «Todas las OT abiertas» o una
 * OT sola. Se pide SIEMPRE con `filtro=todas` y los radios (Pendientes / Parciales /
 * Todas), el buscador y el proveedor se aplican acá. Así:
 *  · cambiar de radio o escribir en el buscador es instantáneo (no vuelve a pedir);
 *  · las tarjetas de arriba se pueden contar acá, con las mismas reglas que el backend
 *    (sobre el universo, antes del radio), y siguen cada tilde sin recargar;
 *  · y, sobre todo, una línea que se marca «Disponible» con el radio en «Pendientes» NO
 *    desaparece debajo del cursor: la lista que se ve se arma cuando cambia un filtro o
 *    llegan datos nuevos, no cuando se guarda un cambio (ver PendientesTab).
 *
 * CÓMO SE GUARDA (sin botón Grabar)
 *
 * Cada cambio se ve al instante y se manda solo. Lo que se muestra de una línea es la
 * última versión que confirmó el servidor MÁS los cambios que todavía no contestó
 * (`parches`). Si el servidor contesta bien, su línea pasa a ser la base y el parche se
 * saca; si contesta mal, el parche se saca y la línea vuelve sola a como estaba, con un
 * aviso. No hay fotos que restaurar, y dos tildes seguidas en la misma línea no se
 * pisan: los pedidos de UNA línea van en fila (el segundo sale cuando contestó el
 * primero), los de líneas distintas en paralelo.
 *
 * El 409 («avisar, no bloquear») pregunta con el diálogo de la pantalla mientras el
 * cambio sigue a la vista; «Hacerlo igual» repite con `?forzar=true` y «Cancelar» lo
 * deshace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import {
    ahoraISO,
    consulta as armarConsulta,
    hoyISO,
    mpGet,
    mpPut,
    usuarioActual,
    type CambiosDeLote,
    type CambiosLinea,
    type CambiosLoteIn,
    type FechaISO,
    type Linea,
    type LineaPendiente,
    type Pendientes,
} from "@/lib/materiaPrima";
import type { Confirmar } from "./PendientesForzar";

export interface ConsultaPendientes {
    /** El lunes de la semana que se mira. */
    semana: FechaISO;
    todasAbiertas: boolean;
    /** Una OT sola (el número que ve la gente): manda sobre la semana. */
    ot: number | null;
}

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Lo que falta conseguir de una línea.
 *
 * ESPEJO de la regla del backend (`falta` de Pendientes): 0 si está disponible o
 * pedida; si no, la cantidad menos lo reservado. Existe sólo porque el guardado de una
 * línea devuelve la línea sin `falta` (es un dato de Pendientes, no de la línea): sin
 * esto, la columna quedaba vieja hasta recargar la semana. Cada vez que se carga la
 * semana, vale la que manda el backend.
 */
export function faltaDe(l: Pick<Linea, "disponible" | "pedido" | "reserva" | "cantidad" | "cantidad_reservada">): number {
    if (l.disponible || l.pedido) return 0;
    const cubierto = l.reserva ? (l.cantidad_reservada ?? 0) : 0;
    return Math.max(0, redondear3((l.cantidad ?? 0) - cubierto));
}

/**
 * Cómo se ve una línea apenas se toca, antes de que conteste el backend. Estampa quién y
 * cuándo con el usuario del token (el backend estampa el suyo, que es el que queda) y
 * copia las consecuencias que la persona espera ver ya: «Disponible» pone la fecha de
 * entrega de hoy si no tenía, sacar la reserva borra lo reservado.
 */
export function aplicarCambios(l: LineaPendiente, c: CambiosLinea): LineaPendiente {
    const n: LineaPendiente = { ...l, ...c } as LineaPendiente;
    const yo = usuarioActual();
    const ahora = ahoraISO();
    if (c.pedido !== undefined && c.pedido !== l.pedido) {
        n.pedido_en = c.pedido ? ahora : null;
        n.pedido_por = c.pedido ? yo : null;
    }
    if (c.disponible !== undefined && c.disponible !== l.disponible) {
        n.disponible_en = c.disponible ? ahora : null;
        n.disponible_por = c.disponible ? yo : null;
        if (c.disponible && !l.fecha_entrega && c.fecha_entrega === undefined) n.fecha_entrega = hoyISO();
    }
    if (c.reserva === false) n.cantidad_reservada = null;
    if (c.reserva === true && (c.cantidad_reservada === undefined || c.cantidad_reservada === null)) {
        // Lo mismo que hace el backend si no se le dice cuánto: lo que haya libre, hasta la cantidad.
        const libre = Math.max(0, l.stock_libre ?? 0);
        n.cantidad_reservada = Math.min(l.cantidad, libre) || l.cantidad_reservada;
    }
    if (c.usado === false && l.reserva) {
        n.reserva = false;
        n.cantidad_reservada = null;
    }
    n.falta = faltaDe(n);
    return n;
}

type Parche = { n: number; cambios: CambiosLinea };

/** Cómo terminó el último guardado, para el indicador de la barra. */
export type EstadoGuardado = "guardando" | "guardado" | "error" | null;

export function usePendientes(q: ConsultaPendientes, confirmar: Confirmar) {
    const [datos, setDatos] = useState<Pendientes | null>(null);
    /** Cuántas veces llegaron datos nuevos del servidor: cuándo se vuelve a armar la lista que se ve. */
    const [carga, setCarga] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [parches, setParches] = useState<Record<number, Parche[]>>({});
    const [enVuelo, setEnVuelo] = useState(0);
    const [ultimo, setUltimo] = useState<"ok" | "error" | null>(null);

    const ultimaCarga = useRef(0);
    const controlador = useRef<AbortController | null>(null);
    const contador = useRef(0);
    const colas = useRef(new Map<number, Promise<unknown>>());
    const confirmarRef = useRef(confirmar);
    useEffect(() => {
        confirmarRef.current = confirmar;
    }, [confirmar]);
    const datosRef = useRef<Pendientes | null>(null);
    datosRef.current = datos;

    const cargar = useCallback(async () => {
        const n = ++ultimaCarga.current;
        controlador.current?.abort();
        const c = new AbortController();
        controlador.current = c;
        setCargando(true);
        const r = await mpGet<Pendientes>(
            `${API_URL}/materia-prima/pendientes?${armarConsulta({
                semana: q.ot || q.todasAbiertas ? null : q.semana,
                todas_abiertas: q.todasAbiertas && !q.ot ? true : null,
                ot: q.ot,
                filtro: "todas",
            })}`,
            { signal: c.signal },
        );
        if (n !== ultimaCarga.current || r.abortado) return;
        setCargando(false);
        setSinServidor(r.sinServidor);
        if (!r.ok || !r.data) {
            setError(r.error ?? "No se pudieron traer los pendientes.");
            if (r.sinServidor) setDatos(null);
            return;
        }
        setError(null);
        const d = r.data;
        setDatos({
            semana: d.semana ?? null,
            resumen: d.resumen ?? { ot_count: 0, lineas_a_pedir: 0, lineas_esperando: 0, lineas_listas: 0 },
            ots: Array.isArray(d.ots) ? d.ots : [],
            lineas: Array.isArray(d.lineas) ? d.lineas.map((l) => ({ ...l, celdas: l.celdas ?? [], cortes: l.cortes ?? [] })) : [],
        });
        setCarga((k) => k + 1);
    }, [q.semana, q.todasAbiertas, q.ot]);

    useEffect(() => {
        void cargar();
    }, [cargar]);
    useEffect(() => () => controlador.current?.abort(), []);

    /** Lo que se ve: la base del servidor con los cambios que todavía no contestó. */
    const lineas = useMemo<LineaPendiente[]>(() => {
        if (!datos) return [];
        return datos.lineas.map((l) => {
            const ps = parches[l.id];
            return ps?.length ? ps.reduce((acc, p) => aplicarCambios(acc, p.cambios), l) : l;
        });
    }, [datos, parches]);

    /** Lo que confirmó el servidor pasa a ser la base. De paso, el stock libre de la pieza en las otras líneas. */
    const aplicarRespuesta = useCallback((resp: Linea[]) => {
        if (!resp.length) return;
        const porId = new Map(resp.map((l) => [l.id, l]));
        const libres = new Map(resp.map((l) => [l.id_pieza, l.stock_libre]));
        setDatos((d) => {
            if (!d) return d;
            return {
                ...d,
                lineas: d.lineas.map((l) => {
                    const r = porId.get(l.id);
                    if (r) {
                        // La línea que vuelve no trae lo de su OT (número, fechas, casilleros): eso queda.
                        const n: LineaPendiente = { ...l, ...r, cortes: r.cortes ?? l.cortes } as LineaPendiente;
                        n.falta = faltaDe(n);
                        return n;
                    }
                    const libre = libres.get(l.id_pieza);
                    return libre !== undefined && libre !== null && libre !== l.stock_libre ? { ...l, stock_libre: libre } : l;
                }),
            };
        });
    }, []);

    /** Encola una tarea detrás de lo que esté pendiente en esas líneas. */
    const encolar = useCallback((ids: number[], tarea: () => Promise<unknown>) => {
        const previas = ids.map((id) => colas.current.get(id)).filter(Boolean) as Promise<unknown>[];
        const p = Promise.all(previas).then(tarea, tarea).catch(() => null);
        ids.forEach((id) => colas.current.set(id, p));
        void p.finally(() =>
            ids.forEach((id) => {
                if (colas.current.get(id) === p) colas.current.delete(id);
            }),
        );
        return p;
    }, []);

    const ponerParche = (ids: number[], n: number, cambios: CambiosLinea) =>
        setParches((p) => {
            const nuevo = { ...p };
            for (const id of ids) nuevo[id] = [...(p[id] ?? []), { n, cambios }];
            return nuevo;
        });
    const sacarParche = (ids: number[], n: number) =>
        setParches((p) => {
            const nuevo = { ...p };
            for (const id of ids) {
                const resto = (p[id] ?? []).filter((x) => x.n !== n);
                if (resto.length) nuevo[id] = resto;
                else delete nuevo[id];
            }
            return nuevo;
        });

    /** «ABR117 · OT 15692», para los avisos. */
    const nombreDe = (id: number) => {
        const l = datosRef.current?.lineas.find((x) => x.id === id);
        return l ? `${l.codigo}${l.numero_ot ? ` · OT ${l.numero_ot}` : ""}` : "la línea";
    };

    /**
     * Guardar un cambio de UNA línea. No devuelve nada que haya que esperar: lo que se
     * ve ya cambió, y si falla vuelve solo.
     */
    const guardar = useCallback(
        (id: number, cambios: CambiosLinea) => {
            const n = ++contador.current;
            ponerParche([id], n, cambios);
            void encolar([id], async () => {
                setEnVuelo((v) => v + 1);
                try {
                    const url = `${API_URL}/materia-prima/lineas/${id}`;
                    let r = await mpPut<Linea>(url, cambios);
                    if (r.requiereConfirmacion) {
                        const si = await confirmarRef.current({ titulo: `Antes de guardar ${nombreDe(id)}`, motivo: r.error ?? "" });
                        if (!si) {
                            sacarParche([id], n);
                            return;
                        }
                        r = await mpPut<Linea>(url, cambios, { forzar: true });
                    }
                    if (r.ok && r.data) {
                        aplicarRespuesta([r.data]);
                        sacarParche([id], n);
                        setUltimo("ok");
                        return;
                    }
                    sacarParche([id], n);
                    setUltimo("error");
                    toast.error(`No se guardó ${nombreDe(id)}: ${r.error ?? "el servidor no contestó."}`);
                } finally {
                    setEnVuelo((v) => v - 1);
                }
            });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- ponerParche/sacarParche/nombreDe sólo usan setters y refs
        [encolar, aplicarRespuesta],
    );

    /**
     * El mismo cambio a varias líneas (la barra de acciones): todas o ninguna, como el
     * backend. Devuelve si quedó, para que la barra suelte la selección.
     */
    const guardarLote = useCallback(
        async (ids: number[], cambios: CambiosDeLote, que: string): Promise<boolean> => {
            if (!ids.length) return false;
            const n = ++contador.current;
            ponerParche(ids, n, cambios);
            const resultado = await encolar(ids, async () => {
                setEnVuelo((v) => v + 1);
                try {
                    const url = `${API_URL}/materia-prima/lineas/lote`;
                    const cuerpo: CambiosLoteIn = { ids, cambios };
                    let r = await mpPut<Linea[]>(url, cuerpo);
                    if (r.requiereConfirmacion) {
                        const si = await confirmarRef.current({
                            titulo: `${que} (${ids.length} línea${ids.length === 1 ? "" : "s"})`,
                            motivo: r.error ?? "",
                        });
                        if (!si) {
                            sacarParche(ids, n);
                            return false;
                        }
                        r = await mpPut<Linea[]>(url, cuerpo, { forzar: true });
                    }
                    if (r.ok && Array.isArray(r.data)) {
                        aplicarRespuesta(r.data);
                        sacarParche(ids, n);
                        setUltimo("ok");
                        return true;
                    }
                    sacarParche(ids, n);
                    setUltimo("error");
                    toast.error(`${que}: no se guardó ninguna. ${r.error ?? "El servidor no contestó."}`);
                    return false;
                } finally {
                    setEnVuelo((v) => v - 1);
                }
            });
            return resultado === true;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- ver `guardar`
        [encolar, aplicarRespuesta],
    );

    // Cerrar la pestaña con cambios en viaje: que el navegador pregunte. Se pierde
    // poco (un pedido), pero Maxi marca de a muchas y no se va a enterar de cuál.
    useEffect(() => {
        if (enVuelo <= 0) return;
        const avisar = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", avisar);
        return () => window.removeEventListener("beforeunload", avisar);
    }, [enVuelo]);

    const estadoGuardado: EstadoGuardado = enVuelo > 0 ? "guardando" : ultimo === "ok" ? "guardado" : ultimo === "error" ? "error" : null;

    return {
        datos,
        lineas,
        carga,
        cargando,
        error,
        sinServidor,
        recargar: cargar,
        guardar,
        guardarLote,
        estadoGuardado,
        /** Para que el «Guardado» se apague solo al rato. */
        olvidarGuardado: useCallback(() => setUltimo(null), []),
    };
}
