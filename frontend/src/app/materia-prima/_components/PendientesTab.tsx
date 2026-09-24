"use client";

/**
 * Pendientes: la pantalla de Maxi para comprar.
 *
 * Reemplaza a «Materias Primas Pendientes» del sistema viejo: las materias primas de
 * las OT de la semana, con lo que falta pedir arriba, y las marcas de siempre (Pedido /
 * Reserva / Disponible / PRODUC, proveedor, fecha del proveedor, fecha de entrega) que
 * ahora se guardan solas, sin «Grabar».
 *
 * LA SEMANA
 *
 * En el viejo salía de un plan semanal cargado a mano. Acá la pone el planificador: una
 * OT «es de la semana» si está abierta y tiene algún proceso planificado que arranca
 * antes del domingo (incluye las que se arrastran). Lo resuelve el backend; la pantalla
 * elige el lunes. Además: «Todas las OT abiertas» (sin mirar el plan) y una OT sola
 * (el N° OT, o tocarla en la cañera de arriba).
 *
 * QUÉ SE VE Y CUÁNDO CAMBIA
 *
 * Los radios, el buscador, el proveedor y las tarjetas filtran acá, sin volver a pedir
 * (ver PendientesDatos). La lista que se ve se arma cuando cambia un filtro o llegan
 * datos del servidor, y NO cuando se guarda un cambio: si Maxi tilda «Disponible» con
 * el radio en «Pendientes», la fila se pone verde y se queda donde está hasta que él
 * cambie de filtro o toque «Actualizar». Que las filas se fueran debajo del cursor era
 * justo lo que no podía pasar en una pantalla donde se marcan diez seguidas.
 *
 * Contrato con la página (app/materia-prima/page.tsx): export con nombre, `edita` y
 * `otInicial` (el `?ot=N` de un enlace; la página vuelve a montar la solapa con cada
 * enlace nuevo, así que alcanza con leerlo al montar). `espejo` + `activo`: en la prueba
 * piloto (ver ModoEspejo.tsx) la semana y la cañera se vuelven a pedir solas mientras la
 * solapa está a la vista; `edita` ya llega en false.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
    AlertTriangle,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    CircleAlert,
    Clock,
    ClipboardList,
    Grid3x3,
    Loader2,
    Printer,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { FilasDeATandas } from "@/components/common/FilasDeATandas";
import { PieDeTandas } from "@/components/common/PieDeTandas";
import { useDeATandas } from "@/hooks/useDeATandas";
import { filtroBusqueda } from "@/lib/exportar";
import { cn } from "@/lib/utils";
import {
    AVISO_SIN_SERVIDOR,
    estadoLinea,
    hoyISO,
    lunesDe,
    rotuloSemana,
    sumarDias,
    type CambiosDeLote,
    type EstadoLinea,
    type FiltroPendientes,
    type LineaPendiente,
    type OTPendiente,
} from "@/lib/materiaPrima";
import { CaneraContexto, celdasPorOT, useCanera, type ContextoCanera } from "./CaneraDatos";
import { GrillaCanera } from "./GrillaCanera";
import { useConfirmarForzar } from "./PendientesForzar";
import { usePendientes } from "./PendientesDatos";
import { useRefrescoEspejo } from "./ModoEspejo";
import { FilaPendiente, Th, type AccionesFila } from "./PendientesFila";
import { BarraDeAcciones } from "./PendientesAcciones";
import { COLUMNAS_EXPORT, imprimirGrilla, imprimirPorProveedor, type FilaSalida } from "./PendientesImprimir";

export interface PendientesTabProps {
    edita: boolean;
    otInicial?: number | null;
    /** Prueba piloto: el dueño es el Sistema Integral (ver ModoEspejo.tsx). */
    espejo?: boolean;
    /** La solapa está a la vista. Por defecto, true. */
    activo?: boolean;
}

/** La cañera de arriba, abierta o cerrada: se recuerda en este navegador. */
const CLAVE_CANERA_ABIERTA = "spmm_mp_pendientes_canera_abierta";

const RADIOS: { valor: FiltroPendientes; rotulo: string; ayuda: string }[] = [
    { valor: "pendientes", rotulo: "Pendientes", ayuda: "Lo que todavía no está disponible" },
    { valor: "parciales", rotulo: "Parciales", ayuda: "Las OT que tienen parte del material y les falta otra parte (todas sus líneas)" },
    { valor: "todas", rotulo: "Todas", ayuda: "Todas las líneas, también las que ya están disponibles" },
];

