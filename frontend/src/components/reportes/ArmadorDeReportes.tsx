"use client";

/**
 * El armador de reportes personalizados (RF-23): la pantalla grande que abre «Armar un
 * reporte» en el Dashboard.
 *
 *   izquierda  los pasos: de qué, qué columnas (y en qué orden), período y filtros, y
 *              cómo agrupar y contar;
 *   derecha    la vista previa EN VIVO: cada cambio pide las primeras 50 filas y los
 *              totales de todo lo filtrado (lo anterior queda a la vista mientras llega).
 *
 * Arriba, el nombre del reporte (es el título del PDF), «Mis reportes» (los guardados y los
 * de ejemplo), Guardar y Exportar. Exportar baja TODO lo filtrado, hasta 20.000 filas, con
 * los totales aparte y los criterios en el encabezado del PDF y en la hoja «Datos del
 * reporte» del Excel.
 *
 * En el teléfono los pasos y la vista previa van en dos solapas.
 *
 * Guardar y borrar se ven al toque en la lista y se deshacen si el servidor dice que no
 * (nada de recargar). Quién puede guardar lo dice el permiso de EDITAR el Dashboard (lo
 * mismo que pide el servidor); compartir con todos, ser admin.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    BookmarkPlus,
    ChevronDown,
    FilePlus2,
    FolderOpen,
    Loader2,
    Lock,
    Save,
    Share2,
    Sparkles,
    Trash2,
    Users,
    X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { ContenedorDeFlotantes, Flotante } from "./Flotante";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { usePermisos } from "@/hooks/usePermisos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
    completarReceta,
    correrReporte,
    criteriosParaExportar,
    guardarReporte,
    borrarReporte,
    limpiarConfig,
    mismaReceta,
    nombreDeArchivo,
    pedirOpciones,
    recetaInicial,
    seccionesParaExportar,
    subtituloParaExportar,
    textoDelPeriodo,
    type Catalogo,
    type ConfigReporte,
    type Ejemplo,
    type Opcion,
    type ReporteGuardado,
    type ResultadoReporte,
} from "@/lib/reportes";
import { ElegirAgrupacion, ElegirColumnas, ElegirFiltros, ElegirFuente, ElegirPeriodo, Paso } from "./PasosDelArmador";
import { VistaPrevia } from "./VistaPrevia";

/** Lo que se está armando. Vive en el bloque del Dashboard: cerrar y volver a abrir sigue
 *  donde estaba. */
export interface TrabajoDeReporte {
    receta: ConfigReporte | null;
    nombre: string;
    descripcion: string;
    compartido: boolean;
    /** El guardado que se está editando (si es propio, «Guardar» lo pisa). */
    guardadoId: number | null;
    /** Para saber si hay cambios sin guardar. */
    base: { receta: ConfigReporte | null; nombre: string } | null;
}

export const TRABAJO_VACIO: TrabajoDeReporte = {
    receta: null, nombre: "", descripcion: "", compartido: false, guardadoId: null, base: null,
};

export function trabajoDesdeGuardado(g: ReporteGuardado): TrabajoDeReporte {
    const receta = g.config ? completarReceta(g.config) : null;
    return {
        receta,
        nombre: g.nombre,
        descripcion: g.descripcion ?? "",
        compartido: g.compartido,
        guardadoId: g.es_mio ? g.id : null,
        base: { receta, nombre: g.nombre },
    };
}

export function trabajoDesdeEjemplo(e: Ejemplo): TrabajoDeReporte {
    return { ...TRABAJO_VACIO, receta: completarReceta(e.config), nombre: e.nombre, descripcion: e.descripcion };
}

export type EstadoCatalogo = "cargando" | "listo" | "viejo" | "error";

