"use client";

/**
 * TODO lo que alguien creó, editó o eliminó en el sistema — y, desde RF-25, quién entró,
 * quién salió y quién se equivocó la contraseña.
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
 *
 * DÓNDE SE BUSCA (RF-25, 23/09)
 *
 * En el servidor. Hasta ese día se traían los últimos 300 y se filtraba acá: lo que
 * alguien hizo hace un mes no aparecía aunque estuviera guardado, y no había fechas.
 * Ahora cada filtro viaja, se ve cuántos hay en total, se pasa de página y «Exportar»
 * baja TODO lo filtrado (hasta TOPE_EXPORTAR, con aviso si hay más). Mientras se busca,
 * la lista que estaba queda a la vista (sin taparla con un spinner).
 *
 * Contra el backend viejo (sin `total` en la respuesta) se hace lo de antes: los
 * últimos 300, filtrados acá, con un aviso chico.
 *
 * DOS MODOS
 *
 *   · «todo»: el registro entero, con los botones Creó / Editó / Eliminó.
 *   · «ingresos»: sólo entradas, salidas, intentos fallidos, bloqueos y claves, con los
 *     fallidos resaltados y de dónde vino cada uno (navegador e IP).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronDown, ChevronLeft, ChevronRight, Filter, PlusCircle, Pencil, Trash2,
    AlertCircle, Clock, User, Search, X, Lock, LockOpen, LogIn, LogOut, ShieldAlert,
    KeyRound, Mail, Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { filtroBusqueda, type ColumnaExport } from "@/lib/exportar";
import { FiltroDeFechas } from "@/components/auditoria/FiltroDeFechas";
import {
    GRUPOS_DE_INGRESO,
    POR_PAGINA,
    TOPE_EXPORTAR,
    TOPE_VIEJO,
    cuandoCorto,
    esBackendNuevo,
    filtrarEnElNavegador,
    origenDelIngreso,
    parametrosDelRegistro,
    pedirMovimientos,
    textoDelPeriodo,
    type FiltrosDelRegistro,
    type Movimiento,
    type PedidoDeFiltro,
    type PeriodoAuditoria,
    type PersonaDelRegistro,
} from "@/lib/auditoria";

export type { Movimiento } from "@/lib/auditoria";

/** RF-22: la frase y quién, cuándo y cómo salió. El detalle crudo no va: es para abrirlo acá. */
const COLUMNAS_EXPORT: ColumnaExport<Movimiento>[] = [
    { titulo: "Fecha", tipo: "fechaHora", valor: (m) => m.cuando },
    { titulo: "Quién", valor: (m) => m.usuario ?? "sin registrar" },
    { titulo: "Acción", valor: (m) => m.accion },
    { titulo: "Qué", valor: (m) => m.entidad },
    { titulo: "N°", valor: (m) => m.id_entidad ?? "" },
    { titulo: "Descripción", valor: (m) => m.descripcion },
    { titulo: "Resultado", valor: (m) => (m.salio_bien ? "Bien" : "No se pudo") },
    { titulo: "Código", tipo: "id", valor: (m) => m.estado },
    { titulo: "Duración (ms)", tipo: "entero", valor: (m) => m.duracion_ms },
    { titulo: "Pedido", valor: (m) => `${m.metodo} ${m.ruta}` },
];

/** Los ingresos: sin código ni pedido, con de dónde vino. */
const COLUMNAS_EXPORT_INGRESOS: ColumnaExport<Movimiento>[] = [
    { titulo: "Fecha", tipo: "fechaHora", valor: (m) => m.cuando },
    { titulo: "Qué pasó", valor: (m) => m.accion },
    { titulo: "Descripción", valor: (m) => m.descripcion },
    { titulo: "Quién", valor: (m) => m.usuario ?? "" },
    { titulo: "Resultado", valor: (m) => (m.salio_bien ? "Bien" : "No se pudo") },
    { titulo: "Navegador", valor: (m) => origenDelIngreso(m).navegador ?? "" },
    { titulo: "IP", valor: (m) => origenDelIngreso(m).ip ?? "" },
];

