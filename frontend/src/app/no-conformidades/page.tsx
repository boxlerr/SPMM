"use client";

/**
 * No conformidades.
 *
 * Lo que el SRS pide (RF-12) es poder sacar el reporte de no conformidades y que cada
 * una quede pegada a su orden. Las dos cosas existían a medias: se cargaban desde un
 * iconito adentro del planificador y se veían como tres números en el tablero. No había
 * dónde pararse a mirarlas todas, ni forma de filtrarlas, ni de bajarlas.
 *
 * Tres decisiones de esta pantalla:
 *
 *  · Lo que nadie evaluó dice «Sin clasificar», no «Media». Las que se cargaron antes
 *    de que existiera el campo no tienen gravedad, y ponerles una sería inventar un
 *    juicio que nadie hizo. Además se pueden filtrar, que es como se encuentran las que
 *    hay que ir a completar.
 *  · No se borra nada: se cierra. Un registro de calidad que se puede borrar no sirve
 *    como registro. Cerrar deja la fecha y lo que se hizo.
 *  · La descarga va con fetch y blob, no con un `<a href>`: la dirección pide token y
 *    un link pelado se come un 401 (mismo camino que la descarga de planos).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    AlertTriangle, CheckCircle2, Download, FileWarning, Filter, RefreshCw,
    RotateCcw, Search, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { usePermisos } from "@/hooks/usePermisos";
import { MarcaSoloLectura } from "@/components/permisos/SinAcceso";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface NoConformidad {
    id: number;
    id_orden_trabajo: number;
    nro_ot: number | null;
    cliente: string | null;
    producto: string | null;
    proceso: string | null;
    operario: string | null;
    tipo: string;
    /** null = nadie la evaluó todavía. */
    gravedad: string | null;
    estado: string;
    piezas_afectadas: number | null;
    minutos_perdidos: number;
    operarios_extra: number;
    descripcion: string | null;
    accion_correctiva: string | null;
    usuario: string | null;
    fecha_registro: string;
    fecha_cierre: string | null;
}

interface Resumen {
    total: number;
    abiertas: number;
    cerradas: number;
    minutos_perdidos: number;
    piezas_afectadas: number;
}

type Listas = Record<string, string>;

const SIN_CLASIFICAR = "SIN_CLASIFICAR";

const COLOR_GRAVEDAD: Record<string, string> = {
    LEVE: "bg-sky-50 text-sky-700 border-sky-200",
    MEDIA: "bg-amber-50 text-amber-700 border-amber-200",
    GRAVE: "bg-rose-50 text-rose-700 border-rose-200",
};

const fmtFecha = (iso: string | null) =>
    iso
        ? new Date(iso).toLocaleString("es-AR", {
              day: "2-digit", month: "2-digit", year: "2-digit",
              hour: "2-digit", minute: "2-digit",
          })
        : "—";

