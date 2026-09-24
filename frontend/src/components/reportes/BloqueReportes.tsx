"use client";

/**
 * El bloque «Reportes» del Dashboard (RF-23): el botón «Armar un reporte» y, abajo, los
 * reportes guardados y los de ejemplo para abrir de un toque.
 *
 * ES EL LUGAR DE LOS REPORTES DEL DASHBOARD. El «Reporte mensual» (RF-21) va
 * acá, al lado del botón: se pasa como `children` y se dibuja antes de «Armar un reporte»
 * (ver app/dashboard/page.tsx). Así los dos conviven sin pelearse por la cabecera.
 *
 * El catálogo y los guardados se piden una vez al entrar al Dashboard, callados: si el
 * servidor todavía no tiene el armador (backend viejo, 404) el botón igual abre y dice
 * que se activa con la próxima actualización.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BookmarkCheck, FileBarChart2, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    pedirCatalogo,
    pedirGuardados,
    type Catalogo,
    type Ejemplo,
    type ReporteGuardado,
} from "@/lib/reportes";
import {
    ArmadorDeReportes,
    TRABAJO_VACIO,
    trabajoDesdeEjemplo,
    trabajoDesdeGuardado,
    type EstadoCatalogo,
    type TrabajoDeReporte,
} from "./ArmadorDeReportes";

export function BloqueReportes({ children, className }: { children?: React.ReactNode; className?: string }) {
    const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
    const [estado, setEstado] = useState<EstadoCatalogo>("cargando");
    const [guardados, setGuardados] = useState<ReporteGuardado[]>([]);
    const [abierto, setAbierto] = useState(false);
    const [trabajo, setTrabajo] = useState<TrabajoDeReporte>(TRABAJO_VACIO);

    const cargar = useCallback(async (senal?: AbortSignal) => {
        setEstado("cargando");
        try {
            const c = await pedirCatalogo(senal);
            if (senal?.aborted) return;
            if (c === null) {
                setEstado("viejo");
                return;
            }
            setCatalogo(c);
            setEstado("listo");
            const g = await pedirGuardados(senal).catch(() => null);
            if (!senal?.aborted && g) setGuardados(g);
        } catch {
            if (!senal?.aborted) setEstado("error");
        }
    }, []);

    useEffect(() => {
        const ctrl = new AbortController();
        void cargar(ctrl.signal);
        return () => ctrl.abort();
    }, [cargar]);

    const abrirCon = (t?: TrabajoDeReporte) => {
        if (t) setTrabajo(t);
        setAbierto(true);
        if (estado === "error") void cargar();
    };

    // Los chips: primero los propios, después los compartidos, después los de ejemplo.
    const chips: { clave: string; texto: string; tipo: "mio" | "compartido" | "ejemplo"; abrir: () => void }[] = [
        ...guardados.filter((g) => g.disponible).map((g) => ({
            clave: `g${g.id}`,
            texto: g.nombre,
            tipo: g.es_mio ? "mio" as const : "compartido" as const,
            abrir: () => abrirCon(trabajoDesdeGuardado(g)),
        })),
        ...(catalogo?.ejemplos ?? []).map((e: Ejemplo) => ({
            clave: `e${e.codigo}`,
            texto: e.nombre,
            tipo: "ejemplo" as const,
            abrir: () => abrirCon(trabajoDesdeEjemplo(e)),
        })),
    ];

    return (
        <section
            className={cn(
                "relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f2742] via-[#1e3a5f] to-[#24466f] text-white shadow-[0_10px_30px_-12px_rgba(15,39,66,0.55)]",
                className,
            )}
            aria-labelledby="titulo-reportes"
        >
            {/* Los adornos van en su propia capa, del tamaño de la sección y recortada. Sueltos
                (con -right-8, -bottom-20...) agrandaban el área de scroll de la sección: un
                overflow-hidden igual se puede desplazar desde el código, y al abrir el popover
                de «Reporte mensual» el navegador la corría sola 32 px (scrollLeft = 32). */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
                {/* La marca de Metalúrgica Longchamps, grande y apagada, de fondo */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt=""
                     className="absolute -right-8 -top-6 hidden h-44 w-44 select-none object-contain opacity-[0.08] brightness-0 invert sm:block" />
                <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-[#DC143C]/20 blur-3xl" />
            </div>

            <div className="relative flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#DC143C] to-[#B8112E] shadow-lg">
                        <FileBarChart2 className="h-6 w-6 text-white" />
                    </div>
                    <div className="min-w-0">
                        <h2 id="titulo-reportes" className="text-lg font-bold sm:text-xl">Reportes</h2>
                        <p className="mt-0.5 max-w-xl text-sm text-white/70">
                            Armá el reporte que necesites —órdenes, horas por persona, consumos, no conformidades— con
                            tus columnas y filtros, y bajalo en PDF, Excel o CSV.
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                    {/* RF-21: acá va el botón «Reporte mensual» (lo pasa el Dashboard como children). */}
                    {children}
                    <button
                        type="button"
                        onClick={() => abrirCon()}
                        className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#1e3a5f] shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
                    >
                        <Sparkles className="h-4 w-4 text-[#DC143C]" />
                        Armar un reporte
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                </div>
            </div>

            {chips.length > 0 && (
                <div className="relative border-t border-white/10 bg-black/10 px-5 py-3 sm:px-6">
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                        {chips.map((c) => (
                            <button
                                key={c.clave}
                                type="button"
                                onClick={c.abrir}
                                className={cn(
                                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                    c.tipo === "ejemplo"
                                        ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white"
                                        : "border-white/30 bg-white/15 text-white hover:bg-white/25",
                                )}
                                title={c.tipo === "ejemplo" ? "Un reporte de ejemplo: abrilo, ajustalo y guardalo como tuyo" : undefined}
                            >
                                {c.tipo === "mio" && <BookmarkCheck className="h-3.5 w-3.5 text-[#ff8da1]" />}
                                {c.tipo === "compartido" && <Users className="h-3.5 w-3.5 text-[#ff8da1]" />}
                                {c.tipo === "ejemplo" && <Sparkles className="h-3.5 w-3.5 text-white/60" />}
                                {c.texto}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <ArmadorDeReportes
                abierto={abierto}
                onCerrar={() => setAbierto(false)}
                catalogo={catalogo}
                estadoCatalogo={estado}
                onReintentar={() => void cargar()}
                trabajo={trabajo}
                setTrabajo={setTrabajo}
                guardados={guardados}
                setGuardados={setGuardados}
            />
        </section>
    );
}

export default BloqueReportes;
