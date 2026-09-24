"use client";

/**
 * La ficha de un insumo, al costado de la lista (en el teléfono, la pantalla entera).
 *
 * Arriba lo que se busca de un vistazo (código, descripción, cuánto hay libre, precio,
 * dónde está) y abajo cinco solapas, una por pregunta:
 *
 *   · General  — qué es: el formulario (FormularioInsumo), el mismo del alta.
 *   · Stock    — cuánto hay y por qué: los movimientos, las reservas.
 *   · Recortes — los tramos que sobraron.
 *   · OT       — en qué órdenes se usó.
 *   · Precios  — lo que se pagó.
 *
 * Las solapas se montan la primera vez que se abren y quedan montadas: ir a Stock y
 * volver a General no pierde lo que se estaba escribiendo. Lo que cambia en una
 * solapa (un movimiento, un precio, un recorte) se ve al instante en la cabecera y en
 * la fila de la lista, sin volver a pedir nada.
 *
 * En el alta (`id` null) sólo está General: lo demás cuelga de un insumo que todavía no
 * existe.
 *
 * Todo lo que pide confirmación (descartar cambios, borrar) se pregunta DENTRO de la
 * ficha y no en un diálogo aparte: en el teléfono la ficha es una capa encima de todo y
 * un diálogo quedaría debajo.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Loader2, MapPin, MoreHorizontal, Scissors, Trash2, X } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { estaBajoMinimo } from "@/lib/stockMinimo";
import {
    fmtCantidad,
    fmtFecha,
    fmtPrecio,
    mpDelete,
    mpGet,
    rotuloTipo,
    type InsumoFicha,
    type InsumoFila,
    type Movimientos,
    type TipoInsumo,
} from "@/lib/materiaPrima";
import { FormularioInsumo } from "./FormularioInsumo";
import { FiguraFormato } from "./FiguraFormato";
import { FichaStock } from "./FichaStock";
import { FichaRecortes } from "./FichaRecortes";
import { FichaOTs } from "./FichaOTs";
import { FichaPrecios } from "./FichaPrecios";
import { CartelError, CartelSinServidor, Esqueleto } from "./InsumoComun";

type Solapa = "general" | "stock" | "recortes" | "ot" | "precios";

/** Las solapas de la ficha: píldoras chicas, como las de la ficha de un recurso humano. */
const SOLAPA =
    "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium text-gray-500 transition-all hover:text-gray-800 " +
    "data-[state=active]:bg-white data-[state=active]:text-red-700 data-[state=active]:shadow-sm " +
    "disabled:cursor-not-allowed disabled:opacity-40";

/** Lo de la ficha que se ve en la fila de la lista (InsumoFila), para actualizarla sin pedirla de nuevo. */
export function filaDe(f: InsumoFicha): InsumoFila {
    return {
        id: f.id,
        codigo: f.codigo,
        descripcion: f.descripcion,
        tipo: f.tipo,
        material: f.material,
        calidad: f.calidad,
        formato: f.formato,
        unidad: f.unidad,
        unitario: f.unitario,
        fecha_ultimo_precio: f.fecha_ultimo_precio,
        stock: f.stock,
        reservado: f.reservado,
        libre: f.libre,
        stock_minimo: f.stock_minimo,
        bajo_minimo: f.bajo_minimo,
        estante: f.estante,
        letra: f.letra,
        nro: f.nro,
        proveedor: f.proveedor,
        inactivo: f.inactivo,
        recortes_disponibles: f.recortes_disponibles,
    };
}

/** Lo que falta en una ficha que vino de un backend más viejo: que nada reviente por un campo ausente. */
function completar(f: InsumoFicha): InsumoFicha {
    return {
        ...f,
        stock: f.stock ?? 0,
        reservado: f.reservado ?? 0,
        libre: f.libre ?? f.stock ?? 0,
        medidas: Array.isArray(f.medidas) ? f.medidas : [null, null, null, null, null],
        recortes_disponibles: f.recortes_disponibles ?? 0,
        usos_en_ot: f.usos_en_ot ?? 0,
        inactivo: !!f.inactivo,
        bajo_minimo: !!f.bajo_minimo,
    };
}