const fmtHoras = (min: number) => {
    if (!min) return "—";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m} min`;
};

export default function NoConformidadesPage() {
    // RF-24: clasificarlas, anotar qué se hizo y cerrarlas pide el área en escritura.
    // Con lectura sola se ven igual, pero el panel muestra lo cargado sin botones.
    const { puede } = usePermisos();
    const puedeEditar = puede("no_conformidades", "write");
    const [filas, setFilas] = useState<NoConformidad[]>([]);
    const [resumen, setResumen] = useState<Resumen | null>(null);
    const [hayMas, setHayMas] = useState(false);
    const [tipos, setTipos] = useState<Listas>({});
    const [gravedades, setGravedades] = useState<Listas>({});
    const [estados, setEstados] = useState<Listas>({});
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /**
     * El servidor todavía no tiene el reporte. Va aparte de `error` porque no se
     * arregla reintentando: el front sale por Vercel con cada push y el backend se
     * deploya a mano, así que hay un rato en el que esta pantalla ya está publicada y
     * el servidor contesta 404. Decir «probá en unos segundos» en ese rato, con un
     * «todavía no se registró ninguna» abajo, hacía creer que se habían perdido.
     */
    const [sinServidor, setSinServidor] = useState(false);
    const [bajando, setBajando] = useState(false);

    // Filtros
    const [ot, setOt] = useState("");
    const [tipo, setTipo] = useState<string | null>(null);
    const [gravedad, setGravedad] = useState<string | null>(null);
    const [estado, setEstado] = useState<string | null>(null);
    const [desde, setDesde] = useState("");
    const [hasta, setHasta] = useState("");

    // Qué fila está abierta para completarla o cerrarla.
    const [abierta, setAbierta] = useState<number | null>(null);

    const queryFiltros = useMemo(() => {
        const p = new URLSearchParams();
        // El campo dice «N° de OT» y la gente escribe el número que ve: el de la orden,
        // que en la base es `id_otvieja`. Por eso se busca por el número visible y el
        // backend resuelve contra la orden, no contra el id interno.
        if (ot.trim()) p.set("nro_ot", ot.trim());
        if (tipo) p.set("tipo", tipo);
        if (gravedad) p.set("gravedad", gravedad);
        if (estado) p.set("estado", estado);
        if (desde) p.set("desde", desde);
        if (hasta) p.set("hasta", hasta);
        return p.toString();
    }, [ot, tipo, gravedad, estado, desde, hasta]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/incidencias/reporte?${queryFiltros}`, {
                headers: getAuthHeaders(),
            });
            // 404/405 es el servidor anterior, que no conoce la ruta: el nuevo no
            // contesta 404 en el reporte (sin coincidencias devuelve la lista vacía).
            // Mismo criterio que la materia prima y el consumo de la OT.
            if (res.status === 404 || res.status === 405) {
                setSinServidor(true);
                setFilas([]);
                setResumen(null);
                setHayMas(false);
                return;
            }
            if (!res.ok) throw new Error(String(res.status));
            const json = await res.json();
            const data = json.data ?? {};
            setSinServidor(false);
            setFilas(data.no_conformidades ?? []);
            setResumen(data.resumen ?? null);
            setHayMas(!!data.hay_mas);
            setTipos(data.tipos ?? {});
            setGravedades(data.gravedades ?? {});
            setEstados(data.estados ?? {});
        } catch (e) {
            console.error(e);
            // Se vacía lo de antes: si no, debajo del cartel quedaban a la vista las
            // filas del filtro ANTERIOR como si fueran las del que se acaba de pedir.
            setFilas([]);
            setResumen(null);
            setHayMas(false);
            // Cada respuesta dice lo suyo: si antes fue un 404 y ahora es otra falla, el
            // cartel de «falta actualizar» ya no es lo que pasa, y los dos juntos no se
            // entienden.
            setSinServidor(false);
            setError("No se pudo traer la lista. Probá de nuevo en unos segundos.");
        } finally {
            setCargando(false);
        }
    }, [queryFiltros]);

    useEffect(() => {
        // Un respiro antes de pedir: si no, escribir «7015» en el número de OT dispara
        // cuatro consultas, una por tecla.
        const t = setTimeout(cargar, 250);
        return () => clearTimeout(t);
    }, [cargar]);

    /** Se baja con fetch porque la dirección pide token; un link pelado da 401. */
    const descargar = async () => {
        setBajando(true);
        try {
            const res = await fetch(`${API_URL}/incidencias/reporte.csv?${queryFiltros}`, {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            try {
                const a = document.createElement("a");
                a.href = url;
                a.download = "no-conformidades.csv";
                document.body.appendChild(a);
                a.click();
                a.remove();
            } finally {
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
            }
        } catch (e) {
            console.error(e);
            toast.error("No se pudo bajar el archivo");
        } finally {
            setBajando(false);
        }
    };

    /**
     * Guardar un cambio de una fila sin recargar la pantalla.
     *
     * Se pisa la fila con lo que contestó el servidor: si algo falla, la lista queda
     * como estaba y el error se dice en un aviso. Recargar todo movería el scroll y
     * cerraría lo que la persona tenía abierto.
     */
    const guardar = async (id: number, ruta: string, cuerpo: Record<string, unknown>) => {
        try {
            const res = await fetch(`${API_URL}/incidencias/${id}${ruta}`, {
                method: "PUT",
                headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
                body: JSON.stringify(cuerpo),
            });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.errors?.[0]?.message || String(res.status));
            const guardada = json?.data ?? {};
            setFilas((previas) => previas.map((f) => (f.id === id ? { ...f, ...guardada } : f)));
            // El encabezado cuenta abiertas y cerradas: sin esto diría lo de antes.
            setResumen((r) => {
                if (!r || guardada.estado === undefined) return r;
                const anterior = filas.find((f) => f.id === id);
                if (!anterior || anterior.estado === guardada.estado) return r;
                const cerro = guardada.estado === "CERRADA";
                return {
                    ...r,
                    abiertas: r.abiertas + (cerro ? -1 : 1),
                    cerradas: r.cerradas + (cerro ? 1 : -1),
                };
            });
            return true;
        } catch (e) {
            console.error(e);
            toast.error(e instanceof Error ? e.message : "No se pudo guardar");
            return false;
        }
    };

    const limpiar = () => {
        setOt(""); setTipo(null); setGravedad(null); setEstado(null);
        setDesde(""); setHasta("");
    };
    const hayFiltros = !!(ot || tipo || gravedad || estado || desde || hasta);

    return (
        // Márgenes chicos en el teléfono (RF-27): el layout ya pone los suyos, y sumados
        // a estos se llevaban 56px de los 375.
        <div className="container mx-auto py-4 sm:py-8 px-1 sm:px-4 max-w-6xl">
            {/* `pr-12` abajo de `lg`: la campana de avisos flota arriba a la derecha
                (Topbar) y, con los márgenes más chicos del teléfono, el título largo y los
                botones le quedaban justo debajo. Desde `lg` hay aire de sobra. */}
            <div className="flex items-start justify-between gap-3 mb-6 flex-wrap pr-12 lg:pr-0">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex flex-wrap items-center gap-2">
                        <FileWarning className="h-6 w-6 sm:h-7 sm:w-7 text-amber-600 shrink-0" />
                        No conformidades
                        {!puedeEditar && <MarcaSoloLectura que="las no conformidades" />}
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Todo lo que salió mal en una orden: qué pasó, qué tan grave fue, cuántas piezas
                        se llevó puestas y si ya se resolvió. Cada una queda pegada a su orden.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
                        <RefreshCw className={cn("h-4 w-4 mr-2", cargando && "animate-spin")} />
                        Actualizar
                    </Button>
                    <Button size="sm" onClick={descargar} disabled={bajando || !filas.length}>
                        <Download className="h-4 w-4 mr-2" />
                        {bajando ? "Bajando…" : "Descargar"}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                </div>
            )}

            {sinServidor && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p className="font-medium">
                        Esta lista todavía no está disponible: falta actualizar el servidor.
                    </p>
                    <p className="mt-1">
                        No se perdió nada: las no conformidades ya cargadas siguen guardadas y
                        aparecen acá apenas se actualice.
                    </p>
                </div>
            )}

            {/* Filtros. Sin el reporte en el servidor no hay nada que filtrar: de los chips
                quedaba sólo «Sin clasificar», porque los demás vienen con la respuesta. */}
            {!sinServidor && (
                <div className="rounded-lg border bg-card p-3 space-y-3 mb-4">
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative w-40">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={ot}
                                onChange={(e) => setOt(e.target.value.replace(/\D/g, ""))}
                                placeholder="N° de OT"
                                inputMode="numeric"
                                className="pl-8 h-9"
                            />
                        </div>
                        {/* Cada rótulo envuelve su fecha: así, cuando la fila no entra (en el
                            teléfono no entra), «Desde» baja de renglón JUNTO con su campo. Sueltos,
                            el rótulo quedaba al final de un renglón y la fecha al principio del
                            otro, y no se sabía cuál era cuál. */}
                        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            Desde
                            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                                   className="h-9 w-40" />
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            Hasta
                            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                                   className="h-9 w-40" />
                        </label>
                        {hayFiltros && (
                            <Button variant="ghost" size="sm" className="h-9" onClick={limpiar}>
                                Limpiar filtros
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Filter className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
                        {Object.entries(estados).map(([clave, rotulo]) => (
                            <Chip key={clave} activo={estado === clave}
                                  onClick={() => setEstado(estado === clave ? null : clave)}>
                                {rotulo}
                            </Chip>
                        ))}
                        <span className="mx-1 h-4 w-px bg-border" />
                        {Object.entries(gravedades).map(([clave, rotulo]) => (
                            <Chip key={clave} activo={gravedad === clave}
                                  onClick={() => setGravedad(gravedad === clave ? null : clave)}>
                                {rotulo}
                            </Chip>
                        ))}
                        {/* No es una gravedad más: es «nadie la evaluó todavía», y es el filtro
                            con el que se encuentra lo que hay que ir a completar. */}
                        <Chip activo={gravedad === SIN_CLASIFICAR}
                              onClick={() => setGravedad(gravedad === SIN_CLASIFICAR ? null : SIN_CLASIFICAR)}>
                            Sin clasificar
                        </Chip>
                        <span className="mx-1 h-4 w-px bg-border" />
                        {Object.entries(tipos).map(([clave, rotulo]) => (
                            <Chip key={clave} activo={tipo === clave}
                                  onClick={() => setTipo(tipo === clave ? null : clave)}>
                                {rotulo}
                            </Chip>
                        ))}
                    </div>
                </div>
            )}

            {/* Resumen */}
            {resumen && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                    <Tarjeta titulo="No conformidades" valor={String(resumen.total)} />
                    <Tarjeta titulo="Abiertas" valor={String(resumen.abiertas)} tono="text-amber-600" />
                    <Tarjeta titulo="Cerradas" valor={String(resumen.cerradas)} tono="text-emerald-600" />
                    <Tarjeta titulo="Tiempo perdido" valor={fmtHoras(resumen.minutos_perdidos)} tono="text-rose-600" />
                    <Tarjeta titulo="Piezas afectadas" valor={String(resumen.piezas_afectadas)} />
                </div>
            )}

            {hayMas && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                    Estás viendo las más nuevas: hay más de las que entran en la pantalla. Achicá el
                    rango de fechas o filtrá por orden para verlas todas.
                </div>
            )}

            {/* Si falló el pedido, lo que hay arriba es el cartel y nada más. Decir acá
                «todavía no se registró ninguna» es afirmar algo que no se sabe: la lista
                está vacía porque no llegó, no porque no haya. */}
            {cargando ? (
                <div className="flex items-center justify-center py-16">
                    <Spinner className="h-8 w-8" />
                </div>
            ) : error || sinServidor ? null : filas.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                    {hayFiltros
                        ? "No hay ninguna que cumpla con eso."
                        : "Todavía no se registró ninguna no conformidad. Se cargan desde la orden, con el ícono naranja que está al lado de cada paso."}
                </p>
            ) : (
                <ul className="rounded-lg border bg-card divide-y overflow-hidden">
                    {filas.map((f) => {
                        const cerrada = f.estado === "CERRADA";
                        const activa = abierta === f.id;
                        return (
                            <li key={f.id}>
                                <button
                                    type="button"
                                    onClick={() => setAbierta(activa ? null : f.id)}
                                    className={cn(
                                        "w-full px-4 py-3 text-left transition-colors",
                                        activa ? "bg-muted/40" : "hover:bg-muted/30"
                                    )}
                                >
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {cerrada ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                        ) : (
                                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                                        )}
                                        <span className="font-semibold text-sm tabular-nums">
                                            OT {f.nro_ot ?? f.id_orden_trabajo}
                                        </span>
                                        <span className="text-sm text-muted-foreground truncate max-w-[220px]">
                                            {f.cliente || "Sin cliente"} · {f.producto || "Sin producto"}
                                        </span>
                                        <Etiqueta className="bg-muted text-foreground/70 border-border">
                                            {tipos[f.tipo] ?? f.tipo}
                                        </Etiqueta>
                                        <Etiqueta
                                            className={f.gravedad
                                                ? COLOR_GRAVEDAD[f.gravedad]
                                                : "bg-muted text-muted-foreground border-dashed"}
                                            title={f.gravedad ? undefined : "Nadie la evaluó todavía"}
                                        >
                                            {f.gravedad ? (gravedades[f.gravedad] ?? f.gravedad) : "Sin clasificar"}
                                        </Etiqueta>
                                        <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
                                            {fmtFecha(f.fecha_registro)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                                        {f.descripcion && (
                                            <span className="text-foreground/80 truncate max-w-[520px]">{f.descripcion}</span>
                                        )}
                                        {f.proceso && <span>Paso: {f.proceso}</span>}
                                        {f.operario && <span>{f.operario}</span>}
                                        {f.minutos_perdidos > 0 && <span>{fmtHoras(f.minutos_perdidos)} perdidas</span>}
                                        {f.piezas_afectadas != null && <span>{f.piezas_afectadas} pieza(s)</span>}
                                    </div>
                                </button>

                                {activa && (
                                    <Panel
                                        fila={f}
                                        gravedades={gravedades}
                                        onGuardar={guardar}
                                        soloLectura={!puedeEditar}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function Chip({ activo, onClick, children }: {
    activo: boolean; onClick: () => void; children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "text-xs px-2 py-1 rounded-full border transition-colors",
                activo
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted text-muted-foreground"
            )}
        >
            {children}
        </button>
    );
}

function Etiqueta({ className, title, children }: {
    className?: string; title?: string; children: React.ReactNode;
}) {
    return (
        <span title={title}
              className={cn("text-[11px] px-2 py-0.5 rounded-full border shrink-0", className)}>
            {children}
        </span>
    );
}

function Tarjeta({ titulo, valor, tono }: { titulo: string; valor: string; tono?: string }) {
    return (
        <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{titulo}</p>
            <p className={cn("text-2xl font-bold tabular-nums", tono)}>{valor}</p>
        </div>
    );
}

/**
 * Lo que se puede hacer con una no conformidad: clasificarla, anotar qué se hizo y
 * cerrarla. Nada de borrar — un registro de calidad se cierra, no desaparece.
 */
function Panel({ fila, gravedades, onGuardar, soloLectura = false }: {
    fila: NoConformidad;
    gravedades: Listas;
    onGuardar: (id: number, ruta: string, cuerpo: Record<string, unknown>) => Promise<boolean>;
    /** RF-24: sin permiso de escritura, lo cargado se lee y no hay botones. */
    soloLectura?: boolean;
}) {
    const [accion, setAccion] = useState(fila.accion_correctiva ?? "");
    const [guardando, setGuardando] = useState(false);
    const cerrada = fila.estado === "CERRADA";

    if (soloLectura) {
        return (
            <div className="px-4 pb-4 pt-1 bg-muted/20 border-t space-y-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Gravedad:</span>
                    <span className="text-xs font-medium">
                        {fila.gravedad ? (gravedades[fila.gravedad] ?? fila.gravedad) : "Sin clasificar"}
                    </span>
                    {fila.usuario && (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="h-3 w-3" /> La reportó {fila.usuario}
                        </span>
                    )}
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">Qué se hizo</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-foreground/80">
                        {fila.accion_correctiva || <span className="italic text-muted-foreground">Todavía no se anotó.</span>}
                    </p>
                </div>
                {cerrada && (
                    <p className="text-xs text-muted-foreground">Cerrada el {fmtFecha(fila.fecha_cierre)}</p>
                )}
            </div>
        );
    }

    const conGuardado = async (ruta: string, cuerpo: Record<string, unknown>, aviso: string) => {
        setGuardando(true);
        const ok = await onGuardar(fila.id, ruta, cuerpo);
        setGuardando(false);
        if (ok) toast.success(aviso);
    };

    return (
        <div className="px-4 pb-4 pt-1 bg-muted/20 border-t space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Gravedad:</span>
                {Object.entries(gravedades).map(([clave, rotulo]) => (
                    <Chip
                        key={clave}
                        activo={fila.gravedad === clave}
                        onClick={() => conGuardado("", { gravedad: clave }, "Gravedad guardada")}
                    >
                        {rotulo}
                    </Chip>
                ))}
                {fila.usuario ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" /> La reportó {fila.usuario}
                    </span>
                ) : (
                    // Igual que en Auditoría: «no se registró» no es lo mismo que «no se sabe».
                    <span className="ml-auto text-xs italic text-muted-foreground/60"
                          title="Se cargó antes del 22/09/2026, cuando todavía no se guardaba el usuario">
                        sin registrar quién la reportó
                    </span>
                )}
            </div>

            <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Qué se hizo</label>
                <Textarea
                    rows={2}
                    value={accion}
                    onChange={(e) => setAccion(e.target.value)}
                    placeholder="Se rehízo la pieza, se pidió el plano actualizado…"
                />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={guardando}
                    onClick={() => conGuardado("", { accion_correctiva: accion || null }, "Guardado")}
                >
                    Guardar lo que se hizo
                </Button>
                {cerrada ? (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={guardando}
                            onClick={() => conGuardado("", { estado: "ABIERTA" }, "Se volvió a abrir")}
                        >
                            <RotateCcw className="h-4 w-4 mr-1.5" />
                            Volver a abrirla
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            Cerrada el {fmtFecha(fila.fecha_cierre)}
                        </span>
                    </>
                ) : (
                    <Button
                        size="sm"
                        disabled={guardando}
                        onClick={() => conGuardado("/cerrar", { accion_correctiva: accion || null }, "Cerrada")}
                    >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        Darla por resuelta
                    </Button>
                )}
            </div>
        </div>
    );
}