export function ArmadorDeReportes({
    abierto,
    onCerrar,
    catalogo,
    estadoCatalogo,
    onReintentar,
    trabajo,
    setTrabajo,
    guardados,
    setGuardados,
}: {
    abierto: boolean;
    onCerrar: () => void;
    catalogo: Catalogo | null;
    estadoCatalogo: EstadoCatalogo;
    onReintentar: () => void;
    trabajo: TrabajoDeReporte;
    setTrabajo: React.Dispatch<React.SetStateAction<TrabajoDeReporte>>;
    guardados: ReporteGuardado[];
    setGuardados: React.Dispatch<React.SetStateAction<ReporteGuardado[]>>;
}) {
    const { puede, esAdmin } = usePermisos();
    const puedeGuardar = puede("dashboard", "write");

    const receta = trabajo.receta;
    const fuente = useMemo(
        () => catalogo?.fuentes.find((f) => f.codigo === receta?.fuente) ?? null,
        [catalogo, receta?.fuente],
    );
    const setReceta = (r: ConfigReporte) => setTrabajo((t) => ({ ...t, receta: r }));

    // ── las listas para filtrar, una vez por fuente ──
    const [opciones, setOpciones] = useState<Record<string, Record<string, Opcion[]>>>({});
    useEffect(() => {
        if (!abierto || !fuente || opciones[fuente.codigo]) return;
        const ctrl = new AbortController();
        pedirOpciones(fuente.codigo, ctrl.signal)
            .then((o) => setOpciones((prev) => ({ ...prev, [fuente.codigo]: o })))
            .catch(() => {
                if (!ctrl.signal.aborted) setOpciones((prev) => ({ ...prev, [fuente.codigo]: {} }));
            });
        return () => ctrl.abort();
    }, [abierto, fuente, opciones]);

    // ── la vista previa, en vivo ──
    const [resultado, setResultado] = useState<ResultadoReporte | null>(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const clave = receta ? JSON.stringify(limpiarConfig(receta)) : "";
    const sinColumnas = !!receta && receta.agrupar.length === 0 && receta.columnas.length === 0;
    useEffect(() => {
        if (!abierto || !receta || !fuente || sinColumnas) {
            setCargando(false);
            return;
        }
        const ctrl = new AbortController();
        setCargando(true);
        const espera = setTimeout(async () => {
            try {
                const r = await correrReporte(receta, true, ctrl.signal);
                setResultado(r);
                setError(null);
            } catch (e) {
                if (ctrl.signal.aborted) return;
                setError(e instanceof Error ? e.message : "No se pudo armar la vista previa.");
            } finally {
                if (!ctrl.signal.aborted) setCargando(false);
            }
        }, 350);
        return () => {
            clearTimeout(espera);
            ctrl.abort();
        };
        // `clave` resume la receta: cambia sólo si cambia lo que viaja.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto, clave, fuente, sinColumnas]);
    // Al cambiar de fuente, la tabla vieja no sirve ni de referencia.
    useEffect(() => {
        setResultado(null);
        setError(null);
    }, [receta?.fuente]);

    // ── lo que baja el Exportar: todo lo filtrado ──
    const completo = useRef<ResultadoReporte | null>(null);
    const titulo = trabajo.nombre.trim() || (fuente ? `Reporte de ${fuente.nombre.toLowerCase()}` : "Reporte");

    const [vista, setVista] = useState<"armar" | "ver">("armar");
    // Los menús flotantes van adentro del diálogo (ver Flotante.tsx).
    const [contenedor, setContenedor] = useState<HTMLElement | null>(null);

    const hayCambios = !!trabajo.base
        ? !mismaReceta(trabajo.receta, trabajo.base.receta) || trabajo.nombre !== trabajo.base.nombre
        : !!trabajo.receta;

    // ── abrir, guardar y borrar ──
    const abrir = (nuevo: TrabajoDeReporte, que: string) => {
        const anterior = trabajo;
        setTrabajo(nuevo);
        setVista("armar");
        if (anterior.receta && hayCambios) {
            toast(`Abriste «${que}»`, {
                description: "Lo que estabas armando no estaba guardado.",
                action: { label: "Volver a lo anterior", onClick: () => setTrabajo(anterior) },
            });
        }
    };

    const guardar = async (comoNuevo: boolean, datos: { nombre: string; descripcion: string; compartido: boolean }) => {
        if (!receta) return;
        const propio = !comoNuevo && trabajo.guardadoId !== null
            ? guardados.find((g) => g.id === trabajo.guardadoId && g.es_mio) ?? null
            : null;
        const previo = guardados;
        const provisorio: ReporteGuardado = {
            id: propio?.id ?? -Date.now(),
            nombre: datos.nombre,
            descripcion: datos.descripcion || null,
            fuente: receta.fuente,
            config: limpiarConfig(receta),
            compartido: esAdmin ? datos.compartido : propio?.compartido ?? false,
            es_mio: true,
            autor: propio?.autor ?? null,
            creado_en: propio?.creado_en ?? null,
            modificado_en: null,
            disponible: true,
            motivo: null,
        };
        // Se ve al toque; si el servidor dice que no, vuelve como estaba.
        setGuardados((lista) => propio
            ? lista.map((g) => (g.id === propio.id ? provisorio : g))
            : [...lista, provisorio].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
        setTrabajo((t) => ({
            ...t, nombre: datos.nombre, descripcion: datos.descripcion, compartido: provisorio.compartido,
            guardadoId: provisorio.id, base: { receta, nombre: datos.nombre },
        }));
        try {
            const real = await guardarReporte({
                nombre: datos.nombre,
                descripcion: datos.descripcion || null,
                config: receta,
                compartido: esAdmin ? datos.compartido : propio ? null : false,
            }, propio?.id);
            setGuardados((lista) => lista.map((g) => (g.id === provisorio.id ? real : g)));
            setTrabajo((t) => (t.guardadoId === provisorio.id ? { ...t, guardadoId: real.id } : t));
            toast.success(propio ? `Guardaste los cambios de «${real.nombre}»` : `Guardaste «${real.nombre}»`);
        } catch (e) {
            setGuardados(previo);
            setTrabajo((t) => ({ ...t, guardadoId: propio?.id ?? null, base: trabajo.base }));
            toast.error(e instanceof Error ? e.message : "No se pudo guardar el reporte.");
        }
    };

    const borrar = async (g: ReporteGuardado) => {
        const previo = guardados;
        setGuardados((lista) => lista.filter((x) => x.id !== g.id));
        if (trabajo.guardadoId === g.id) setTrabajo((t) => ({ ...t, guardadoId: null, base: null }));
        try {
            await borrarReporte(g.id);
            toast.success(`Borraste «${g.nombre}»`);
        } catch (e) {
            setGuardados(previo);
            toast.error(e instanceof Error ? e.message : "No se pudo borrar el reporte.");
        }
    };

    const columnasDelResultado = resultado?.columnas.length ?? 0;
    const totalParaExportar = resultado
        ? Math.min(resultado.modo === "grupos" ? resultado.total_grupos ?? 0 : resultado.total_filas, resultado.tope)
        : undefined;

    return (
        <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
            <DialogContent
                ref={setContenedor}
                showCloseButton={false}
                // Sin foco automático en el nombre: en el teléfono abriría el teclado encima.
                onOpenAutoFocus={(e) => e.preventDefault()}
                className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#f4f6f9] p-0 sm:h-[94dvh] sm:w-[calc(100vw-2rem)] sm:max-w-[1440px] sm:rounded-2xl"
            >
                <ContenedorDeFlotantes.Provider value={contenedor}>
                <DialogTitle className="sr-only">Armar un reporte</DialogTitle>
                <DialogDescription className="sr-only">
                    Elegí de qué, qué columnas, qué filtros y cómo agrupar; mirá la vista previa y exportalo en PDF, Excel o CSV.
                </DialogDescription>

                {/* ── Cabecera ── */}
                <header className="relative shrink-0 overflow-hidden bg-gradient-to-r from-[#0f2742] via-[#1e3a5f] to-[#24466f] text-white">
                    <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#DC143C]/25 blur-3xl" aria-hidden />
                    <div className="relative flex flex-col gap-3 px-4 py-3 sm:px-5 md:flex-row md:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-md">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/logo.png" alt="" className="h-7 w-7 object-contain" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
                                    Reporte personalizado{fuente ? ` · ${fuente.nombre}` : ""}
                                </p>
                                <input
                                    value={trabajo.nombre}
                                    onChange={(e) => setTrabajo((t) => ({ ...t, nombre: e.target.value.slice(0, 120) }))}
                                    placeholder={fuente ? `Reporte de ${fuente.nombre.toLowerCase()}` : "Ponele un nombre a tu reporte"}
                                    className="w-full truncate rounded-md border border-transparent bg-transparent px-1 -mx-1 text-lg font-bold text-white placeholder:text-white/40 hover:border-white/20 focus:border-white/40 focus:bg-white/10 focus:outline-none sm:text-xl"
                                    aria-label="Nombre del reporte"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={onCerrar}
                                className="shrink-0 rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white md:hidden"
                                aria-label="Cerrar"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <MisReportes
                                catalogo={catalogo}
                                guardados={guardados}
                                abiertoId={trabajo.guardadoId}
                                onNuevo={() => abrir(TRABAJO_VACIO, "un reporte nuevo")}
                                onAbrirGuardado={(g) => abrir(trabajoDesdeGuardado(g), g.nombre)}
                                onAbrirEjemplo={(e) => abrir(trabajoDesdeEjemplo(e), e.nombre)}
                                // Borrar pide lo mismo que guardar (editar el Dashboard): sin eso
                                // el tacho no aparece, en vez de fallar al tocarlo.
                                onBorrar={puedeGuardar ? borrar : undefined}
                            />
                            <Guardar
                                deshabilitado={!receta || sinColumnas || estadoCatalogo !== "listo"}
                                puedeGuardar={puedeGuardar}
                                esAdmin={esAdmin}
                                trabajo={trabajo}
                                titulo={titulo}
                                propio={trabajo.guardadoId !== null && guardados.some((g) => g.id === trabajo.guardadoId && g.es_mio)}
                                hayCambios={hayCambios}
                                onGuardar={guardar}
                            />
                            <ExportarMenu<Record<string, unknown>>
                                titulo={titulo}
                                archivo={nombreDeArchivo(titulo)}
                                cantidad={totalParaExportar}
                                disabled={!resultado || !!error || cargando || columnasDelResultado === 0}
                                rotulo={resultado
                                    ? `Exportar todo lo filtrado: ${resultado.modo === "grupos"
                                        ? `${(resultado.total_grupos ?? 0).toLocaleString("es-AR")} grupos`
                                        : `${resultado.total_filas.toLocaleString("es-AR")} filas`}, con sus totales`
                                    : "Armá el reporte para poder exportarlo"}
                                aviso={resultado && resultado.recortado
                                    ? `Sale todo lo filtrado, no sólo la vista previa${totalParaExportar === resultado.tope ? ` (el tope es ${resultado.tope.toLocaleString("es-AR")} filas)` : ""}.`
                                    : undefined}
                                cargarSecciones={async () => {
                                    const r = await correrReporte(receta!, false);
                                    completo.current = r;
                                    if (r.aviso) toast.warning(r.aviso, { duration: 8000 });
                                    return seccionesParaExportar(r, "Datos");
                                }}
                                filtros={() => (completo.current ? criteriosParaExportar(completo.current) : [])}
                                rotuloFiltros="Criterios"
                                subtitulo={() => (completo.current ? subtituloParaExportar(completo.current) : undefined)}
                                className="h-9 border-white/0 px-3 font-semibold text-[#1e3a5f] shadow-sm"
                            />
                            <button
                                type="button"
                                onClick={onCerrar}
                                className="hidden rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white md:block"
                                aria-label="Cerrar"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                    <div className="h-1 bg-gradient-to-r from-[#DC143C] via-[#DC143C] to-[#B8112E]" aria-hidden />
                </header>

                {/* ── Cuerpo ── */}
                {estadoCatalogo === "cargando" ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#DC143C]" /> Abriendo el armador…
                    </div>
                ) : estadoCatalogo === "viejo" ? (
                    <Aviso
                        titulo="El armador de reportes todavía no está en el servidor"
                        texto="Se activa solo con la próxima actualización. Mientras tanto, cada lista del sistema se sigue exportando con su botón «Exportar»."
                    />
                ) : estadoCatalogo === "error" || !catalogo ? (
                    <Aviso
                        titulo="No se pudo abrir el armador"
                        texto="Revisá la conexión y probá de nuevo."
                        accion={{ texto: "Probar de nuevo", onClick: onReintentar }}
                    />
                ) : catalogo.fuentes.length === 0 ? (
                    <Aviso
                        titulo="No hay datos que puedas usar en un reporte"
                        texto="Tu usuario no ve ninguna de las pantallas de donde salen los reportes. Si los necesitás, pedíselas a un administrador."
                    />
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        {/* Solapas del teléfono */}
                        <div className="flex shrink-0 border-b border-gray-200 bg-white lg:hidden">
                            {(["armar", "ver"] as const).map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => setVista(v)}
                                    className={cn(
                                        "flex-1 border-b-2 py-2.5 text-sm font-semibold transition-colors",
                                        vista === v ? "border-[#DC143C] text-[#1e3a5f]" : "border-transparent text-gray-500",
                                    )}
                                >
                                    {v === "armar"
                                        ? "Armar"
                                        : `Vista previa${resultado ? ` · ${(resultado.modo === "grupos" ? resultado.total_grupos ?? 0 : resultado.total_filas).toLocaleString("es-AR")}` : ""}`}
                                </button>
                            ))}
                        </div>

                        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,440px)_1fr]">
                            {/* Los pasos */}
                            <div className={cn(
                                "min-h-0 min-w-0 space-y-3 overflow-y-auto border-gray-200 p-3 sm:p-4 lg:block lg:border-r lg:bg-white/40",
                                vista === "armar" ? "block" : "hidden",
                            )}>
                                <Paso numero={1} titulo="¿De qué es el reporte?">
                                    <ElegirFuente
                                        fuentes={catalogo.fuentes}
                                        actual={receta?.fuente ?? null}
                                        onElegir={(f) => {
                                            if (f.codigo === receta?.fuente) return;
                                            setTrabajo((t) => ({ ...t, receta: recetaInicial(f) }));
                                        }}
                                    />
                                    {fuente?.nota && <p className="mt-2 text-[11px] text-gray-500">{fuente.nota}</p>}
                                </Paso>
                                {fuente && receta && (
                                    <>
                                        <Paso numero={2} titulo="Columnas" resumen={`${receta.columnas.length} elegidas`}>
                                            <ElegirColumnas fuente={fuente} receta={receta} onCambiar={setReceta} />
                                        </Paso>
                                        <Paso
                                            numero={3}
                                            titulo="Período y filtros"
                                            resumen={fuente.periodo.length || fuente.periodo_interno ? textoDelPeriodo(receta.periodo) : undefined}
                                        >
                                            <div className="space-y-4">
                                                {(fuente.periodo.length > 0 || fuente.periodo_interno) && (
                                                    <ElegirPeriodo fuente={fuente} receta={receta} onCambiar={setReceta} />
                                                )}
                                                <ElegirFiltros
                                                    fuente={fuente}
                                                    receta={receta}
                                                    opciones={opciones[fuente.codigo] ?? null}
                                                    onCambiar={setReceta}
                                                />
                                            </div>
                                        </Paso>
                                        <Paso
                                            numero={4}
                                            titulo="Agrupar, contar y ordenar"
                                            resumen={receta.agrupar.length ? `${receta.agrupar.length} agrupación${receta.agrupar.length > 1 ? "es" : ""}` : "Sin agrupar"}
                                        >
                                            <ElegirAgrupacion fuente={fuente} receta={receta} onCambiar={setReceta} />
                                        </Paso>
                                        <button
                                            type="button"
                                            onClick={() => setVista("ver")}
                                            className="w-full rounded-xl bg-gradient-to-r from-[#DC143C] to-[#B8112E] py-3 text-sm font-semibold text-white shadow-md lg:hidden"
                                        >
                                            Ver la vista previa
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* La vista previa */}
                            <div className={cn("min-h-0 min-w-0 flex-col p-3 sm:p-4 lg:flex", vista === "ver" ? "flex" : "hidden")}>
                                {!receta || !fuente ? (
                                    <Bienvenida catalogo={catalogo} onEjemplo={(e) => abrir(trabajoDesdeEjemplo(e), e.nombre)} />
                                ) : (
                                    <VistaPrevia resultado={resultado} cargando={cargando} error={error} sinColumnas={sinColumnas} className="flex-1" />
                                )}
                            </div>
                        </div>
                    </div>
                )}
                </ContenedorDeFlotantes.Provider>
            </DialogContent>
        </Dialog>
    );
}

