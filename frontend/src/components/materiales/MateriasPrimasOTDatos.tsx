"use client";

/**
 * Los datos de la solapa «Materias primas» de la OT: pedirlas, guardar cada cambio solo
 * y, para una OT que todavía no existe, mandarlas cuando el alta devuelve el id.
 *
 * OPTIMISTA CON MARCHA ATRÁS (el patrón de Pendientes, ver PendientesDatos.ts)
 *
 * Lo que vino del servidor es la BASE. Cada cambio que se toca se guarda como un
 * «parche» encima de la base y se ve al instante; cuando el servidor contesta, la línea
 * que devolvió pasa a ser la base y el parche se va. Si contesta que no, el parche se va
 * igual y la fila vuelve sola a como estaba (más el aviso). Nunca se vuelve a pedir la
 * lista entera para mostrar un cambio: el foco y el scroll se quedan donde estaban.
 *
 * Los cambios de UNA línea van en fila (uno detrás del otro): tildar «Pedido» y enseguida
 * «Disponible» no puede llegar al revés al backend, que decide cosas según el orden
 * (disponible con reserva retira stock).
 *
 * El 409 («avisar, no bloquear») se pregunta EN MEDIO del guardado: la marca ya se ve,
 * aparece el motivo, y según la respuesta se repite con `?forzar=true` o se deshace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import {
    aLineaIn,
    ahoraISO,
    hoyISO,
    mpDelete,
    mpGet,
    mpPost,
    mpPut,
    usuarioActual,
    type CambiosLinea,
    type Corte,
    type CorteIn,
    type Linea,
    type LineaIn,
    type LineaLocal,
    type LineasDeOT,
    type NoLleva,
    type Origen,
    type TipoInsumo,
} from "@/lib/materiaPrima";
import type { Confirmar } from "@/app/materia-prima/_components/PendientesForzar";

// ═══════════════════════════ la fila que se dibuja ═══════════════════════════

/** Un corte como se dibuja: el de la base (con su texto del viejo) o uno recién escrito. */
export interface CorteVista {
    cantidad: number;
    largo_mm: number | null;
    ancho_mm: number | null;
    /** Lo que decía el viejo cuando no se pudo leer como medida («80x200x20mm»). */
    texto_original?: string | null;
}

/**
 * Una fila de la grilla, venga de donde venga: una línea guardada (OT existente) o una
 * línea local (OT nueva, todavía en memoria). La grilla es UNA sola para los dos modos:
 * lo que cambia es qué se puede tocar (una línea local no tiene marcas, consumo ni
 * stock que reservar: todo eso vive en la base).
 */
export interface FilaMP {
    /** La llave de React. */
    clave: string;
    /** El id de la línea. `null` = línea local (OT nueva); negativo = alta que el servidor todavía no confirmó. */
    id: number | null;
    id_pieza: number;
    codigo: string;
    descripcion: string;
    tipo_pieza: TipoInsumo | null;
    cantidad: number;
    unidad: string | null;
    id_proveedor: number | null;
    proveedor: string | null;
    observaciones: string | null;
    usado: boolean;
    pedido: boolean;
    reserva: boolean;
    cantidad_reservada: number | null;
    disponible: boolean;
    en_produccion: boolean;
    precio: number | null;
    consumido: number;
    cortes: CorteVista[];
    sugerido_m: number | null;
    /** Lo libre del insumo (lo no reservado por otra OT). Null en una línea local: no se sabe. */
    stock_libre: number | null;
    recortes_disponibles: number;
    origen: Origen | null;
    /** La línea tal como la mandó el servidor (quién y cuándo marcó cada cosa). */
    linea: Linea | null;
    local: boolean;
    /** Alta en viaje: se ve, pero no se toca hasta que el servidor le dé un id. */
    enVuelo: boolean;
    /** Se está borrando (o esperando el «Borrar igual»). */
    borrando: boolean;
}

