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
 *  · Se baja con el botón común «Exportar» (RF-22): PDF, Excel o CSV de lo que está
 *    en pantalla, con las mismas columnas que tenía el CSV del servidor. Antes había un
 *    botón propio que sólo sabía CSV y lo pedía al servidor.
 *
 * Los rechazos (23/09, reunión con Lucas: «si algo se rechazó, que quede el registro de
 * que tuviste 10 piezas que se rechazaron. ¿Quién la hizo? Tal empleado»):
 *
 *  · «Registrar rechazo» carga una de cualquier tipo acá mismo (el mismo formulario que
 *    la ficha de la OT): la OT por su número, el paso, cuántas de cuántas, quién hizo
 *    las piezas y qué se hace con lo rechazado. Aparece al toque en la lista.
 *  · Se filtra por quién hizo las piezas, y «Por persona» las agrupa: «piezas
 *    rechazadas por persona este mes», exportable. Las dos cosas piden la sección
 *    confidencial «Rendimiento por persona» (la misma del reporte de RF-07): sin ella no
 *    aparecen, y el servidor tampoco las contesta. La lista de siempre, que ya decía
 *    quién hizo cada una, sigue igual.
 *  · Con un servidor de antes del 23/09 nada de eso aparece: la pantalla queda como
 *    estaba (guardar un tipo nuevo fallaría y el filtro por persona no filtraría).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle, CalendarDays, CheckCircle2, FileWarning, Filter, List, Plus, RefreshCw,
    RotateCcw, Search, User, Users,
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
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { fechaDeFiltro, type ColumnaExport } from "@/lib/exportar";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { type BorradorRechazo, RegistrarRechazo, type VistaDelRechazo } from "@/components/calidad/RegistrarRechazo";
import {
    type Catalogos,
    type CuerpoRechazo,
    type NoConformidad,
    type PersonaAgrupada,
    type Persona,
    type ResumenNC as Resumen,
    entraEnElFiltro,
    filaProvisoria,
    mesEnCurso,
    nombreVisible,
    pasoTexto,
    pedirCatalogos,
    pedirPersonas,
    piezasTexto,
    porcentajeTexto,
    registrarRechazo,
    sabeCargarRechazos,
} from "@/lib/calidad";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

type Listas = Record<string, string>;

const SIN_CLASIFICAR = "SIN_CLASIFICAR";

