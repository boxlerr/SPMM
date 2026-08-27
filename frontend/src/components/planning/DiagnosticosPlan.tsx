"use client";

/**
 * Qué traba este plan y cómo se destraba.
 *
 * Cuarta pasada de diseño. La primera eran cajas anidadas con párrafos ("marea
 * tanto texto" — Lucas); la segunda comprimió todo a líneas de 11px grises y un
 * solo item abierto a la vez, y Julián la devolvió: "me marea que esté todo en
 * gris y tan chiquito, y si abro una se cierra otra"; la tercera arregló eso pero
 * escondía el detalle hasta que abrías la línea, y el detalle es justamente lo que
 * dice qué máquina y qué rango hay que ir a tocar. Esta versión sigue el mockup:
 *
 *  - El detalle se lee SIEMPRE, en dos líneas, sin abrir nada. Abrir la línea
 *    agrega las soluciones y los botones, no revela el problema.
 *  - Cada línea abre y cierra POR SU CUENTA (Set de abiertos, no un único id).
 *  - Se muestran las primeras 4 y "Ver todas" despliega el resto: con 11 avisos la
 *    tabla del plan quedaba abajo de todo y había que scrollear para verla.
 *  - El "dónde" dejó de ser un cartelito muerto: te lleva a la pantalla, a la
 *    pestaña y a la fila del dato que hay que arreglar, ya desplegada.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, ChevronDown, Info, Loader2, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { antiguedadTexto } from "@/lib/borradorPlan";

/** Cuántas líneas se ven antes de "Ver todas". */
const VISIBLES = 4;

/**
 * Resalta lo que viene entre **dobles asteriscos** desde el backend.
 *
 * Los avisos nombran máquinas, rangos, personas y fechas — los datos que hay que
 * ir a tocar — y en un párrafo plano se pierden. El backend los marca y acá se
 * dibujan resaltados. No es Markdown: solo negritas, que es lo único que hace
 * falta y lo único que no puede romper nada.
 *
 * Se dibuja en `font-medium` sobre un cuerpo gris, no en `font-semibold` sobre
 * negro. Con cinco o seis nombres por renglón —que es lo normal en un aviso de
 * cuello de máquina— el semibold no resalta: grita, y el ojo deja de distinguir
 * qué es dato y qué es relleno ("me marea tanta negrita", Julián 21/08). El
 * contraste sigue estando, lo pone la diferencia con el gris de alrededor.
 */
function conNegritas(texto: string) {
    return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
        parte.startsWith("**") && parte.endsWith("**") && parte.length > 4 ? (
            <strong key={i} className="font-medium text-gray-900">{parte.slice(2, -2)}</strong>
        ) : (
            parte
        )
    );
}

/**
 * La categoría del aviso, en una palabra y siempre en la misma columna.
 *
 * Es lo que permite barrer la lista sin leerla: seis rótulos posibles, ancho fijo,
 * y los títulos arrancan todos a la misma altura. Sin esto cada línea empieza con
 * una palabra distinta —un nombre de proceso, uno de máquina, una cifra— y para
 * saber de qué habla cada una hay que leerlas todas enteras.
 *
 * El color lo da la severidad y no la categoría: rojo lo que quedó sin resolver,
 * ámbar lo que sale igual. Así un solo elemento dice las dos cosas y no hace falta
 * además el puntito de color que había antes.
 */
const CATEGORIA: Record<string, string> = {
    proceso_sin_operarios: "Sin gente",
    proceso_sin_rango: "Sin rango",
    maquina_incompatible: "Sin máquina",
    cuello_de_maquina: "Cuello",
    trabajo_tercerizado: "Terceros",
    puestos_vacantes: "Vacante",
};

const categoriaDe = (tipo: string) => CATEGORIA[tipo] ?? "Plan";

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

/**
 * A dónde manda el "dónde" del aviso.
 *
 * Antes esto era un `<span>` gris que decía "Recursos › Procesos" y no hacía nada:
 * había que salir, encontrar la pantalla, elegir la pestaña, buscar el proceso
 * entre 414 y recién ahí desplegar la fila. Ahora el link deja todo eso hecho.
 *
 * Con UN objetivo se apunta a la fila concreta (`foco`) y se precarga el buscador
 * para que caiga en la primera página. Con varios solo se abre la pestaña: llevar
 * a una de las tres soldadoras haría creer que el aviso habla de esa sola.
 */
