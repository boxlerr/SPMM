"use client";

/**
 * TODO lo que alguien creó, editó o eliminó en el sistema.
 *
 * Pedido de Julián (15/09): «log en auditoría de cada cosa que se haga, se agregue,
 * edite o elimine de TODO». Hasta hoy la pantalla de Auditoría mostraba UNA sola
 * cosa —los intentos de planificar— y nada más. Borrar una persona, cambiarle los
 * minutos a un proceso o tocar una OT no dejaba rastro en ningún lado, y con el
 * taller ya cargando los datos de verdad «¿quién cambió esto?» no tenía respuesta.
 *
 * CÓMO SE LEE
 *
 * Una frase por renglón, en castellano: «Lucas eliminó persona #5». Nada de PUT,
 * DELETE ni rutas — eso está adentro, para el día que la frase no alcance. Misma
 * regla que se aplicó a los avisos de pre-planificación: tiene que entenderse de
 * una pasada, sin leer dos veces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ChevronDown, ChevronRight, Filter, PlusCircle, Pencil, Trash2,
    AlertCircle, Clock, User, Search, X, Lock, LockOpen,
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

export interface Movimiento {
    id: number;
    cuando: string | null;
    usuario: string | null;
    accion: string;
    entidad: string;
    id_entidad: string | null;
    descripcion: string;
    metodo: string;
    ruta: string;
    estado: number | null;
    salio_bien: boolean;
    duracion_ms: number | null;
    detalle: string | null;
}

// «bloqueó» / «desbloqueó» son del RF-26: una cuenta que quedó bloqueada por 5
// contraseñas malas seguidas (sin autor: lo decidió el sistema) y el admin que la
// destrabó. Cualquier acción que no esté acá se muestra con el lápiz gris.
const ICONO: Record<string, typeof PlusCircle> = {
    "creó": PlusCircle,
    "editó": Pencil,
    "eliminó": Trash2,
    "bloqueó": Lock,
    "desbloqueó": LockOpen,
};

const COLOR: Record<string, string> = {
    "creó": "text-emerald-600",
    "editó": "text-sky-600",
    "eliminó": "text-rose-600",
    "bloqueó": "text-amber-600",
    "desbloqueó": "text-emerald-600",
};

// Reloj de 24 horas a propósito: con `hour12` el es-AR escribe «12:10 p. m.», que en
// una columna angosta se parte en dos renglones y desalinea la lista entera.
const fmtFecha = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
};

/**
 * El detalle crudo, sólo si alguien lo abre.
 *
 * Es JSON y se ve como JSON a propósito: no es para el taller, es para cuando hay
 * que reconstruir qué se mandó exactamente. La frase de arriba es la versión que se
 * lee; esto es la prueba.
 */
function Detalle({ m }: { m: Movimiento }) {
    let bonito = m.detalle;
    try {
        if (m.detalle) bonito = JSON.stringify(JSON.parse(m.detalle), null, 2);
    } catch {
        /* si quedó cortado por el tope, se muestra tal cual */
    }
    return (
        <div className="px-3 sm:px-4 pb-3 pl-9 sm:pl-11 space-y-2 text-sm">
            {/* `break-all`: la ruta es una sola palabra larga (/ordenes-trabajo/123/procesos…)
                y en un teléfono no tenía dónde cortarse, así que empujaba la pantalla. */}
            <p className="text-xs text-muted-foreground font-mono break-all">
                {m.metodo} {m.ruta}
                {m.estado != null && ` → ${m.estado}`}
                {m.duracion_ms != null && ` · ${m.duracion_ms} ms`}
            </p>
            {bonito ? (
                <pre className="text-xs bg-muted/50 border rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap max-h-64">
                    {bonito}
                </pre>
            ) : (
                <p className="text-xs text-muted-foreground italic">
                    Sin datos guardados. Las contraseñas y los archivos nunca se copian acá.
                </p>
            )}
        </div>
    );
}