/** Para filtrar por proveedor: el nombre sin mayúsculas ni espacios de más. "~" = sin proveedor. */
const claveProveedor = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase() || "~";
const normalBusqueda = (s: string | null | undefined) =>
    (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");

/** Una fila de la lista que se ve: la línea (por id) y cómo se agrupa con sus vecinas. */
interface Visible {
    id: number;
    primera: boolean;
    zebra: boolean;
}

export function PendientesTab({ edita, otInicial, espejo = false, activo = true }: PendientesTabProps) {
    const router = useRouter();
    const { confirmar, dialogo } = useConfirmarForzar();
    const canera = useCanera({ confirmar });

    // ─────────────── filtros ───────────────
    const [semana, setSemana] = useState(() => lunesDe(hoyISO()));
    const [todasAbiertas, setTodasAbiertas] = useState(false);
    const [otTexto, setOtTexto] = useState(otInicial ? String(otInicial) : "");
    const [ot, setOt] = useState<number | null>(otInicial ?? null);
    // Con una OT sola, lo normal es querer verla entera (lo que llegó también).
    const [filtro, setFiltro] = useState<FiltroPendientes>(otInicial ? "todas" : "pendientes");
    const [estadoRapido, setEstadoRapido] = useState<EstadoLinea | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const busquedaDiferida = useDeferredValue(busqueda);
    const [proveedor, setProveedor] = useState<string>("");

    // El N° OT se pide al servidor (cambia el universo): se espera a que termine de escribir.
    useEffect(() => {
        const t = otTexto.trim();
        const n = /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
        if (n === ot) return;
        const espera = setTimeout(() => setOt(n), t ? 400 : 0);
        return () => clearTimeout(espera);
    }, [otTexto, ot]);

    const p = usePendientes({ semana, todasAbiertas, ot }, confirmar);
    // Modo espejo: lo que marcan en el Integral aparece solo (lo mismo que «Actualizar»).
    useRefrescoEspejo(espejo && activo, () => {
        void p.recargar();
        void canera.recargar();
    });

    // ─────────────── cañera de arriba ───────────────
    const [caneraAbierta, setCaneraAbierta] = useState(true);
    useEffect(() => {
        try {
            const v = localStorage.getItem(CLAVE_CANERA_ABIERTA);
            if (v !== null) setCaneraAbierta(v === "1");
        } catch {
            // Sin almacenamiento (modo privado estricto): queda abierta, como viene.
        }
    }, []);
    const alternarCanera = () =>
        setCaneraAbierta((a) => {
            try {
                localStorage.setItem(CLAVE_CANERA_ABIERTA, a ? "0" : "1");
            } catch {
                // No se recuerda; no pasa nada.
            }
            return !a;
        });

    const contextoCanera = useMemo<ContextoCanera>(
        () => ({ estado: canera, celdasPorOT: celdasPorOT(canera.canera) }),
        [canera],
    );

    // ─────────────── lo que se ve ───────────────
    const lineas = p.lineas;
    const porId = useMemo(() => new Map(lineas.map((l) => [l.id, l])), [lineas]);
    const otsPorId = useMemo(() => new Map((p.datos?.ots ?? []).map((o) => [o.id, o])), [p.datos?.ots]);

    /**
     * Las filas que se ven. Se arma de nuevo sólo cuando cambia un filtro o llegan datos
     * nuevos del servidor (`p.carga`), NO con cada guardado: `lineas` no está en las
     * dependencias a propósito (ver el comentario de arriba del archivo). Cuando se arma,
     * lee las líneas como están en ese momento, con los cambios ya hechos.
     */
    const visibles = useMemo<Visible[]>(() => {
        const tokens = normalBusqueda(busquedaDiferida).split(" ").filter(Boolean);
        // Parciales: las OT con al menos una línea disponible y al menos una que no.
        const parcial = new Map<number, { si: boolean; no: boolean }>();
        if (filtro === "parciales") {
            for (const l of lineas) {
                const e = parcial.get(l.id_orden_trabajo) ?? { si: false, no: false };
                if (l.disponible) e.si = true;
                else e.no = true;
                parcial.set(l.id_orden_trabajo, e);
            }
        }
        const salida: Visible[] = [];
        let otAnterior: number | null = null;
        let tramo = -1;
        for (const l of lineas) {
            if (filtro === "pendientes" && l.disponible) continue;
            if (filtro === "parciales") {
                const e = parcial.get(l.id_orden_trabajo);
                if (!e?.si || !e.no) continue;
            }
            if (estadoRapido && estadoLinea(l) !== estadoRapido) continue;
            if (proveedor && claveProveedor(l.proveedor) !== proveedor) continue;
            if (tokens.length) {
                const texto = normalBusqueda(
                    [l.codigo, l.descripcion, l.proveedor, l.observaciones, l.numero_ot].filter(Boolean).join(" "),
                );
                if (!tokens.every((t) => texto.includes(t))) continue;
            }
            const primera = l.id_orden_trabajo !== otAnterior;
            if (primera) tramo++;
            otAnterior = l.id_orden_trabajo;
            salida.push({ id: l.id, primera, zebra: tramo % 2 === 1 });
        }
        return salida;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `lineas` NO va: ver arriba
    }, [p.carga, filtro, estadoRapido, proveedor, busquedaDiferida]);

    /** Las tarjetas: sobre el universo, antes del radio (como las cuenta el backend), y siguiendo cada tilde. */
    const resumen = useMemo(() => {
        let aPedir = 0;
        let esperando = 0;
        let listas = 0;
        for (const l of lineas) {
            const e = estadoLinea(l);
            if (e === "falta_pedir") aPedir++;
            else if (e === "esperando") esperando++;
            else if (e === "lista") listas++;
        }
        return { ots: p.datos?.resumen.ot_count ?? p.datos?.ots.length ?? 0, aPedir, esperando, listas };
    }, [lineas, p.datos]);

    /** Los proveedores de las líneas cargadas, con cuántas faltan pedir de cada uno. */
    const proveedores = useMemo(() => {
        const m = new Map<string, { nombre: string; total: number; aPedir: number }>();
        for (const l of lineas) {
            const k = claveProveedor(l.proveedor);
            const e = m.get(k) ?? { nombre: l.proveedor?.trim() || "Sin proveedor", total: 0, aPedir: 0 };
            e.total++;
            if (estadoLinea(l) === "falta_pedir") e.aPedir++;
            m.set(k, e);
        }
        return [...m.entries()].sort(([a, x], [b, y]) => (a === "~" ? 1 : b === "~" ? -1 : x.nombre.localeCompare(y.nombre, "es")));
    }, [lineas]);

    // ─────────────── selección ───────────────
    const [seleccion, setSeleccion] = useState<Set<number>>(() => new Set());
    const ultimaTocada = useRef<number | null>(null);
    const visiblesRef = useRef(visibles);
    useEffect(() => {
        visiblesRef.current = visibles;
        // Lo elegido que dejó de verse se suelta: una acción masiva sobre filas escondidas
        // sería una sorpresa.
        const ids = new Set(visibles.map((v) => v.id));
        setSeleccion((s) => {
            const quedan = [...s].filter((id) => ids.has(id));
            return quedan.length === s.size ? s : new Set(quedan);
        });
    }, [visibles]);

    const seleccionar = useCallback((id: number, conShift: boolean) => {
        setSeleccion((s) => {
            const nueva = new Set(s);
            const marcar = !s.has(id);
            const vis = visiblesRef.current;
            const desde = ultimaTocada.current;
            if (conShift && desde !== null && desde !== id) {
                const i = vis.findIndex((v) => v.id === desde);
                const j = vis.findIndex((v) => v.id === id);
                if (i >= 0 && j >= 0) {
                    const [a, b] = i < j ? [i, j] : [j, i];
                    for (let k = a; k <= b; k++) {
                        if (marcar) nueva.add(vis[k].id);
                        else nueva.delete(vis[k].id);
                    }
                    return nueva;
                }
            }
            if (marcar) nueva.add(id);
            else nueva.delete(id);
            return nueva;
        });
        ultimaTocada.current = id;
    }, []);

    const todasElegidas = visibles.length > 0 && visibles.every((v) => seleccion.has(v.id));
    const algunaElegida = seleccion.size > 0;
    const elegirTodas = () => setSeleccion(todasElegidas ? new Set() : new Set(visibles.map((v) => v.id)));

    // Escape suelta la selección (si no hay un diálogo o cartel abierto que lo use antes).
    useEffect(() => {
        if (!algunaElegida) return;
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (document.querySelector('[role="dialog"]')) return;
            setSeleccion(new Set());
        };
        window.addEventListener("keydown", alTeclear);
        return () => window.removeEventListener("keydown", alTeclear);
    }, [algunaElegida]);

    // ─────────────── acciones ───────────────
    const otsPorIdRef = useRef(otsPorId);
    useEffect(() => {
        otsPorIdRef.current = otsPorId;
    }, [otsPorId]);
    const { guardar, guardarLote } = p;
    const asignarCelda = canera.asignar;
    const acciones = useMemo<AccionesFila>(
        () => ({
            guardar,
            seleccionar,
            abrirOT: (id) => router.push(`/operaciones?edit_ot=${id}`),
            verInsumo: (idPieza) => router.push(`/materia-prima?tab=insumos&pieza=${idPieza}`),
            ubicar: (l, celda) => {
                if (l.numero_ot === null || l.numero_ot === undefined) return;
                const o = otsPorIdRef.current.get(l.id_orden_trabajo);
                void asignarCelda(celda, l.numero_ot, {
                    id_orden_trabajo: l.id_orden_trabajo,
                    cliente: o?.cliente ?? null,
                    articulo: o?.articulo ?? null,
                    // Lo que se sabe ya: si todas sus líneas están listas, verde; si no, ámbar.
                    // El backend manda el de verdad en la respuesta.
                    estado_material: o && o.lineas_total > 0 && o.lineas_listas >= o.lineas_total ? "ok" : "pedido",
                });
            },
        }),
        [guardar, seleccionar, router, asignarCelda],
    );
    const [lotePendiente, setLotePendiente] = useState(false);
    const aplicarLote = async (cambios: CambiosDeLote, que: string) => {
        const ids = [...seleccion];
        setLotePendiente(true);
        const ok = await guardarLote(ids, cambios, que);
        setLotePendiente(false);
        if (ok) setSeleccion(new Set());
    };
    const quitarMarcas = async () => {
        const ids = [...seleccion];
        const reservadasDisponibles = ids.filter((id) => {
            const l = porId.get(id);
            return l?.reserva && l.disponible;
        }).length;
        const si = await confirmar({
            titulo: `Quitar las marcas de ${ids.length} línea${ids.length === 1 ? "" : "s"}`,
            motivo:
                "Pedido, Reserva y Disponible vuelven a cero: las líneas quedan otra vez «Falta pedir»." +
                (reservadasDisponibles
                    ? `\n\n${reservadasDisponibles} ya se habían retirado del stock (estaban reservadas y disponibles): el retiro se anula y el material vuelve al stock.`
                    : ""),
            boton: "Quitar marcas",
        });
        if (si) await aplicarLote({ pedido: false, reserva: false, disponible: false }, "Quitar marcas");
    };

    // ─────────────── salidas (imprimir / exportar) ───────────────
    const filasSalida = useCallback((): FilaSalida[] => {
        const mapa = contextoCanera.estado.canera ? contextoCanera.celdasPorOT : null;
        return visibles
            .map((v) => porId.get(v.id))
            .filter((l): l is LineaPendiente => !!l)
            .map((l) => ({ linea: l, celdas: mapa ? (mapa.get(l.id_orden_trabajo) ?? []) : (l.celdas ?? []) }));
    }, [visibles, porId, contextoCanera]);

    const rotuloUniverso = ot
        ? `OT ${ot}`
        : todasAbiertas
            ? "Todas las OT abiertas"
            : rotuloSemana(semana);
    const filtrosTexto = (): string[] => [
        rotuloUniverso,
        `Líneas: ${RADIOS.find((r) => r.valor === filtro)?.rotulo ?? filtro}`,
        ...(estadoRapido ? [`Sólo: ${estadoRapido === "falta_pedir" ? "a pedir" : estadoRapido === "esperando" ? "esperando" : "listas"}`] : []),
        ...(proveedor ? [`Proveedor: ${proveedores.find(([k]) => k === proveedor)?.[1].nombre ?? proveedor}`] : []),
        ...filtroBusqueda(busqueda),
    ];

    // ─────────────── «Guardado» que se apaga solo ───────────────
    const { estadoGuardado, olvidarGuardado } = p;
    const recargarCanera = canera.recargar;
    useEffect(() => {
        if (estadoGuardado !== "error") return;
        const t = setTimeout(olvidarGuardado, 8000);
        return () => clearTimeout(t);
    }, [estadoGuardado, olvidarGuardado]);
    useEffect(() => {
        if (estadoGuardado !== "guardado") return;
        // El color de cada casillero es el estado del material de su OT, que lo calcula
        // el backend: después de una tanda de tildes, la cañera de arriba se vuelve a
        // pedir para que el verde/ámbar siga a lo que se marcó.
        void recargarCanera();
        const t = setTimeout(olvidarGuardado, 2500);
        return () => clearTimeout(t);
    }, [estadoGuardado, olvidarGuardado, recargarCanera]);

    // ─────────────── dibujo ───────────────
    const { setCaja, estilo: estiloCaja } = useCajaFija();
    const tandas = useDeATandas(visibles, `${p.carga}|${filtro}|${estadoRapido}|${proveedor}|${busquedaDiferida}`);
    const render = useCallback(
        (v: Visible) => {
            const l = porId.get(v.id);
            if (!l) return null;
            return (
                <FilaPendiente
                    key={v.id}
                    linea={l}
                    ot={otsPorId.get(l.id_orden_trabajo)}
                    edita={edita}
                    seleccionada={seleccion.has(v.id)}
                    primera={v.primera}
                    zebra={v.zebra}
                    acciones={acciones}
                />
            );
        },
        [porId, otsPorId, edita, seleccion, acciones],
    );

    const irASemana = (dias: number) => {
        setSemana((s) => lunesDe(sumarDias(s, dias)));
        setEstadoRapido(null);
    };
    const estaSemana = lunesDe(hoyISO());
    const semanaInactiva = todasAbiertas || ot !== null;
    const hayFiltrosLocales = filtro !== "pendientes" || !!estadoRapido || !!proveedor || !!busqueda.trim();
    const limpiarFiltrosLocales = () => {
        setFiltro("pendientes");
        setEstadoRapido(null);
        setProveedor("");
        setBusqueda("");
    };
    const elegirOT = (n: number | null) => {
        setOtTexto(n ? String(n) : "");
        setOt(n);
        setEstadoRapido(null);
        setSeleccion(new Set());
    };
    const tarjeta = (e: EstadoLinea | null) => {
        if (e === null) {
            setEstadoRapido(null);
            setFiltro("todas");
            return;
        }
        if (estadoRapido === e) {
            setEstadoRapido(null);
            return;
        }
        setEstadoRapido(e);
        // «Listas» no entra en «Pendientes» (que es lo no disponible): se abre el radio.
        if (e === "lista" && filtro === "pendientes") setFiltro("todas");
    };

    const elegidas = [...seleccion].map((id) => porId.get(id)).filter((l): l is LineaPendiente => !!l);
    const universoVacio = !!p.datos && p.datos.ots.length === 0;
    const sinLineas = !!p.datos && p.datos.ots.length > 0 && lineas.length === 0;

    return (
        <CaneraContexto.Provider value={contextoCanera}>
            <div className="space-y-3">
                {/* ── Filtros: el universo (lo pide el servidor) ── */}
                <div className="flex flex-wrap items-center gap-2">
                    <div
                        className={cn(
                            "flex items-center rounded-lg border border-gray-200 bg-white",
                            semanaInactiva && "opacity-50",
                        )}
                        title={semanaInactiva ? "Con «Todas las OT abiertas» o con una OT sola no se mira la semana" : undefined}
                    >
                        <button
                            type="button"
                            onClick={() => irASemana(-7)}
                            disabled={semanaInactiva}
                            className="rounded-l-lg p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed"
                            aria-label="Semana anterior"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <label className="relative flex cursor-pointer items-center gap-1.5 px-1 text-sm font-medium text-gray-800">
                            <CalendarDays className="h-4 w-4 text-gray-400" />
                            <span className="whitespace-nowrap">{rotuloSemana(semana)}</span>
                            {/* El selector de fecha va encima del rótulo, invisible: se toca la
                                semana y se abre el calendario. Cualquier día elige su semana. */}
                            <input
                                type="date"
                                value={semana}
                                disabled={semanaInactiva}
                                onChange={(e) => {
                                    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                                        setSemana(lunesDe(e.target.value));
                                        setEstadoRapido(null);
                                    }
                                }}
                                onClick={(e) => {
                                    // Invisible encima del rótulo: el calendario no se abriría solo
                                    // (sólo lo abre el iconito del campo), así que se abre a mano.
                                    try {
                                        e.currentTarget.showPicker?.();
                                    } catch {
                                        // Navegador viejo: queda el campo, se puede escribir la fecha.
                                    }
                                }}
                                className="absolute inset-0 cursor-pointer opacity-0"
                                aria-label="Elegir la semana"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => irASemana(7)}
                            disabled={semanaInactiva}
                            className="rounded-r-lg p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed"
                            aria-label="Semana siguiente"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    {semana !== estaSemana && !semanaInactiva && (
                        <button
                            type="button"
                            onClick={() => setSemana(estaSemana)}
                            className="rounded-full px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                            Esta semana
                        </button>
                    )}

                    <button
                        type="button"
                        role="switch"
                        aria-checked={todasAbiertas}
                        disabled={ot !== null}
                        onClick={() => {
                            setTodasAbiertas((t) => !t);
                            setEstadoRapido(null);
                        }}
                        className={cn(
                            "inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
                            todasAbiertas ? "border-blue-300 bg-blue-50 text-blue-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                        )}
                        title="Todas las OT abiertas, estén o no en el plan de esta semana"
                    >
                        <span
                            className={cn(
                                "relative inline-block h-4 w-7 rounded-full transition-colors",
                                todasAbiertas ? "bg-blue-600" : "bg-gray-300",
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                                    todasAbiertas ? "left-3.5" : "left-0.5",
                                )}
                            />
                        </span>
                        Todas las OT abiertas
                    </button>

                    <div className="relative w-32">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input
                            value={otTexto}
                            onChange={(e) => setOtTexto(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    const t = otTexto.trim();
                                    setOt(/^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null);
                                }
                            }}
                            placeholder="N° OT"
                            inputMode="numeric"
                            className={cn(
                                "h-9 w-full rounded-lg border pl-8 pr-7 text-sm outline-none focus:ring-2",
                                ot !== null ? "border-blue-300 bg-blue-50 focus:ring-blue-100" : "border-gray-200 focus:border-blue-400 focus:ring-blue-100",
                            )}
                            aria-label="Número de OT"
                        />
                        {otTexto && (
                            <button
                                type="button"
                                onClick={() => elegirOT(null)}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:bg-gray-100"
                                aria-label="Quitar la OT"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                        <IndicadorGuardado estado={estadoGuardado} />
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9"
                            onClick={() => {
                                void p.recargar();
                                void canera.recargar();
                            }}
                            disabled={p.cargando}
                            title="Volver a traer la semana (las filas que ya no entran en el filtro se van)"
                        >
                            {p.cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            <span className="ml-1.5 hidden sm:inline">Actualizar</span>
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-9" disabled={!p.datos || !visibles.length}>
                                    <Printer className="h-4 w-4" />
                                    <span className="ml-1.5 hidden sm:inline">Imprimir</span>
                                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuLabel className="text-xs text-gray-500">
                                    Imprimir las {visibles.length} líneas que se ven
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onSelect={() => imprimirGrilla(filasSalida(), "Materias primas pendientes", rotuloUniverso, filtrosTexto())}
                                >
                                    <ClipboardList className="mr-2 h-4 w-4" />
                                    <span>
                                        Como se ve
                                        <span className="block text-[11px] text-gray-500">Una línea por OT, con las marcas</span>
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onSelect={() => imprimirPorProveedor(filasSalida(), "Lista para pedir", rotuloUniverso, filtrosTexto())}
                                >
                                    <Printer className="mr-2 h-4 w-4" />
                                    <span>
                                        Agrupada por proveedor
                                        <span className="block text-[11px] text-gray-500">La lista para pedir, con cantidades sumadas</span>
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <ExportarMenu
                            titulo="Materias primas pendientes"
                            archivo="materia_prima_pendientes"
                            secciones={() => [{ titulo: "Pendientes", filas: filasSalida(), columnas: COLUMNAS_EXPORT }]}
                            cantidad={visibles.length}
                            filtros={filtrosTexto}
                            disabled={!p.datos}
                            className="h-9"
                        />
                    </div>
                </div>

                {ot !== null && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-900">
                        Mirando sólo la OT <b>{ot}</b> (sin mirar la semana).
                        <button type="button" onClick={() => elegirOT(null)} className="font-semibold underline">
                            Volver a {todasAbiertas ? "todas las OT abiertas" : "la semana"}
                        </button>
                    </div>
                )}

                {p.sinServidor && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{AVISO_SIN_SERVIDOR}</p>
                    </div>
                )}
                {p.error && !p.sinServidor && (
                    <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1">{p.error}</span>
                        <button type="button" onClick={() => void p.recargar()} className="font-semibold underline">
                            Reintentar
                        </button>
                    </div>
                )}

                {!p.sinServidor && (
                    <>
                        {/* ── Tarjetas (filtro rápido) ── */}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Tarjeta
                                titulo={ot ? "OT" : todasAbiertas ? "OT abiertas" : "OT de la semana"}
                                valor={resumen.ots}
                                icono={<ClipboardList className="h-4 w-4" />}
                                tono="text-gray-900"
                                activa={!estadoRapido && filtro === "todas"}
                                onClick={() => tarjeta(null)}
                                ayuda="Ver todas sus líneas"
                                cargando={p.cargando && !p.datos}
                            />
                            <Tarjeta
                                titulo="A pedir"
                                valor={resumen.aPedir}
                                icono={<CircleAlert className="h-4 w-4" />}
                                tono={resumen.aPedir ? "text-red-600" : "text-gray-400"}
                                activa={estadoRapido === "falta_pedir"}
                                onClick={() => tarjeta("falta_pedir")}
                                ayuda="Ni pedidas, ni reservadas, ni disponibles"
                                cargando={p.cargando && !p.datos}
                            />
                            <Tarjeta
                                titulo="Esperando"
                                valor={resumen.esperando}
                                icono={<Clock className="h-4 w-4" />}
                                tono={resumen.esperando ? "text-amber-600" : "text-gray-400"}
                                activa={estadoRapido === "esperando"}
                                onClick={() => tarjeta("esperando")}
                                ayuda="Pedidas o reservadas, todavía no llegaron"
                                cargando={p.cargando && !p.datos}
                            />
                            <Tarjeta
                                titulo="Listas"
                                valor={resumen.listas}
                                icono={<CheckCircle2 className="h-4 w-4" />}
                                tono={resumen.listas ? "text-green-600" : "text-gray-400"}
                                activa={estadoRapido === "lista"}
                                onClick={() => tarjeta("lista")}
                                ayuda="Disponibles para producción"
                                cargando={p.cargando && !p.datos}
                            />
                        </div>

                        {/* ── Cañera compacta ── */}
                        <div className="rounded-xl border border-gray-200 bg-white">
                            <button
                                type="button"
                                onClick={alternarCanera}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                                aria-expanded={caneraAbierta}
                            >
                                <Grid3x3 className="h-4 w-4 text-gray-400" />
                                <span className="text-sm font-semibold text-gray-800">Cañera</span>
                                <span className="text-xs text-gray-500">
                                    {canera.canera
                                        ? `${new Set(canera.canera.ocupaciones.map((o) => o.celda)).size} casilleros ocupados · tocá una OT para ver sus materias primas`
                                        : canera.cargando
                                            ? "cargando…"
                                            : ""}
                                </span>
                                <span className="ml-auto text-gray-400">
                                    {caneraAbierta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </span>
                            </button>
                            {caneraAbierta && (
                                <div className="border-t border-gray-100 px-2 pb-2 pt-1.5 sm:px-3">
                                    <GrillaCanera
                                        edita={edita}
                                        compacta
                                        estado={canera}
                                        resaltarOT={ot}
                                        onElegirOT={(n) => elegirOT(n)}
                                    />
                                </div>
                            )}
                        </div>

                        {/* ── Filtros de las líneas (acá, sin volver a pedir) ── */}
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="inline-flex rounded-lg bg-gray-100 p-0.5" role="radiogroup" aria-label="Qué líneas mostrar">
                                {RADIOS.map((r) => (
                                    <button
                                        key={r.valor}
                                        type="button"
                                        role="radio"
                                        aria-checked={filtro === r.valor}
                                        onClick={() => {
                                            setFiltro(r.valor);
                                            setEstadoRapido(null);
                                        }}
                                        title={r.ayuda}
                                        className={cn(
                                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                            filtro === r.valor ? "bg-white text-red-700 shadow-sm ring-1 ring-black/5" : "text-gray-500 hover:text-gray-800",
                                        )}
                                    >
                                        {r.rotulo}
                                    </button>
                                ))}
                            </div>

                            <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                    value={busqueda}
                                    onChange={(e) => setBusqueda(e.target.value)}
                                    placeholder="Código, descripción, proveedor…"
                                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-7 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    aria-label="Buscar en las líneas"
                                />
                                {busqueda && (
                                    <button
                                        type="button"
                                        onClick={() => setBusqueda("")}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:bg-gray-100"
                                        aria-label="Borrar la búsqueda"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>

                            <select
                                value={proveedor}
                                onChange={(e) => setProveedor(e.target.value)}
                                className={cn(
                                    "h-9 max-w-[14rem] rounded-lg border px-2 text-sm outline-none focus:ring-2 focus:ring-blue-100",
                                    proveedor ? "border-blue-300 bg-blue-50 text-blue-900" : "border-gray-200 bg-white text-gray-700",
                                )}
                                aria-label="Filtrar por proveedor"
                            >
                                <option value="">Todos los proveedores</option>
                                {proveedores.map(([k, v]) => (
                                    <option key={k} value={k}>
                                        {v.nombre} ({v.aPedir ? `${v.aPedir} a pedir de ` : ""}{v.total})
                                    </option>
                                ))}
                            </select>

                            {hayFiltrosLocales && (
                                <button
                                    type="button"
                                    onClick={limpiarFiltrosLocales}
                                    className="rounded-full px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                >
                                    Limpiar filtros
                                </button>
                            )}
                            <span className="ml-auto text-xs text-gray-500">
                                {p.datos ? `${visibles.length} de ${lineas.length} líneas` : ""}
                            </span>
                        </div>

                        {/* ── La grilla ── */}
                        {!p.datos ? (
                            p.cargando ? (
                                <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 py-16 text-sm text-gray-400">
                                    <Loader2 className="h-5 w-5 animate-spin" /> Buscando las materias primas…
                                </div>
                            ) : null
                        ) : universoVacio ? (
                            <Vacio
                                titulo={
                                    ot !== null
                                        ? `La OT ${ot} no está abierta o no tiene materias primas para comprar.`
                                        : todasAbiertas
                                            ? "No hay OT abiertas con materias primas."
                                            : `No hay OT planificadas en la ${rotuloSemana(semana).toLowerCase()}.`
                                }
                                detalle={
                                    ot === null && !todasAbiertas
                                        ? "La semana la arma el planificador: entran las OT abiertas con algún proceso que arranca antes del domingo. Si todavía no se planificó, no hay nada acá."
                                        : undefined
                                }
                            >
                                {ot === null && !todasAbiertas && (
                                    <Button
                                        size="sm"
                                        className="bg-red-700 text-white hover:bg-red-800"
                                        onClick={() => setTodasAbiertas(true)}
                                    >
                                        Ver todas las OT abiertas
                                    </Button>
                                )}
                                {ot !== null && (
                                    <Button size="sm" variant="outline" onClick={() => elegirOT(null)}>
                                        Quitar el filtro de OT
                                    </Button>
                                )}
                            </Vacio>
                        ) : sinLineas ? (
                            <Vacio
                                titulo={`${p.datos.ots.length === 1 ? "La OT no tiene" : `Las ${p.datos.ots.length} OT no tienen`} materias primas cargadas.`}
                                detalle="Se cargan en la solapa Materias primas de cada OT (o se marca que no lleva)."
                            />
                        ) : visibles.length === 0 ? (
                            <Vacio
                                titulo={
                                    filtro === "pendientes" && !estadoRapido && !proveedor && !busqueda.trim()
                                        ? "Todo el material está disponible."
                                        : "No hay líneas con estos filtros."
                                }
                            >
                                {hayFiltrosLocales && (
                                    <Button size="sm" variant="outline" onClick={limpiarFiltrosLocales}>
                                        Limpiar filtros
                                    </Button>
                                )}
                                {filtro === "pendientes" && (
                                    <Button size="sm" variant="outline" onClick={() => setFiltro("todas")}>
                                        Ver todas las líneas
                                    </Button>
                                )}
                            </Vacio>
                        ) : (
                            <>
                                <div
                                    ref={setCaja}
                                    style={estiloCaja}
                                    className={cn(
                                        // `z-0`: las cabeceras fijas de la tabla quedan adentro de esta
                                        // caja; sin eso, al bajar la página pasaban por encima de la
                                        // cabecera de la sección (las dos con z-30). La caja misma es
                                        // `sticky` (ver `useCajaFija`).
                                        "sticky z-0 min-h-[18rem] overflow-auto rounded-xl border border-gray-200 bg-white transition-opacity",
                                        // Otra semana en camino: lo que se ve es la anterior hasta que llegue.
                                        p.cargando && "opacity-60",
                                    )}
                                >
                                    <table className="w-full min-w-[1780px] border-separate border-spacing-0">
                                        <thead>
                                            <tr>
                                                {/* Los anchos, los mismos que la celda fija de cada fila (PendientesFila). */}
                                                <Th className={cn("left-0 z-30", edita ? "w-[148px] max-sm:w-[96px]" : "w-[116px] max-sm:w-[72px]")}>
                                                    <span className="flex items-center gap-2.5">
                                                        {edita && (
                                                            <input
                                                                type="checkbox"
                                                                checked={todasElegidas}
                                                                ref={(el) => {
                                                                    if (el) el.indeterminate = algunaElegida && !todasElegidas;
                                                                }}
                                                                onChange={elegirTodas}
                                                                className="ml-1 h-4 w-4 cursor-pointer accent-blue-600"
                                                                aria-label="Elegir todas las líneas que se ven"
                                                                title="Elegir todas las que se ven (Shift + clic en una fila elige un tramo)"
                                                            />
                                                        )}
                                                        OT
                                                    </span>
                                                </Th>
                                                <Th>Código</Th>
                                                <Th>Descripción</Th>
                                                <Th className="text-right">Cant</Th>
                                                <Th>Un</Th>
                                                <Th>Proveedor</Th>
                                                <Th>Observaciones</Th>
                                                <Th className="text-center" title="Pedido al proveedor">Pedido</Th>
                                                <Th className="text-center" title="Reservado del stock">Reserva</Th>
                                                <Th className="text-center" title="Disponible para producción">Disp</Th>
                                                <Th className="text-center" title="En producción (PRODUC)">Prod</Th>
                                                <Th title="La fecha que prometió el proveedor">Fecha prov</Th>
                                                <Th title="Cuándo llegó / quedó disponible">F. entrega</Th>
                                                <Th className="text-right" title="Stock físico menos lo reservado por otras OT">Stock libre</Th>
                                                <Th className="text-right">Reservado</Th>
                                                <Th className="text-right" title="Lo que queda por conseguir">Falta</Th>
                                                <Th>Cañera</Th>
                                                <Th className="text-center" title="Recortes disponibles de la pieza">Rec.</Th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <FilasDeATandas filas={visibles} mostradas={tandas.mostradas} tanda={tandas.tanda} render={render} />
                                        </tbody>
                                    </table>
                                    <PieDeTandas {...tandas} />
                                </div>
                                <p className="text-[11px] text-gray-400">
                                    Cada cambio se guarda solo. Las filas que dejan de entrar en el filtro (por ejemplo, las que marcás
                                    disponibles) se quedan a la vista hasta que cambies el filtro o toques «Actualizar».
                                </p>
                            </>
                        )}
                    </>
                )}

                {edita && algunaElegida && (
                    <BarraDeAcciones
                        cantidad={elegidas.length}
                        yaPedidas={elegidas.filter((l) => l.pedido).length}
                        yaDisponibles={elegidas.filter((l) => l.disponible).length}
                        ocupado={lotePendiente}
                        onAplicar={(c, que) => void aplicarLote(c, que)}
                        onQuitarMarcas={() => void quitarMarcas()}
                        onSoltar={() => setSeleccion(new Set())}
                    />
                )}

                {dialogo}
            </div>
        </CaneraContexto.Provider>
    );
}

export default PendientesTab;

// ═══════════════════════════ piezas chicas ═══════════════════════════

function Tarjeta({
    titulo,
    valor,
    icono,
    tono,
    activa,
    onClick,
    ayuda,
    cargando,
}: {
    titulo: string;
    valor: number;
    icono: ReactNode;
    tono: string;
    activa: boolean;
    onClick: () => void;
    ayuda: string;
    cargando: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={ayuda}
            aria-pressed={activa}
            className={cn(
                "rounded-xl border bg-white px-3 py-2 text-left transition-all hover:border-gray-300 hover:shadow-sm",
                activa ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-200",
            )}
        >
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                <span className={tono}>{icono}</span>
                {titulo}
            </span>
            <span className={cn("mt-0.5 block text-2xl font-bold tabular-nums", tono)}>
                {cargando ? <Loader2 className="my-1.5 h-5 w-5 animate-spin text-gray-300" /> : valor}
            </span>
        </button>
    );
}

function Vacio({ titulo, detalle, children }: { titulo: string; detalle?: string; children?: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-200 px-4 py-12 text-center">
            <p className="text-sm font-medium text-gray-700">{titulo}</p>
            {detalle && <p className="max-w-md text-xs text-gray-500">{detalle}</p>}
            {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
        </div>
    );
}

/** «Guardando… / Guardado / No se guardó»: discreto, al lado de los botones. */
function IndicadorGuardado({ estado }: { estado: ReturnType<typeof usePendientes>["estadoGuardado"] }) {
    if (!estado) return null;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap text-xs",
                estado === "guardando" ? "text-gray-500" : estado === "guardado" ? "text-green-700" : "text-rose-700",
            )}
            aria-live="polite"
        >
            {estado === "guardando" ? (
                <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando…
                </>
            ) : estado === "guardado" ? (
                <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Guardado
                </>
            ) : (
                <>
                    <AlertTriangle className="h-3.5 w-3.5" /> No se guardó
                </>
            )}
        </span>
    );
}

// ═══════════════════════════ la caja de la grilla ═══════════════════════════

/**
 * La grilla tiene cabecera fija Y scroll horizontal, y las dos cosas juntas no se
 * llevan: el scroll horizontal pide una caja con `overflow`, y adentro de esa caja la
 * cabecera sólo queda fija contra la caja, no contra la página. Así que la caja tiene
 * su propio scroll vertical, y para que eso no sea una ventanita:
 *
 *  · la caja mide lo que queda de pantalla debajo de la cabecera de la sección, y se
 *    queda pegada debajo de ella (`sticky`) al bajar: nunca queda tapada, ni la fila de
 *    títulos de la tabla con ella;
 *  · la rueda del mouse sobre la tabla baja primero la PÁGINA hasta que la tabla llega
 *    arriba, y recién ahí baja la tabla. Sin esto, con la cañera abierta, se veían tres
 *    filas y la rueda movía esas tres.
 *
 * La cabecera de la sección se busca sola (el primer `sticky; top: 0` que haya antes,
 * subiendo): así no depende de cómo la arme la página.
 */
function useCajaFija() {
    const [caja, setCaja] = useState<HTMLDivElement | null>(null);
    const [medidas, setMedidas] = useState<{ top: number; alto: number } | null>(null);

    useEffect(() => {
        if (!caja) return;
        const scroller = scrollerDe(caja);
        const cabecera = cabeceraFijaDe(caja);
        const medir = () => {
            const altoCabecera = cabecera?.getBoundingClientRect().height ?? 0;
            const altoVentana = scroller?.clientHeight ?? window.innerHeight;
            // Abajo de `lg` el menú es un botón redondo que flota abajo: se le deja lugar.
            const abajo = window.innerWidth < 1024 ? 84 : 16;
            const top = Math.round(altoCabecera + 8);
            setMedidas({ top, alto: Math.max(288, altoVentana - top - abajo) });
        };
        medir();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
        if (cabecera) ro?.observe(cabecera);
        if (scroller) ro?.observe(scroller);
        window.addEventListener("resize", medir);
        return () => {
            ro?.disconnect();
            window.removeEventListener("resize", medir);
        };
    }, [caja]);

    useEffect(() => {
        if (!caja || !medidas) return;
        const scroller = scrollerDe(caja);
        if (!scroller) return;
        const alRodar = (e: WheelEvent) => {
            const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            if (dy <= 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            const falta = caja.getBoundingClientRect().top - (scroller.getBoundingClientRect().top + medidas.top);
            const puedeBajar = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
            if (falta > 1 && puedeBajar) {
                e.preventDefault();
                scroller.scrollBy({ top: Math.min(dy, falta) });
            }
        };
        // `passive: false`: si no, el navegador no deja cancelar la rueda (y React la engancha pasiva).
        caja.addEventListener("wheel", alRodar, { passive: false });
        return () => caja.removeEventListener("wheel", alRodar);
    }, [caja, medidas]);

    const estilo = medidas
        ? { top: medidas.top, maxHeight: medidas.alto }
        : { top: 0, maxHeight: "calc(100svh - 9rem)" };
    return { setCaja, estilo };
}

/** El primer ancestro que scrollea de verdad en vertical (el <main> del layout). */
function scrollerDe(el: HTMLElement): HTMLElement | null {
    let actual = el.parentElement;
    while (actual && actual !== document.body) {
        const { overflowY } = getComputedStyle(actual);
        if (/(auto|scroll|overlay)/.test(overflowY) && actual.scrollHeight > actual.clientHeight + 1) return actual;
        actual = actual.parentElement;
    }
    return null;
}

/** La cabecera fija de la sección: un hermano anterior (de la caja o de algún ancestro) con `position: sticky; top: 0`. */
function cabeceraFijaDe(el: HTMLElement): HTMLElement | null {
    let hijo: Element = el;
    let padre = el.parentElement;
    while (padre && padre !== document.body) {
        for (const h of Array.from(padre.children)) {
            if (h === hijo) break;
            const cs = getComputedStyle(h);
            if (cs.position === "sticky" && cs.top === "0px") return h as HTMLElement;
        }
        hijo = padre;
        padre = padre.parentElement;
    }
    return null;
}
