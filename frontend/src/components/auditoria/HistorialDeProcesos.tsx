"use client";

/**
 * Quién agregó, cambió o sacó cada paso de cada OT.
 *
 * Pedido de Julián (17/09): «auditoría de quién agregue, elimine o modifique cada
 * proceso en cada OT, siempre, en cualquier pantalla, con su usuario, hora y día bien
 * completo, por si hay dudas de que se duplican cosas y si lo agregó un usuario».
 *
 * El mismo componente se usa en los dos lugares donde hace falta, que son dos
 * preguntas distintas:
 *   · adentro de una orden (`idOrden`) — «este proceso está dos veces, ¿quién lo puso?»
 *   · en Auditoría, sin orden — «¿qué tocó Fulano esta semana?»
 *
 * POR QUÉ LA FECHA VA ENTERA
 *
 * El resto de la auditoría muestra «17/09 15:42» y alcanza. Acá no: dos pasadas del
 * mismo proceso agregadas en el mismo guardado caen en el mismo minuto, y cuál vino
 * antes es justamente lo que se viene a mirar. Por eso van los segundos y el año.
 */

import { useCallback, useEffect, useState } from "react";
import {
    AlertCircle, ArrowRight, Filter, Pencil, PlusCircle, Search, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface CambioDeCampo {
    campo: string;
    antes: string | null;
    despues: string | null;
}

export interface CambioDeProceso {
    id: number;
    cuando: string | null;
    usuario: string | null;
    origen: string | null;
    id_orden_trabajo: number;
    id_otp: number | null;
    id_proceso: number | null;
    nombre_proceso: string | null;
    accion: "alta" | "baja" | "edicion" | string;
    paso: number | null;
    cambios: CambioDeCampo[];
    descripcion: string;
}

const ICONO: Record<string, typeof PlusCircle> = {
    alta: PlusCircle,
    baja: Trash2,
    edicion: Pencil,
};

const COLOR: Record<string, string> = {
    alta: "text-emerald-600",
    baja: "text-rose-600",
    edicion: "text-sky-600",
};

const VERBO: Record<string, string> = {
    alta: "agregó",
    baja: "sacó",
    edicion: "cambió",
};

/** Día, mes, año y hora con segundos. Reloj de 24 h: «12:10 p. m.» parte el renglón. */
const fmtMomento = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const fecha = d.toLocaleDateString("es-AR", {
        weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
    });
    const hora = d.toLocaleTimeString("es-AR", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    return `${fecha} · ${hora}`;
};

const fmtDesde = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("es-AR", {
        day: "2-digit", month: "2-digit", year: "numeric",
    });
};