function enlaceDe(donde: string, accion?: DiagnosticoAccion | null): string | null {
    const d = (donde || "").toLowerCase();
    if (!d.startsWith("recursos")) return null;

    const pestania = d.includes("maquinaria") ? "maquinas"
        : d.includes("proceso") ? "procesos"
            : d.includes("operario") ? "operarios"
                : null;
    if (!pestania) return null;

    const params = new URLSearchParams({ tab: pestania });

    // El objetivo de una skill_nativa es el operario; en los otros casos, el
    // proceso o la máquina que se va a tocar.
    const objetivos = accion?.objetivos?.length
        ? accion.objetivos
        : accion
            ? [{ id: accion.id, nombre: accion.nombre }]
            : [];

    if (accion && objetivos.length === 1) {
        const clave = accion.tipo === "maquinaria" ? "maquina"
            : accion.tipo === "skill_nativa" ? "operario"
                : "proceso";
        // La pestaña del link manda sobre el tipo de la acción: hay soluciones de
        // tipo "proceso" cuyo "dónde" es Maquinarias, y ahí el id no aplica.
        const coincide =
            (clave === "maquina" && pestania === "maquinas") ||
            (clave === "proceso" && pestania === "procesos") ||
            (clave === "operario" && pestania === "operarios");
        if (coincide) {
            params.set("foco", String(objetivos[0].id));
            if (objetivos[0].nombre) params.set("q", objetivos[0].nombre);
        }
    }

    return `/recursos?${params.toString()}`;
}

