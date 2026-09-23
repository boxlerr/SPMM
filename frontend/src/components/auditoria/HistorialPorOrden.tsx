"use client";

/**
 * Auditoría › «Por orden» (RF-17): elegir una OT y ver TODO lo que pasó con ella, lo
 * último primero — el alta, los cambios de estado, de fechas, de cliente y de prioridad,
 * los pasos, las planificaciones, las pausas (RF-03), los consumos (RF-15), las no
 * conformidades (RF-12), los planos y las entregas—, con quién y cuándo.
 *
 * Julián lo pidió en Auditoría y no en la ficha de la OT ni en la planificación: por eso
 * la OT se busca acá (por número, cliente o artículo) y no se llega desde otra pantalla.
 * Desde «Por persona», tocar una OT de su línea de tiempo la abre acá.
 *
 * La lista la arma el servidor; el filtro de fechas viaja, el de tipos no (se aplica
 * sobre lo que llegó). Mientras se pide de nuevo, lo que estaba queda a la vista.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Info, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { fechaCorta } from "@/lib/asistencia";
import type { PeriodoAuditoria } from "@/lib/auditoria";
import {
    HistorialNoDisponible,
    NoExiste,
    buscarOrdenes,
    historialDeOrden,
    type HistorialDeOrden,
    type OrdenDelHistorial,
} from "@/lib/historial";
import { VistaDeHistorial } from "@/components/auditoria/LineaDeTiempo";

/** Lo que manda «Por persona» al tocar una OT: `n` cambia en cada pedido. */
export interface PedidoDeOrden {
    n: number;
    id: number;
    numero: number;
}

type Estado = "cargando" | "listo" | "error" | "no-disponible" | "no-existe";

type ElegidaOrden = Partial<OrdenDelHistorial> & { id: number; numero: number };

function AvisoNoDisponible() {
    return (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
            El historial de cada orden llega con la próxima actualización del servidor.
        </p>
    );
}

