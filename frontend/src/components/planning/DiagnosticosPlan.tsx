"use client";

/**
 * Qué traba este plan y cómo se destraba.
 *
 * Tercera pasada de diseño. La primera eran cajas anidadas con párrafos ("marea
 * tanto texto" — Lucas); la segunda comprimió todo a líneas de 11px grises y un
 * solo item abierto a la vez, y Julián la devolvió: "me marea que esté todo en
 * gris y tan chiquito, y si abro una se cierra otra". Esta versión:
 *
 *  - Cada línea abre y cierra POR SU CUENTA (Set de abiertos, no un único id).
 *  - Texto a 14px con jerarquía real: título oscuro, etiqueta traba/aviso con
 *    color, detalle legible. El gris clarito queda solo para lo accesorio.
 *  - El encabezado dice qué significa cada color, porque "2 trabas" solo no
 *    le decía nada a nadie.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Info, Loader2, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { antiguedadTexto, estaViejo } from "@/lib/borradorPlan";

/**
 * Resalta lo que viene entre **dobles asteriscos** desde el backend.
 *
 * Los avisos nombran máquinas, rangos, personas y fechas — los datos que hay que
 * ir a tocar — y en un párrafo plano se pierden. El backend los marca y acá se
 * dibujan en negrita. No es Markdown: solo negritas, que es lo único que hace
 * falta y lo único que no puede romper nada.
 */
function conNegritas(texto: string) {
    return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
        parte.startsWith("**") && parte.endsWith("**") && parte.length > 4 ? (
            <strong key={i} className="font-semibold text-gray-900">{parte.slice(2, -2)}</strong>
        ) : (
            parte
        )
    );
}

/**
 * El cambio concreto que hace falta, listo para aplicar desde el aviso.
 *
 * `rangos` es el conjunto FINAL (los que ya tenía más los nuevos): los endpoints
 * de rangos reemplazan, no suman.
 *
 * `objetivos` permite que una sola solución toque VARIAS cosas — las tres
 * soldadoras MIG, los dos pasantes—. Antes, con más de una máquina no se ofrecía
 * botón para no cambiar un parque entero de un click, pero el efecto real era que
 * la mitad de los avisos había que resolverlos a mano en Recursos haciendo
 * exactamente lo mismo, uno por uno. El resguardo ahora es el texto (dice a cuánta
 * gente se le abre la máquina) más la confirmación del botón.
 *
 * `id`/`rangos` sueltos quedan por compatibilidad con lo ya desplegado.
 */
export interface DiagnosticoAccion {
    tipo: "proceso" | "maquinaria" | "skill_nativa";
    id: number;
    nombre: string;
    rangos?: number[];
    /** Para skill_nativa: a qué estado se lleva la habilidad. */
    habilitado?: boolean;
    /** Cada cosa a tocar. Para skill_nativa son operarios; si no, procesos o máquinas. */
    objetivos?: { id: number; nombre: string; rangos?: number[] }[];
}

export interface DiagnosticoSolucion {
    texto: string;
    donde: string;
    accion?: DiagnosticoAccion | null;
}

export interface Diagnostico {
    id: string;
    tipo: string;
    severidad: "bloqueante" | "advertencia";
    titulo: string;
    detalle: string;
    impacto: {
        procesos: number;
        ots: number[];
        minutos: number;
        resumen: string;
    };
    soluciones: DiagnosticoSolucion[];
}