export interface FichaInsumoProps {
    /** El insumo que se muestra. Null = alta. */
    id: number | null;
    /** La ficha, si ya se tiene (la que devolvió el alta): no se vuelve a pedir. */
    fichaInicial?: InsumoFicha | null;
    edita: boolean;
    /** Alta: con qué arranca el formulario. */
    tipoInicial?: TipoInsumo;
    descripcionInicial?: string;
    onCerrar: () => void;
    /** Algo de la ficha que se ve en la fila de la lista cambió. */
    onFilaCambio: (id: number, parcial: Partial<InsumoFila>) => void;
    /** Alta: se creó. `otro` = «Guardar y cargar otro» (la ficha se queda en el alta). */
    onCreado: (ficha: InsumoFicha, otro: boolean) => void;
    onBorrado: (id: number) => void;
    /** Abrir otro insumo (un duplicado que avisó el formulario). */
    onAbrirInsumo: (id: number) => void;
    onSucioChange: (sucio: boolean) => void;
    /** Se quiso cerrar o abrir otro con cambios sin guardar: se pregunta acá arriba. */
    avisoDescartar?: { onDescartar: () => void; onSeguir: () => void } | null;
    className?: string;
}

export function FichaInsumo({
    id,
    fichaInicial,
    edita,
    tipoInicial,
    descripcionInicial,
    onCerrar,
    onFilaCambio,
    onCreado,
    onBorrado,
    onAbrirInsumo,
    onSucioChange,
    avisoDescartar,
    className,
}: FichaInsumoProps) {
    const esAlta = id === null;
    const [ficha, setFicha] = useState<InsumoFicha | null>(
        fichaInicial && fichaInicial.id === id ? completar(fichaInicial) : null,
    );
    const [error, setError] = useState<string | null>(null);
    const [noExiste, setNoExiste] = useState(false);
    const [sinServidor, setSinServidor] = useState(false);
    const [solapa, setSolapa] = useState<Solapa>("general");
    const [montadas, setMontadas] = useState<Solapa[]>(["general"]);
    const [confirmarBorrado, setConfirmarBorrado] = useState(false);
    const [borrando, setBorrando] = useState(false);

    // La ficha más nueva, para los callbacks que se disparan después de una espera (el
    // «deshacer» del parche optimista vuelve a lo que había ANTES de guardar).
    const fichaRef = useRef(ficha);
    useEffect(() => {
        fichaRef.current = ficha;
    }, [ficha]);

    const cargar = useCallback(async (signal?: AbortSignal) => {
        if (id === null) return;
        setError(null);
        const r = await mpGet<InsumoFicha>(`${API_URL}/materia-prima/insumos/${id}`, { signal });
        if (r.abortado) return;
        setSinServidor(r.sinServidor);
        if (r.ok && r.data) {
            setFicha(completar(r.data));
            return;
        }
        if (r.status === 404 && !r.sinServidor) setNoExiste(true);
        else setError(r.error ?? "No se pudo traer el insumo.");
    }, [id]);

    useEffect(() => {
        if (id === null || (fichaInicial && fichaInicial.id === id)) return;
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
        // La ficha inicial sólo cuenta al montar (la ficha se vuelve a montar por cada insumo).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cargar]);

    const irA = (s: Solapa) => {
        setSolapa(s);
        setMontadas((m) => (m.includes(s) ? m : [...m, s]));
    };

    /** Cambia la ficha y la fila de la lista a la vez. */
    const parchear = useCallback((parcial: Partial<InsumoFicha>) => {
        const actual = fichaRef.current;
        if (!actual) return;
        const nueva = { ...actual, ...parcial };
        fichaRef.current = nueva;
        setFicha(nueva);
        onFilaCambio(actual.id, filaDe(nueva));
    }, [onFilaCambio]);

    const alStock = useCallback((d: Movimientos) => {
        const actual = fichaRef.current;
        parchear({
            stock: d.fisico,
            reservado: d.reservado,
            libre: d.libre,
            bajo_minimo: estaBajoMinimo(d.fisico, actual?.stock_minimo ?? null),
        });
    }, [parchear]);

    const alRecortes = useCallback((n: number) => parchear({ recortes_disponibles: n }), [parchear]);

    const alPrecio = useCallback(
        (unitario: number | null, fecha: string | null) => parchear({ unitario, fecha_ultimo_precio: fecha }),
        [parchear],
    );

    const borrar = async () => {
        if (!ficha || borrando) return;
        setBorrando(true);
        const r = await mpDelete(`${API_URL}/materia-prima/insumos/${ficha.id}`);
        setBorrando(false);
        setConfirmarBorrado(false);
        if (!r.ok) {
            // El 422 de siempre: se usó en alguna OT, tiene movimientos o precios. El
            // motivo del backend dice cuál y ofrece la salida (marcarlo inactivo).
            toast.error(r.error ?? "No se pudo borrar el insumo.", { duration: 8000 });
            return;
        }
        toast.success(`Insumo ${ficha.codigo} borrado`);
        onBorrado(ficha.id);
    };

    // Escape cierra la ficha, salvo que se esté escribiendo (ahí es de la persona, no
    // de la ficha: un Escape de más no tiene que tirar lo escrito).
    const alTeclear = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        // Tampoco si viene de un menú o una lista abierta (van en portales, pero el evento
        // burbujea por el árbol de React hasta acá): ese Escape cierra el menú y nada más.
        if (t.closest("input, textarea, select, [contenteditable=true], [role=combobox], [role=menu], [role=listbox], [role=dialog]")) return;
        onCerrar();
    };

    // ─────────────── cabecera ───────────────

    let cabecera: ReactNode;
    if (esAlta) {
        cabecera = (
            <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-900">Nuevo insumo</h2>
                <p className="text-xs text-gray-500">El código y la descripción se arman solos con la regla del sistema viejo.</p>
            </div>
        );
    } else if (!ficha) {
        cabecera = (
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-6 w-28 animate-pulse rounded bg-gray-100" />
                <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100" />
            </div>
        );
    } else {
        const ubicacion = [ficha.estante, ficha.letra, ficha.nro].filter(Boolean).join(" · ");
        cabecera = (
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="font-mono text-xl font-bold leading-tight text-gray-900">{ficha.codigo}</h2>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                        {rotuloTipo(ficha.tipo)}
                    </span>
                    {ficha.inactivo && (
                        <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-gray-500">
                            Inactivo
                        </span>
                    )}
                    {ficha.bajo_minimo && (
                        <span
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                            title={`El stock físico (${fmtCantidad(ficha.stock, "0")}) está abajo del punto crítico (${fmtCantidad(ficha.stock_minimo)}).`}
                        >
                            <AlertTriangle className="h-3 w-3" /> Bajo mínimo
                        </span>
                    )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-gray-700" title={ficha.descripcion}>{ficha.descripcion}</p>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-gray-500">
                    <button
                        type="button"
                        onClick={() => irA("stock")}
                        className="hover:text-gray-800"
                        title={`Físico ${fmtCantidad(ficha.stock, "0")} · reservado ${fmtCantidad(ficha.reservado, "0")}`}
                    >
                        Libre{" "}
                        <span className={cn("text-sm font-bold tabular-nums", ficha.libre < 0 ? "text-red-700" : ficha.libre > 0 ? "text-gray-900" : "text-gray-400")}>
                            {fmtCantidad(ficha.libre, "0")}
                        </span>{" "}
                        {ficha.unidad ?? ""}
                        {ficha.reservado > 0 && <span className="text-gray-400"> (de {fmtCantidad(ficha.stock)})</span>}
                    </button>
                    <button type="button" onClick={() => irA("precios")} className="hover:text-gray-800">
                        <span className="font-semibold tabular-nums text-gray-700">{fmtPrecio(ficha.unitario, "Sin precio")}</span>
                        {ficha.fecha_ultimo_precio && <span className="text-gray-400"> · {fmtFecha(ficha.fecha_ultimo_precio)}</span>}
                    </button>
                    {ubicacion && (
                        <span className="inline-flex items-center gap-1 font-mono">
                            <MapPin className="h-3 w-3" /> {ubicacion}
                        </span>
                    )}
                    {ficha.recortes_disponibles > 0 && (
                        <button type="button" onClick={() => irA("recortes")} className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900">
                            <Scissors className="h-3 w-3" /> {ficha.recortes_disponibles} recorte{ficha.recortes_disponibles === 1 ? "" : "s"}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    const soloGeneral = esAlta || !ficha;

    return (
        <aside
            aria-label={esAlta ? "Nuevo insumo" : `Ficha del insumo ${ficha?.codigo ?? ""}`}
            onKeyDown={alTeclear}
            className={cn("flex min-h-0 flex-col bg-white", className)}
        >
            {/* ── cabecera ── */}
            <div className="shrink-0 border-b border-gray-200 px-4 pb-2.5 pt-3">
                <div className="flex items-start gap-3">
                    {/* En el teléfono la ficha tapa la lista: «volver» a la izquierda, como una pantalla. */}
                    <button
                        type="button"
                        onClick={onCerrar}
                        aria-label="Volver a la lista"
                        className="-ml-1.5 mt-0.5 rounded-md p-1 text-gray-500 hover:bg-gray-100 lg:hidden"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    {ficha?.tipo === "insumo" && ficha.formato && (
                        <FiguraFormato formato={ficha.formato} soloForma className="mt-0.5 hidden h-10 w-12 shrink-0 sm:block" />
                    )}
                    {cabecera}
                    <div className="flex shrink-0 items-center gap-0.5">
                        {edita && ficha && (
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <button type="button" aria-label="Más acciones" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                {/* z-[70]: en el teléfono la ficha es una capa z-[60]. */}
                                <DropdownMenuContent align="end" className="z-[70] w-64">
                                    <DropdownMenuLabel className="text-xs font-normal text-gray-500">
                                        {ficha.usos_en_ot > 0
                                            ? `Se usó en ${ficha.usos_en_ot} OT: no se puede borrar. Si ya no se compra, marcalo inactivo en General.`
                                            : "Sólo se puede borrar si nunca se usó (sin OT, movimientos, precios ni recortes)."}
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem
                                        disabled={ficha.usos_en_ot > 0}
                                        onSelect={() => setConfirmarBorrado(true)}
                                        className="text-rose-600 focus:text-rose-700"
                                    >
                                        <Trash2 className="h-4 w-4" /> Borrar el insumo
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <button
                            type="button"
                            onClick={onCerrar}
                            aria-label="Cerrar la ficha"
                            title="Cerrar"
                            className="hidden rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 lg:block"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* ── lo que se pregunta antes de hacer ── */}
            {avisoDescartar && (
                <div role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                    <p className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        Hay cambios sin guardar{ficha ? ` en ${ficha.codigo}` : " en el alta"}. Si seguís, se pierden.
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                        <button type="button" onClick={avisoDescartar.onSeguir} className="rounded-md px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                            Volver a la ficha
                        </button>
                        <button
                            type="button"
                            onClick={avisoDescartar.onDescartar}
                            className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                        >
                            Descartar los cambios
                        </button>
                    </div>
                </div>
            )}
            {confirmarBorrado && ficha && (
                <div role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900">
                    <p>¿Borrar <span className="font-mono font-bold">{ficha.codigo}</span> del catálogo? No se puede deshacer.</p>
                    <div className="mt-2 flex justify-end gap-2">
                        <button type="button" onClick={() => setConfirmarBorrado(false)} disabled={borrando} className="rounded-md px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100">
                            No
                        </button>
                        <button
                            type="button"
                            onClick={() => void borrar()}
                            disabled={borrando}
                            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                        >
                            {borrando && <Loader2 className="h-3 w-3 animate-spin" />}
                            Borrar
                        </button>
                    </div>
                </div>
            )}

            {/* ── cuerpo ── */}
            {sinServidor ? (
                <div className="p-4"><CartelSinServidor /></div>
            ) : noExiste ? (
                <div className="p-4">
                    <CartelError mensaje="Ese insumo ya no existe (lo borraron o el enlace es viejo)." />
                </div>
            ) : error && !ficha ? (
                <div className="p-4"><CartelError mensaje={error} onReintentar={() => void cargar()} /></div>
            ) : !esAlta && !ficha ? (
                <Esqueleto filas={6} className="p-4" />
            ) : (
                <Tabs value={solapa} onValueChange={(v) => irA(v as Solapa)} className="flex min-h-0 flex-1 flex-col">
                    <div className="shrink-0 border-b border-gray-100 px-3 py-2">
                        <TabsList className="flex h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-lg bg-gray-100/80 p-1 [scrollbar-width:none]">
                            <TabsTrigger value="general" className={SOLAPA}>General</TabsTrigger>
                            <TabsTrigger value="stock" className={SOLAPA} disabled={soloGeneral} title={soloGeneral ? "Primero guardá el insumo" : undefined}>
                                Stock
                            </TabsTrigger>
                            <TabsTrigger value="recortes" className={SOLAPA} disabled={soloGeneral} title={soloGeneral ? "Primero guardá el insumo" : undefined}>
                                Recortes
                                {!!ficha?.recortes_disponibles && (
                                    <span className="ml-1 rounded-full bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700">{ficha.recortes_disponibles}</span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="ot" className={SOLAPA} disabled={soloGeneral} title={soloGeneral ? "Primero guardá el insumo" : undefined}>
                                OT
                                {!!ficha?.usos_en_ot && (
                                    <span className="ml-1 rounded-full bg-gray-200 px-1.5 text-[10px] font-semibold text-gray-600">{ficha.usos_en_ot}</span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="precios" className={SOLAPA} disabled={soloGeneral} title={soloGeneral ? "Primero guardá el insumo" : undefined}>
                                Precios
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        <TabsContent value="general" forceMount className="mt-0 min-h-full data-[state=inactive]:hidden">
                            <FormularioInsumo
                                ficha={ficha}
                                edita={edita}
                                tipoInicial={tipoInicial}
                                descripcionInicial={descripcionInicial}
                                autoFocus={esAlta}
                                onSucioChange={onSucioChange}
                                onIrAPrecios={ficha ? () => irA("precios") : undefined}
                                onAbrirInsumo={onAbrirInsumo}
                                onOptimista={(parcial) => {
                                    const antes = fichaRef.current;
                                    if (!antes) return;
                                    onFilaCambio(antes.id, parcial);
                                    return () => onFilaCambio(antes.id, filaDe(antes));
                                }}
                                onGuardado={(nueva, como) => {
                                    if (como.alta) {
                                        onCreado(completar(nueva), como.otro);
                                        return;
                                    }
                                    const f = completar(nueva);
                                    fichaRef.current = f;
                                    setFicha(f);
                                    onFilaCambio(f.id, filaDe(f));
                                }}
                            />
                        </TabsContent>
                        {ficha && montadas.includes("stock") && (
                            <TabsContent value="stock" forceMount className="mt-0 data-[state=inactive]:hidden">
                                <FichaStock ficha={ficha} edita={edita} onCambio={alStock} />
                            </TabsContent>
                        )}
                        {ficha && montadas.includes("recortes") && (
                            <TabsContent value="recortes" forceMount className="mt-0 data-[state=inactive]:hidden">
                                <FichaRecortes ficha={ficha} edita={edita} onCambio={alRecortes} />
                            </TabsContent>
                        )}
                        {ficha && montadas.includes("ot") && (
                            <TabsContent value="ot" forceMount className="mt-0 data-[state=inactive]:hidden">
                                <FichaOTs ficha={ficha} />
                            </TabsContent>
                        )}
                        {ficha && montadas.includes("precios") && (
                            <TabsContent value="precios" forceMount className="mt-0 data-[state=inactive]:hidden">
                                <FichaPrecios ficha={ficha} edita={edita} onPrecioVigente={alPrecio} />
                            </TabsContent>
                        )}
                    </div>
                </Tabs>
            )}
        </aside>
    );
}

export default FichaInsumo;
