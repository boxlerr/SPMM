"use client";

/**
 * Solapa Recortes de la ficha: los tramos que sobraron de este insumo.
 *
 * Se compra material justo y los recortes son secundarios (así lo dijo Lucas el 23/09),
 * pero existen: el sistema viejo tenía 271 anotados, casi todos barras, y antes de
 * encargar una barra entera conviene saber si hay un tramo que alcanza. Por eso se
 * cargan rápido (largo, Enter) y se marcan cuando se usan en una OT o se tiran.
 *
 * Un recorte usado o descartado no se borra: queda en la lista con su estado (y la OT
 * donde se usó). «Eliminar» es para lo cargado por error.
 *
 * Todo optimista: se ve al instante y vuelve atrás con un aviso si el backend no lo acepta.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, MoreHorizontal, Plus, RotateCcw, Scissors, Trash2, X } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    ahoraISO,
    fmtCantidad,
    fmtFecha,
    frenarPorPractica,
    leerCantidad,
    mpDelete,
    mpGet,
    mpPost,
    mpPut,
    ROTULO_ESTADO_RECORTE,
    usuarioActual,
    type EstadoRecorte,
    type InsumoFicha,
    type Recorte,
    type RecorteCambios,
    type RecorteIn,
} from "@/lib/materiaPrima";
import { CartelError, CartelSinServidor, Esqueleto, Vacio, enlaceOT } from "./InsumoComun";

/** Un largo de barra entera: el viejo anotaba «6000» para las barras sin empezar. */
const BARRA_ENTERA_MM = 6000;

const ESTILO_ESTADO: Record<EstadoRecorte, string> = {
    disponible: "bg-emerald-50 text-emerald-700 border-emerald-200",
    usado: "bg-blue-50 text-blue-700 border-blue-200",
    descartado: "bg-gray-100 text-gray-500 border-gray-200",
};

/** Disponibles primero (como los manda el backend), y dentro de cada estado el más largo arriba. */
const ordenar = (lista: Recorte[]) => {
    const peso: Record<EstadoRecorte, number> = { disponible: 0, usado: 1, descartado: 2 };
    return [...lista].sort((a, b) => peso[a.estado] - peso[b.estado] || (b.largo_mm ?? 0) - (a.largo_mm ?? 0) || b.id - a.id);
};

/** Cuántos recortes disponibles hay (la suma de cantidades): el numerito de la tijera en la lista. */
export const disponiblesDe = (lista: Recorte[]) =>
    lista.filter((r) => r.estado === "disponible").reduce((s, r) => s + (r.cantidad || 0), 0);

function medidaDe(r: Pick<Recorte, "largo_mm" | "ancho_mm" | "texto_original">): string {
    if (r.largo_mm == null) return r.texto_original ?? "Sin medida";
    return r.ancho_mm != null ? `${fmtCantidad(r.largo_mm)} × ${fmtCantidad(r.ancho_mm)} mm` : `${fmtCantidad(r.largo_mm)} mm`;
}

export interface FichaRecortesProps {
    ficha: InsumoFicha;
    edita: boolean;
    /** Cambió cuántos disponibles hay (para la fila de la lista y la cabecera). */
    onCambio: (disponibles: number) => void;
}