export function filaDeLinea(l: Linea, borrando = false): FilaMP {
    return {
        clave: `l${l.id}`,
        id: l.id,
        id_pieza: l.id_pieza,
        codigo: l.codigo,
        descripcion: l.descripcion,
        tipo_pieza: l.tipo_pieza,
        cantidad: l.cantidad,
        unidad: l.unidad,
        id_proveedor: l.id_proveedor,
        proveedor: l.proveedor,
        observaciones: l.observaciones,
        usado: l.usado,
        pedido: l.pedido,
        reserva: l.reserva,
        cantidad_reservada: l.cantidad_reservada,
        disponible: l.disponible,
        en_produccion: l.en_produccion,
        precio: l.precio,
        consumido: l.consumido ?? 0,
        cortes: l.cortes ?? [],
        sugerido_m: l.sugerido_m,
        stock_libre: l.stock_libre,
        recortes_disponibles: l.recortes_disponibles ?? 0,
        origen: l.origen,
        linea: l,
        local: false,
        enVuelo: l.id < 0,
        borrando,
    };
}

export function filaDeLocal(l: LineaLocal): FilaMP {
    return {
        clave: l.clave,
        id: null,
        id_pieza: l.id_pieza,
        codigo: l.codigo,
        descripcion: l.descripcion_mostrada,
        tipo_pieza: l.tipo_pieza,
        cantidad: l.cantidad,
        unidad: l.unidad ?? null,
        id_proveedor: l.id_proveedor ?? null,
        proveedor: l.proveedor ?? null,
        observaciones: l.observaciones ?? null,
        // Una línea nueva nace utilizada y sin marcas (así la crea el backend).
        usado: true,
        pedido: false,
        reserva: false,
        cantidad_reservada: null,
        disponible: false,
        en_produccion: false,
        precio: l.precio,
        consumido: 0,
        cortes: (l.cortes ?? []).map((c) => ({ cantidad: c.cantidad, largo_mm: c.largo_mm ?? null, ancho_mm: c.ancho_mm ?? null })),
        sugerido_m: null,
        stock_libre: null,
        recortes_disponibles: 0,
        origen: l.origen ?? "spmm",
        linea: null,
        local: true,
        enVuelo: false,
        borrando: false,
    };
}

// ═══════════════════════════ cuentas que se muestran ═══════════════════════════

/**
 * Cuántos metros pedir para esos cortes: Σ cantidad × (largo + sierra) / 1000, hacia
 * arriba a 2 decimales. Null si falta el largo de alguno (una sugerencia corta es peor
 * que ninguna) o no hay cortes.
 *
 * ESPEJO de `reglas.sugerido_m` del backend, SÓLO PARA MOSTRAR mientras se escriben los
 * cortes (y en una OT nueva, que no tiene línea en la base que la calcule). La que vale
 * es la que devuelve el backend con la línea (`sugerido_m`), y el espesor de la sierra
 * sale de `catalogos` para no tenerlo escrito en dos lados. Se cuenta en décimas de
 * milímetro enteras (lo que guarda la base) para no heredar el 0,1 + 0,2 de la coma
 * flotante: el backend usa Decimal.
 */
export function sugerenciaMetros(cortes: { cantidad: number; largo_mm?: number | null }[], espesorSierraMm: number): number | null {
    if (!cortes.length) return null;
    let decimas = 0;
    for (const c of cortes) {
        if (c.largo_mm === null || c.largo_mm === undefined || !Number.isFinite(c.largo_mm)) return null;
        if (!Number.isFinite(c.cantidad) || c.cantidad <= 0) return null;
        decimas += Math.round(c.cantidad) * Math.round((c.largo_mm + espesorSierraMm) * 10);
    }
    // 0,01 m son 100 décimas de milímetro: centésimas de metro, hacia arriba.
    return Math.ceil(decimas / 100) / 100;
}

/** «2 × 1.093 mm», «1 × 1.220 × 2.440 mm» o lo que decía el viejo. */
export function textoCorte(c: CorteVista): string {
    const n = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
    if (c.largo_mm === null || c.largo_mm === undefined) return `${c.cantidad} × ${c.texto_original ?? "?"}`;
    return `${c.cantidad} × ${n(c.largo_mm)}${c.ancho_mm ? ` × ${n(c.ancho_mm)}` : ""} mm`;
}