// «bloqueó» / «desbloqueó» son del RF-26: una cuenta que quedó bloqueada por 5
// contraseñas malas seguidas (sin autor: lo decidió el sistema) y el admin que la
// destrabó. Los de entrar, salir y las claves, de RF-25. Cualquier acción que no esté
// acá se muestra con el lápiz gris.
const ICONO: Record<string, typeof PlusCircle> = {
    "creó": PlusCircle,
    "editó": Pencil,
    "eliminó": Trash2,
    "bloqueó": Lock,
    "desbloqueó": LockOpen,
    "ingresó": LogIn,
    "salió": LogOut,
    "intento fallido": ShieldAlert,
    "cambió su clave": KeyRound,
    "restableció clave": KeyRound,
    "pidió recuperar": Mail,
};

const COLOR: Record<string, string> = {
    "creó": "text-emerald-600",
    "editó": "text-sky-600",
    "eliminó": "text-rose-600",
    "bloqueó": "text-amber-600",
    "desbloqueó": "text-emerald-600",
    "ingresó": "text-emerald-600",
    "salió": "text-gray-500",
    "intento fallido": "text-rose-600",
    "cambió su clave": "text-sky-600",
    "restableció clave": "text-sky-600",
    "pidió recuperar": "text-gray-500",
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
                <pre className="text-xs bg-muted/50 border rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-64">
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

/** Lo que la pantalla muestra de cada respuesta. */
interface Pagina {
    movs: Movimiento[];
    total: number;
    hayMas: boolean;
}

export function RegistroDeMovimientos({ modo = "todo", pedido = null }: {
    modo?: "todo" | "ingresos";
    /** Lo que mandó la Actividad por persona al tocar a alguien (se aplica al montar). */
    pedido?: PedidoDeFiltro | null;
}) {
    const ingresos = modo === "ingresos";

    // ── los filtros (todos viajan al servidor) ──
    const [texto, setTexto] = useState("");
    const [textoBuscado, setTextoBuscado] = useState("");
    const [queAccion, setQueAccion] = useState<string | null>(null);
    const [grupo, setGrupo] = useState<string | null>(pedido?.grupo ?? null);
    const [queEntidad, setQueEntidad] = useState<string | null>(null);
    const [persona, setPersona] = useState<{ id: number; nombre: string } | null>(pedido?.persona ?? null);
    const [soloFallidos, setSoloFallidos] = useState(!!pedido?.soloFallidos);
    const [periodo, setPeriodo] = useState<PeriodoAuditoria>(pedido?.periodo ?? { clave: "todo" });
    const [desplazamiento, setDesplazamiento] = useState(0);

    // ── lo que vino ──
    const [pagina, setPagina] = useState<Pagina | null>(null);
    const [entidades, setEntidades] = useState<{ entidad: string; cuantos: number }[]>([]);
    const [personas, setPersonas] = useState<PersonaDelRegistro[]>([]);
    const [cargando, setCargando] = useState(true);      // la primera vez: spinner
    const [actualizando, setActualizando] = useState(false); // las demás: la lista queda
    const [error, setError] = useState<string | null>(null);
    const [abierto, setAbierto] = useState<number | null>(null);
    // Backend viejo: los últimos 300, filtrados acá (null = backend nuevo).
    const [viejos, setViejos] = useState<Movimiento[] | null>(null);
    const [nombresViejos, setNombresViejos] = useState<string[]>([]);

    const arriba = useRef<HTMLDivElement>(null);
    const pedidoEnCurso = useRef(0);

    // El buscador espera a que se deje de tipear: una letra no es una búsqueda.
    useEffect(() => {
        const t = setTimeout(() => setTextoBuscado(texto), 350);
        return () => clearTimeout(t);
    }, [texto]);

    const accionPedida = ingresos
        ? (GRUPOS_DE_INGRESO.find((g) => g.clave === grupo)?.acciones ?? null)
        : queAccion;

    const filtros: FiltrosDelRegistro = useMemo(() => ({
        modo,
        texto: textoBuscado,
        accion: accionPedida,
        entidad: ingresos ? null : queEntidad,
        persona,
        soloFallidos,
        periodo,
    }), [modo, textoBuscado, accionPedida, ingresos, queEntidad, persona, soloFallidos, periodo]);
    const claveDeFiltros = JSON.stringify(filtros);

    // Otro filtro: de vuelta a la primera página.
    useEffect(() => { setDesplazamiento(0); }, [claveDeFiltros]);

    const conOpciones = useRef(true);
    const cargar = useCallback(async () => {
        if (viejos !== null) return; // backend viejo: se filtra acá, no se vuelve a pedir
        const n = ++pedidoEnCurso.current;
        setActualizando(true);
        setError(null);
        try {
            const q = parametrosDelRegistro(filtros);
            q.set("limite", String(POR_PAGINA));
            q.set("desplazamiento", String(desplazamiento));
            q.set("opciones", conOpciones.current ? "true" : "false");
            const r = await pedirMovimientos(q);
            if (n !== pedidoEnCurso.current) return; // llegó tarde: ya se pidió otra cosa

            if (!esBackendNuevo(r)) {
                // El servidor todavía no busca solo: lo de antes, los últimos 300.
                const q300 = new URLSearchParams({ limite: String(TOPE_VIEJO) });
                const r300 = await pedirMovimientos(q300);
                if (n !== pedidoEnCurso.current) return;
                setViejos(r300.movimientos);
                setEntidades(Array.isArray(r300.entidades) ? r300.entidades : []);
                setNombresViejos(Array.isArray(r300.usuarios) ? r300.usuarios : []);
                return;
            }
            setPagina({ movs: r.movimientos, total: r.total ?? 0, hayMas: !!r.hay_mas });
            if (conOpciones.current) {
                setEntidades(Array.isArray(r.entidades) ? r.entidades : []);
                setPersonas(Array.isArray(r.personas) ? r.personas : []);
                conOpciones.current = false;
            }
        } catch {
            if (n === pedidoEnCurso.current) setError("No se pudo cargar el registro. Probá actualizar.");
        } finally {
            if (n === pedidoEnCurso.current) {
                setCargando(false);
                setActualizando(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claveDeFiltros, desplazamiento, viejos === null]);

    useEffect(() => { void cargar(); }, [cargar]);

    // ── lo que se muestra ──
    const visiblesViejos = useMemo(
        () => (viejos ? filtrarEnElNavegador(viejos, filtros) : []),
        [viejos, filtros],
    );
    const movs = viejos ? visiblesViejos : (pagina?.movs ?? []);
    const total = viejos ? visiblesViejos.length : (pagina?.total ?? 0);

    const hayFiltro = !!(texto || queAccion || grupo || queEntidad || persona || soloFallidos
        || periodo.clave !== "todo");

    const limpiar = () => {
        setTexto(""); setTextoBuscado(""); setQueAccion(null); setGrupo(null);
        setQueEntidad(null); setPersona(null); setSoloFallidos(false); setPeriodo({ clave: "todo" });
    };

    const irA = (nuevo: number) => {
        setDesplazamiento(Math.max(0, nuevo));
        setAbierto(null);
        arriba.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    // El desplegable de personas: las cuentas (backend nuevo) o los nombres (viejo). Si
    // la persona pedida no está en la lista, se agrega igual para que se vea elegida.
    const opcionesDePersona = useMemo(() => {
        const lista = viejos
            ? nombresViejos.map((n, i) => ({ id: -(i + 1), nombre: n }))
            : personas.map((p) => ({ id: p.id_usuario, nombre: p.nombre ?? `Usuario #${p.id_usuario}` }));
        if (persona && !lista.some((p) => p.id === persona.id || p.nombre === persona.nombre)) {
            lista.unshift(persona);
        }
        return lista;
    }, [viejos, nombresViejos, personas, persona]);

    const resumenDeFiltros = () => [
        ...filtroBusqueda(texto),
        `Período: ${textoDelPeriodo(periodo)}`,
        ...(ingresos ? ["Sólo ingresos, salidas, intentos fallidos, bloqueos y contraseñas"] : []),
        ...(grupo ? [`Qué: ${GRUPOS_DE_INGRESO.find((g) => g.clave === grupo)?.texto ?? grupo}`] : []),
        ...(queAccion ? [`Acción: ${queAccion}`] : []),
        ...(queEntidad ? [`Qué: ${queEntidad}`] : []),
        ...(persona ? [`Persona: ${persona.nombre}`] : []),
        ...(soloFallidos ? ["Sólo lo que no se pudo"] : []),
    ];

    // Exportar: TODO lo filtrado, pedido recién al tocar (hasta TOPE_EXPORTAR).
    const excedido = useRef<number | null>(null);
    const cargarParaExportar = async (): Promise<Movimiento[]> => {
        if (viejos) return visiblesViejos;
        const q = parametrosDelRegistro(filtros);
        q.set("limite", String(TOPE_EXPORTAR));
        q.set("opciones", "false");
        q.set("con_detalle", ingresos ? "true" : "false"); // los ingresos exportan navegador e IP
        const r = await pedirMovimientos(q);
        excedido.current = (r.total ?? 0) > TOPE_EXPORTAR ? (r.total ?? 0) : null;
        if (excedido.current) {
            toast.warning(
                `Se bajaron los ${TOPE_EXPORTAR.toLocaleString("es-AR")} más recientes de `
                + `${excedido.current.toLocaleString("es-AR")}. Para el resto, acotá las fechas.`,
            );
        }
        return r.movimientos;
    };

    if (cargando) {
        return (
            <div className="flex items-center justify-center py-16">
                <Spinner className="h-8 w-8" />
            </div>
        );
    }

    const desdeN = desplazamiento + 1;
    const hastaN = desplazamiento + movs.length;

    return (
        <div className="space-y-4" ref={arriba}>
            {error && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                </div>
            )}

            {viejos && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                    {ingresos
                        ? "Los ingresos y las salidas se empiezan a registrar con la próxima actualización del servidor. Mientras tanto se ven los bloqueos, sobre los últimos 300 movimientos."
                        : "El servidor todavía no busca en todo el registro: se muestran y se filtran los últimos 300 movimientos."}
                </p>
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
                            placeholder={ingresos ? "Buscar: un nombre, un usuario…" : "Buscar: un nombre, un número de OT…"}
                            className="pl-8 h-9"
                        />
                    </div>
                    {!ingresos && (["creó", "editó", "eliminó"] as const).map((a) => {
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
                    {!ingresos && (
                        <Button
                            variant={soloFallidos ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSoloFallidos(!soloFallidos)}
                            className="h-9"
                            title="Lo que alguien intentó hacer y no se pudo"
                        >
                            <AlertCircle className={cn("h-4 w-4 mr-1.5", !soloFallidos && "text-amber-600")} />
                            No se pudo
                        </Button>
                    )}
                </div>

                {ingresos && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {GRUPOS_DE_INGRESO.map((g) => {
                            const activo = grupo === g.clave;
                            const esFallido = g.clave === "fallidos";
                            return (
                                <button
                                    key={g.clave}
                                    type="button"
                                    onClick={() => setGrupo(activo ? null : g.clave)}
                                    aria-pressed={activo}
                                    className={cn(
                                        "text-xs px-2.5 py-1 rounded-full border transition-colors",
                                        activo
                                            ? (esFallido ? "bg-rose-600 text-white border-rose-600" : "bg-primary text-primary-foreground border-primary")
                                            : (esFallido ? "border-rose-200 text-rose-700 hover:bg-rose-50" : "hover:bg-muted text-muted-foreground"),
                                    )}
                                >
                                    {g.texto}
                                </button>
                            );
                        })}
                    </div>
                )}

                <FiltroDeFechas periodo={periodo} onCambiar={setPeriodo} />

                <div className="flex items-center gap-1.5 flex-wrap">
                    <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3.5 w-3.5" />
                        <span className="sr-only">Persona</span>
                        <select
                            value={persona ? String(persona.id) : ""}
                            onChange={(e) => {
                                const id = Number(e.target.value);
                                const p = opcionesDePersona.find((o) => o.id === id);
                                setPersona(e.target.value && p ? p : null);
                            }}
                            aria-label="Persona"
                            className="h-7 max-w-[220px] rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                            <option value="">Todas las personas</option>
                            {opcionesDePersona.map((p) => (
                                <option key={p.id} value={String(p.id)}>{p.nombre}</option>
                            ))}
                        </select>
                    </label>
                    {!ingresos && (
                        <>
                            <Filter className="h-3.5 w-3.5 text-muted-foreground ml-1 mr-0.5" />
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
                        </>
                    )}
                    {hayFiltro && (
                        <Button variant="ghost" size="sm" onClick={limpiar} className="h-7 text-xs">
                            <X className="h-3 w-3 mr-1" />
                            Ver todo
                        </Button>
                    )}
                </div>
            </div>

            <section className="rounded-lg border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold flex items-center gap-2 min-w-0">
                        <span className="truncate">
                            {total.toLocaleString("es-AR")} {ingresos ? (total === 1 ? "registro" : "registros") : (total === 1 ? "movimiento" : "movimientos")}
                            {hayFiltro && <span className="font-normal text-muted-foreground"> con lo que elegiste</span>}
                        </span>
                        {actualizando && <Spinner className="h-3.5 w-3.5 shrink-0" />}
                    </h2>
                    <ExportarMenu
                        titulo={ingresos ? "Auditoría · Ingresos" : "Auditoría · Todo lo que se hizo"}
                        archivo={ingresos ? "auditoria_ingresos" : "auditoria_movimientos"}
                        cantidad={Math.min(total, TOPE_EXPORTAR)}
                        cargarFilas={cargarParaExportar}
                        columnas={ingresos ? COLUMNAS_EXPORT_INGRESOS : COLUMNAS_EXPORT}
                        aviso={total > TOPE_EXPORTAR
                            ? `Hay ${total.toLocaleString("es-AR")}: se bajan los ${TOPE_EXPORTAR.toLocaleString("es-AR")} más recientes. Para el resto, acotá las fechas.`
                            : undefined}
                        filtros={() => [
                            ...resumenDeFiltros(),
                            ...(viejos ? [`Sobre los ${TOPE_VIEJO} movimientos más recientes`] : []),
                            ...(excedido.current
                                ? [`Se exportaron los ${TOPE_EXPORTAR.toLocaleString("es-AR")} más recientes de ${excedido.current.toLocaleString("es-AR")}`]
                                : []),
                        ]}
                    />
                </div>

                {movs.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        {!hayFiltro ? (
                            ingresos ? (
                                <>
                                    Todavía no hay ingresos registrados. Desde la actualización del 23/09,
                                    cada entrada, salida e intento fallido queda acá: quién, cuándo y desde dónde.
                                </>
                            ) : (
                                <>
                                    Todavía no hay nada registrado. Desde ahora, cada vez que alguien
                                    cargue, edite o borre algo queda acá: quién, cuándo y qué.
                                </>
                            )
                        ) : (
                            <>Ningún movimiento coincide con lo que estás buscando.</>
                        )}
                    </p>
                ) : (
                    <ul className={cn("divide-y transition-opacity", actualizando && "opacity-60")}>
                        {movs.map((m) => {
                            const Icono = ICONO[m.accion] ?? Pencil;
                            const activo = abierto === m.id;
                            const fallido = m.accion === "intento fallido" || (!m.salio_bien && ingresos);
                            const origen = ingresos ? origenDelIngreso(m) : {};
                            return (
                                <li key={m.id} className={cn(
                                    fallido && "bg-rose-50/70",
                                    m.accion === "bloqueó" && "bg-amber-50/70",
                                )}>
                                    <button
                                        type="button"
                                        onClick={() => setAbierto(activo ? null : m.id)}
                                        className={cn(
                                            "w-full px-3 sm:px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 text-left transition-colors",
                                            activo ? "bg-muted/40" : "hover:bg-muted/30"
                                        )}
                                    >
                                        <Icono className={cn("h-4 w-4 shrink-0", COLOR[m.accion] ?? "text-muted-foreground")} />
                                        <span className="text-sm tabular-nums text-muted-foreground shrink-0 w-[6.75rem]">
                                            {cuandoCorto(m.cuando)}
                                        </span>
                                        {/* La frase entera, que es lo único que hay que leer.
                                            En el teléfono (RF-27) va en su propio renglón, abajo
                                            de la fecha y a todo el ancho: al lado de la fecha y
                                            del reloj le quedaban 90px y se leía una palabra por
                                            renglón. Desde `sm`, en la fila y cortada, como antes. */}
                                        {/* En Ingresos no se corta: el porqué («contraseña
                                            incorrecta, le quedan 3») va al final de la frase. */}
                                        <span
                                            title={ingresos ? undefined : m.descripcion}
                                            className={cn(
                                                "text-sm min-w-0 break-words order-last basis-full pl-7 sm:order-none sm:basis-auto sm:pl-0",
                                                ingresos ? "sm:flex-1" : "sm:truncate",
                                                m.salio_bien && !fallido ? "text-gray-700" : "text-rose-700"
                                            )}>
                                            {m.descripcion}
                                            {/* En el teléfono, de dónde vino va abajo de la frase:
                                                en el primer renglón no entra al lado de la fecha. */}
                                            {(origen.navegador || origen.ip) && (
                                                <span className="block sm:hidden text-xs text-muted-foreground">
                                                    {[origen.navegador, origen.ip].filter(Boolean).join(" · ")}
                                                </span>
                                            )}
                                        </span>
                                        {/* El que empuja lo de la derecha. En Ingresos, desde `sm`,
                                            lo hace la frase misma (que ocupa el lugar y no se corta). */}
                                        <span className={cn("flex-1", ingresos && "sm:hidden")} />
                                        {(origen.navegador || origen.ip) && (
                                            <span className="hidden sm:inline text-xs text-muted-foreground shrink-0 truncate max-w-[14rem]"
                                                  title={[origen.navegador, origen.ip].filter(Boolean).join(" · ")}>
                                                {[origen.navegador, origen.ip].filter(Boolean).join(" · ")}
                                            </span>
                                        )}
                                        {/* La frase ya dice «no se pudo»; el cartel agrega
                                            el código, que es lo único que ella no tiene. En
                                            Ingresos, «no entró» dice más que un número. */}
                                        {!m.salio_bien && (
                                            <Badge variant="outline" className="text-xs font-normal shrink-0 border-rose-200 text-rose-700">
                                                {ingresos || m.accion === "intento fallido" ? "no se pudo" : `error ${m.estado}`}
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

                {/* Las páginas. Con el backend viejo no hay: son los 300 de siempre. */}
                {!viejos && total > POR_PAGINA && (
                    <div className="px-3 sm:px-4 py-2 border-t bg-muted/20 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <Button
                            variant="outline" size="sm" className="h-8"
                            disabled={desplazamiento === 0 || actualizando}
                            onClick={() => irA(desplazamiento - POR_PAGINA)}
                        >
                            <ChevronLeft className="h-3.5 w-3.5 sm:mr-1" />
                            <span className="hidden sm:inline">Más nuevos</span>
                        </Button>
                        <span className="tabular-nums text-center">
                            {desdeN.toLocaleString("es-AR")}–{hastaN.toLocaleString("es-AR")} de {total.toLocaleString("es-AR")}
                        </span>
                        <Button
                            variant="outline" size="sm" className="h-8"
                            disabled={!pagina?.hayMas || actualizando}
                            onClick={() => irA(desplazamiento + POR_PAGINA)}
                        >
                            <span className="hidden sm:inline">Más viejos</span>
                            <ChevronRight className="h-3.5 w-3.5 sm:ml-1" />
                        </Button>
                    </div>
                )}
            </section>
        </div>
    );
}