export function DiagnosticosPlan({
    diagnosticos,
    onResuelto,
    onRevisar,
    revisando = false,
    calculadoEn,
}: {
    diagnosticos?: Diagnostico[];
    /** Se llama después de aplicar un cambio, para recalcular el plan con el dato nuevo. */
    onResuelto?: () => void;
    /**
     * Volver a calcular para ver si lo que se arregló afuera (en Recursos) ya está.
     *
     * Los diagnósticos son una foto del momento del cálculo: si vas a Recursos,
     * cargás el rango que te pedía y volvés, el aviso sigue ahí igual de rojo
     * aunque el problema ya no exista. Peor con un borrador retomado, que puede ser
     * de ayer. No se puede revalidar sin recalcular —el diagnóstico se construye
     * con lo que el solver realmente hizo—, así que esto recalcula.
     */
    onRevisar?: () => void;
    revisando?: boolean;
    /** Cuándo se calculó este plan (ISO). Sirve para avisar que la foto es vieja. */
    calculadoEn?: string;
}) {
    const items = diagnosticos ?? [];
    const bloqueantes = items.filter((d) => d.severidad === "bloqueante");
    const avisos = items.filter((d) => d.severidad !== "bloqueante");

    const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
    const [colapsado, setColapsado] = useState(false);
    const [aplicando, setAplicando] = useState<string | null>(null);
    const [aplicadas, setAplicadas] = useState<Set<string>>(new Set());
    /**
     * Botón en dos pasos: el primer click pregunta, el segundo aplica.
     *
     * Estos cambios tocan quién puede usar una máquina — el 18/08 un cambio así,
     * hecho sin preguntar, abrió la PLEGADORA de 1 persona a 10 y hubo que
     * revertirlo. Un click de más es barato al lado de eso, y el paso intermedio
     * es donde se lee el "ojo, esto la habilita para N personas".
     */
    const [confirmando, setConfirmando] = useState<string | null>(null);

    /**
     * Los que estaban en el cálculo anterior y ya no están: se arreglaron.
     *
     * Sin esto, resolver algo se ve como un aviso que desaparece — y un aviso que
     * desaparece se lee como un aviso que se perdió, no como un problema resuelto.
     * Quedan en verde hasta el próximo recálculo.
     */
    const previos = useRef<Diagnostico[]>([]);
    const [resueltos, setResueltos] = useState<Diagnostico[]>([]);

    useEffect(() => {
        const ahora = new Set(items.map((d) => d.id));
        const antes = previos.current;
        // Solo si ANTES había algo: en el primer render no hay nada resuelto, hay
        // un plan recién calculado.
        if (antes.length > 0) {
            const idos = antes.filter((d) => !ahora.has(d.id));
            if (idos.length > 0) setResueltos(idos);
        }
        previos.current = items;
    }, [items]);

    /**
     * Aplica el cambio de rangos y recalcula el plan sin salir de la vista previa.
     *
     * Cambiar rangos toca quién puede usar una máquina o hacer un proceso, así que
     * el botón no adivina: el texto del aviso dice exactamente qué se va a cambiar
     * y a cuánta gente alcanza, y recién ahí se aplica.
     */
    const aplicar = async (clave: string, accion: DiagnosticoAccion) => {
        if (confirmando !== clave) {
            setConfirmando(clave);
            return;
        }
        setConfirmando(null);
        setAplicando(clave);
        try {
            const base = API_URL.replace(/\/$/, "");
            const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
            const cabeceras = {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            };

            // Una solución puede tocar varias cosas (las tres soldadoras MIG, los dos
            // pasantes). Sin `objetivos` es una sola: el formato viejo.
            const objetivos = accion.objetivos?.length
                ? accion.objetivos
                : [{ id: accion.id, nombre: accion.nombre, rangos: accion.rangos }];

            const urlDe = (objetivoId: number) =>
                accion.tipo === "proceso" ? `${base}/procesos/${objetivoId}/rangos`
                    : accion.tipo === "maquinaria" ? `${base}/maquinarias/${objetivoId}/rangos`
                        // skill_nativa: el objetivo es el operario y el proceso va en la ruta.
                        : `${base}/operarios/${objetivoId}/skills-nativas/${accion.id}/estado`;

            const cuerpoDe = (o: { rangos?: number[] }) =>
                accion.tipo === "skill_nativa"
                    ? { habilitado: accion.habilitado ?? true }
                    : { rangos: o.rangos ?? accion.rangos ?? [] };

            // En serie y no en paralelo: son pocos y así, si el tercero falla, los dos
            // primeros ya quedaron aplicados y el reintento no los pisa de nuevo.
            const fallidos: string[] = [];
            for (const o of objetivos) {
                try {
                    const r = await fetch(urlDe(o.id), {
                        method: "PUT",
                        headers: cabeceras,
                        body: JSON.stringify(cuerpoDe(o)),
                    });
                    if (!r.ok) fallidos.push(o.nombre);
                } catch {
                    fallidos.push(o.nombre);
                }
            }
            // Todo mal es un error; algo mal se dice con nombre y apellido, porque el
            // resto SÍ se aplicó y volver a tocar el botón repetiría lo que ya está.
            if (fallidos.length === objetivos.length) throw new Error("todos");
            if (fallidos.length > 0) {
                toast.warning(`Quedó a medias: no se pudo con ${fallidos.join(", ")}`, {
                    description: "El resto se aplicó. Terminá esos desde Recursos.",
                });
            }
            setAplicadas((prev) => new Set(prev).add(clave));
            toast.success(
                objetivos.length === 1
                    ? `Listo: ${objetivos[0].nombre} actualizado`
                    : `Listo: ${objetivos.length} actualizados`,
                { description: "Recalculando el plan con el cambio…" },
            );
            onResuelto?.();
        } catch {
            toast.error(`No se pudo actualizar ${accion.nombre}`, {
                description: "Probá desde Recursos.",
            });
        } finally {
            setAplicando(null);
        }
    };

    // Antes se iba en null apenas la lista quedaba vacía. Justo el caso en que se
    // resolvió lo último: el aviso desaparecía sin decir que se había arreglado.
    if (items.length === 0 && resueltos.length === 0) return null;

    const toggle = (id: string) =>
        setAbiertos((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const hayBloqueantes = bloqueantes.length > 0;
    const resumenHeader = items.length === 0
        ? "Sin trabas ni avisos"
        : [
            bloqueantes.length > 0 && `${bloqueantes.length} ${bloqueantes.length === 1 ? "traba" : "trabas"}`,
            avisos.length > 0 && `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`,
        ].filter(Boolean).join(" y ");

    return (
        <div className="mx-4 mt-4 mb-2 rounded-lg border bg-white overflow-hidden">
            {/* La fila es un div y no un <button>: adentro va el de "Volver a revisar"
                y no se pueden anidar botones. El toggle queda como botón propio. */}
            <div
                className={cn(
                    "w-full flex items-center transition-colors",
                    items.length === 0 ? "bg-emerald-50/70"
                        : hayBloqueantes ? "bg-rose-50/70" : "bg-amber-50/60"
                )}
            >
            <button
                type="button"
                aria-expanded={!colapsado}
                onClick={() => setColapsado((c) => !c)}
                className="flex-1 min-w-0 px-4 py-2.5 flex items-center gap-2.5 text-left"
            >
                {items.length === 0 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : hayBloqueantes ? (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                    <Info className="w-4 h-4 text-amber-500 shrink-0" />
                )}
                <span className="text-sm font-semibold text-gray-900">{resumenHeader}</span>
                <span className="text-[13px] text-gray-600 hidden sm:inline truncate">
                    {items.length === 0
                        ? "— quedó todo resuelto"
                        : hayBloqueantes
                            ? "— lo rojo quedó sin resolver en el plan; tocá la línea para ver cómo se arregla"
                            : "— el plan sale igual; tocá cada línea para el detalle"}
                </span>
                <span className="flex-1" />
                <ChevronDown
                    className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", colapsado && "-rotate-90")}
                />
            </button>

            {onRevisar && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRevisar}
                    disabled={revisando}
                    className="mr-3 h-7 shrink-0 gap-1.5 text-xs text-gray-700 hover:bg-white/70"
                    title="Recalcular para ver si lo que arreglaste en Recursos ya está"
                >
                    <RefreshCw className={cn("w-3.5 h-3.5", revisando && "animate-spin")} />
                    {revisando ? "Revisando…" : "Volver a revisar"}
                </Button>
            )}
            </div>

            {!colapsado && estaViejo(calculadoEn) && (
                /* Un borrador retomado puede ser de ayer: lo que se arregló en
                   Recursos desde entonces no está reflejado acá y el aviso se lee
                   como si el problema siguiera. */
                <div className="border-t bg-slate-50 px-4 py-2.5 text-[13px] text-slate-600">
                    Esta revisión se calculó <strong>{antiguedadTexto(calculadoEn)}</strong>. Si
                    desde entonces cargaste rangos o habilidades en Recursos, tocá{" "}
                    <strong>Volver a revisar</strong> para que se actualice.
                </div>
            )}

            {!colapsado && resueltos.length > 0 && (
                <ul className="divide-y border-t bg-emerald-50/40">
                    {resueltos.map((d) => (
                        <li key={`resuelto-${d.id}`} className="px-4 py-2.5 flex items-center gap-2.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 shrink-0">
                                Resuelto
                            </span>
                            <span className="text-sm text-gray-700 truncate line-through decoration-emerald-600/40">
                                {d.titulo}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {!colapsado && (
                <ul className="divide-y border-t">
                    {[...bloqueantes, ...avisos].map((d) => {
                        const activo = abiertos.has(d.id);
                        const esBloq = d.severidad === "bloqueante";
                        return (
                            <li key={d.id} className={cn(activo && "bg-slate-50/60")}>
                                <button
                                    type="button"
                                    aria-expanded={activo}
                                    onClick={() => toggle(d.id)}
                                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
                                >
                                    <span
                                        className={cn(
                                            // amber-700 y no 600: a 11px el 600 sobre blanco no
                                            // llega al contraste AA y era ilegible — justo lo
                                            // que este rediseño vino a arreglar.
                                            "text-[11px] font-semibold uppercase tracking-wide shrink-0 w-11",
                                            esBloq ? "text-rose-600" : "text-amber-700"
                                        )}
                                    >
                                        {esBloq ? "Traba" : "Aviso"}
                                    </span>
                                    <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
                                        {d.titulo}
                                    </span>
                                    <span
                                        className="hidden sm:inline-flex items-center rounded-full bg-slate-100 text-slate-600 text-xs px-2 py-0.5 tabular-nums shrink-0"
                                        title={`OTs: ${d.impacto.ots.map((n) => `#${n}`).join(", ")}`}
                                    >
                                        {d.impacto.resumen}
                                    </span>
                                    <ChevronDown
                                        className={cn(
                                            "w-4 h-4 text-gray-400 shrink-0 transition-transform",
                                            activo && "rotate-180"
                                        )}
                                    />
                                </button>

                                {activo && (
                                    <div className="px-4 pb-3.5 pl-[4.25rem] space-y-2.5">
                                        <p className="text-sm text-gray-700 leading-relaxed max-w-[80ch]">
                                            {conNegritas(d.detalle)}
                                        </p>
                                        {d.soluciones.length > 0 && (
                                            <div className="space-y-1.5">
                                                {d.soluciones.map((s, i) => {
                                                  const clave = `${d.id}-${i}`;
                                                  const hecha = aplicadas.has(clave);
                                                  return (
                                                    <div key={i} className="flex items-start gap-2 text-sm">
                                                        <Wrench className="w-3.5 h-3.5 mt-[3px] shrink-0 text-emerald-600" />
                                                        <span className="text-gray-800 leading-relaxed">
                                                            {conNegritas(s.texto)}
                                                            {/* Hay soluciones que no mandan a ninguna pantalla
                                                                ("está bien así"): sin esto quedaba un chip vacío. */}
                                                            {s.donde && (
                                                                <>
                                                                    {" "}
                                                                    <span className="inline-block rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-px whitespace-nowrap align-baseline">
                                                                        {s.donde}
                                                                    </span>
                                                                </>
                                                            )}
                                                            {s.accion && (
                                                                <>
                                                                    {" "}
                                                                    <Button
                                                                        size="sm"
                                                                        variant={hecha ? "ghost" : "outline"}
                                                                        disabled={hecha || aplicando !== null}
                                                                        onClick={() => aplicar(clave, s.accion!)}
                                                                        onBlur={() => confirmando === clave && setConfirmando(null)}
                                                                        className={cn(
                                                                            "h-6 px-2 text-[11px] gap-1 align-baseline",
                                                                            hecha
                                                                                ? "text-emerald-700"
                                                                                : confirmando === clave
                                                                                    ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                                                                    : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                                                                        )}
                                                                    >
                                                                        {aplicando === clave ? (
                                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                                        ) : hecha ? (
                                                                            <Check className="w-3 h-3" />
                                                                        ) : null}
                                                                        {hecha
                                                                            ? "Aplicado"
                                                                            : confirmando === clave
                                                                                ? "Tocá de nuevo para confirmar"
                                                                                : "Aplicar y recalcular"}
                                                                    </Button>
                                                                </>
                                                            )}
                                                        </span>
                                                    </div>
                                                  );
                                                })}
                                            </div>
                                        )}
                                        <p className="text-xs text-gray-500">
                                            {/* En mobile el chip del resumen no entra en la fila,
                                                así que acá es el único lugar donde se ve. */}
                                            <span className="sm:hidden">
                                                {d.impacto.resumen}
                                                {d.impacto.ots.length > 0 ? " — " : ""}
                                            </span>
                                            {d.impacto.ots.length > 0 && (
                                                <>OTs: {d.impacto.ots.map((n) => `#${n}`).join(", ")}</>
                                            )}
                                        </p>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