export function FichaRecortes({ ficha, edita, onCambio }: FichaRecortesProps) {
    const [lista, setLista] = useState<Recorte[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);

    const alCambio = useRef(onCambio);
    useEffect(() => {
        alCambio.current = onCambio;
    });

    const cargar = useCallback(async (signal?: AbortSignal) => {
        const r = await mpGet<Recorte[]>(`${API_URL}/materia-prima/insumos/${ficha.id}/recortes`, { signal });
        if (r.abortado) return;
        setSinServidor(r.sinServidor);
        if (!r.ok) {
            setError(r.error ?? "No se pudieron traer los recortes.");
            return;
        }
        setError(null);
        setLista(ordenar(Array.isArray(r.data) ? r.data : []));
    }, [ficha.id]);

    useEffect(() => {
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
    }, [cargar]);

    const poner = (nueva: Recorte[]) => setLista(ordenar(nueva));

    // Cada vez que cambia la lista (la carga, un alta, un cambio, su vuelta atrás) se
    // avisa afuera cuántos disponibles hay: la fila de la lista y la cabecera de la
    // ficha quedan con el número de acá, que es el más nuevo.
    const disponiblesAvisados = useRef<number | null>(null);
    useEffect(() => {
        if (!lista) return;
        const n = disponiblesDe(lista);
        if (n === disponiblesAvisados.current) return;
        disponiblesAvisados.current = n;
        alCambio.current(n);
    }, [lista]);

    const agregar = async (cuerpo: RecorteIn): Promise<boolean> => {
        if (!lista) return false;
        const antes = lista;
        const temporal: Recorte = {
            id: -Date.now(),
            largo_mm: cuerpo.largo_mm,
            ancho_mm: cuerpo.ancho_mm ?? null,
            cantidad: cuerpo.cantidad ?? 1,
            observaciones: cuerpo.observaciones ?? null,
            texto_original: null,
            estado: "disponible",
            id_orden_trabajo_uso: null,
            numero_ot_uso: null,
            creado_en: ahoraISO(),
            creado_por: usuarioActual(),
            usado_en: null,
            usado_por: null,
        };
        poner([temporal, ...lista]);
        const r = await mpPost<Recorte>(`${API_URL}/materia-prima/insumos/${ficha.id}/recortes`, cuerpo);
        if (!r.ok || !r.data) {
            poner(antes);
            // Modo práctica: el cartelito ya salió y lo escrito vuelve a los campos (`false`).
            if (!r.practica) toast.error(`No se agregó el recorte: ${r.error ?? "error desconocido"}`);
            return false;
        }
        const creado = r.data;
        setLista((l) => ordenar((l ?? []).map((x) => (x.id === temporal.id ? creado : x))));
        return true;
    };

    const cambiar = async (rec: Recorte, cambios: RecorteCambios, aviso: string) => {
        if (!lista) return;
        const antes = lista;
        const optimista: Recorte = {
            ...rec,
            ...("estado" in cambios ? { estado: cambios.estado! } : {}),
            ...(cambios.estado === "usado" ? { usado_en: ahoraISO(), usado_por: usuarioActual(), numero_ot_uso: cambios.numero_ot_uso ?? null } : {}),
            ...(cambios.estado === "disponible" ? { usado_en: null, usado_por: null, numero_ot_uso: null, id_orden_trabajo_uso: null } : {}),
        };
        poner(lista.map((x) => (x.id === rec.id ? optimista : x)));
        const r = await mpPut<Recorte>(`${API_URL}/materia-prima/recortes/${rec.id}`, cambios);
        if (!r.ok || !r.data) {
            poner(antes);
            if (!r.practica) toast.error(`No se cambió el recorte: ${r.error ?? "error desconocido"}`);
            return;
        }
        const nuevo = r.data;
        setLista((l) => ordenar((l ?? []).map((x) => (x.id === rec.id ? nuevo : x))));
        toast.success(aviso);
    };

    const eliminar = async (rec: Recorte) => {
        if (!lista) return;
        const antes = lista;
        poner(lista.filter((x) => x.id !== rec.id));
        const r = await mpDelete(`${API_URL}/materia-prima/recortes/${rec.id}`);
        if (!r.ok) {
            poner(antes);
            if (!r.practica) toast.error(`No se eliminó el recorte: ${r.error ?? "error desconocido"}`);
            return;
        }
        toast.success("Recorte eliminado");
    };

    if (sinServidor) return <CartelSinServidor className="m-4" />;
    if (error && !lista) return <CartelError className="m-4" mensaje={error} onReintentar={() => void cargar()} />;

    const disponibles = lista ? disponiblesDe(lista) : 0;

    return (
        // `@container`: se acomoda al ancho del panel de la ficha, no al de la ventana.
        <div className="@container space-y-4 px-4 py-4">
            {edita && lista && <AltaRapida onAgregar={agregar} />}

            <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Recortes</h3>
                    {lista && lista.length > 0 && (
                        <span className="text-xs text-gray-500">
                            {disponibles ? `${disponibles} disponible${disponibles === 1 ? "" : "s"}` : "Ninguno disponible"}
                        </span>
                    )}
                </div>
                {!lista ? (
                    <Esqueleto filas={3} />
                ) : lista.length === 0 ? (
                    <Vacio icono={<Scissors className="h-6 w-6" />} titulo="No hay recortes anotados">
                        {edita ? "Cuando sobre un tramo, anotá el largo arriba: la próxima vez aparece antes de comprar." : null}
                    </Vacio>
                ) : (
                    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                        {lista.map((r) => (
                            <FilaRecorte
                                key={r.id}
                                r={r}
                                edita={edita}
                                onUsar={(ot) => void cambiar(r, { estado: "usado", numero_ot_uso: ot }, `Recorte marcado como usado${ot ? ` en la OT ${ot}` : ""}`)}
                                onDescartar={() => void cambiar(r, { estado: "descartado" }, "Recorte descartado")}
                                onVolver={() => void cambiar(r, { estado: "disponible", numero_ot_uso: null }, "El recorte volvió a estar disponible")}
                                onEliminar={() => void eliminar(r)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

/** Largo (Enter), ancho si es chapa, cantidad si son varios iguales. Queda listo para el siguiente. */
function AltaRapida({ onAgregar }: { onAgregar: (r: RecorteIn) => Promise<boolean> }) {
    const [largo, setLargo] = useState("");
    const [ancho, setAncho] = useState("");
    const [cantidad, setCantidad] = useState("1");
    const [obs, setObs] = useState("");
    const refLargo = useRef<HTMLInputElement>(null);

    const vLargo = leerCantidad(largo);
    const vAncho = leerCantidad(ancho);
    const vCantidad = leerCantidad(cantidad);
    const largoMalo = largo.trim() !== "" && (vLargo === null || vLargo <= 0);
    const anchoMalo = ancho.trim() !== "" && (vAncho === null || vAncho <= 0);
    const cantidadMala = vCantidad === null || vCantidad < 1 || !Number.isInteger(vCantidad);
    const valido = vLargo !== null && vLargo > 0 && !anchoMalo && !cantidadMala;

    const agregar = async () => {
        if (!valido || vLargo === null) return;
        const cuerpo: RecorteIn = {
            largo_mm: vLargo,
            ancho_mm: ancho.trim() ? vAncho : null,
            cantidad: vCantidad ?? 1,
            observaciones: obs.trim() || null,
        };
        // Se limpia ya (la fila aparece sola arriba) y el foco vuelve al largo: se anotan
        // varios seguidos. Si el backend no lo acepta, vuelve lo escrito.
        setLargo("");
        setAncho("");
        setCantidad("1");
        setObs("");
        refLargo.current?.focus();
        const ok = await onAgregar(cuerpo);
        if (!ok) {
            setLargo(largo);
            setAncho(ancho);
            setCantidad(cantidad);
            setObs(obs);
        }
    };

    const enter = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void agregar();
        }
    };

    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <p className="mb-2 text-sm font-semibold text-gray-900">Anotar un recorte</p>
            <div className="grid grid-cols-2 gap-2 @lg:grid-cols-[6.5rem_6.5rem_4.5rem_minmax(0,1fr)_auto]">
                <label className="block">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Largo mm</span>
                    <Input
                        ref={refLargo}
                        inputMode="decimal"
                        value={largo}
                        onChange={(e) => setLargo(e.target.value)}
                        onKeyDown={enter}
                        placeholder="2777"
                        className={cn("h-9 bg-white tabular-nums", largoMalo && "border-rose-300")}
                    />
                </label>
                <label className="block">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Ancho mm</span>
                    <Input
                        inputMode="decimal"
                        value={ancho}
                        onChange={(e) => setAncho(e.target.value)}
                        onKeyDown={enter}
                        placeholder="Opcional"
                        className={cn("h-9 bg-white tabular-nums", anchoMalo && "border-rose-300")}
                    />
                </label>
                <label className="block">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cant.</span>
                    <Input
                        inputMode="numeric"
                        value={cantidad}
                        onChange={(e) => setCantidad(e.target.value.replace(/[^\d]/g, ""))}
                        onKeyDown={enter}
                        className={cn("h-9 bg-white tabular-nums", cantidadMala && cantidad !== "" && "border-rose-300")}
                    />
                </label>
                <label className="col-span-2 block @lg:col-span-1">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Observaciones</span>
                    <Input value={obs} onChange={(e) => setObs(e.target.value)} onKeyDown={enter} placeholder="Pintado, con rebaba…" className="h-9 bg-white" />
                </label>
                <div className="col-span-2 flex items-end @lg:col-span-1">
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void agregar()}
                        disabled={!valido}
                        className="h-9 w-full bg-[#DC143C] text-white hover:bg-[#B01030] @lg:w-auto"
                    >
                        <Plus className="h-4 w-4" />
                        Agregar
                    </Button>
                </div>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
                {fmtCantidad(BARRA_ENTERA_MM)} mm = una barra entera.
                {vLargo !== null && vLargo >= BARRA_ENTERA_MM && " Si es una barra sin empezar, conviene cargarla como ingreso de stock."}
            </p>
        </div>
    );
}

function FilaRecorte({ r, edita, onUsar, onDescartar, onVolver, onEliminar }: {
    r: Recorte;
    edita: boolean;
    onUsar: (numeroOt: number | null) => void;
    onDescartar: () => void;
    onVolver: () => void;
    onEliminar: () => void;
}) {
    /** Qué se está confirmando en el renglón: la OT donde se usó, o el borrado. */
    const [pidiendo, setPidiendo] = useState<"usar" | "eliminar" | null>(null);
    const [ot, setOt] = useState("");
    const temporal = r.id < 0;
    const apagado = r.estado !== "disponible";
    // Lo que decía el viejo se muestra sólo si dice algo más que la medida («1525x3»,
    // «3440 (pintado)»): «2777» al lado de «2.777 mm» es ruido.
    const textoViejo = r.texto_original && r.largo_mm != null && r.texto_original.trim() !== String(r.largo_mm) ? r.texto_original : null;
    const anotado = r.creado_en || r.creado_por;

    const confirmarUso = () => {
        // Modo práctica: la pregunta queda abierta con la OT escrita (y sale el cartelito).
        if (frenarPorPractica()) return;
        const n = ot.trim() ? Number(ot.trim()) : null;
        setPidiendo(null);
        setOt("");
        onUsar(n);
    };

    return (
        <li className={cn("px-3 py-2", temporal && "opacity-60")}>
            <div className="flex items-start gap-3">
                <div className={cn("min-w-0 flex-1", apagado && "text-gray-400")}>
                    <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className={cn("font-semibold tabular-nums", apagado ? "text-gray-500" : "text-gray-900")}>{medidaDe(r)}</span>
                        {r.cantidad > 1 && <span className="text-xs font-medium text-gray-600">× {r.cantidad}</span>}
                        {r.largo_mm != null && r.largo_mm >= BARRA_ENTERA_MM && r.ancho_mm == null && (
                            <span className="text-[10px] font-medium uppercase text-gray-400">barra entera</span>
                        )}
                    </p>
                    {(r.observaciones || textoViejo) && (
                        <p className="mt-0.5 text-xs text-gray-500">
                            {r.observaciones}
                            {textoViejo && (
                                <span className={cn("text-gray-400", r.observaciones && "ml-1")} title="Lo que decía el sistema viejo">
                                    (en el viejo: «{textoViejo}»)
                                </span>
                            )}
                        </p>
                    )}
                    {(r.estado === "usado" || anotado) && (
                        <p className="mt-0.5 text-[11px] text-gray-400">
                            {r.estado === "usado" ? (
                                <>
                                    Usado
                                    {r.numero_ot_uso != null && (
                                        <>
                                            {" en la OT "}
                                            {r.id_orden_trabajo_uso ? (
                                                <Link href={enlaceOT(r.id_orden_trabajo_uso)} className="font-medium text-blue-700 hover:underline">
                                                    {r.numero_ot_uso}
                                                </Link>
                                            ) : (
                                                r.numero_ot_uso
                                            )}
                                        </>
                                    )}
                                    {r.usado_en && ` el ${fmtFecha(r.usado_en)}`}
                                    {r.usado_por && ` por ${r.usado_por}`}
                                </>
                            ) : (
                                <>
                                    {r.creado_en ? `Anotado el ${fmtFecha(r.creado_en)}` : "Anotado"}
                                    {r.creado_por && ` por ${r.creado_por}`}
                                </>
                            )}
                        </p>
                    )}
                </div>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", ESTILO_ESTADO[r.estado])}>
                    {ROTULO_ESTADO_RECORTE[r.estado]}
                </span>
                {edita && !temporal && (
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Acciones del recorte"
                                className="-mr-1 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        {/* z-[70]: en el teléfono la ficha es una capa z-[60] y el menú tiene que ir arriba. */}
                        <DropdownMenuContent align="end" className="z-[70] w-48">
                            {r.estado === "disponible" ? (
                                <>
                                    <DropdownMenuItem onSelect={() => setPidiendo("usar")}>
                                        <Check className="h-4 w-4" /> Usar en OT…
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={onDescartar}>
                                        <X className="h-4 w-4" /> Descartar
                                    </DropdownMenuItem>
                                </>
                            ) : (
                                <DropdownMenuItem onSelect={onVolver}>
                                    <RotateCcw className="h-4 w-4" /> Volver a disponible
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setPidiendo("eliminar")} className="text-rose-600 focus:text-rose-700">
                                <Trash2 className="h-4 w-4" /> Eliminar
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {pidiendo === "usar" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-blue-50/70 px-2 py-2">
                    <span className="text-xs text-blue-900">¿En qué OT se usó?</span>
                    <Input
                        autoFocus
                        inputMode="numeric"
                        value={ot}
                        onChange={(e) => setOt(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                confirmarUso();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setPidiendo(null);
                            }
                        }}
                        placeholder="N° de OT (opcional)"
                        className="h-8 w-40 bg-white text-xs tabular-nums"
                    />
                    <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setPidiendo(null)}>No</Button>
                    <Button type="button" size="sm" className="h-8 bg-blue-600 text-white hover:bg-blue-700" onClick={confirmarUso}>
                        Marcar usado
                    </Button>
                </div>
            )}
            {pidiendo === "eliminar" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-rose-50/70 px-2 py-2">
                    <span className="flex-1 text-xs text-rose-900">
                        ¿Eliminar el recorte? Es para lo anotado por error: si se usó o se tiró, mejor marcarlo así (queda el registro).
                    </span>
                    <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setPidiendo(null)}>No</Button>
                    <Button
                        type="button"
                        size="sm"
                        className="h-8 bg-rose-600 text-white hover:bg-rose-700"
                        onClick={() => {
                            // Modo práctica: sin esto el renglón se iba y volvía (optimista) y la
                            // pregunta se cerraba; así queda abierta y sale el cartelito.
                            if (frenarPorPractica()) return;
                            setPidiendo(null);
                            onEliminar();
                        }}
                    >
                        Eliminar
                    </Button>
                </div>
            )}
        </li>
    );
}

export default FichaRecortes;