// Ids de las cargadas que todavía no contestó el servidor: negativos, de un contador.
let proximoTemporal = -1;

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
    const { puede, puedeSeccion } = usePermisos();
    const puedeEditar = puede("no_conformidades", "write");
    // El agrupado por persona es la sección confidencial «Rendimiento por persona» (la
    // misma del reporte de RF-07 y la que pide el servidor): sin ella no se muestra.
    const veRendimiento = puedeSeccion("dashboard_rendimiento", "read");
    const [filas, setFilas] = useState<NoConformidad[]>([]);
    const [resumen, setResumen] = useState<Resumen | null>(null);
    const [hayMas, setHayMas] = useState(false);
    const [tipos, setTipos] = useState<Listas>({});
    const [gravedades, setGravedades] = useState<Listas>({});
    const [estados, setEstados] = useState<Listas>({});
    const [disposiciones, setDisposiciones] = useState<Listas>({});
    /** Las listas del formulario de carga. Sin `disposiciones` el servidor es de antes
     *  del 23/09 y no se ofrece cargar, ni filtrar ni agrupar por persona. */
    const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
    const sabeCargar = sabeCargarRechazos(catalogos);
    const [personas, setPersonas] = useState<Persona[]>([]);
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

    // Filtros
    const [ot, setOt] = useState("");
    const [tipo, setTipo] = useState<string | null>(null);
    const [gravedad, setGravedad] = useState<string | null>(null);
    const [estado, setEstado] = useState<string | null>(null);
    const [desde, setDesde] = useState("");
    const [hasta, setHasta] = useState("");
    /** Quién hizo las piezas (id de la persona), o "". */
    const [persona, setPersona] = useState("");

    // Qué fila está abierta para completarla o cerrarla.
    const [abierta, setAbierta] = useState<number | null>(null);

    // La lista de siempre, o agrupada por quién hizo las piezas.
    const [vista, setVista] = useState<"lista" | "persona">("lista");
    const verPorPersona = vista === "persona" && veRendimiento && sabeCargar;
    /**
     * Filtrar por quién hizo las piezas: con un servidor que sabe de rechazos y con la
     * sección «Rendimiento por persona». Filtrada por una persona, la lista y su resumen
     * son lo mismo que su ficha (piezas y porcentaje de rechazo), y el servidor lo pide
     * con esa sección (revisión del 23/09: sin ella el supervisor lo esquivaba con el
     * filtro). Sin la sección la lista sigue diciendo quién hizo cada una, como siempre.
     */
    const filtraPorPersona = sabeCargar && veRendimiento;

    // El formulario de carga, y lo tipeado si el servidor dijo que no.
    const [formulario, setFormulario] = useState(false);
    const [borrador, setBorrador] = useState<BorradorRechazo | null>(null);

    useEffect(() => {
        void pedirCatalogos().then(setCatalogos);
        void pedirPersonas().then(setPersonas);
    }, []);

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
        // Con un servidor de antes se ignoraría sin decir nada y la lista parecería
        // filtrada sin estarlo: sólo se manda si el servidor sabe de rechazos.
        // Sin la sección, tampoco: el servidor contestaría 403 y la lista quedaría vacía.
        if (persona && filtraPorPersona) p.set("id_operario", persona);
        return p.toString();
    }, [ot, tipo, gravedad, estado, desde, hasta, persona, filtraPorPersona]);

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
            setDisposiciones(data.disposiciones ?? {});
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

    /**
     * Lo que se exporta (RF-22): las mismas dieciséis columnas, con los mismos nombres
     * y en el mismo orden que el CSV que armaba el servidor, así quien ya lo usaba
     * encuentra todo donde estaba. Salen las filas que está mostrando la lista.
     */
    const columnasExport: ColumnaExport<NoConformidad>[] = [
        { titulo: "N° OT", tipo: "id", valor: (f) => f.nro_ot ?? f.id_orden_trabajo },
        { titulo: "Cliente", valor: (f) => f.cliente ?? "" },
        { titulo: "Producto", valor: (f) => f.producto ?? "" },
        { titulo: "Fecha", tipo: "fechaHora", valor: (f) => f.fecha_registro },
        { titulo: "Tipo", valor: (f) => tipos[f.tipo] ?? f.tipo ?? "" },
        // Vacío sería «no aplica»; la verdad es que nadie la evaluó todavía.
        { titulo: "Gravedad", valor: (f) => (f.gravedad ? (gravedades[f.gravedad] ?? f.gravedad) : "Sin clasificar") },
        { titulo: "Estado", valor: (f) => estados[f.estado] ?? f.estado ?? "" },
        { titulo: "Piezas afectadas", tipo: "entero", valor: (f) => f.piezas_afectadas },
        { titulo: "Minutos perdidos", tipo: "entero", valor: (f) => f.minutos_perdidos },
        { titulo: "Recurso humano extra", tipo: "entero", valor: (f) => f.operarios_extra },
        { titulo: "Proceso", valor: (f) => f.proceso ?? "" },
        { titulo: "Recurso humano", valor: (f) => f.operario ?? "" },
        { titulo: "Qué pasó", valor: (f) => f.descripcion ?? "" },
        { titulo: "Qué se hizo", valor: (f) => f.accion_correctiva ?? "" },
        { titulo: "Lo reportó", valor: (f) => f.usuario ?? "" },
        { titulo: "Fecha de cierre", tipo: "fechaHora", valor: (f) => f.fecha_cierre },
        // Del 23/09, al final: las dieciséis de antes siguen en su lugar.
        { titulo: "Paso", tipo: "entero", valor: (f) => f.paso ?? null },
        { titulo: "Piezas controladas", tipo: "entero", valor: (f) => f.piezas_controladas ?? null },
        { titulo: "Qué se hace con lo rechazado", valor: (f) => (f.disposicion ? (disposiciones[f.disposicion] ?? f.disposicion) : "") },
    ];

    const filtrosExport = () => [
        ...(ot.trim() ? [`N° de OT: ${ot.trim()}`] : []),
        ...(estado ? [`Estado: ${estados[estado] ?? estado}`] : []),
        ...(gravedad ? [`Gravedad: ${gravedad === SIN_CLASIFICAR ? "Sin clasificar" : (gravedades[gravedad] ?? gravedad)}`] : []),
        ...(tipo ? [`Tipo: ${tipos[tipo] ?? tipo}`] : []),
        ...(desde ? [`Desde: ${fechaDeFiltro(desde)}`] : []),
        ...(hasta ? [`Hasta: ${fechaDeFiltro(hasta)}`] : []),
        ...(persona && filtraPorPersona ? [`Hizo las piezas: ${personas.find((x) => String(x.id) === persona)?.nombre ?? persona}`] : []),
        ...(hayMas ? [`Sólo las ${filas.length} más nuevas: hay más que no entran en la pantalla`] : []),
    ];

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
        setDesde(""); setHasta(""); setPersona("");
    };
    const hayFiltros = !!(ot || tipo || gravedad || estado || desde || hasta || (persona && filtraPorPersona));
    /** Los filtros que de verdad viajan al servidor (los mismos de `queryFiltros`). */
    const filtrosActivos = {
        ot, tipo, gravedad, estado, desde, hasta,
        persona: filtraPorPersona ? persona : "",
    };
    const mes = mesEnCurso();
    const esEsteMes = desde === mes.desde && hasta === mes.hasta;
    const porPersona = usePorPersona(queryFiltros, verPorPersona);

    /**
     * Registrar un rechazo sin recargar: la fila aparece arriba al toque (con «guardando…»)
     * y se reemplaza por la que devuelve el servidor. Si dice que no, se saca, se dice por
     * qué y el formulario vuelve a abrirse con lo tipeado.
     */
    const registrar = async (cuerpo: CuerpoRechazo, vista: VistaDelRechazo, lo: BorradorRechazo) => {
        const temporal = filaProvisoria(cuerpo, vista, proximoTemporal--);
        const piezas = cuerpo.piezas_afectadas ?? 0;
        const mover = (signo: 1 | -1) => setResumen((r) => (r ? {
            ...r,
            total: r.total + signo,
            abiertas: r.abiertas + signo,
            piezas_afectadas: r.piezas_afectadas + signo * piezas,
        } : r));
        // Sólo va a la lista si entra en los filtros puestos (revisión del 23/09: con
        // «Quién hizo las piezas = Juan», un rechazo de María quedaba en la lista de Juan,
        // descuadraba el resumen y salía en su Exportar). Los filtros se toman ahora: si
        // alguien los cambia mientras guarda, la lista se vuelve a pedir igual.
        const filtros = filtrosActivos;
        const seVe = entraEnElFiltro(temporal, filtros);
        if (seVe) {
            setFilas((l) => [temporal, ...l]);
            mover(1);
        }
        try {
            const guardada = await registrarRechazo(cuerpo);
            // Lo que manda es lo que guardó el servidor (su fecha, su número de OT).
            const entra = entraEnElFiltro(guardada, filtros);
            if (entra) {
                setFilas((l) => (seVe
                    ? l.map((f) => (f.id === temporal.id ? guardada : f))
                    : [guardada, ...l]));
            } else if (seVe) {
                setFilas((l) => l.filter((f) => f.id !== temporal.id));
            }
            const donde = `Registrada en la OT ${guardada.nro_ot ?? vista.nro_ot ?? ""}`.trim();
            if (entra) {
                toast.success(donde);
            } else {
                toast.success(donde, { description: "No entra en los filtros que están puestos, por eso no aparece en la lista." });
            }
            if (verPorPersona) void porPersona.recargar();
            // El porcentaje de rechazo del encabezado no se puede recontar acá (sale de
            // todas las filas, no de las que se ven): se pide sólo el resumen, en silencio.
            void fetch(`${API_URL}/incidencias/reporte?${queryFiltros}&limite=1`, { headers: getAuthHeaders() })
                .then((r) => (r.ok ? r.json() : null))
                .then((j) => { if (j?.data?.resumen) setResumen(j.data.resumen); })
                .catch(() => { /* queda el que se recontó a mano */ });
        } catch (e) {
            if (seVe) {
                setFilas((l) => l.filter((f) => f.id !== temporal.id));
                mover(-1);
            }
            toast.error("No se registró", { description: e instanceof Error ? e.message : undefined });
            setBorrador(lo);
            setFormulario(true);
        }
    };

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
                <div className="flex items-center gap-2 flex-wrap">
                    {/* RF-12: cargar una de cualquier tipo, acá mismo. Sólo con permiso de
                        escritura y con un servidor que ya sabe de rechazos. */}
                    {puedeEditar && sabeCargar && catalogos && (
                        <Button size="sm" onClick={() => { setBorrador(null); setFormulario(true); }}
                                className="bg-amber-600 text-white hover:bg-amber-700">
                            <Plus className="h-4 w-4 sm:mr-1.5" />
                            <span className="hidden sm:inline">Registrar rechazo / no conformidad</span>
                            <span className="sm:hidden">Registrar</span>
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => { void cargar(); if (verPorPersona) void porPersona.recargar(); }} disabled={cargando}>
                        <RefreshCw className={cn("h-4 w-4 sm:mr-2", cargando && "animate-spin")} />
                        <span className="hidden sm:inline">Actualizar</span>
                    </Button>
                    {verPorPersona ? (
                        <ExportarMenu
                            titulo="Piezas rechazadas por persona"
                            archivo="rechazos_por_persona"
                            filas={porPersona.personas}
                            columnas={COLUMNAS_POR_PERSONA}
                            filtros={filtrosExport}
                            disabled={porPersona.cargando || !porPersona.personas.length}
                        />
                    ) : (
                        <ExportarMenu
                            titulo="No conformidades"
                            archivo="no_conformidades"
                            filas={filas}
                            columnas={columnasExport}
                            filtros={filtrosExport}
                            disabled={cargando || sinServidor}
                            aviso={hayMas
                                ? `Salen las ${filas.length} más nuevas, las que entran en la pantalla. Achicá las fechas o filtrá por OT para bajar el resto.`
                                : undefined}
                        />
                    )}
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
                        <Chip activo={esEsteMes}
                              onClick={() => { if (esEsteMes) { setDesde(""); setHasta(""); } else { setDesde(mes.desde); setHasta(mes.hasta); } }}>
                            <CalendarDays className="inline h-3 w-3 mr-1 -mt-px" />Este mes
                        </Chip>
                        {filtraPorPersona && (
                            <SearchableSelect
                                options={personas.map((x) => ({ value: String(x.id), label: x.nombre }))}
                                value={persona}
                                onValueChange={setPersona}
                                placeholder="Quién hizo las piezas"
                                className="w-full sm:w-56"
                                triggerClassName="h-9"
                            />
                        )}
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
                        {/* Un desplegable y no chips: con los tipos de un taller metalúrgico
                            (23/09) son doce, y doce chips ocupaban media pantalla del teléfono. */}
                        <select
                            value={tipo ?? ""}
                            onChange={(e) => setTipo(e.target.value || null)}
                            aria-label="Tipo"
                            className={cn(
                                "h-7 rounded-full border px-2 text-xs",
                                tipo ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground",
                            )}
                        >
                            <option value="">Todos los tipos</option>
                            {Object.entries(tipos).map(([clave, rotulo]) => (
                                <option key={clave} value={clave}>{rotulo}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* La lista, o «piezas rechazadas por persona». */}
            {veRendimiento && sabeCargar && !sinServidor && (
                <div className="mb-4 inline-flex rounded-lg border bg-card p-0.5">
                    {([["lista", "Lista", List], ["persona", "Por persona", Users]] as const).map(([clave, rotulo, Icono]) => (
                        <button
                            key={clave}
                            type="button"
                            onClick={() => setVista(clave)}
                            aria-pressed={vista === clave}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                                vista === clave ? "bg-[#010e26] text-white" : "text-muted-foreground hover:bg-muted",
                            )}
                        >
                            <Icono className="h-3.5 w-3.5" /> {rotulo}
                        </button>
                    ))}
                </div>
            )}

            {/* Resumen */}
            {resumen && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                    <Tarjeta titulo="No conformidades" valor={String(resumen.total)} />
                    <Tarjeta titulo="Abiertas" valor={String(resumen.abiertas)} tono="text-amber-600" />
                    <Tarjeta titulo="Cerradas" valor={String(resumen.cerradas)} tono="text-emerald-600" />
                    <Tarjeta titulo="Tiempo perdido" valor={fmtHoras(resumen.minutos_perdidos)} tono="text-rose-600" />
                    <Tarjeta titulo="Piezas rechazadas" valor={String(resumen.piezas_afectadas)}
                             detalle={resumen.porcentaje_rechazo != null ? `${porcentajeTexto(resumen.porcentaje_rechazo)} de las controladas` : undefined} />
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
            {verPorPersona ? (
                <TablaPorPersona
                    datos={porPersona}
                    onVerPersona={(id) => { setPersona(String(id)); setVista("lista"); }}
                />
            ) : cargando ? (
                <div className="flex items-center justify-center py-16">
                    <Spinner className="h-8 w-8" />
                </div>
            ) : error || sinServidor ? null : filas.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                    {hayFiltros
                        ? "No hay ninguna que cumpla con eso."
                        : sabeCargar
                            ? "Todavía no se registró ninguna no conformidad. Se cargan con «Registrar rechazo», acá o desde la ficha de la OT."
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
                                    onClick={() => !f.pendiente && setAbierta(activa ? null : f.id)}
                                    className={cn(
                                        "w-full px-4 py-3 text-left transition-colors",
                                        activa ? "bg-muted/40" : "hover:bg-muted/30",
                                        f.pendiente && "opacity-60 cursor-default",
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
                                            {f.pendiente ? "guardando…" : fmtFecha(f.fecha_registro)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                                        {f.descripcion && (
                                            <span className="text-foreground/80 truncate max-w-[520px]">{f.descripcion}</span>
                                        )}
                                        {(f.proceso || f.paso != null) && <span>{pasoTexto(f)}</span>}
                                        {f.operario && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />Las hizo {nombreVisible(f.operario)}</span>}
                                        {f.minutos_perdidos > 0 && <span>{fmtHoras(f.minutos_perdidos)} perdidas</span>}
                                        {f.piezas_afectadas != null && (
                                            <span className="font-medium text-rose-700 tabular-nums">
                                                {piezasTexto(f.piezas_afectadas, f.piezas_controladas)} {f.piezas_afectadas === 1 && f.piezas_controladas == null ? "pieza" : "piezas"}
                                            </span>
                                        )}
                                        {f.disposicion && <span>{disposiciones[f.disposicion] ?? f.disposicion}</span>}
                                    </div>
                                </button>

                                {activa && (
                                    <Panel
                                        fila={f}
                                        gravedades={gravedades}
                                        disposiciones={disposiciones}
                                        onGuardar={guardar}
                                        soloLectura={!puedeEditar}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {catalogos && sabeCargar && puedeEditar && (
                <RegistrarRechazo
                    open={formulario}
                    onClose={() => setFormulario(false)}
                    catalogos={catalogos}
                    borrador={borrador}
                    onRegistrar={(cuerpo, vista, lo) => void registrar(cuerpo, vista, lo)}
                />
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

function Tarjeta({ titulo, valor, tono, detalle }: { titulo: string; valor: string; tono?: string; detalle?: string }) {
    return (
        <div className="rounded-lg border bg-card px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{titulo}</p>
            <p className={cn("text-2xl font-bold tabular-nums", tono)}>{valor}</p>
            {detalle && <p className="text-[11px] text-muted-foreground">{detalle}</p>}
        </div>
    );
}

// ─────────────────────────── por persona (23/09) ───────────────────────────

/** Las columnas del archivo «piezas rechazadas por persona». */
const COLUMNAS_POR_PERSONA: ColumnaExport<PersonaAgrupada>[] = [
    { titulo: "Quién hizo las piezas", valor: (p) => (p.operario ? nombreVisible(p.operario) : "Sin decir quién") },
    { titulo: "Piezas rechazadas", tipo: "entero", valor: (p) => p.piezas_rechazadas },
    { titulo: "Piezas controladas", tipo: "entero", valor: (p) => p.piezas_controladas },
    { titulo: "% rechazado (de las que dicen de cuántas)", tipo: "porcentaje", decimales: 1, valor: (p) => p.porcentaje_rechazo },
    { titulo: "No conformidades", tipo: "entero", valor: (p) => p.no_conformidades },
    { titulo: "Abiertas", tipo: "entero", valor: (p) => p.abiertas },
    { titulo: "Órdenes", tipo: "entero", valor: (p) => p.ordenes },
    { titulo: "La última", tipo: "fechaHora", valor: (p) => p.ultima },
];

/**
 * El agrupado por persona, con los mismos filtros que la lista. Cambiar un filtro no
 * tapa lo que se está viendo: queda a la vista con «actualizando…» hasta que llega lo
 * nuevo.
 */
function usePorPersona(query: string, activo: boolean) {
    const [personas, setPersonas] = useState<PersonaAgrupada[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pedido = useRef(0);

    const recargar = useCallback(async () => {
        if (!activo) return;
        const este = ++pedido.current;
        setCargando(true);
        try {
            const res = await fetch(`${API_URL}/incidencias/por-persona?${query}`, { headers: getAuthHeaders() });
            if (este !== pedido.current) return;
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.errors?.[0]?.message || "No se pudo armar el agrupado.");
            }
            const body = await res.json().catch(() => null);
            if (este !== pedido.current) return;
            setPersonas(Array.isArray(body?.data?.personas) ? body.data.personas : []);
            setError(null);
        } catch (e) {
            if (este === pedido.current) setError(e instanceof Error ? e.message : "No se pudo armar el agrupado.");
        } finally {
            if (este === pedido.current) setCargando(false);
        }
    }, [query, activo]);

    useEffect(() => {
        const t = setTimeout(() => void recargar(), 250);
        return () => clearTimeout(t);
    }, [recargar]);

    return { personas, cargando, error, recargar };
}

function TablaPorPersona({ datos, onVerPersona }: {
    datos: ReturnType<typeof usePorPersona>;
    onVerPersona: (idOperario: number) => void;
}) {
    const { personas, cargando, error } = datos;
    if (error && !personas.length) {
        return (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        );
    }
    if (cargando && !personas.length) {
        return (
            <div className="flex items-center justify-center py-16">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }
    if (!personas.length) {
        return (
            <p className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                No hay ninguna que cumpla con eso.
            </p>
        );
    }
    const maximo = Math.max(1, ...personas.map((p) => p.piezas_rechazadas));
    return (
        <div className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                <span>Piezas rechazadas por quién las hizo, con los filtros de arriba</span>
                {cargando && <span>actualizando…</span>}
            </div>
            <ul className="divide-y">
                {personas.map((p) => (
                    <li key={p.id_operario ?? "nadie"}>
                        <button
                            type="button"
                            disabled={p.id_operario == null}
                            onClick={() => p.id_operario != null && onVerPersona(p.id_operario)}
                            title={p.id_operario != null ? "Ver sus no conformidades" : undefined}
                            className="w-full px-4 py-2.5 text-left hover:bg-muted/30 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", p.id_operario == null && "italic text-muted-foreground")}>
                                    {p.operario ? nombreVisible(p.operario) : "Sin decir quién las hizo"}
                                </span>
                                <span className="text-sm font-bold tabular-nums text-rose-700">
                                    {p.piezas_rechazadas} {p.piezas_rechazadas === 1 ? "pieza" : "piezas"}
                                </span>
                                <span className="w-full sm:w-auto text-xs text-muted-foreground tabular-nums">
                                    {p.porcentaje_rechazo != null ? `${porcentajeTexto(p.porcentaje_rechazo)} de las controladas · ` : ""}
                                    {p.no_conformidades} {p.no_conformidades === 1 ? "no conformidad" : "no conformidades"}
                                    {p.abiertas ? ` (${p.abiertas} ${p.abiertas === 1 ? "abierta" : "abiertas"})` : ""}
                                    {` · ${p.ordenes} ${p.ordenes === 1 ? "OT" : "OT distintas"}`}
                                </span>
                            </div>
                            {/* La barra compara contra el que más tuvo: se lee de un vistazo. */}
                            <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full bg-[#445EF2]" style={{ width: `${(100 * p.piezas_rechazadas) / maximo}%` }} />
                            </div>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Lo que se puede hacer con una no conformidad: clasificarla, anotar qué se hizo y
 * cerrarla. Nada de borrar — un registro de calidad se cierra, no desaparece.
 */
function Panel({ fila, gravedades, disposiciones, onGuardar, soloLectura = false }: {
    fila: NoConformidad;
    gravedades: Listas;
    /** Qué se hace con lo rechazado. Vacío con un servidor de antes del 23/09. */
    disposiciones: Listas;
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
                {fila.disposicion && (
                    <p className="text-xs">
                        <span className="text-muted-foreground">Con lo rechazado: </span>
                        {disposiciones[fila.disposicion] ?? fila.disposicion}
                    </p>
                )}
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

            {Object.keys(disposiciones).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Con lo rechazado:</span>
                    {Object.entries(disposiciones).map(([clave, rotulo]) => (
                        <Chip
                            key={clave}
                            activo={fila.disposicion === clave}
                            onClick={() => conGuardado("", { disposicion: fila.disposicion === clave ? null : clave }, "Guardado")}
                        >
                            {rotulo}
                        </Chip>
                    ))}
                </div>
            )}

            <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Qué se hizo (acción correctiva)</label>
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