// ═══════════════════════════ cómo se ve un cambio antes de que conteste ═══════════════════════════

/**
 * Lo que se le puede cambiar a una línea desde la solapa: lo del PUT, más los cortes (que
 * van por su ruta). `sugerido_m` NO se manda: es la sugerencia del espejo para que el
 * botón de cortes no muestre la vieja mientras contesta el servidor (que manda la suya).
 */
export type CambiosFila = CambiosLinea & { cortes?: CorteIn[]; sugerido_m?: number | null };

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;
let proximoTemporal = -1;
/** Ids de las altas que todavía no contestó el servidor: negativos para no chocar nunca con uno real. */
export const idTemporal = () => proximoTemporal--;

/**
 * Cómo se ve una línea apenas se toca. Estampa quién y cuándo con el usuario del token
 * (el backend estampa el suyo, que es el que queda) y copia las consecuencias que la
 * persona espera ver ya. Las mismas que aplica el backend (MateriaPrimaOTService._aplicar)
 * y que ya copia Pendientes (`aplicarCambios`), más la de la cantidad: si baja de lo
 * reservado, la reserva baja con ella.
 */
export function aplicarEnLinea(l: Linea, c: CambiosFila): Linea {
    const { cortes, descripcion, ...resto } = c;
    const n: Linea = { ...l, ...resto } as Linea;
    // Descripción vacía = «volver a la del insumo»: esa la sabe el backend. Mientras
    // contesta, queda la que había.
    if (descripcion !== undefined && descripcion !== null) n.descripcion = descripcion;
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
        const libre = Math.max(0, l.stock_libre ?? 0);
        n.cantidad_reservada = Math.min(l.cantidad, libre) || l.cantidad;
    }
    if (c.usado === false && l.reserva && !l.disponible) {
        n.reserva = false;
        n.cantidad_reservada = null;
    }
    if (c.cantidad !== undefined && n.reserva && !n.disponible && (n.cantidad_reservada ?? 0) > c.cantidad) {
        n.cantidad_reservada = c.cantidad;
    }
    if (cortes) {
        n.cortes = cortes.map((x, i): Corte => ({
            id: -(i + 1),
            cantidad: x.cantidad,
            largo_mm: x.largo_mm ?? null,
            ancho_mm: x.ancho_mm ?? null,
            texto_original: null,
        }));
    }
    return n;
}

/**
 * La línea que se dibuja mientras viaja el alta: con lo que se sabe del insumo elegido.
 * El servidor la reemplaza entera (con su id, su orden y su stock) al contestar.
 */
export function lineaTemporal(
    idOrden: number,
    entrada: LineaIn,
    delInsumo: { codigo: string; descripcion: string; tipo: TipoInsumo | null; precio: number | null; libre?: number | null; recortes?: number },
    orden: number,
): Linea {
    return {
        id: idTemporal(),
        id_orden_trabajo: idOrden,
        orden,
        id_pieza: entrada.id_pieza,
        codigo: delInsumo.codigo,
        descripcion: entrada.descripcion || delInsumo.descripcion,
        tipo_pieza: delInsumo.tipo,
        cantidad: entrada.cantidad,
        unidad: entrada.unidad ?? null,
        id_proveedor: entrada.id_proveedor ?? null,
        proveedor: entrada.proveedor ?? null,
        observaciones: entrada.observaciones ?? null,
        usado: true,
        pedido: false,
        pedido_en: null,
        pedido_por: null,
        reserva: false,
        cantidad_reservada: null,
        disponible: false,
        disponible_en: null,
        disponible_por: null,
        en_produccion: false,
        fecha_proveedor: null,
        fecha_entrega: null,
        precio: delInsumo.precio,
        consumido: 0,
        cortes: (entrada.cortes ?? []).map((c, i) => ({
            id: -(i + 1), cantidad: c.cantidad, largo_mm: c.largo_mm ?? null, ancho_mm: c.ancho_mm ?? null, texto_original: null,
        })),
        sugerido_m: null,
        stock_libre: delInsumo.libre ?? 0,
        recortes_disponibles: delInsumo.recortes ?? 0,
        origen: entrada.origen ?? "spmm",
        modificado_en: null,
        modificado_por: null,
    };
}

