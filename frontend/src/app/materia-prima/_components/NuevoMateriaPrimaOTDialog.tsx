"use client";

/**
 * «Nuevo › Materia prima para una OT»: la carga de Carolina, sin abrir la OT.
 *
 * En el sistema viejo las materias primas de una OT se cargaban desde su propia pantalla:
 * el número de OT y, abajo, los renglones (código, cantidad, Enter). En SPMM viven en la
 * solapa «Materias primas» de la OT (components/materiales/MateriasPrimasOT.tsx), y para
 * llegar había que ir a Operaciones, buscar la OT, abrirla y cambiar de solapa. Desde
 * Materia prima, que es donde está el que compra, eso era salir de la sección.
 *
 * Esto es la pantalla del viejo: se escribe el N° de OT y aparece, debajo, EL MISMO
 * componente de la solapa de la OT (no una copia): la barra de carga, los cortes, «Traer
 * historial», las marcas, «No lleva materias primas». Todo lo que cambia se guarda solo,
 * como en la OT; no hay «Guardar».
 *
 * CÓMO SE ENCUENTRA LA OT
 *
 * La gente conoce la OT por su número (id_otvieja) y la API de materias primas pide el id
 * interno. Se busca primero en Pendientes por número (`?ot=N`): es liviano, es de esta
 * sección (mismo permiso) y trae cliente, artículo y unidades. Pendientes deja afuera las
 * OT marcadas «No lleva materias primas»; para ésas (y sólo si no apareció) se busca en el
 * resumen de las OT de Operaciones, que las trae todas: así también se puede destildar el
 * «No lleva» de una que sí lleva.
 *
 * AL CERRAR
 *
 *  · Si quedó un insumo elegido en la barra sin agregar (lo avisa la solapa), se pregunta
 *    antes de cerrar: lo demás ya está guardado (en modo práctica no hay nada guardado,
 *    y la pregunta no dice que sí).
 *  · Si se cambió algo, se avisa a Pendientes (NuevoAvisos.ts) para que se ponga al día
 *    en silencio.
 *
 * Modo práctica (prueba piloto): se recorre entero, con la barra y las casillas; lo que
 * se intenta guardar lo frena el candado de `mpFetch` (sale su cartelito, «Esto no se
 * guarda») y la solapa lo vuelve atrás (ver MateriasPrimasOT: ahí decide su modo práctica).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Search } from "lucide-react";
import { API_URL } from "@/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MateriasPrimasOT } from "@/components/materiales/MateriasPrimasOT";
import { consulta, fmtCantidad, fmtFecha, mpGet, type Linea, type Pendientes } from "@/lib/materiaPrima";
import { useConfirmarForzar } from "./PendientesForzar";
import { enlaceOT, Rotulo } from "./InsumoComun";
import { avisarCargaMP } from "./NuevoAvisos";
import { PildoraPractica } from "./NuevoComun";

/** Lo que hace falta de la OT para cargarle materia prima. */
interface OTElegida {
    id: number;
    numero: number;
    cliente: string | null;
    articulo: string | null;
    unidades: number | null;
    fecha_prometida: string | null;
    /** Está marcada «No lleva materias primas» (sólo se sabe si vino del resumen de OT). */
    noLleva: boolean;
}

/** Lo que se lee de una fila de `GET /ordenes-resumen` (TodasLasOrdenes.tsx tiene el tipo entero). */
interface OrdenDelResumen {
    id: number;
    id_otvieja: number | null;
    cliente: string | null;
    articulo: string | null;
    unidades: number | null;
    fecha_prometida: string | null;
    no_lleva_materia_prima?: boolean | number | null;
}

type Busqueda = { ot: OTElegida | null; error: string | null };