function Renglon({ c, mostrarOrden }: { c: CambioDeProceso; mostrarOrden: boolean }) {
    const Icono = ICONO[c.accion] ?? Pencil;
    return (
        // En pantalla angosta la fecha va abajo y no al costado: con los segundos y el
        // día de la semana, la columna derecha le dejaba dos palabras por renglón al
        // texto, que es lo que uno lee.
        <li className="flex flex-col sm:flex-row gap-1 sm:gap-3 px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/40">
            <Icono className={cn("h-4 w-4 mt-0.5 shrink-0", COLOR[c.accion] ?? "text-muted-foreground")} />

            <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">
                    <span className={cn("font-medium", !c.usuario && "italic text-muted-foreground")}>
                        {c.usuario ?? "El sistema"}
                    </span>{" "}
                    {VERBO[c.accion] ?? c.accion}{" "}
                    {c.paso ? <>el paso <span className="font-medium">{c.paso}</span></> : "un paso"}
                    {c.nombre_proceso && <> — <span className="font-medium">{c.nombre_proceso}</span></>}
                    {mostrarOrden && (
                        <span className="text-muted-foreground"> · OT #{c.id_orden_trabajo}</span>
                    )}
                </p>

                {c.cambios.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                        {c.cambios.map((cambio, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-foreground/70">{cambio.campo}:</span>
                                <span className="line-through opacity-70">{cambio.antes ?? "vacío"}</span>
                                <ArrowRight className="h-3 w-3 shrink-0" />
                                <span className="text-foreground">{cambio.despues ?? "vacío"}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-1 sm:text-right shrink-0 pl-7 sm:pl-0">
                {/* Completo a propósito: es el dato por el que se abre esta pantalla. */}
                <p className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {fmtMomento(c.cuando)}
                </p>
                {c.origen && (
                    <Badge variant="outline" className="text-[10px] font-normal whitespace-nowrap">
                        {c.origen}
                    </Badge>
                )}
            </div>
        </li>
    );
}

export function HistorialDeProcesos({ idOrden }: { idOrden?: number }) {
    const [cambios, setCambios] = useState<CambioDeProceso[]>([]);
    const [desde, setDesde] = useState<string | null>(null);
    const [tope, setTope] = useState(300);
    const [cargando, setCargando] = useState(true);
    // Distinto de `cargando`: si el spinner tapara toda la pantalla en cada recarga,
    // escribir en el buscador haría desaparecer el buscador y perder el foco a mitad
    // de la palabra.
    const [yaCargo, setYaCargo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [texto, setTexto] = useState("");
    const [accion, setAccion] = useState<string | null>(null);

    /**
     * Los filtros los aplica el SERVIDOR, no el navegador.
     *
     * Filtrando sobre lo que ya se trajo, la búsqueda sólo miraba las últimas 300
     * filas, y acá cada paso tocado deja la suya: una corrida del planificador
     * escribe cientos de una. Buscar a alguien por su nombre contestaba «no hay nada»
     * cuando lo que pasaba es que sus cambios estaban más atrás del corte.
     */
    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (idOrden) params.set("id_orden", String(idOrden));
            if (accion) params.set("accion", accion);
            if (texto.trim()) params.set("buscar", texto.trim());
            const res = await fetch(
                `${API_URL.replace(/\/$/, "")}/auditoria/procesos?${params}`,
                { headers: getAuthHeaders() },
            );
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setCambios(Array.isArray(data?.cambios) ? data.cambios : []);
            setDesde(data?.desde ?? null);
            setTope(typeof data?.tope === "number" ? data.tope : 300);
        } catch {
            setError("No se pudo cargar el historial. Probá actualizar.");
        } finally {
            setCargando(false);
            setYaCargo(true);
        }
    }, [idOrden, accion, texto]);

    // Un respiro antes de pedir, para no disparar una consulta por tecla.
    useEffect(() => {
        const t = setTimeout(cargar, texto ? 300 : 0);
        return () => clearTimeout(t);
    }, [cargar, texto]);

    const filtrados = cambios;

    if (!yaCargo) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
                <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={cargar}>
                    Reintentar
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        placeholder={idOrden ? "Buscar un proceso o una persona…" : "Buscar por proceso, persona o N° de OT…"}
                        className="pl-8 h-8 text-sm"
                    />
                    {texto && (
                        <button
                            type="button"
                            onClick={() => setTexto("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {/* `type="button"` en TODOS, y no es un detalle: esto se monta adentro del
                    <form> de la orden, así que sin eso cada filtro dispara el guardado de
                    la OT —y el Enter en el buscador clickea el primer submit del form, que
                    sería la X. Mirar el historial no puede guardar nada. */}
                <div className="flex items-center gap-1">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
                    {(["alta", "edicion", "baja"] as const).map((a) => (
                        <Button
                            key={a}
                            type="button"
                            variant={accion === a ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setAccion(accion === a ? null : a)}
                        >
                            {a === "alta" ? "Agregados" : a === "baja" ? "Sacados" : "Cambiados"}
                        </Button>
                    ))}
                </div>
            </div>

            {filtrados.length === 0 ? (
                <div className="text-center py-10 px-4 text-sm text-muted-foreground">
                    {cambios.length === 0 ? (
                        <>
                            {/* «No hay registro» y «no se tocó nada» NO son lo mismo, y
                                confundirlos acá da la conclusión opuesta a la correcta:
                                los scripts que corren contra la base (migraciones,
                                arreglos de datos) mueven pasos sin dejar renglón, así que
                                una lista vacía no prueba que nadie tocó nada. */}
                            <p>
                                {idOrden
                                    ? "No hay ningún cambio registrado en los pasos de esta orden."
                                    : "No hay ningún cambio registrado todavía."}
                            </p>
                            <p className="mt-1 text-xs">
                                {desde
                                    ? `Hay registro desde el ${fmtDesde(desde)}. Lo anterior a esa fecha, y lo que se cambie por fuera del sistema, no queda acá.`
                                    : "Los pasos que ya estaban vinieron del sistema viejo: de esos no se guardó quién los cargó."}
                            </p>
                        </>
                    ) : (
                        <p>No hay nada que coincida con lo que buscaste.</p>
                    )}
                </div>
            ) : (
                <>
                    <ul className={cn("border rounded-md overflow-hidden bg-background",
                        cargando && "opacity-60")}>
                        {filtrados.map((c) => (
                            <Renglon key={c.id} c={c} mostrarOrden={!idOrden} />
                        ))}
                    </ul>
                    <p className="text-xs text-muted-foreground px-1">
                        {/* Que el corte se vea: sin esto, «no está» y «está más atrás
                            del tope» se leen igual. */}
                        {cambios.length >= tope
                            ? `Se están viendo los ${tope} cambios más nuevos; si buscás algo más viejo, puede quedar afuera del corte. `
                            : ""}
                        {desde && `Hay registro desde el ${fmtDesde(desde)}; los pasos cargados antes vinieron del sistema viejo y no tienen autor guardado.`}
                    </p>
                </>
            )}
        </div>
    );
}