// ═══════════════════════════ OT existente: el hook ═══════════════════════════

type Parche = { n: number; cambios: CambiosFila };
export type EstadoGuardado = "guardando" | "guardado" | "error" | null;

export interface UsarLineasDeOT {
    datos: LineasDeOT | null;
    /** Base + cambios en viaje + altas en viaje, en el orden de la OT. */
    lineas: Linea[];
    borrando: ReadonlySet<number>;
    cargando: boolean;
    error: string | null;
    sinServidor: boolean;
    enVuelo: number;
    estadoGuardado: EstadoGuardado;
    /** Cuántas veces se TOCÓ algo (no cuenta las cargas): para saber si hubo cambios. */
    cambios: number;
    recargar: () => Promise<void>;
    guardar: (id: number, cambios: CambiosFila) => Promise<boolean>;
    agregar: (entradas: { entrada: LineaIn; temporal: Linea }[], que: string) => Promise<boolean>;
    borrar: (id: number) => Promise<boolean>;
    cambiarNoLleva: (valor: boolean) => Promise<boolean>;
}

export function useLineasDeOT({
    idOrden,
    activo,
    confirmar,
}: {
    idOrden: number | null;
    /** Con false no pide nada (la solapa no está a la vista, o no se tiene permiso de leer). */
    activo: boolean;
    confirmar: Confirmar;
}): UsarLineasDeOT {
    const [datos, setDatos] = useState<LineasDeOT | null>(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);
    const [parches, setParches] = useState<Record<number, Parche[]>>({});
    const [temporales, setTemporales] = useState<Linea[]>([]);
    const [borrando, setBorrando] = useState<ReadonlySet<number>>(new Set());
    const [enVuelo, setEnVuelo] = useState(0);
    const [ultimo, setUltimo] = useState<"ok" | "error" | null>(null);
    const [cambios, setCambios] = useState(0);

    const ultimaCarga = useRef(0);
    const controlador = useRef<AbortController | null>(null);
    const contador = useRef(0);
    const colas = useRef(new Map<number, Promise<unknown>>());
    const confirmarRef = useRef(confirmar);
    useEffect(() => {
        confirmarRef.current = confirmar;
    }, [confirmar]);
    const datosRef = useRef<LineasDeOT | null>(null);
    datosRef.current = datos;

    const cargar = useCallback(async () => {
        if (!idOrden) return;
        const n = ++ultimaCarga.current;
        controlador.current?.abort();
        const c = new AbortController();
        controlador.current = c;
        setCargando(true);
        const r = await mpGet<LineasDeOT>(`${API_URL}/materia-prima/ot/${idOrden}/lineas`, { signal: c.signal });
        if (n !== ultimaCarga.current || r.abortado) return;
        setCargando(false);
        setSinServidor(r.sinServidor);
        if (!r.ok || !r.data) {
            setError(r.error ?? "No se pudieron traer las materias primas de la OT.");
            return;
        }
        setError(null);
        const d = r.data;
        setDatos({
            ...d,
            celdas: d.celdas ?? [],
            lineas: Array.isArray(d.lineas) ? d.lineas.map((l) => ({ ...l, cortes: l.cortes ?? [] })) : [],
        });
    }, [idOrden]);

    // Otra OT (o la misma reabierta): nada de lo anterior vale.
    useEffect(() => {
        setDatos(null);
        setParches({});
        setTemporales([]);
        setBorrando(new Set());
        setError(null);
        setSinServidor(false);
        setUltimo(null);
        setCambios(0);
        if (activo && idOrden) void cargar();
        else controlador.current?.abort();
    }, [idOrden, activo, cargar]);
    useEffect(() => () => controlador.current?.abort(), []);

    const lineas = useMemo<Linea[]>(() => {
        const base = (datos?.lineas ?? []).map((l) => {
            const ps = parches[l.id];
            return ps?.length ? ps.reduce((acc, p) => aplicarEnLinea(acc, p.cambios), l) : l;
        });
        return temporales.length ? [...base, ...temporales] : base;
    }, [datos, parches, temporales]);

    /** Lo que confirmó el servidor pasa a ser la base; de paso, el stock libre de ese insumo en las otras líneas. */
    const aplicarRespuesta = useCallback((resp: Linea[]) => {
        if (!resp.length) return;
        const porId = new Map(resp.map((l) => [l.id, l]));
        const libres = new Map(resp.map((l) => [l.id_pieza, l.stock_libre]));
        setDatos((d) =>
            d
                ? {
                      ...d,
                      lineas: d.lineas.map((l) => {
                          const r = porId.get(l.id);
                          if (r) return { ...r, cortes: r.cortes ?? [] };
                          const libre = libres.get(l.id_pieza);
                          return libre !== undefined && libre !== null && libre !== l.stock_libre ? { ...l, stock_libre: libre } : l;
                      }),
                  }
                : d,
        );
    }, []);

    /** Encola una tarea detrás de lo que esté pendiente en esa línea. */
    const encolar = useCallback(<T,>(id: number, tarea: () => Promise<T>): Promise<T> => {
        const previa = colas.current.get(id);
        const p = (previa ? previa.then(tarea, tarea) : tarea()) as Promise<T>;
        const guardada = p.catch(() => null);
        colas.current.set(id, guardada);
        void guardada.finally(() => {
            if (colas.current.get(id) === guardada) colas.current.delete(id);
        });
        return p;
    }, []);

    const ponerParche = (id: number, n: number, c: CambiosFila) =>
        setParches((p) => ({ ...p, [id]: [...(p[id] ?? []), { n, cambios: c }] }));
    const sacarParche = (id: number, n: number) =>
        setParches((p) => {
            const resto = (p[id] ?? []).filter((x) => x.n !== n);
            const nuevo = { ...p };
            if (resto.length) nuevo[id] = resto;
            else delete nuevo[id];
            return nuevo;
        });

    const nombreDe = (id: number) => datosRef.current?.lineas.find((x) => x.id === id)?.codigo ?? "la línea";

    const guardar = useCallback(
        (id: number, c: CambiosFila): Promise<boolean> => {
            const n = ++contador.current;
            ponerParche(id, n, c);
            setCambios((k) => k + 1);
            return encolar(id, async () => {
                setEnVuelo((v) => v + 1);
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- sugerido_m es sólo para dibujar
                    const { cortes, sugerido_m, ...resto } = c;
                    // Los cortes van por su propia ruta (reemplaza todos); el resto, por el PUT
                    // de la línea. Si vinieran las dos cosas, primero los cortes.
                    if (cortes) {
                        const r = await mpPut<Linea>(`${API_URL}/materia-prima/lineas/${id}/cortes`, { cortes });
                        if (!r.ok || !r.data) {
                            sacarParche(id, n);
                            setUltimo("error");
                            toast.error(`No se guardaron los cortes de ${nombreDe(id)}`, { description: r.error ?? undefined });
                            return false;
                        }
                        aplicarRespuesta([r.data]);
                        if (!Object.keys(resto).length) {
                            sacarParche(id, n);
                            setUltimo("ok");
                            return true;
                        }
                    }
                    const url = `${API_URL}/materia-prima/lineas/${id}`;
                    let r = await mpPut<Linea>(url, resto);
                    if (r.requiereConfirmacion) {
                        const si = await confirmarRef.current({ titulo: `Antes de guardar ${nombreDe(id)}`, motivo: r.error ?? "" });
                        if (!si) {
                            sacarParche(id, n);
                            return false;
                        }
                        r = await mpPut<Linea>(url, resto, { forzar: true });
                    }
                    sacarParche(id, n);
                    if (r.ok && r.data) {
                        aplicarRespuesta([r.data]);
                        setUltimo("ok");
                        return true;
                    }
                    setUltimo("error");
                    toast.error(`No se guardó ${nombreDe(id)}`, { description: r.error ?? "El servidor no contestó." });
                    return false;
                } finally {
                    setEnVuelo((v) => v - 1);
                }
            });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- ponerParche/sacarParche/nombreDe sólo usan setters y refs
        [encolar, aplicarRespuesta],
    );

    const agregar = useCallback(
        async (entradas: { entrada: LineaIn; temporal: Linea }[], que: string): Promise<boolean> => {
            if (!idOrden || !entradas.length) return false;
            const tmp = entradas.map((e) => e.temporal);
            const idsTmp = new Set(tmp.map((t) => t.id));
            setTemporales((t) => [...t, ...tmp]);
            setCambios((k) => k + 1);
            setEnVuelo((v) => v + 1);
            const sacarTemporales = () => setTemporales((t) => t.filter((x) => !idsTmp.has(x.id)));
            try {
                const una = entradas.length === 1;
                const url = una
                    ? `${API_URL}/materia-prima/ot/${idOrden}/lineas`
                    : `${API_URL}/materia-prima/ot/${idOrden}/lineas/lote`;
                const cuerpo = una ? entradas[0].entrada : { lineas: entradas.map((e) => e.entrada) };
                let r = await mpPost<Linea | Linea[]>(url, cuerpo);
                if (r.requiereConfirmacion) {
                    const si = await confirmarRef.current({ titulo: `Antes de ${que}`, motivo: r.error ?? "", boton: "Cargar igual" });
                    if (!si) {
                        sacarTemporales();
                        return false;
                    }
                    r = await mpPost<Linea | Linea[]>(url, cuerpo, { forzar: true });
                }
                const nuevas = r.ok && r.data ? (Array.isArray(r.data) ? r.data : [r.data]) : null;
                if (!nuevas) {
                    sacarTemporales();
                    setUltimo("error");
                    toast.error(`No se pudo ${que}`, { description: r.error ?? "El servidor no contestó." });
                    return false;
                }
                // La base y las temporales cambian en el mismo render: la fila no parpadea.
                const libres = new Map(nuevas.map((l) => [l.id_pieza, l.stock_libre]));
                setDatos((d) =>
                    d
                        ? {
                              ...d,
                              lineas: [
                                  ...d.lineas.map((l) => {
                                      const libre = libres.get(l.id_pieza);
                                      return libre !== undefined && libre !== null ? { ...l, stock_libre: libre } : l;
                                  }),
                                  ...nuevas.map((l) => ({ ...l, cortes: l.cortes ?? [] })),
                              ],
                          }
                        : d,
                );
                sacarTemporales();
                setUltimo("ok");
                return true;
            } finally {
                setEnVuelo((v) => v - 1);
            }
        },
        [idOrden],
    );

    const borrar = useCallback(
        (id: number): Promise<boolean> => {
            setBorrando((b) => new Set(b).add(id));
            setCambios((k) => k + 1);
            const soltar = () =>
                setBorrando((b) => {
                    const n = new Set(b);
                    n.delete(id);
                    return n;
                });
            return encolar(id, async () => {
                setEnVuelo((v) => v + 1);
                try {
                    const url = `${API_URL}/materia-prima/lineas/${id}`;
                    let r = await mpDelete(url);
                    if (r.requiereConfirmacion) {
                        const si = await confirmarRef.current({
                            titulo: `Borrar ${nombreDe(id)}`,
                            motivo: r.error ?? "",
                            boton: "Borrar igual",
                        });
                        if (!si) {
                            soltar();
                            return false;
                        }
                        r = await mpDelete(url, { forzar: true });
                    }
                    if (!r.ok) {
                        soltar();
                        setUltimo("error");
                        toast.error(`No se borró ${nombreDe(id)}`, { description: r.error ?? "El servidor no contestó." });
                        return false;
                    }
                    const borrada = datosRef.current?.lineas.find((l) => l.id === id);
                    setDatos((d) => (d ? { ...d, lineas: d.lineas.filter((l) => l.id !== id) } : d));
                    setParches((p) => {
                        const n = { ...p };
                        delete n[id];
                        return n;
                    });
                    soltar();
                    setUltimo("ok");
                    // Si estaba reservada y no retirada, el stock libre del insumo cambió:
                    // lo dice el backend la próxima vez que se pida. No se inventa acá.
                    if (borrada) toast.success(`Se borró ${borrada.codigo} de la OT`);
                    return true;
                } finally {
                    setEnVuelo((v) => v - 1);
                }
            });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- nombreDe sólo usa refs
        [encolar],
    );

    const cambiarNoLleva = useCallback(
        async (valor: boolean): Promise<boolean> => {
            if (!idOrden) return false;
            const antes = datosRef.current?.no_lleva_materia_prima ?? false;
            setDatos((d) => (d ? { ...d, no_lleva_materia_prima: valor } : d));
            setCambios((k) => k + 1);
            setEnVuelo((v) => v + 1);
            try {
                const r = await mpPut<NoLleva>(`${API_URL}/materia-prima/ot/${idOrden}/no-lleva`, { no_lleva: valor });
                if (r.ok) {
                    const quedo = r.data?.no_lleva_materia_prima ?? valor;
                    setDatos((d) => (d ? { ...d, no_lleva_materia_prima: quedo } : d));
                    setUltimo("ok");
                    return true;
                }
                setDatos((d) => (d ? { ...d, no_lleva_materia_prima: antes } : d));
                setUltimo("error");
                toast.error("No se guardó «No lleva materias primas»", { description: r.error ?? "El servidor no contestó." });
                return false;
            } finally {
                setEnVuelo((v) => v - 1);
            }
        },
        [idOrden],
    );

    const estadoGuardado: EstadoGuardado = enVuelo > 0 ? "guardando" : ultimo === "ok" ? "guardado" : ultimo === "error" ? "error" : null;

    return {
        datos,
        lineas,
        borrando,
        cargando,
        error,
        sinServidor,
        enVuelo,
        estadoGuardado,
        cambios,
        recargar: cargar,
        guardar,
        agregar,
        borrar,
        cambiarNoLleva,
    };
}

// ═══════════════════════════ OT nueva: mandarlas con el alta ═══════════════════════════
//
// Las líneas de una OT que todavía no existe viven en memoria (las tiene el modal). Al
// volver el id de `POST /ordenes` se mandan todas juntas. Si ESE pedido falla, la OT ya
// quedó creada y el modal se cierra: las líneas no se pueden perder. Se guardan acá
// (memoria de la pestaña + localStorage, por si se recarga) atadas al id de la OT, y la
// próxima vez que se abra esa OT la solapa ofrece «Reintentar» o «Descartar».

const CLAVE_SIN_GUARDAR = (idOrden: number) => `spmm.mp.lineasSinGuardar.${idOrden}`;
const sinGuardarEnMemoria = new Map<number, LineaLocal[]>();

export function guardarSinGuardar(idOrden: number, lineas: LineaLocal[]) {
    sinGuardarEnMemoria.set(idOrden, lineas);
    try {
        localStorage.setItem(CLAVE_SIN_GUARDAR(idOrden), JSON.stringify({ guardado: ahoraISO(), lineas }));
    } catch {
        // Sin almacenamiento (modo privado): queda la copia en memoria, que dura lo que la pestaña.
    }
}

export function leerSinGuardar(idOrden: number): LineaLocal[] | null {
    const enMemoria = sinGuardarEnMemoria.get(idOrden);
    if (enMemoria?.length) return enMemoria;
    try {
        const crudo = localStorage.getItem(CLAVE_SIN_GUARDAR(idOrden));
        if (!crudo) return null;
        const leido = JSON.parse(crudo) as { lineas?: LineaLocal[] };
        return Array.isArray(leido?.lineas) && leido.lineas.length ? leido.lineas : null;
    } catch {
        return null;
    }
}

export function olvidarSinGuardar(idOrden: number) {
    sinGuardarEnMemoria.delete(idOrden);
    try {
        localStorage.removeItem(CLAVE_SIN_GUARDAR(idOrden));
    } catch {
        // nada: la copia en memoria ya se fue
    }
}

export interface ResultadoAltaDeLineas {
    ok: boolean;
    /** Cuántas se mandaron. */
    cuantas: number;
    /** El motivo, si no quedaron. */
    error: string | null;
    /** La persona no quiso cargarlas igual (409): no es un error, pero tampoco quedaron. */
    cancelado: boolean;
}

/**
 * Manda las líneas de una OT recién creada (`POST …/lineas/lote`, todas o ninguna).
 *
 * `preguntar` es el 409 (un insumo inactivo): devuelve si se cargan igual. Si no quedaron
 * —error o «no»—, se guardan para reintentar desde la solapa al abrir la OT. El que
 * llama avisa: la OT se creó igual y eso también hay que decirlo.
 */
export async function mandarLineasDeOTNueva(
    idOrden: number,
    lineas: LineaLocal[],
    preguntar: (motivo: string) => boolean | Promise<boolean>,
): Promise<ResultadoAltaDeLineas> {
    if (!lineas.length) return { ok: true, cuantas: 0, error: null, cancelado: false };
    const url = `${API_URL}/materia-prima/ot/${idOrden}/lineas/lote`;
    const cuerpo = { lineas: lineas.map(aLineaIn) };
    let r = await mpPost<Linea[]>(url, cuerpo);
    if (r.requiereConfirmacion) {
        const si = await preguntar(r.error ?? "El servidor pidió confirmación.");
        if (!si) {
            guardarSinGuardar(idOrden, lineas);
            return { ok: false, cuantas: lineas.length, error: null, cancelado: true };
        }
        r = await mpPost<Linea[]>(url, cuerpo, { forzar: true });
    }
    if (r.ok) {
        olvidarSinGuardar(idOrden);
        return { ok: true, cuantas: lineas.length, error: null, cancelado: false };
    }
    guardarSinGuardar(idOrden, lineas);
    return { ok: false, cuantas: lineas.length, error: r.error ?? "El servidor no contestó.", cancelado: false };
}

/**
 * Una línea local (OT nueva) con, además, la descripción del insumo: si la persona
 * escribe otra y después la borra, vuelve a ésa (lo mismo que hace el backend con una
 * línea guardada). Es un campo de más que `aLineaIn` no manda.
 */
export type LineaLocalMP = LineaLocal & { descripcion_insumo?: string };

/** Una línea local (OT nueva), con lo que hace falta para dibujarla. */
export function lineaLocal(
    entrada: LineaIn,
    delInsumo: { codigo: string; descripcion: string; tipo: TipoInsumo | null; precio: number | null },
): LineaLocalMP {
    return {
        ...entrada,
        cantidad: redondear3(entrada.cantidad),
        clave: `local-${idTemporal()}`,
        codigo: delInsumo.codigo,
        descripcion_mostrada: entrada.descripcion || delInsumo.descripcion,
        descripcion_insumo: delInsumo.descripcion,
        tipo_pieza: delInsumo.tipo,
        precio: delInsumo.precio,
    };
}

/** Un cambio de la grilla aplicado a una línea local (no hay servidor que contestar). */
export function cambiarLineaLocal(l: LineaLocalMP, c: CambiosFila): LineaLocalMP {
    const n: LineaLocalMP = { ...l };
    if (c.cantidad !== undefined) n.cantidad = redondear3(c.cantidad);
    if (c.unidad !== undefined) n.unidad = c.unidad;
    if (c.observaciones !== undefined) n.observaciones = c.observaciones;
    if (c.id_proveedor !== undefined) n.id_proveedor = c.id_proveedor;
    if (c.proveedor !== undefined) n.proveedor = c.proveedor;
    if (c.descripcion !== undefined) {
        n.descripcion = c.descripcion;
        n.descripcion_mostrada = c.descripcion || l.descripcion_insumo || l.descripcion_mostrada;
    }
    if (c.cortes !== undefined) n.cortes = c.cortes;
    return n;
}