/** Número de OT → la OT. Ver «Cómo se encuentra la OT» arriba. */
async function buscarOT(numero: number, signal: AbortSignal): Promise<Busqueda | null> {
    const r = await mpGet<Pendientes>(`${API_URL}/materia-prima/pendientes?${consulta({ ot: numero, filtro: "todas" })}`, { signal });
    if (r.abortado) return null;
    const o = r.ok ? r.data?.ots?.[0] : undefined;
    if (o) {
        return {
            ot: {
                id: o.id,
                numero: o.numero_ot ?? numero,
                cliente: o.cliente,
                articulo: o.articulo,
                unidades: o.unidades,
                fecha_prometida: o.fecha_prometida,
                noLleva: false,
            },
            error: null,
        };
    }
    if (!r.ok && r.status !== 422) return { ot: null, error: r.error ?? "No se pudo buscar la OT." };

    // No está en Pendientes: puede ser una «No lleva materias primas».
    const r2 = await mpGet<{ ordenes?: OrdenDelResumen[] }>(`${API_URL}/ordenes-resumen`, { signal });
    if (r2.abortado) return null;
    // El resumen es de Operaciones: quien no lo puede leer (403) o un tropiezo de red no
    // es «no existe», es «no se pudo mirar entre las demás».
    if (!r2.ok) return { ot: null, error: `No está entre las OT con materia prima pendiente, y no se pudo buscar entre las demás${r2.error ? `: ${r2.error}` : "."}` };
    const lista = r2.ok && Array.isArray(r2.data?.ordenes) ? r2.data!.ordenes! : [];
    const x = lista.find((q) => Number(q.id_otvieja) === numero);
    if (!x) return { ot: null, error: `No hay ninguna OT con el N° ${numero}.` };
    return {
        ot: {
            id: x.id,
            numero,
            cliente: x.cliente,
            articulo: x.articulo,
            unidades: x.unidades,
            fecha_prometida: x.fecha_prometida,
            noLleva: !!x.no_lleva_materia_prima,
        },
        error: null,
    };
}

export interface NuevoMateriaPrimaOTDialogProps {
    open: boolean;
    onClose: () => void;
    practica: boolean;
}

export function NuevoMateriaPrimaOTDialog({ open, onClose, practica }: NuevoMateriaPrimaOTDialogProps) {
    const { confirmar, dialogo } = useConfirmarForzar();
    /** Quedó algo a medio escribir en la barra de carga (lo avisa la solapa). */
    const sinGuardar = useRef(false);
    /** Se cambió algo de alguna OT en esta apertura: Pendientes se tiene que poner al día. */
    const cambio = useRef(false);

    const cerrar = useCallback(async () => {
        if (sinGuardar.current) {
            const si = await confirmar({
                titulo: "Cerrar sin agregar",
                // En modo práctica no hay «lo demás guardado»: no se guardó nada.
                motivo: practica
                    ? "Quedó un insumo elegido en la barra de carga que todavía no se agregó. Si cerrás, se pierde lo escrito."
                    : "Quedó un insumo elegido en la barra de carga que todavía no se agregó. Si cerrás, se pierde lo escrito (lo demás ya está guardado).",
                boton: "Cerrar igual",
                cancelar: "Seguir cargando",
            });
            if (!si) return;
        }
        if (cambio.current) avisarCargaMP(["pendientes", "canera"]);
        sinGuardar.current = false;
        cambio.current = false;
        onClose();
    }, [confirmar, onClose, practica]);

    return (
        <>
            {dialogo}
            <Dialog open={open} onOpenChange={(v) => !v && void cerrar()}>
                <DialogContent className="flex h-[92dvh] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
                    {/* `pr-12`: que el título (con la píldora de modo práctica) no se meta abajo de la X en el teléfono. */}
                    <DialogHeader className="shrink-0 border-b border-gray-100 py-3 pl-5 pr-12 text-left">
                        <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
                            Materia prima para una OT
                            {practica && <PildoraPractica />}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            La carga del sistema viejo: el N° de OT y, abajo, lo que lleva.
                            {practica ? " En modo práctica se carga para ver cómo es, pero no se guarda." : " Cada renglón se guarda solo."}
                        </DialogDescription>
                    </DialogHeader>
                    {/* Se monta con el contenido del diálogo: cada apertura arranca por el N° de OT. */}
                    <CargaDeOT
                        onSinGuardar={(v) => (sinGuardar.current = v)}
                        onCambio={() => (cambio.current = true)}
                    />
                </DialogContent>
            </Dialog>
        </>
    );
}