export function HistorialPorOrden({ refresco, pedido }: {
    /** Cambia con «Actualizar»: vuelve a pedir lo que se está mirando, sin perder la OT. */
    refresco: number;
    pedido: PedidoDeOrden | null;
}) {
    // ── el buscador ──
    const [texto, setTexto] = useState("");
    const [resultados, setResultados] = useState<OrdenDelHistorial[] | null>(null);
    const [buscando, setBuscando] = useState(false);
    const [disponible, setDisponible] = useState(true);
    const [errorBusqueda, setErrorBusqueda] = useState(false);

    // ── la OT elegida ──
    // Lo que se sabe de la OT elegida: la fila del buscador (el encabezado se ve al toque,
    // mientras llega el historial) o sólo el número, si vino de «Por persona».
    const [elegida, setElegida] = useState<ElegidaOrden | null>(null);
    const [periodo, setPeriodo] = useState<PeriodoAuditoria>({ clave: "todo" });
    const [datos, setDatos] = useState<HistorialDeOrden | null>(null);
    const [estado, setEstado] = useState<Estado>("cargando");
    const [actualizando, setActualizando] = useState(false);
    const [detalleNoExiste, setDetalleNoExiste] = useState("");

    // La búsqueda, 300 ms después de la última tecla (sin texto: las últimas cargadas).
    useEffect(() => {
        const c = new AbortController();
        const t = setTimeout(async () => {
            setBuscando(true);
            try {
                const r = await buscarOrdenes(texto, c.signal);
                if (c.signal.aborted) return;
                setResultados(r);
                setErrorBusqueda(false);
            } catch (e) {
                if (c.signal.aborted) return;
                if (e instanceof HistorialNoDisponible) setDisponible(false);
                else setErrorBusqueda(true);
            } finally {
                if (!c.signal.aborted) setBuscando(false);
            }
        }, texto ? 300 : 0);
        return () => {
            clearTimeout(t);
            c.abort();
        };
    }, [texto, refresco]);

    // Desde «Por persona»: abrir esa OT.
    const ultimoPedido = useRef<number | null>(null);
    useEffect(() => {
        if (!pedido || pedido.n === ultimoPedido.current) return;
        ultimoPedido.current = pedido.n;
        setElegida({ id: pedido.id, numero: pedido.numero });
    }, [pedido]);

    const cargar = useCallback(async (id: number, p: PeriodoAuditoria, senal: AbortSignal) => {
        setActualizando(true);
        try {
            const r = await historialDeOrden(id, p, senal);
            if (senal.aborted) return;
            setDatos(r);
            setEstado("listo");
        } catch (e) {
            if (senal.aborted) return;
            if (e instanceof HistorialNoDisponible) setEstado("no-disponible");
            else if (e instanceof NoExiste) {
                setDetalleNoExiste(e.message);
                setEstado("no-existe");
            } else setEstado((s) => (s === "listo" ? "listo" : "error"));
        } finally {
            if (!senal.aborted) setActualizando(false);
        }
    }, []);

    // Cambiar de OT arranca de cero (no se muestra la anterior mientras llega la nueva);
    // cambiar las fechas o «Actualizar» deja la lista a la vista.
    const idElegida = elegida?.id ?? null;
    useEffect(() => {
        setDatos(null);
        setEstado("cargando");
    }, [idElegida]);
    useEffect(() => {
        if (idElegida == null) return;
        const c = new AbortController();
        void cargar(idElegida, periodo, c.signal);
        return () => c.abort();
    }, [idElegida, periodo, refresco, cargar]);

    if (!disponible) return <AvisoNoDisponible />;

    // ── la OT elegida ──
    if (elegida) {
        const o: ElegidaOrden = datos?.orden ?? elegida;
        const numero = o.numero ?? elegida.numero;
        return (
            <div className="space-y-3">
                <div className="rounded-lg border bg-card px-3 sm:px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold flex flex-wrap items-center gap-2">
                            OT {numero}
                            {o.terminada && (
                                <Badge variant="outline" className="text-xs font-normal border-emerald-200 text-emerald-700">
                                    Terminada
                                </Badge>
                            )}
                        </h2>
                        {(o.cliente !== undefined || o.articulo !== undefined) && (
                            <p className="text-sm text-muted-foreground break-words">
                                {[o.cliente, o.articulo].filter(Boolean).join(" · ") || "Sin cliente ni artículo"}
                                {o.unidades != null && ` · ${o.unidades} ${o.unidades === 1 ? "unidad" : "unidades"}`}
                                {o.cantidad_entregada ? ` (${o.cantidad_entregada} entregadas)` : ""}
                            </p>
                        )}
                        {(o.fecha_orden || o.fecha_prometida || o.fecha_entrega) && (
                            <p className="text-xs text-muted-foreground">
                                {[
                                    o.fecha_orden && `Orden: ${fechaCorta(o.fecha_orden)}`,
                                    o.fecha_prometida && `Prometida: ${fechaCorta(o.fecha_prometida)}`,
                                    o.fecha_entrega && `Entrega: ${fechaCorta(o.fecha_entrega)}`,
                                ].filter(Boolean).join(" · ")}
                            </p>
                        )}
                    </div>
                    <Button variant="outline" size="sm" className="self-start shrink-0" onClick={() => setElegida(null)}>
                        <ArrowLeft className="h-4 w-4 mr-1.5" />
                        Elegir otra OT
                    </Button>
                </div>

                {estado === "cargando" && (
                    <div className="flex items-center justify-center py-16">
                        <Spinner className="h-8 w-8" />
                    </div>
                )}
                {estado === "no-disponible" && <AvisoNoDisponible />}
                {estado === "no-existe" && (
                    <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
                        {detalleNoExiste || `La OT ${numero} ya no existe.`}
                    </p>
                )}
                {estado === "error" && !datos && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                        No se pudo cargar el historial de la OT. Probá actualizar.
                    </div>
                )}
                {datos && estado === "listo" && (
                    <VistaDeHistorial
                        key={datos.orden?.id ?? elegida.id}
                        datos={datos}
                        actualizando={actualizando}
                        periodo={periodo}
                        onPeriodo={setPeriodo}
                        tituloExport={`Auditoría · Historial de la OT ${numero}`}
                        archivoExport={`auditoria_ot_${numero}`}
                        filtrosExport={[
                            `OT ${numero}${o.cliente ? ` — ${o.cliente}` : ""}${o.articulo ? ` — ${o.articulo}` : ""}`,
                        ]}
                        vacio="No pasó nada con esta OT en este período."
                    />
                )}
            </div>
        );
    }

    // ── el buscador ──
    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                Elegí una orden para ver todo lo que pasó con ella: quién la cargó y la cambió, sus pasos,
                planes, pausas, consumos, no conformidades, planos y entregas.
            </p>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="Buscar por número de OT, cliente o artículo"
                    aria-label="Buscar una orden"
                    className="pl-9 pr-9"
                />
                {texto && (
                    <button
                        type="button"
                        onClick={() => setTexto("")}
                        aria-label="Borrar la búsqueda"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            <section className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        {texto.trim() ? "Lo que coincide" : "Las últimas cargadas"}
                        {buscando && <Spinner className="h-3.5 w-3.5" />}
                    </h3>
                </div>
                {errorBusqueda && !resultados ? (
                    <p className="px-4 py-8 text-center text-sm text-rose-700">No se pudo buscar. Probá actualizar.</p>
                ) : resultados === null ? (
                    <div className="flex items-center justify-center py-10"><Spinner className="h-6 w-6" /></div>
                ) : resultados.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Ninguna orden coincide con «{texto.trim()}».
                    </p>
                ) : (
                    <ul className={cn("divide-y transition-opacity", buscando && "opacity-60")}>
                        {resultados.map((o) => (
                            <li key={o.id}>
                                <button
                                    type="button"
                                    onClick={() => setElegida(o)}
                                    className="w-full px-3 sm:px-4 py-2 flex items-center gap-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/40"
                                >
                                    <span className="w-16 shrink-0 text-sm font-medium tabular-nums">{o.numero}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm text-gray-800 truncate">
                                            {o.cliente || "Sin cliente"}
                                        </span>
                                        <span className="block text-xs text-muted-foreground truncate">
                                            {o.articulo || "Sin artículo"}
                                            {o.fecha_prometida && ` · prometida ${fechaCorta(o.fecha_prometida)}`}
                                        </span>
                                    </span>
                                    {o.terminada && (
                                        <Badge variant="outline" className="hidden sm:inline-flex text-[10px] font-normal border-emerald-200 text-emerald-700 shrink-0">
                                            Terminada
                                        </Badge>
                                    )}
                                    <ChevronRight className="h-4 w-4 opacity-40 shrink-0" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