export function RegistroDeMovimientos() {
    const [movs, setMovs] = useState<Movimiento[]>([]);
    const [entidades, setEntidades] = useState<{ entidad: string; cuantos: number }[]>([]);
    const [usuarios, setUsuarios] = useState<string[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [abierto, setAbierto] = useState<number | null>(null);

    // Los filtros se aplican acá, en el navegador, sobre lo último que trajo el
    // backend: son 300 renglones y filtrar sin ir y volver hace que se sienta
    // instantáneo. El backend igual sabe filtrar, para cuando haya que ir más atrás.
    const [queEntidad, setQueEntidad] = useState<string | null>(null);
    const [queAccion, setQueAccion] = useState<string | null>(null);
    const [quien, setQuien] = useState<string | null>(null);
    const [texto, setTexto] = useState("");
    const [soloFallidos, setSoloFallidos] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL.replace(/\/$/, "")}/auditoria/movimientos?limite=300`, {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setMovs(Array.isArray(data?.movimientos) ? data.movimientos : []);
            setEntidades(Array.isArray(data?.entidades) ? data.entidades : []);
            setUsuarios(Array.isArray(data?.usuarios) ? data.usuarios : []);
        } catch {
            setError("No se pudo cargar el registro. Probá actualizar.");
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const visibles = useMemo(() => {
        const buscado = texto.trim().toLowerCase();
        return movs.filter((m) => {
            if (queEntidad && !m.entidad.startsWith(queEntidad)) return false;
            if (queAccion && m.accion !== queAccion) return false;
            if (quien && m.usuario !== quien) return false;
            if (soloFallidos && m.salio_bien) return false;
            if (buscado && !m.descripcion.toLowerCase().includes(buscado)) return false;
            return true;
        });
    }, [movs, queEntidad, queAccion, quien, texto, soloFallidos]);

    const hayFiltro = queEntidad || queAccion || quien || texto || soloFallidos;
    const fallidos = movs.filter((m) => !m.salio_bien).length;

    const limpiar = () => {
        setQueEntidad(null); setQueAccion(null); setQuien(null);
        setTexto(""); setSoloFallidos(false);
    };

    if (cargando) {
        return (
            <div className="flex items-center justify-center py-16">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {error && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                </div>
            )}

            {/* Filtros. Las entidades salen de los datos, así que una pantalla nueva
                aparece sola en la lista sin tocar este archivo. */}
            <div className="rounded-lg border bg-card p-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={texto}
                            onChange={(e) => setTexto(e.target.value)}
                            placeholder="Buscar: un nombre, un número de OT…"
                            className="pl-8 h-9"
                        />
                    </div>
                    {(["creó", "editó", "eliminó"] as const).map((a) => {
                        const Icono = ICONO[a];
                        const activo = queAccion === a;
                        return (
                            <Button
                                key={a}
                                variant={activo ? "default" : "outline"}
                                size="sm"
                                onClick={() => setQueAccion(activo ? null : a)}
                                className="h-9"
                            >
                                <Icono className={cn("h-4 w-4 mr-1.5", !activo && COLOR[a])} />
                                {a.charAt(0).toUpperCase() + a.slice(1)}
                            </Button>
                        );
                    })}
                    {fallidos > 0 && (
                        <Button
                            variant={soloFallidos ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSoloFallidos(!soloFallidos)}
                            className="h-9"
                            title="Lo que alguien intentó hacer y no se pudo"
                        >
                            <AlertCircle className={cn("h-4 w-4 mr-1.5", !soloFallidos && "text-amber-600")} />
                            No se pudo ({fallidos})
                        </Button>
                    )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
                    {entidades.slice(0, 14).map(({ entidad, cuantos }) => (
                        <button
                            key={entidad}
                            type="button"
                            onClick={() => setQueEntidad(queEntidad === entidad ? null : entidad)}
                            className={cn(
                                "text-xs px-2 py-1 rounded-full border transition-colors",
                                queEntidad === entidad
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "hover:bg-muted text-muted-foreground"
                            )}
                        >
                            {entidad} <span className="tabular-nums opacity-60">{cuantos}</span>
                        </button>
                    ))}
                    {usuarios.length > 1 && usuarios.map((u) => (
                        <button
                            key={u}
                            type="button"
                            onClick={() => setQuien(quien === u ? null : u)}
                            className={cn(
                                "text-xs px-2 py-1 rounded-full border transition-colors inline-flex items-center gap-1",
                                quien === u
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "hover:bg-muted text-muted-foreground"
                            )}
                        >
                            <User className="h-3 w-3" />
                            {u}
                        </button>
                    ))}
                    {hayFiltro && (
                        <Button variant="ghost" size="sm" onClick={limpiar} className="h-7 text-xs">
                            <X className="h-3 w-3 mr-1" />
                            Ver todo
                        </Button>
                    )}
                </div>
            </div>

            <section className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                        {hayFiltro ? `${visibles.length} de ${movs.length}` : `Últimos ${movs.length}`} movimientos
                    </h2>
                    {movs.length >= 300 && (
                        <span className="text-xs text-muted-foreground">
                            se muestran los 300 más recientes
                        </span>
                    )}
                </div>

                {visibles.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        {movs.length === 0 ? (
                            <>
                                Todavía no hay nada registrado. Desde ahora, cada vez que alguien
                                cargue, edite o borre algo queda acá: quién, cuándo y qué.
                            </>
                        ) : (
                            <>Ningún movimiento coincide con lo que estás buscando.</>
                        )}
                    </p>
                ) : (
                    <ul className="divide-y">
                        {visibles.map((m) => {
                            const Icono = ICONO[m.accion] ?? Pencil;
                            const activo = abierto === m.id;
                            return (
                                <li key={m.id}>
                                    <button
                                        type="button"
                                        onClick={() => setAbierto(activo ? null : m.id)}
                                        className={cn(
                                            "w-full px-3 sm:px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 text-left transition-colors",
                                            activo ? "bg-muted/40" : "hover:bg-muted/30"
                                        )}
                                    >
                                        <Icono className={cn("h-4 w-4 shrink-0", COLOR[m.accion] ?? "text-muted-foreground")} />
                                        <span className="text-sm tabular-nums text-muted-foreground shrink-0 w-[5.5rem]">
                                            {fmtFecha(m.cuando)}
                                        </span>
                                        {/* La frase entera, que es lo único que hay que leer.
                                            En el teléfono (RF-27) va en su propio renglón, abajo
                                            de la fecha y a todo el ancho: al lado de la fecha y
                                            del reloj le quedaban 90px y se leía una palabra por
                                            renglón. Desde `sm`, en la fila y cortada, como antes. */}
                                        <span className={cn(
                                            "text-sm min-w-0 break-words order-last basis-full pl-7 sm:order-none sm:basis-auto sm:pl-0 sm:truncate",
                                            m.salio_bien ? "text-gray-700" : "text-rose-700"
                                        )}>
                                            {m.descripcion}
                                        </span>
                                        <span className="flex-1" />
                                        {/* La frase ya dice «no se pudo»; el cartel agrega
                                            el código, que es lo único que ella no tiene. */}
                                        {!m.salio_bien && (
                                            <Badge variant="outline" className="text-xs font-normal shrink-0 border-rose-200 text-rose-700">
                                                error {m.estado}
                                            </Badge>
                                        )}
                                        {m.duracion_ms != null && m.duracion_ms > 3000 && (
                                            <span className="flex items-center gap-1 text-xs text-amber-600 tabular-nums shrink-0"
                                                  title="Tardó más de 3 segundos">
                                                <Clock className="h-3 w-3" />
                                                {(m.duracion_ms / 1000).toFixed(1)} s
                                            </span>
                                        )}
                                        {activo ? (
                                            <ChevronDown className="h-4 w-4 opacity-40 shrink-0" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4 opacity-40 shrink-0" />
                                        )}
                                    </button>
                                    {activo && <Detalle m={m} />}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