function CargaDeOT({ onSinGuardar, onCambio }: { onSinGuardar: (v: boolean) => void; onCambio: () => void }) {
    const refNumero = useRef<HTMLInputElement>(null);
    const [numero, setNumero] = useState("");
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ot, setOt] = useState<OTElegida | null>(null);
    const control = useRef<AbortController | null>(null);

    useEffect(() => () => control.current?.abort(), []);

    const buscar = async () => {
        const n = Number(numero.trim());
        if (!Number.isInteger(n) || n <= 0 || buscando) return;
        control.current?.abort();
        const c = new AbortController();
        control.current = c;
        setBuscando(true);
        setError(null);
        const r = await buscarOT(n, c.signal);
        if (!r) return;
        setBuscando(false);
        if (r.ot) setOt(r.ot);
        else setError(r.error);
    };

    const otraOT = () => {
        setOt(null);
        onSinGuardar(false);
        window.setTimeout(() => {
            refNumero.current?.focus();
            refNumero.current?.select();
        }, 0);
    };

    const alCambiarLineas = useCallback(
        (_l: Linea[], motivo: "carga" | "cambio") => {
            if (motivo === "cambio") onCambio();
        },
        [onCambio],
    );

    if (!ot) {
        return (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
                <form
                    className="mx-auto max-w-md"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void buscar();
                    }}
                >
                    <Rotulo htmlFor="nuevo-mp-ot">N° de OT</Rotulo>
                    <div className="flex gap-2">
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <Input
                                ref={refNumero}
                                id="nuevo-mp-ot"
                                autoFocus
                                inputMode="numeric"
                                value={numero}
                                onChange={(e) => {
                                    setNumero(e.target.value.replace(/\D/g, ""));
                                    setError(null);
                                }}
                                placeholder="15692"
                                className="h-10 bg-white pl-8 text-base tabular-nums"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={!numero.trim() || buscando}
                            className="h-10 bg-[#DC143C] text-white hover:bg-[#B01030]"
                        >
                            {buscando && <Loader2 className="h-4 w-4 animate-spin" />}
                            Buscar
                        </Button>
                    </div>
                    {error ? (
                        <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>
                    ) : (
                        <p className="mt-2 text-xs text-gray-500">
                            El número que ve la gente (el del sistema viejo). Aparecen sus materias primas y la barra para cargar.
                        </p>
                    )}
                </form>
            </div>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto">
            {/* La OT elegida, fija arriba mientras se carga. */}
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 bg-white/95 px-5 py-2.5 backdrop-blur">
                <button
                    type="button"
                    onClick={otraOT}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Otra OT
                </button>
                <p className="min-w-0 flex-1 text-sm">
                    <span className="font-bold text-gray-900">OT {ot.numero}</span>
                    {ot.cliente && <span className="text-gray-600"> · {ot.cliente}</span>}
                    {ot.articulo && <span className="text-gray-500"> · {ot.articulo}</span>}
                    <span className="block text-[11px] text-gray-400">
                        {ot.unidades != null && `${fmtCantidad(ot.unidades)} ${ot.unidades === 1 ? "unidad" : "unidades"}`}
                        {ot.unidades != null && ot.fecha_prometida && " · "}
                        {ot.fecha_prometida && `prometida el ${fmtFecha(ot.fecha_prometida)}`}
                    </span>
                </p>
                <Link
                    href={enlaceOT(ot.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-700"
                    title="Abrir la OT en Operaciones"
                >
                    Abrir la OT <ExternalLink className="h-3 w-3" />
                </Link>
            </div>
            <div className="px-5 py-4">
                <MateriasPrimasOT
                    key={ot.id}
                    idOrden={ot.id}
                    // Quien ve el botón «Nuevo» puede escribir la sección: lo demás (el modo
                    // espejo o práctica de la piloto) lo resuelve la solapa, como en la OT.
                    edita
                    activo
                    numeroOT={ot.numero}
                    unidadesOT={ot.unidades}
                    noLleva={ot.noLleva}
                    onLineasChange={alCambiarLineas}
                    onSinGuardarChange={onSinGuardar}
                    onNoLlevaChange={() => onCambio()}
                />
            </div>
        </div>
    );
}

export default NuevoMateriaPrimaOTDialog;