export function DiagnosticosPlan({
    diagnosticos,
    onResuelto,
    onRevisar,
    revisando = false,
    calculadoEn,
    revisionAuto = null,
    colapsado: colapsadoProp,
    onColapsadoChange,
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
     *
     * Desde el 21/08 esto pasa SOLO al volver a la pantalla (ver `revisionAuto`);
     * el botón queda como salida manual para cuando la revisión automática no
     * puede correr.
     */
    onRevisar?: () => void;
    revisando?: boolean;
    /** Cuándo se calculó este plan (ISO). Sirve para decir de cuándo es la foto. */
    calculadoEn?: string;
    /** En qué anda la revisión automática, para contarlo en vez de pedir un click. */
    revisionAuto?: "mirando" | "recalculando" | "con-retoques" | "no-disponible" | null;
    /**
     * Plegado controlado desde la pantalla.
     *
     * Desplegada esta tira se come ~290px arriba de la tabla del plan. Quién
     * decide si arranca plegada es el padre, porque es el único que sabe si el
     * plan tiene trabas sin resolver (con trabas no se pliega) y el único que
     * necesita poder abrirla desde la cifra "Trabas sin resolver". Sin estas
     * props el componente sigue andando con su estado propio.
     */
    colapsado?: boolean;
    onColapsadoChange?: (v: boolean) => void;
}) {
    const items = diagnosticos ?? [];
    const bloqueantes = items.filter((d) => d.severidad === "bloqueante");
    const avisos = items.filter((d) => d.severidad !== "bloqueante");
    const ordenados = [...bloqueantes, ...avisos];

    const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
    // Controlada por el padre si le pasan la prop; con estado propio si no.
    const [colapsadoLocal, setColapsadoLocal] = useState(false);
    const colapsado = colapsadoProp ?? colapsadoLocal;
    const alternarColapso = () => {
        const next = !colapsado;
        setColapsadoLocal(next);
        onColapsadoChange?.(next);
    };
    const [verTodas, setVerTodas] = useState(false);
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
            bloqueantes.length > 0 && `${bloqueantes.length} ${bloqueantes.length === 1 ? "traba detectada" : "trabas detectadas"}`,
            avisos.length > 0 && `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`,
        ].filter(Boolean).join(" y ");

    const visibles = verTodas ? ordenados : ordenados.slice(0, VISIBLES);
    const ocultas = ordenados.length - visibles.length;

    return (
        <div className={cn(
            "mx-4 mt-4 mb-2 rounded-xl border overflow-hidden bg-white",
            items.length === 0 ? "border-emerald-200" : hayBloqueantes ? "border-rose-200" : "border-amber-200"
        )}>
            {/* La fila es un div y no un <button>: adentro van "Ver todas" y "Volver a
                revisar", y no se pueden anidar botones. El toggle queda como botón propio. */}
            <div
                className={cn(
                    "w-full flex items-center gap-2",
                    items.length === 0 ? "bg-emerald-50/70"
                        : hayBloqueantes ? "bg-rose-50/70" : "bg-amber-50/60"
                )}
            >
                <button
                    type="button"
                    aria-expanded={!colapsado}
                    onClick={alternarColapso}
                    className={cn(
                        "flex-1 min-w-0 px-4 flex gap-3 text-left",
                        // Plegada la tira es UNA línea de ~40px en vez de ~64. Lo que
                        // sobrevive es lo que importa: el color (rojo = hay trabas), el
                        // resumen ("3 trabas detectadas y 2 avisos") y el chevron. La
                        // explicación de qué hacer con eso se lee al abrir.
                        colapsado ? "py-2 items-center" : "py-3 items-start",
                    )}
                >
                    {items.length === 0 ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-px" />
                    ) : hayBloqueantes ? (
                        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-px" />
                    ) : (
                        <Info className="w-5 h-5 text-amber-500 shrink-0 mt-px" />
                    )}
                    <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-gray-900">{resumenHeader}</span>
                        {!colapsado && (
                            <span className="block text-[13px] text-gray-600 mt-0.5">
                                {items.length === 0
                                    ? "Quedó todo resuelto."
                                    : hayBloqueantes
                                        ? "Lo rojo quedó sin resolver en el plan. Resolvelas para optimizar tu planificación."
                                        : "El plan sale igual. Resolvelos para optimizar tu planificación."}
                            </span>
                        )}
                    </span>
                    <span className="flex-1" />
                    {colapsado && (
                        <span className="text-[13px] font-medium text-gray-600 shrink-0 whitespace-nowrap">
                            Ver {items.length === 1 ? "el aviso" : "los avisos"}
                        </span>
                    )}
                    <ChevronDown
                        className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", colapsado ? "-rotate-90" : "mt-1")}
                    />
                </button>

                {ocultas > 0 && !colapsado && (
                    <button
                        type="button"
                        onClick={() => setVerTodas(true)}
                        className="shrink-0 text-[13px] font-medium text-gray-700 hover:text-gray-900 whitespace-nowrap"
                    >
                        Ver todas <span className="text-gray-400">›</span>
                    </button>
                )}

                {onRevisar && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onRevisar}
                        disabled={revisando}
                        className="mr-3 h-7 shrink-0 gap-1.5 text-xs text-gray-700 hover:bg-white/70"
                        title="Recalcular ahora para ver si lo que arreglaste en Recursos ya está"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", revisando && "animate-spin")} />
                        {revisando ? "Revisando…" : "Volver a revisar"}
                    </Button>
                )}
            </div>

            {!colapsado && (
                /* De cuándo es esta foto y quién la mantiene al día. Antes acá había
                   un "tocá Volver a revisar" que aparecía recién a la hora; ahora la
                   revisión corre sola al volver a la pantalla y lo único que falta
                   decir es eso, para que nadie quede esperando un botón. */
                <div className="border-t bg-slate-50 px-4 py-2 text-[12px] text-slate-600 flex items-center gap-2">
                    {revisionAuto === "mirando" && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />}
                    {revisionAuto === "recalculando" && <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />}
                    {revisionAuto === "con-retoques" && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    <span>
                        {revisionAuto === "mirando"
                            ? "Fijándose si cambió algo en Recursos…"
                            : revisionAuto === "recalculando"
                                ? <>Cambió algo en Recursos: <strong>recalculando el plan</strong> para ver qué quedó resuelto.</>
                                : revisionAuto === "con-retoques"
                                    ? <>
                                        Cambió algo en Recursos, pero <strong>no recalculo solo</strong> porque tenés
                                        cambios hechos a mano en este plan y el recálculo los rehace.
                                        {" "}Tocá <strong>Volver a revisar</strong> cuando quieras.
                                    </>
                                    : revisionAuto === "no-disponible"
                                        ? <>No se pudo consultar Recursos{calculadoEn ? <> (esta revisión es {antiguedadTexto(calculadoEn)})</> : null}. Si arreglaste algo, tocá <strong>Volver a revisar</strong>.</>
                                        : <>
                                            Revisión del plan {calculadoEn ? antiguedadTexto(calculadoEn) : "recién"}.
                                            {" "}Si vas a Recursos y arreglás algo, al volver acá se revisa y se recalcula solo.
                                        </>}
                    </span>
                </div>
            )}

            {!colapsado && resueltos.length > 0 && (
                <ul className="divide-y border-t bg-emerald-50/40">
                    {/* Misma geometría que las filas de abajo —chip de 92px y después el
                        título— para que los resueltos y los pendientes se lean como una
                        sola lista y no como dos tablas pegadas. */}
                    {resueltos.map((d) => (
                        <li key={`resuelto-${d.id}`} className="px-4 py-2.5 flex items-center gap-3">
                            <span className="shrink-0 w-[92px] text-center rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide py-1">
                                Resuelto
                            </span>
                            <span className="flex-1 min-w-0 text-sm text-gray-600 truncate line-through decoration-emerald-600/40">
                                {d.titulo}
                            </span>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        </li>
                    ))}
                </ul>
            )}

            {!colapsado && (
                <ul className="divide-y border-t">
                    {visibles.map((d) => {
                        const activo = abiertos.has(d.id);
                        const esBloq = d.severidad === "bloqueante";
                        return (
                            <li key={d.id} className={cn(activo && "bg-slate-50/60")}>
                                <button
                                    type="button"
                                    aria-expanded={activo}
                                    onClick={() => toggle(d.id)}
                                    className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-slate-50 transition-colors"
                                >
                                    <span
                                        className={cn(
                                            "shrink-0 w-[92px] mt-px text-center rounded border text-[10px] font-bold uppercase tracking-wide py-1",
                                            esBloq
                                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                                : "bg-amber-50 text-amber-800 border-amber-200"
                                        )}
                                        title={esBloq
                                            ? "Traba: quedó sin resolver en el plan"
                                            : "Aviso: el plan sale igual"}
                                    >
                                        {categoriaDe(d.tipo)}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-semibold text-gray-900">{d.titulo}</span>
                                        {/* El detalle es lo que dice QUÉ máquina y QUÉ rango tocar.
                                            Tenerlo escondido detrás de un click obligaba a abrir las
                                            once líneas para saber cuál importaba. */}
                                        <span className={cn(
                                            "block text-[13px] text-gray-500 leading-relaxed mt-0.5 max-w-[95ch]",
                                            !activo && "line-clamp-2"
                                        )}>
                                            {conNegritas(d.detalle)}
                                        </span>
                                    </span>
                                    <span
                                        className="hidden sm:inline-flex items-center rounded-full bg-slate-100 text-slate-600 text-xs px-2.5 py-1 tabular-nums shrink-0 mt-px"
                                        title={d.impacto.ots.length > 0 ? `OTs: ${d.impacto.ots.map((n) => `#${n}`).join(", ")}` : undefined}
                                    >
                                        {d.impacto.resumen}
                                    </span>
                                    <ChevronDown
                                        className={cn(
                                            "w-4 h-4 text-gray-400 shrink-0 mt-1.5 transition-transform",
                                            activo && "rotate-180"
                                        )}
                                    />
                                </button>

                                {activo && (
                                    <div className="px-4 pb-3.5 pl-[7.75rem] space-y-2.5">
                                        {d.soluciones.length > 0 && (
                                            <div className="space-y-1.5">
                                                {d.soluciones.map((s, i) => {
                                                    const clave = `${d.id}-${i}`;
                                                    const hecha = aplicadas.has(clave);
                                                    const link = enlaceDe(s.donde, s.accion);
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
                                                                        {link ? (
                                                                            <a
                                                                                href={link}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                className="inline-flex items-center gap-1 rounded bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 text-xs px-1.5 py-px whitespace-nowrap align-baseline transition-colors"
                                                                                title="Abrir en otra pestaña, ya parado en lo que hay que tocar"
                                                                            >
                                                                                {s.donde}
                                                                                <ArrowUpRight className="w-3 h-3" />
                                                                            </a>
                                                                        ) : (
                                                                            <span className="inline-block rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-px whitespace-nowrap align-baseline">
                                                                                {s.donde}
                                                                            </span>
                                                                        )}
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

            {!colapsado && ocultas > 0 && (
                <button
                    type="button"
                    onClick={() => setVerTodas(true)}
                    className="w-full border-t px-4 py-2.5 text-[13px] font-medium text-gray-600 hover:bg-slate-50 transition-colors"
                >
                    Ver las {ocultas} restantes
                </button>
            )}
            {!colapsado && verTodas && ordenados.length > VISIBLES && (
                <button
                    type="button"
                    onClick={() => setVerTodas(false)}
                    className="w-full border-t px-4 py-2.5 text-[13px] font-medium text-gray-500 hover:bg-slate-50 transition-colors"
                >
                    Mostrar solo las primeras {VISIBLES}
                </button>
            )}
        </div>
    );
}
