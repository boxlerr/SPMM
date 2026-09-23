"use client";

/**
 * Auditoría › «Por persona» (RF-17): elegir a alguien del taller y ver su línea de
 * tiempo, lo último primero — los cambios en su ficha, sus habilidades y rangos, sus
 * ausencias (RF-06), a qué pasos lo asignaron y quién, qué pasos arrancó y terminó, las
 * pausas de esos pasos y las no conformidades en las que figura—.
 *
 * Es la persona del taller (Recursos › Recurso humano), no el usuario que entra al
 * sistema: lo que hizo cada usuario está en «Actividad por persona». Julián lo pidió en
 * Auditoría y no en la ficha de la persona: por eso se elige acá.
 *
 * Lo estimado contra lo que llevó cada paso sale sólo con la sección confidencial
 * «Rendimiento por persona»; sin ella, el servidor no lo manda y la pantalla lo dice.
 * Tocar una OT de la línea de tiempo la abre en «Por orden».
 *
 * Los legajos con archivos (documentos por persona) no están: van en la v2 (Módulo J).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Info, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { PeriodoAuditoria } from "@/lib/auditoria";
import {
    HistorialNoDisponible,
    NoExiste,
    buscarPersonas,
    historialDePersona,
    type HistorialDePersona,
    type PersonaDelHistorial,
} from "@/lib/historial";
import { VistaDeHistorial } from "@/components/auditoria/LineaDeTiempo";

type Estado = "cargando" | "listo" | "error" | "no-disponible" | "no-existe";

/** Sin tildes ni mayúsculas: «perez» encuentra a «Pérez». */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function AvisoNoDisponible() {
    return (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
            El historial de cada persona llega con la próxima actualización del servidor.
        </p>
    );
}

export function HistorialPorPersona({ refresco, onVerOT }: {
    refresco: number;
    /** Tocar una OT de la línea de tiempo: la abre en «Por orden». */
    onVerOT: (ot: { id: number; numero: number }) => void;
}) {
    // ── la lista de personas (son pocas: se trae entera y se filtra acá) ──
    const [personas, setPersonas] = useState<PersonaDelHistorial[] | null>(null);
    const [texto, setTexto] = useState("");
    const [disponible, setDisponible] = useState(true);
    const [errorLista, setErrorLista] = useState(false);

    useEffect(() => {
        const c = new AbortController();
        buscarPersonas(c.signal)
            .then((r) => {
                if (!c.signal.aborted) {
                    setPersonas(r);
                    setErrorLista(false);
                }
            })
            .catch((e) => {
                if (c.signal.aborted) return;
                if (e instanceof HistorialNoDisponible) setDisponible(false);
                else setErrorLista(true);
            });
        return () => c.abort();
    }, [refresco]);

    const filtradas = useMemo(() => {
        const buscado = normalizar(texto.trim());
        const lista = personas ?? [];
        return buscado ? lista.filter((p) => normalizar(p.nombre).includes(buscado)) : lista;
    }, [personas, texto]);

    // ── la persona elegida ──
    const [elegida, setElegida] = useState<PersonaDelHistorial | null>(null);
    const [periodo, setPeriodo] = useState<PeriodoAuditoria>({ clave: "30d" });
    const [datos, setDatos] = useState<HistorialDePersona | null>(null);
    const [estado, setEstado] = useState<Estado>("cargando");
    const [actualizando, setActualizando] = useState(false);

    const cargar = useCallback(async (id: number, p: PeriodoAuditoria, senal: AbortSignal) => {
        setActualizando(true);
        try {
            const r = await historialDePersona(id, p, senal);
            if (senal.aborted) return;
            setDatos(r);
            setEstado("listo");
        } catch (e) {
            if (senal.aborted) return;
            if (e instanceof HistorialNoDisponible) setEstado("no-disponible");
            else if (e instanceof NoExiste) setEstado("no-existe");
            else setEstado((s) => (s === "listo" ? "listo" : "error"));
        } finally {
            if (!senal.aborted) setActualizando(false);
        }
    }, []);

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

    if (elegida) {
        const p = datos?.persona ?? elegida;
        return (
            <div className="space-y-3">
                <div className="rounded-lg border bg-card px-3 sm:px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold flex flex-wrap items-center gap-2 break-words">
                            {p.nombre}
                            {!p.activo && (
                                <Badge variant="outline" className="text-xs font-normal border-amber-200 text-amber-700">
                                    Ausente
                                </Badge>
                            )}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {[p.categoria, p.sector].filter(Boolean).join(" · ") || "Sin categoría"}
                        </p>
                    </div>
                    <Button variant="outline" size="sm" className="self-start shrink-0" onClick={() => setElegida(null)}>
                        <ArrowLeft className="h-4 w-4 mr-1.5" />
                        Elegir otra persona
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
                        {p.nombre} ya no está cargada en Recursos.
                    </p>
                )}
                {estado === "error" && !datos && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                        No se pudo cargar el historial. Probá actualizar.
                    </div>
                )}
                {datos && estado === "listo" && (
                    <VistaDeHistorial
                        key={p.id}
                        datos={datos}
                        actualizando={actualizando}
                        periodo={periodo}
                        onPeriodo={setPeriodo}
                        tituloExport={`Auditoría · Historial de ${p.nombre}`}
                        archivoExport={`auditoria_persona_${p.nombre.replace(/\s+/g, "_").toLowerCase()}`}
                        filtrosExport={[`Persona: ${p.nombre}${p.categoria ? ` (${p.categoria})` : ""}`]}
                        onVerOT={onVerOT}
                        vacio="No hay nada de esta persona en este período."
                    />
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                Elegí a alguien del taller para ver su historia: cambios en su ficha, habilidades y rangos,
                ausencias, a qué pasos lo asignaron, qué trabajó, las pausas de sus pasos y las no conformidades
                en las que figura.
            </p>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="Buscar por nombre o apellido"
                    aria-label="Buscar una persona"
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
                <div className="px-4 py-2.5 border-b bg-muted/40">
                    <h3 className="text-sm font-semibold">
                        {personas ? `${filtradas.length} ${filtradas.length === 1 ? "persona" : "personas"}` : "Personas"}
                    </h3>
                </div>
                {errorLista && !personas ? (
                    <p className="px-4 py-8 text-center text-sm text-rose-700">No se pudo cargar la lista. Probá actualizar.</p>
                ) : personas === null ? (
                    <div className="flex items-center justify-center py-10"><Spinner className="h-6 w-6" /></div>
                ) : filtradas.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                        {texto.trim() ? `Nadie coincide con «${texto.trim()}».` : "No hay personas cargadas."}
                    </p>
                ) : (
                    <ul className="divide-y">
                        {filtradas.map((p) => (
                            <li key={p.id}>
                                <button
                                    type="button"
                                    onClick={() => setElegida(p)}
                                    className="w-full px-3 sm:px-4 py-2 flex items-center gap-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/40"
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm text-gray-800 truncate">{p.nombre}</span>
                                        <span className="block text-xs text-muted-foreground truncate">
                                            {[p.categoria, p.sector].filter(Boolean).join(" · ") || "Sin categoría"}
                                        </span>
                                    </span>
                                    {!p.activo && (
                                        <Badge variant="outline" className="text-[10px] font-normal border-amber-200 text-amber-700 shrink-0">
                                            Ausente
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