// ─────────────────────────── piezas ───────────────────────────

function Aviso({ titulo, texto, accion }: { titulo: string; texto: string; accion?: { texto: string; onClick: () => void } }) {
    return (
        <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center shadow-sm">
                <p className="font-semibold text-gray-900">{titulo}</p>
                <p className="mt-1 text-sm text-gray-600">{texto}</p>
                {accion && (
                    <button type="button" onClick={accion.onClick}
                            className="mt-4 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f2742]">
                        {accion.texto}
                    </button>
                )}
            </div>
        </div>
    );
}

function Bienvenida({ catalogo, onEjemplo }: { catalogo: Catalogo; onEjemplo: (e: Ejemplo) => void }) {
    return (
        <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/70 p-6 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#DC143C] to-[#B8112E] shadow-lg">
                <Sparkles className="h-7 w-7 text-white" />
            </div>
            <p className="text-lg font-bold text-[#1e3a5f]">Armá el reporte que necesites</p>
            <p className="mt-1 max-w-md text-sm text-gray-600">
                Elegí de qué es a la izquierda, o arrancá desde uno de estos, ajustalo y guardalo como tuyo.
            </p>
            {catalogo.ejemplos.length > 0 && (
                <div className="mt-5 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                    {catalogo.ejemplos.map((e) => (
                        <button
                            key={e.codigo}
                            type="button"
                            onClick={() => onEjemplo(e)}
                            className="rounded-xl border border-gray-200 bg-white p-3 text-left transition-all hover:-translate-y-px hover:border-[#DC143C]/50 hover:shadow-md"
                        >
                            <p className="text-sm font-semibold text-gray-900">{e.nombre}</p>
                            <p className="mt-0.5 text-xs text-gray-500">{e.descripcion}</p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function MisReportes({
    catalogo,
    guardados,
    abiertoId,
    onNuevo,
    onAbrirGuardado,
    onAbrirEjemplo,
    onBorrar,
}: {
    catalogo: Catalogo | null;
    guardados: ReporteGuardado[];
    abiertoId: number | null;
    onNuevo: () => void;
    onAbrirGuardado: (g: ReporteGuardado) => void;
    onAbrirEjemplo: (e: Ejemplo) => void;
    onBorrar?: (g: ReporteGuardado) => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [borrando, setBorrando] = useState<number | null>(null);
    const nombreFuente = (codigo: string) => catalogo?.fuentes.find((f) => f.codigo === codigo)?.nombre ?? codigo;
    const mios = guardados.filter((g) => g.es_mio);
    const compartidos = guardados.filter((g) => !g.es_mio);
    const cerrarYHacer = (hacer: () => void) => {
        setAbierto(false);
        setBorrando(null);
        hacer();
    };

    return (
        <Popover open={abierto} onOpenChange={(v) => { setAbierto(v); if (!v) setBorrando(null); }}>
            <PopoverTrigger asChild>
                <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-medium text-white hover:bg-white/20">
                    <FolderOpen className="h-4 w-4" />
                    Mis reportes
                    {mios.length > 0 && <span className="rounded-full bg-white/20 px-1.5 text-[11px]">{mios.length}</span>}
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </button>
            </PopoverTrigger>
            <Flotante align="end" className="w-[min(380px,calc(100vw-1.5rem))] p-0">
                <div className="max-h-[70dvh] overflow-y-auto p-2">
                    <button type="button" onClick={() => cerrarYHacer(onNuevo)}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-[#DC143C] hover:bg-[#DC143C]/5">
                        <FilePlus2 className="h-4 w-4" /> Empezar uno nuevo
                    </button>
                    <Grupo titulo="Tuyos" vacio="Todavía no guardaste ninguno.">
                        {mios.map((g) => (
                            <FilaGuardado key={g.id} g={g} activo={g.id === abiertoId} fuente={nombreFuente(g.fuente)}
                                          confirmando={borrando === g.id}
                                          onAbrir={() => cerrarYHacer(() => onAbrirGuardado(g))}
                                          onPedirBorrar={onBorrar ? () => setBorrando(g.id) : undefined}
                                          onCancelarBorrar={() => setBorrando(null)}
                                          onBorrar={() => { setBorrando(null); onBorrar?.(g); }} />
                        ))}
                    </Grupo>
                    {compartidos.length > 0 && (
                        <Grupo titulo="Compartidos con todos">
                            {compartidos.map((g) => (
                                <FilaGuardado key={g.id} g={g} activo={false} fuente={nombreFuente(g.fuente)}
                                              onAbrir={() => cerrarYHacer(() => onAbrirGuardado(g))} />
                            ))}
                        </Grupo>
                    )}
                    {!!catalogo?.ejemplos.length && (
                        <Grupo titulo="Para empezar">
                            {catalogo.ejemplos.map((e) => (
                                <button key={e.codigo} type="button" onClick={() => cerrarYHacer(() => onAbrirEjemplo(e))}
                                        className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50">
                                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#DC143C]" />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-gray-900">{e.nombre}</span>
                                        <span className="block text-[11px] text-gray-500">{e.descripcion}</span>
                                    </span>
                                </button>
                            ))}
                        </Grupo>
                    )}
                </div>
            </Flotante>
        </Popover>
    );
}

function Grupo({ titulo, vacio, children }: { titulo: string; vacio?: string; children: React.ReactNode }) {
    const lista = Array.isArray(children) ? children.filter(Boolean) : children;
    const hay = Array.isArray(lista) ? lista.length > 0 : !!lista;
    return (
        <div className="mt-2 border-t border-gray-100 pt-2">
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{titulo}</p>
            {hay ? lista : vacio ? <p className="px-2.5 py-1 text-xs text-gray-500">{vacio}</p> : null}
        </div>
    );
}

function FilaGuardado({
    g,
    activo,
    fuente,
    confirmando = false,
    onAbrir,
    onPedirBorrar,
    onCancelarBorrar,
    onBorrar,
}: {
    g: ReporteGuardado;
    activo: boolean;
    fuente: string;
    confirmando?: boolean;
    onAbrir: () => void;
    onPedirBorrar?: () => void;
    onCancelarBorrar?: () => void;
    onBorrar?: () => void;
}) {
    if (confirmando) {
        return (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-800">
                <span className="min-w-0 flex-1">
                    ¿Borrar «{g.nombre}»?{g.compartido ? " Lo dejan de ver todos." : ""}
                </span>
                <button type="button" onClick={onBorrar} className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700">Borrar</button>
                <button type="button" onClick={onCancelarBorrar} className="rounded-md px-2 py-1 font-medium text-red-700 hover:bg-red-100">No</button>
            </div>
        );
    }
    return (
        <div className={cn("group flex items-center gap-1 rounded-lg hover:bg-gray-50", activo && "bg-[#1e3a5f]/5")}>
            <button type="button" onClick={onAbrir} disabled={!g.disponible}
                    className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    title={g.motivo ?? g.descripcion ?? undefined}>
                {g.compartido ? <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1e3a5f]" /> : <BookmarkPlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1e3a5f]" />}
                <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{g.nombre}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                        {g.disponible ? fuente : "No lo podés abrir: " + (g.motivo ?? "")}
                        {!g.es_mio && g.autor ? ` · de ${g.autor}` : ""}
                    </span>
                </span>
            </button>
            {onPedirBorrar && g.id > 0 && (
                <button type="button" onClick={onPedirBorrar} title={`Borrar «${g.nombre}»`} aria-label={`Borrar «${g.nombre}»`}
                        className="mr-1 rounded-md p-1.5 text-gray-400 opacity-100 hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}

function Guardar({
    deshabilitado,
    puedeGuardar,
    esAdmin,
    trabajo,
    titulo,
    propio,
    hayCambios,
    onGuardar,
}: {
    deshabilitado: boolean;
    puedeGuardar: boolean;
    esAdmin: boolean;
    trabajo: TrabajoDeReporte;
    titulo: string;
    propio: boolean;
    hayCambios: boolean;
    onGuardar: (comoNuevo: boolean, datos: { nombre: string; descripcion: string; compartido: boolean }) => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [nombre, setNombre] = useState("");
    const [descripcion, setDescripcion] = useState("");
    const [compartido, setCompartido] = useState(false);
    useEffect(() => {
        if (!abierto) return;
        setNombre(trabajo.nombre.trim() || titulo);
        setDescripcion(trabajo.descripcion);
        setCompartido(trabajo.compartido);
    }, [abierto, trabajo.nombre, trabajo.descripcion, trabajo.compartido, titulo]);

    const listo = nombre.trim().length > 0;
    const hacer = (comoNuevo: boolean) => {
        if (!listo) return;
        setAbierto(false);
        onGuardar(comoNuevo, { nombre: nombre.trim(), descripcion: descripcion.trim(), compartido });
    };

    return (
        <Popover open={abierto} onOpenChange={setAbierto}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={deshabilitado}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#DC143C] to-[#B8112E] px-3.5 text-sm font-semibold text-white shadow-md transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {puedeGuardar ? <Save className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    Guardar
                    {propio && hayCambios && <span className="h-1.5 w-1.5 rounded-full bg-white" aria-label="con cambios sin guardar" />}
                </button>
            </PopoverTrigger>
            <Flotante align="end" className="w-[min(340px,calc(100vw-1.5rem))] p-4">
                {!puedeGuardar ? (
                    <div className="space-y-2 text-sm">
                        <p className="font-semibold text-gray-900">Para guardar reportes hace falta un permiso</p>
                        <p className="text-gray-600">
                            Guardar pide poder <b>editar el Dashboard</b>. Pedíselo a un administrador. Mientras tanto
                            podés armar el reporte y exportarlo igual.
                        </p>
                    </div>
                ) : (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); hacer(!propio); }}>
                        <p className="text-sm font-semibold text-gray-900">{propio ? "Guardar los cambios" : "Guardar el reporte"}</p>
                        <label className="block space-y-1">
                            <span className="text-xs font-medium text-gray-600">Nombre</span>
                            <input value={nombre} onChange={(e) => setNombre(e.target.value.slice(0, 120))} autoFocus
                                   className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm focus:border-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/15" />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-xs font-medium text-gray-600">Para qué es <span className="text-gray-400">(opcional)</span></span>
                            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value.slice(0, 500))} rows={2}
                                      className="w-full resize-none rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-[#1e3a5f] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/15" />
                        </label>
                        {esAdmin && (
                            <label className="flex items-start gap-2 rounded-lg bg-[#1e3a5f]/5 p-2.5 text-xs text-[#1e3a5f]">
                                <input type="checkbox" checked={compartido} onChange={(e) => setCompartido(e.target.checked)}
                                       className="mt-0.5 accent-[#DC143C]" />
                                <span>
                                    <span className="flex items-center gap-1 font-semibold"><Share2 className="h-3 w-3" /> Compartir con todos</span>
                                    Lo ve cada uno que pueda ver estos datos (a nadie le abre lo que no puede ver).
                                </span>
                            </label>
                        )}
                        <p className="text-[11px] text-gray-500">Se guarda cómo se arma, no los datos: cada vez que lo abras trae lo de ese momento.</p>
                        <div className="flex flex-wrap justify-end gap-2">
                            {propio && (
                                <button type="button" onClick={() => hacer(true)} disabled={!listo}
                                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-[#1e3a5f] disabled:opacity-40">
                                    Guardar como nuevo
                                </button>
                            )}
                            <button type="submit" disabled={!listo}
                                    className="rounded-lg bg-[#1e3a5f] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0f2742] disabled:opacity-40">
                                {propio ? "Guardar cambios" : "Guardar"}
                            </button>
                        </div>
                    </form>
                )}
            </Flotante>
        </Popover>
    );
}

