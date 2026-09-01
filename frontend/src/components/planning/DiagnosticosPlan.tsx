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
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, ChevronDown, Cog, Info, ListChecks, Loader2, RefreshCw, RotateCcw, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { antiguedadTexto } from "@/lib/borradorPlan";

/** Cuántas líneas se ven antes de "Ver todas". */
// Con la tarjeta compacta seis avisos ocupan casi lo mismo que ocupaban cuatro filas
// de las viejas (384px contra 356px, medido en Chrome): mostrar cuatro sería dejar
// pantalla sin usar y hacer tocar "Ver todas" de gusto.
const VISIBLES = 6;

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
 * La categoría del aviso: de qué RECURSO habla y qué le pasa.
 *
 * Es la taxonomía cerrada que pidió Lucas el 28/08 y son las únicas cuatro
 * combinaciones que existen: recurso máquina → rango | capacidad, recurso humano
 * → rango | skill. La arma el backend (`recurso` y `subtipo` en cada
 * diagnóstico); acá solo se dibuja.
 *
 * Antes esta columna decía "Sin gente", "Sin rango", "Cuello", "Terceros" —seis
 * rótulos inventados acá, uno por tipo de aviso—. Servían para barrer la lista,
 * pero no para contestar la pregunta que Lucas hizo mirando la pantalla: "acá no
 * dice en ningún lado traba". "Sin gente" no dice si el problema es de la persona
 * o de la máquina, y esas son las dos únicas pantallas a las que se puede ir.
 *
 * El color lo sigue dando la severidad y no la categoría: rojo lo que quedó sin
 * resolver, ámbar lo que sale igual.
 */
const RECURSO: Record<string, { texto: string; icono: LucideIcon }> = {
    maquina: { texto: "Recurso máquina", icono: Cog },
    humano: { texto: "Recurso humano", icono: Users },
};

const SUBTIPO: Record<string, string> = {
    rango: "Rango",
    capacidad: "Capacidad",
    skill: "Skill",
};

/**
 * De qué recurso habla un aviso que llegó sin `recurso`.
 *
 * El backend se despliega a mano y a destiempo del frontend (Cloud Run contra
 * Vercel): entre un deploy y el otro los avisos llegan con el formato viejo. Sin
 * esto la columna quedaría vacía justo en la pantalla que Lucas mira.
 */
const RECURSO_POR_TIPO: Record<string, "maquina" | "humano"> = {
    proceso_sin_operarios: "humano",
    proceso_sin_rango: "humano",
    puestos_vacantes: "humano",
    maquina_incompatible: "maquina",
    cuello_de_maquina: "maquina",
    trabajo_tercerizado: "maquina",
};

const SUBTIPO_POR_TIPO: Record<string, string> = {
    proceso_sin_operarios: "rango",
    proceso_sin_rango: "rango",
    puestos_vacantes: "rango",
    maquina_incompatible: "rango",
    cuello_de_maquina: "capacidad",
    trabajo_tercerizado: "capacidad",
};

const recursoDe = (d: Diagnostico) => RECURSO[d.recurso ?? RECURSO_POR_TIPO[d.tipo] ?? "maquina"];
const subtipoDe = (d: Diagnostico) => SUBTIPO[d.subtipo ?? SUBTIPO_POR_TIPO[d.tipo] ?? ""] ?? "";

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
    /**
     * A qué fila de Recursos apunta el "dónde" cuando la solución NO trae botón.
     *
     * Los avisos Media casi nunca traen `accion` —qué rango va lo sabe el taller,
     * no el planificador—, y el link se armaba a partir de la acción: justo los
     * que van a quedar para siempre en pantalla ("los de media van a estar
     * siempre porque es una recomendación", Lucas 28/08) eran los que te dejaban
     * buscando la fila a mano entre 414 procesos.
     */
    objetivo?: {
        tipo: "proceso" | "maquinaria" | "operario";
        id: number;
        nombre: string;
        /** Rangos propuestos, para llegar a Recursos con la solución ya tildada. */
        rangos?: number[];
    } | null;
}

export interface Diagnostico {
    id: string;
    tipo: string;
    severidad: "bloqueante" | "advertencia";
    /** Taxonomía cerrada (Lucas 28/08). Opcionales: el backend viejo no las manda. */
    recurso?: "maquina" | "humano";
    subtipo?: "rango" | "capacidad" | "skill";
    /** Qué tiene hoy el recurso ("Medio oficial") y qué le pide el proceso ("Oficial"). */
    tiene?: string;
    pide?: string;
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
function enlaceDe(donde: string, accion?: DiagnosticoAccion | null, objetivo?: DiagnosticoSolucion["objetivo"]): string | null {
    const d = (donde || "").toLowerCase();
    if (!d.startsWith("recursos")) return null;

    // "operario" sigue estando porque el backend se despliega a mano y a destiempo
    // del frontend: hasta que salga el deploy, los avisos llegan con el nombre
    // viejo y el link tiene que andar igual.
    const pestania = d.includes("maquinaria") ? "maquinas"
        : d.includes("proceso") ? "procesos"
            : (d.includes("humano") || d.includes("operario")) ? "operarios"
                : null;
    if (!pestania) return null;

    const params = new URLSearchParams({ tab: pestania });

    // Sin acción no había a dónde apuntar y el link caía en la lista entera. El
    // `objetivo` es lo mismo pero sin botón: dice a qué fila ir, no qué cambiar.
    if (!accion && objetivo) {
        const clave = objetivo.tipo === "maquinaria" ? "maquina"
            : objetivo.tipo === "operario" ? "operario"
                : "proceso";
        const coincide =
            (clave === "maquina" && pestania === "maquinas") ||
            (clave === "proceso" && pestania === "procesos") ||
            (clave === "operario" && pestania === "operarios");
        if (coincide) {
            params.set("foco", String(objetivo.id));
            if (objetivo.nombre) params.set("q", objetivo.nombre);
            // Los rangos propuestos viajan en el link para que el editor de Recursos
            // se abra con ellos ya tildados: llegar y guardar, sin adivinar cuál era.
            if (objetivo.rangos?.length) params.set("rangos", objetivo.rangos.join(","));
        }
        return `/recursos?${params.toString()}`;
    }

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
            // `rangos` de la acción es el conjunto FINAL (lo que ya tenía más lo
            // nuevo), justo lo que el editor necesita para quedar listo para guardar.
            const rangos = objetivos[0].rangos ?? accion.rangos;
            if (rangos?.length) params.set("rangos", rangos.join(","));
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
    marcados: marcadosProp,
    onMarcadosChange,
    numeroDeOT,
    onVerOT,
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
    /**
     * Los avisos que alguien dio por resueltos A MANO.
     *
     * Distinto de los que desaparecieron solos: estos siguen existiendo en el
     * plan. Lo pidió Lucas el 28/08 mirando los Media —"los de media van a estar
     * siempre porque es una recomendación"—: un aviso que no se puede sacar de la
     * pantalla y que además no traba nada termina siendo ruido, y el ruido tapa
     * las trabas de verdad. Marcarlo no cambia el plan ni toca ningún dato: lo
     * saca de la lista de pendientes y lo baja a la tira verde, del todo
     * reversible. El recálculo manda: si el problema sigue, vuelve a la lista.
     *
     * Lo maneja la pantalla porque la cifra "Trabas sin resolver" del encabezado
     * tiene que contar lo mismo que se ve acá.
     */
    marcados?: Set<string>;
    onMarcadosChange?: (v: Set<string>) => void;
    /**
     * El #OT que se ve en la tabla del plan, a partir del `orden_id` interno.
     *
     * Los avisos los arma el backend con el id de la base, que no es el número que
     * el taller conoce ni el que muestra la tabla. Traducirlo lo puede hacer sólo
     * quien tiene el plan a mano, así que entra por acá. Sin esta función los
     * números no se muestran: un "#212" que no existe en ningún papel es peor que
     * nada.
     */
    numeroDeOT?: (ordenId: number) => string;
    /**
     * Abrir la OT del aviso de un click (Lucas, 28/08: "estaría bueno que hagas
     * clic acá"). Lo resuelve la pantalla —desplegar la fila, traerla a la vista—
     * porque es la que tiene la tabla; el aviso sólo sabe a qué OT apunta.
     */
    onVerOT?: (ordenId: number) => void;
}) {
    const todos = diagnosticos ?? [];

    // Controlado por la pantalla si le pasan la prop; con estado propio si no.
    const [marcadosLocal, setMarcadosLocal] = useState<Set<string>>(new Set());
    const marcados = marcadosProp ?? marcadosLocal;
    const cambiarMarcados = (siguiente: Set<string>) => {
        setMarcadosLocal(siguiente);
        onMarcadosChange?.(siguiente);
    };
    const marcar = (d: Diagnostico) => {
        const siguiente = new Set(marcados);
        siguiente.add(d.id);
        cambiarMarcados(siguiente);
        // "A ver si ponés resuelto y no te dice qué resolvió. Estaría bueno que te
        // diga qué resolvió" (Lucas, 28/08). Por eso va el título y no un "Listo".
        toast.success("Marcado como resuelto", { description: d.titulo });
    };
    const desmarcar = (id: string) => {
        const siguiente = new Set(marcados);
        siguiente.delete(id);
        cambiarMarcados(siguiente);
    };

    const items = todos.filter((d) => !marcados.has(d.id));
    // En el orden en que se ven, para que la tira verde no baraje de nuevo.
    const aMano = todos.filter((d) => marcados.has(d.id));
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
        const ahora = new Set(todos.map((d) => d.id));
        const antes = previos.current;
        // Solo si ANTES había algo: en el primer render no hay nada resuelto, hay
        // un plan recién calculado.
        if (antes.length > 0) {
            const idos = antes.filter((d) => !ahora.has(d.id));
            if (idos.length > 0) setResueltos(idos);
        }
        previos.current = todos;

        // Las marcas a mano de avisos que ya no están se tiran: el recálculo dijo
        // que el problema no existe más, así que ya lo cuenta la tira verde de
        // arriba. Sin esto la marca queda pegada al id y, si el mismo aviso vuelve
        // dentro de un rato, vuelve ya tachado y sin que nadie lo haya mirado.
        if (marcados.size > 0) {
            const vivas = new Set([...marcados].filter((id) => ahora.has(id)));
            if (vivas.size !== marcados.size) cambiarMarcados(vivas);
        }
        // `marcados` a propósito fuera de las dependencias: la limpieza se hace
        // cuando cambian los diagnósticos, no cada vez que alguien marca uno.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todos]);

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
    if (items.length === 0 && resueltos.length === 0 && aMano.length === 0) return null;

    const toggle = (id: string) =>
        setAbiertos((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const hayBloqueantes = bloqueantes.length > 0;
    const resumenHeader = items.length === 0
        // Marcado a mano no es lo mismo que resuelto, y el encabezado no puede
        // decir "sin trabas" cuando las trabas siguen ahí: lo único que pasó es
        // que alguien las dio por vistas.
        ? (aMano.length > 0 ? "Todo listo, marcado por vos" : "Sin trabas ni avisos")
        : [
            bloqueantes.length > 0 && `${bloqueantes.length} ${bloqueantes.length === 1 ? "traba detectada" : "trabas detectadas"}`,
            avisos.length > 0 && `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`,
        ].filter(Boolean).join(" y ");

    const visibles = verTodas ? ordenados : ordenados.slice(0, VISIBLES);
    const ocultas = ordenados.length - visibles.length;

    return (
        <div className="mx-4 mt-4 mb-2 rounded-xl border border-gray-200 overflow-hidden bg-white">
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
                        "flex-1 min-w-0 px-3 flex gap-2.5 text-left",
                        // Plegada la tira es UNA línea de ~36px. Lo que sobrevive es lo
                        // que importa: el color (rojo = hay trabas), el resumen ("3 trabas
                        // detectadas y 2 avisos") y el chevron. La explicación de qué hacer
                        // con eso se lee al abrir.
                        colapsado ? "py-2 items-center" : "py-2 items-start",
                    )}
                >
                    {items.length === 0 ? (
                        <CheckCircle2 className="w-[18px] h-[18px] text-emerald-600 shrink-0 mt-px" />
                    ) : hayBloqueantes ? (
                        <AlertTriangle className="w-[18px] h-[18px] text-rose-600 shrink-0 mt-px" />
                    ) : (
                        <Info className="w-[18px] h-[18px] text-amber-500 shrink-0 mt-px" />
                    )}
                    <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-gray-900 leading-tight">{resumenHeader}</span>
                        {!colapsado && (
                            <span className="block text-[12px] text-gray-600 leading-snug mt-px">
                                {items.length === 0
                                    ? (aMano.length > 0
                                        ? "Los diste por resueltos. Al recalcular, los que sigan trabando vuelven a la lista."
                                        : "Quedó todo resuelto.")
                                    : hayBloqueantes
                                        ? "Lo rojo quedó sin resolver en el plan. Resolvelas para optimizar tu planificación."
                                        : "El plan sale igual. Resolvelos para optimizar tu planificación."}
                            </span>
                        )}
                    </span>
                    <span className="flex-1" />
                    {colapsado && (
                        <span className="text-[12px] font-medium text-gray-600 shrink-0 whitespace-nowrap">
                            Ver {items.length === 1 ? "el aviso" : "los avisos"}
                        </span>
                    )}
                    <ChevronDown
                        className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", colapsado ? "-rotate-90" : "mt-0.5")}
                    />
                </button>

                {/* Con borde, como en el mockup: es la salida a "las veo todas" y tiene
                    que verse como acción, no como texto suelto. */}
                {ocultas > 0 && !colapsado && (
                    <button
                        type="button"
                        onClick={() => setVerTodas(true)}
                        className="shrink-0 h-7 inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white/70 px-2.5 text-[12px] font-medium text-gray-700 hover:bg-white hover:text-gray-900 whitespace-nowrap transition-colors"
                    >
                        Ver las {ordenados.length} <span aria-hidden="true">→</span>
                    </button>
                )}

                {/* "Poner todo listo": el caso es un lote de 60 OTs donde los Media
                    son media pantalla y ya se sabe qué son. No toca el plan ni los
                    datos —los baja a la tira verde— y se deshace uno por uno o
                    entero, así que el riesgo de marcar de más es un click. */}
                {!colapsado && items.length > 0 && (
                    <button
                        type="button"
                        onClick={() => {
                            const siguiente = new Set(marcados);
                            ordenados.forEach((d) => siguiente.add(d.id));
                            cambiarMarcados(siguiente);
                            toast.success(
                                `${ordenados.length} ${ordenados.length === 1 ? "aviso marcado" : "avisos marcados"} como resueltos`,
                                { description: "Siguen en el plan: al recalcular vuelven los que no se hayan arreglado." },
                            );
                        }}
                        className="shrink-0 h-7 inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white/70 px-2.5 text-[12px] font-medium text-gray-700 hover:bg-white hover:text-gray-900 whitespace-nowrap transition-colors"
                        title="Los baja a la tira verde sin tocar el plan ni los datos. Se deshace."
                    >
                        <ListChecks className="w-3.5 h-3.5 shrink-0" />
                        {/* Con el sidebar abierto y una pantalla de 1150px, el tercer
                            botón del encabezado le come el ancho al resumen y "1 traba
                            detectada y 7 avisos" se parte en diez renglones. Abajo de
                            xl queda el ícono solo: la acción sigue estando y el resumen
                            —que es lo que se lee— se queda con su renglón. */}
                        <span className="hidden xl:inline">Marcar todo listo</span>
                    </button>
                )}

                {onRevisar ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onRevisar}
                        disabled={revisando}
                        className="mr-2 h-7 shrink-0 gap-1.5 text-xs text-gray-700 hover:bg-white/70"
                        title="Recalcular ahora para ver si lo que arreglaste en Recursos ya está"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", revisando && "animate-spin")} />
                        {revisando ? "Revisando…" : "Volver a revisar"}
                    </Button>
                ) : (
                    <span className="w-2 shrink-0" />
                )}
            </div>

            {!colapsado && (
                /* De cuándo es esta foto y quién la mantiene al día. Antes acá había
                   un "tocá Volver a revisar" que aparecía recién a la hora; ahora la
                   revisión corre sola al volver a la pantalla y lo único que falta
                   decir es eso, para que nadie quede esperando un botón. */
                <div className="border-t bg-slate-50 px-3 py-1.5 text-[11.5px] leading-snug text-slate-600 flex items-center gap-2">
                    {revisionAuto === "mirando" && <Loader2 className="w-3 h-3 animate-spin text-slate-400 shrink-0" />}
                    {revisionAuto === "recalculando" && <RefreshCw className="w-3 h-3 animate-spin text-blue-500 shrink-0" />}
                    {revisionAuto === "con-retoques" && <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />}
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

            {/* Misma geometría que las tarjetas de abajo —barra de color, chip del mismo
                ancho, título— para que resueltos y pendientes se lean como una sola
                lista y no como dos tablas pegadas. De una línea: son la confirmación de
                que algo se arregló, no algo para leer. */}
            {!colapsado && (resueltos.length > 0 || aMano.length > 0) && (
                <ul className="border-t bg-emerald-50/40 p-2 space-y-1">
                    {resueltos.map((d) => (
                        <li
                            key={`resuelto-${d.id}`}
                            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/70 px-2 py-1"
                        >
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                            <span className="shrink-0 min-w-[96px] inline-flex items-center justify-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold leading-[15px] text-emerald-700 whitespace-nowrap">
                                Resuelto
                            </span>
                            <span className="flex-1 min-w-0 truncate text-[13px] leading-tight text-gray-500 line-through decoration-emerald-600/40">
                                {d.titulo}
                            </span>
                        </li>
                    ))}

                    {/* Los marcados a mano van en la misma tira pero NO dicen
                        "Resuelto": dicen quién lo dio por resuelto. La diferencia
                        importa —el problema sigue en el plan— y es lo único que
                        separa esta fila de la de arriba. */}
                    {aMano.map((d) => (
                        <li
                            key={`marcado-${d.id}`}
                            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/70 px-2 py-1"
                        >
                            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
                            <span className="shrink-0 min-w-[96px] inline-flex items-center justify-center gap-1 rounded border border-emerald-200 bg-emerald-50/70 px-1.5 text-[10px] font-semibold leading-[15px] text-emerald-700 whitespace-nowrap">
                                Lo diste listo
                            </span>
                            <span className="flex-1 min-w-0 truncate text-[13px] leading-tight text-gray-500 line-through decoration-emerald-600/30" title={d.titulo}>
                                {d.titulo}
                            </span>
                            <button
                                type="button"
                                onClick={() => desmarcar(d.id)}
                                className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-white hover:text-gray-800 transition-colors"
                                title="Devolverlo a la lista de avisos"
                            >
                                <RotateCcw className="w-3 h-3" />
                                Deshacer
                            </button>
                        </li>
                    ))}

                    {aMano.length > 1 && (
                        <li className="pt-0.5 text-right">
                            <button
                                type="button"
                                onClick={() => cambiarMarcados(new Set())}
                                className="text-[11px] font-medium text-gray-500 hover:text-gray-800 transition-colors"
                            >
                                Devolver los {aMano.length} a la lista
                            </button>
                        </li>
                    )}
                </ul>
            )}

            {/* Cada aviso es una tarjeta con barra de color y dos columnas: a la
                izquierda QUÉ PASA (orden, severidad, categoría, título, detalle e
                impacto), a la derecha QUÉ HACER (la solución, dónde se arregla y el
                botón). Antes la solución vivía escondida detrás de un click: para
                saber qué hacer con once avisos había que abrir once.

                Todo apretado a propósito ("no me gusta que ocupen tanto espacio,
                pueden entrar más trabas", Lucas 26/08): la tarjeta mide 60px medidos
                contra los 89px de la fila anterior, y encima ya trae la solución
                adentro, que antes costaba otro click y otros ~70px. */}
            {!colapsado && (
                <ul className="border-t bg-slate-50/60 p-2 space-y-1">
                    {visibles.map((d) => {
                        const activo = abiertos.has(d.id);
                        const esBloq = d.severidad === "bloqueante";
                        const recurso = recursoDe(d);
                        const Icono = recurso?.icono ?? Info;
                        const subtipo = subtipoDe(d);

                        // Plegada se muestra UNA solución: la primera que se puede aplicar
                        // de un botón y, si ninguna se puede, la primera a secas. Las demás
                        // se cuentan al lado del texto y salen enteras al desplegar.
                        const conBoton = d.soluciones.findIndex((s) => s.accion);
                        const iSol = conBoton >= 0 ? conBoton : (d.soluciones.length > 0 ? 0 : -1);
                        const sol = iSol >= 0 ? d.soluciones[iSol] : null;
                        // Misma clave que la lista desplegada: aplicar desde cualquiera de
                        // los dos lados marca el mismo botón.
                        const claveSol = `${d.id}-${iSol}`;
                        const hecha = aplicadas.has(claveSol);
                        const link = sol ? enlaceDe(sol.donde, sol.accion, sol.objetivo) : null;
                        const otras = d.soluciones.length - 1;

                        // El backend ya manda el impacto masticado ("3 proc · 2 OT · 4 h").
                        // Se parte en chips en vez de reescribirlo: mismos datos, sin
                        // inventar campos y sin decir dos veces lo mismo.
                        const impacto = d.impacto.resumen.split("·").map((t) => t.trim()).filter(Boolean);
                        // El aviso habla en ids internos; en pantalla va el número que el
                        // taller conoce. Si la pantalla no sabe traducirlo (esta tira se usa
                        // también sin el plan al lado), no se muestran: un número que no
                        // existe en ningún papel confunde más de lo que ayuda.
                        const otsDelAviso = numeroDeOT
                            ? d.impacto.ots.map((n) => ({ id: n, numero: numeroDeOT(n) }))
                            : [];
                        const otsTexto = otsDelAviso.length > 0
                            ? `OTs: ${otsDelAviso.map((o) => `#${o.numero}`).join(", ")}`
                            : undefined;
                        // Plegada entran dos sin empujar el "dónde"; abierta van todas.
                        const otsVisibles = activo ? otsDelAviso : otsDelAviso.slice(0, 2);

                        return (
                            <li
                                key={d.id}
                                /* Sin riel de color ni numerito a la izquierda: eran dos
                                   adornos por tarjeta que no agregaban nada —"ese detalle que
                                   tienen a la izquierda son muy molestas", Julián 31/08— y
                                   empujaban el título, que es lo único que hay que poder leer
                                   de un vistazo. La severidad no se pierde: ya está dicha con
                                   todas las letras en el chip Alta/Media, que además es rojo o
                                   ámbar, así que la lista se sigue barriendo por color. */
                                className={cn(
                                    "rounded-lg border border-gray-200 bg-white overflow-hidden",
                                    activo && "shadow-sm"
                                )}
                            >
                                {/* 7fr/4fr y no 5fr/4fr: con 5fr el título entraba en ~250px y se
                                    cortaba en los cinco avisos del plan real ("Soldadura con MIG: sus
                                    3 máquina…"), que es justo lo que tiene que leerse de un vistazo.
                                    Verificado en producción. La columna de la derecha se banca 4fr: le
                                    alcanza para dos líneas de solución y el botón. */}
                                {/* El corte va en 2xl y no en lg: el panel NUNCA tiene el ancho
                                    del viewport. En un notebook de 1366 con la barra de navegación
                                    abierta el contenedor real ronda los 700px, así que la columna
                                    de la solución quedaba en ~250px y partía "Aplicar y recalcular"
                                    en tres renglones. Una sola columna se lee mejor que dos
                                    ahogadas. */}
                                <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 px-2 py-1 2xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
                                    {/* ── Qué pasa ──
                                        Es un <button> entero para que el bloque del problema
                                        despliegue el detalle sin apuntarle al chevron. Adentro
                                        solo van spans: no se puede anidar nada clickeable. */}
                                    <button
                                        type="button"
                                        aria-expanded={activo}
                                        onClick={() => toggle(d.id)}
                                        className="flex min-w-0 items-start gap-2 text-left"
                                    >
                                        <span className="min-w-0 flex-1">
                                            {/* Severidad, categoría y título en el mismo renglón: son
                                                tres cosas cortas y darle una línea a cada una era la
                                                mitad del alto de la tarjeta. */}
                                            <span className="flex items-center gap-1.5">
                                                <span
                                                    className={cn(
                                                        "shrink-0 w-[38px] text-center rounded px-1 text-[9px] font-bold uppercase leading-[15px] tracking-wide",
                                                        esBloq ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                                                    )}
                                                    title={esBloq
                                                        ? "Traba: quedó sin resolver en el plan"
                                                        : "Aviso: el plan sale igual"}
                                                >
                                                    {esBloq ? "Alta" : "Media"}
                                                </span>
                                                {/* Recurso y subtipo en UN chip y no en dos: leído en voz
                                                    alta es la frase que dijo Lucas —"alta, recurso máquina,
                                                    rango"—, y dos chips separados costaban 30px más de
                                                    ancho que salían del título, que es lo que de verdad
                                                    hay que poder leer sin abrir la tarjeta. Ancho fijo y
                                                    siempre en la misma columna: sin eso la lista no se
                                                    puede barrer, hay que leerla entera. */}
                                                <span className={cn(
                                                    "shrink-0 min-w-[152px] inline-flex items-center justify-center gap-1 rounded border px-1.5 text-[10px] font-semibold leading-[15px] whitespace-nowrap",
                                                    esBloq
                                                        ? "bg-rose-50 text-rose-700 border-rose-200"
                                                        : "bg-amber-50 text-amber-800 border-amber-200"
                                                )}>
                                                    <Icono className="w-3 h-3 shrink-0" />
                                                    {recurso?.texto ?? "Plan"}
                                                    {subtipo && (
                                                        <>
                                                            <span className={esBloq ? "text-rose-300" : "text-amber-300"}>·</span>
                                                            {subtipo}
                                                        </>
                                                    )}
                                                </span>
                                                <span
                                                    className={cn(
                                                        // Dos renglones y no `truncate`: con una sola línea se cortaban
                                                        // cuatro de los seis títulos del plan real, y en «Control de
                                                        // medidas: hoy no lo puede hacer n…» lo que se perdía era
                                                        // justo «nadie». El título es lo único que tiene que
                                                        // entenderse sin abrir la tarjeta; que crezca un renglón
                                                        // cuesta menos que dejarlo a medias.
                                                        "min-w-0 flex-1 text-[13px] font-semibold leading-tight text-gray-900",
                                                        !activo && "line-clamp-2"
                                                    )}
                                                    title={d.titulo}
                                                >
                                                    {d.titulo}
                                                </span>
                                            </span>

                                            {/* El detalle es lo que dice QUÉ máquina y QUÉ rango tocar:
                                                se lee siempre, sin abrir nada. Plegado, dos líneas.
                                                Los números del impacto van al final del mismo renglón:
                                                así no le comen ancho al título y no cuestan alto. */}
                                            <span className="mt-0.5 flex items-start gap-2">
                                                {/* Qué tiene hoy → qué le piden. Es la pregunta textual de
                                                    Lucas mirando la soldadora: "¿cuál es el rango que tiene?
                                                    Medio oficial. Debería decir qué tiene la máquina". El
                                                    detalle ya lo explica en una frase, pero la frase hay que
                                                    leerla; esto se ve. Solo sale cuando el backend lo manda:
                                                    hay avisos donde no hay dos cosas que comparar. */}
                                                {d.tiene && (
                                                    <span
                                                        className="mt-px hidden shrink-0 max-w-[260px] items-center gap-1 rounded bg-slate-100 px-1.5 text-[10px] leading-[15px] text-slate-600 lg:inline-flex"
                                                        title={d.pide
                                                            ? `Tiene ${d.tiene} · el proceso pide ${d.pide}`
                                                            : `Tiene ${d.tiene}`}
                                                    >
                                                        {/* Los dos lados se achican, ninguno es intocable.
                                                            Medido en el plan real: con «pide» fijo, el
                                                            «OFICIAL» de la izquierda quedaba en 0px de ancho y
                                                            el chip se leía «→ MEDIO OFICIAL o OPERARIO
                                                            CALIFICADO», que es justo la mitad que NO contesta
                                                            la pregunta de Lucas ("¿cuál es el rango que
                                                            tiene?"). Sin `shrink-0` y con `min-w-0` los dos
                                                            ceden en proporción a lo que ocupan: el corto queda
                                                            entero y el largo se recorta. El texto completo
                                                            está en el tooltip y en el detalle de al lado. */}
                                                        <span className="min-w-0 truncate">{d.tiene}</span>
                                                        {d.pide && (
                                                            <>
                                                                <span className="shrink-0 text-slate-400" aria-hidden="true">→</span>
                                                                <span className="min-w-0 truncate font-medium text-slate-700">{d.pide}</span>
                                                            </>
                                                        )}
                                                    </span>
                                                )}
                                                <span className={cn(
                                                    "min-w-0 flex-1 text-[11.5px] leading-[1.35] text-gray-600",
                                                    !activo && "line-clamp-2"
                                                )}>
                                                    {conNegritas(d.detalle)}
                                                </span>
                                                <span className="mt-px hidden shrink-0 items-center gap-1 md:flex" title={otsTexto}>
                                                    {impacto.map((t) => (
                                                        <span key={t} className="rounded bg-slate-100 px-1.5 text-[10px] leading-[15px] text-slate-600 tabular-nums">
                                                            {t}
                                                        </span>
                                                    ))}
                                                </span>
                                            </span>
                                        </span>
                                    </button>

                                    {/* ── Qué hacer ──
                                        Columna propia con divisor. Abajo de lg no hay dos columnas:
                                        pasa abajo, separada por una línea. */}
                                    <div className="flex min-w-0 items-start gap-2 border-t pt-1.5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-3">
                                        <div className="min-w-0 flex-1">
                                            {sol ? (
                                                <>
                                                    <span className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "shrink-0 whitespace-nowrap text-[9px] font-bold uppercase leading-[15px] tracking-wider",
                                                            esBloq ? "text-rose-600" : "text-amber-600"
                                                        )}>
                                                            Solución
                                                        </span>
                                                        {/* La OT, de un click, en el mismo renglón: "y vas a
                                                            buscarla acá… estaría bueno que hagas clic acá"
                                                            (Lucas 28/08, sobre la 15678). Va acá y no del lado
                                                            del problema porque ese bloque entero es un botón
                                                            que despliega la tarjeta y no se puede anidar nada
                                                            clickeable adentro. Sin renglón propio: el alto de
                                                            la tarjeta es lo que se cuida. */}
                                                        {onVerOT && otsVisibles.map((o) => (
                                                            <button
                                                                key={o.id}
                                                                type="button"
                                                                onClick={() => onVerOT(o.id)}
                                                                className="shrink-0 rounded bg-slate-100 px-1.5 text-[10px] font-medium leading-[15px] text-slate-600 tabular-nums hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                                                                title={`Abrir la OT #${o.numero} en la tabla del plan y asignarle ahí la persona`}
                                                            >
                                                                #{o.numero}
                                                            </button>
                                                        ))}
                                                        {onVerOT && !activo && otsDelAviso.length > otsVisibles.length && (
                                                            <span className="shrink-0 text-[10px] leading-[15px] text-gray-400" title={otsTexto}>
                                                                +{otsDelAviso.length - otsVisibles.length}
                                                            </span>
                                                        )}
                                                        {/* El "dónde" vive siempre en el mismo lugar y lleva a
                                                            la pantalla, la pestaña y la fila que hay que tocar.
                                                            Acá arriba no lo puede comer el clamp del texto. */}
                                                        {sol.donde && (link ? (
                                                            <a
                                                                href={link}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="ml-auto inline-flex min-w-0 items-center gap-0.5 rounded bg-slate-100 px-1.5 text-[10px] leading-[15px] text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                                                title={`${sol.donde} — se abre en otra pestaña, ya parado en lo que hay que tocar`}
                                                            >
                                                                <span className="truncate">{sol.donde}</span>
                                                                <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
                                                            </a>
                                                        ) : (
                                                            <span className="ml-auto min-w-0 truncate rounded bg-slate-100 px-1.5 text-[10px] leading-[15px] text-slate-500" title={sol.donde}>
                                                                {sol.donde}
                                                            </span>
                                                        ))}
                                                    </span>
                                                    <p className={cn(
                                                        "mt-0.5 text-[11.5px] font-medium leading-[1.35] text-gray-800",
                                                        !activo && "line-clamp-2"
                                                    )}>
                                                        {conNegritas(sol.texto)}
                                                        {otras > 0 && !activo && (
                                                            <span className="ml-1 font-normal text-gray-400">
                                                                +{otras} {otras === 1 ? "opción" : "opciones"}
                                                            </span>
                                                        )}
                                                    </p>
                                                </>
                                            ) : (
                                                <span className="text-[11px] text-gray-400">Este aviso no trae una solución sugerida.</span>
                                            )}
                                        </div>

                                        {/* Los botones van en su propia columnita: así quedan
                                            alineados de tarjeta en tarjeta y no empujan el alto con
                                            un renglón más. */}
                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                            {/* Sin botón que lo aplique solo, la única salida era el
                                                chip gris del "dónde", que no se lee como acción. Los
                                                Media son justamente los que nunca traen botón —"los
                                                de media van a estar siempre porque es una
                                                recomendación", Lucas 28/08— y son los que más
                                                necesitan una puerta: se abre en otra pestaña, así el
                                                borrador queda donde está y al volver se revisa solo. */}
                                            {!sol?.accion && link && (
                                                <a
                                                    href={link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex h-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 text-[10.5px] font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                                    title={`Abre ${sol?.donde} en otra pestaña, ya parado en lo que hay que tocar. Al volver acá se revisa solo.`}
                                                >
                                                    Ir a arreglarlo
                                                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                                                </a>
                                            )}
                                            {sol?.accion && (
                                                <Button
                                                    size="sm"
                                                    disabled={hecha || aplicando !== null}
                                                    onClick={() => aplicar(claveSol, sol.accion!)}
                                                    onBlur={() => confirmando === claveSol && setConfirmando(null)}
                                                    title={confirmando === claveSol
                                                        ? "Tocá de nuevo para confirmar el cambio"
                                                        : "Aplica el cambio en Recursos y recalcula el plan"}
                                                    className={cn(
                                                        "h-6 w-[8.5rem] justify-center gap-1 px-1.5 text-[10.5px] font-semibold shadow-none",
                                                        hecha
                                                            ? "bg-transparent text-emerald-700 hover:bg-transparent"
                                                            : confirmando === claveSol
                                                                ? "bg-amber-500 text-white hover:bg-amber-600"
                                                                : "bg-emerald-600 text-white hover:bg-emerald-700"
                                                    )}
                                                >
                                                    {aplicando === claveSol ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : hecha ? (
                                                        <Check className="w-3 h-3" />
                                                    ) : null}
                                                    {hecha
                                                        ? "Aplicado"
                                                        : confirmando === claveSol
                                                            ? "Tocá de nuevo"
                                                            : "Aplicar y recalcular"}
                                                </Button>
                                            )}
                                            {/* Darlo por resuelto, SOLO donde no hay un botón que lo
                                                arregle de verdad.

                                                Al lado de "Aplicar y recalcular" no tiene sentido y
                                                confunde (Julián, 31/08): son dos botones verdes pegados
                                                que hacen cosas opuestas —uno cambia el dato, el otro
                                                dice "no me lo muestres más"— y el chiquito parecía el
                                                confirmar del grande. Ahí el aviso se va solo cuando el
                                                cambio se aplica, así que no hace falta.

                                                Donde SÍ va es en los Media, que no traen botón porque
                                                qué corregir lo sabe el taller: es la única acción de la
                                                tarjeta y por eso va con nombre y en verde lleno, no un
                                                tilde gris que nadie encuentra. Para las Alta con botón,
                                                el "Marcar como resuelto" sigue estando adentro de la
                                                tarjeta desplegada. */}
                                            {!sol?.accion && (
                                                <button
                                                    type="button"
                                                    onClick={() => marcar(d)}
                                                    title="Darlo por resuelto: lo baja a la tira verde de arriba. No cambia el plan ni los datos, y se deshace."
                                                    aria-label={`Marcar como resuelto: ${d.titulo}`}
                                                    className="inline-flex h-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 text-[10.5px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                                                >
                                                    <Check className="w-3.5 h-3.5 shrink-0" />
                                                    Listo
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                aria-expanded={activo}
                                                onClick={() => toggle(d.id)}
                                                title={activo ? "Ocultar detalles" : "Ver detalles"}
                                                aria-label={activo ? "Ocultar detalles" : "Ver detalles"}
                                                className="grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-slate-100 hover:text-gray-600 transition-colors"
                                            >
                                                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", activo && "rotate-180")} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Abierto: TODAS las soluciones (no solo la que se ve plegada),
                                    cada una con su link y su botón, más las OTs. */}
                                {activo && (
                                    <div className="border-t bg-slate-50/70 px-2 py-1.5 space-y-1.5">
                                        {d.soluciones.length > 0 && (
                                            <ul className="space-y-1">
                                                {d.soluciones.map((s, idx) => {
                                                    const clave = `${d.id}-${idx}`;
                                                    const hechaEsta = aplicadas.has(clave);
                                                    const linkEste = enlaceDe(s.donde, s.accion, s.objetivo);
                                                    return (
                                                        <li key={idx} className="flex items-start gap-1.5 text-[11.5px] leading-[1.4]">
                                                            <Wrench className="w-3 h-3 mt-[3px] shrink-0 text-emerald-600" />
                                                            <span className="text-gray-800">
                                                                {conNegritas(s.texto)}
                                                                {/* Hay soluciones que no mandan a ninguna pantalla
                                                                    ("está bien así"): sin esto quedaba un chip vacío. */}
                                                                {s.donde && (
                                                                    <>
                                                                        {" "}
                                                                        {linkEste ? (
                                                                            <a
                                                                                href={linkEste}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                className="inline-flex items-center gap-0.5 rounded bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 text-[10px] px-1.5 py-px whitespace-nowrap align-baseline transition-colors"
                                                                                title="Abrir en otra pestaña, ya parado en lo que hay que tocar"
                                                                            >
                                                                                {s.donde}
                                                                                <ArrowUpRight className="w-2.5 h-2.5" />
                                                                            </a>
                                                                        ) : (
                                                                            <span className="inline-block rounded bg-slate-100 text-slate-600 text-[10px] px-1.5 py-px whitespace-nowrap align-baseline">
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
                                                                            variant={hechaEsta ? "ghost" : "outline"}
                                                                            disabled={hechaEsta || aplicando !== null}
                                                                            onClick={() => aplicar(clave, s.accion!)}
                                                                            onBlur={() => confirmando === clave && setConfirmando(null)}
                                                                            className={cn(
                                                                                "h-5 px-1.5 text-[10px] gap-1 align-baseline",
                                                                                hechaEsta
                                                                                    ? "text-emerald-700"
                                                                                    : confirmando === clave
                                                                                        ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                                                                        : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                                                                            )}
                                                                        >
                                                                            {aplicando === clave ? (
                                                                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                                            ) : hechaEsta ? (
                                                                                <Check className="w-2.5 h-2.5" />
                                                                            ) : null}
                                                                            {hechaEsta
                                                                                ? "Aplicado"
                                                                                : confirmando === clave
                                                                                    ? "Tocá de nuevo para confirmar"
                                                                                    : "Aplicar y recalcular"}
                                                                        </Button>
                                                                    </>
                                                                )}
                                                            </span>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                        <div className="flex items-end justify-between gap-3">
                                            <p className="text-[10.5px] text-gray-500">
                                                {/* Abajo de md los chips del impacto no entran en la
                                                    tarjeta, así que acá es el único lugar donde se ven. */}
                                                <span className="md:hidden">
                                                    {d.impacto.resumen}
                                                    {otsDelAviso.length > 0 ? " — " : ""}
                                                </span>
                                                {otsDelAviso.length > 0 && (
                                                    <>
                                                        OTs:{" "}
                                                        {otsDelAviso.map((o, k) => (
                                                            <span key={o.id}>
                                                                {k > 0 && ", "}
                                                                {onVerOT ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onVerOT(o.id)}
                                                                        className="font-medium text-slate-600 underline decoration-dotted underline-offset-2 hover:text-indigo-700"
                                                                        title={`Abrir la OT #${o.numero} en la tabla del plan`}
                                                                    >
                                                                        #{o.numero}
                                                                    </button>
                                                                ) : (
                                                                    <>#{o.numero}</>
                                                                )}
                                                            </span>
                                                        ))}
                                                    </>
                                                )}
                                            </p>
                                            {/* El mismo "dar por resuelto" del tilde de arriba, pero
                                                con el nombre puesto: el ícono solo no se descubre, y
                                                acá adentro hay lugar para decir qué hace. */}
                                            <button
                                                type="button"
                                                onClick={() => marcar(d)}
                                                className="shrink-0 inline-flex items-center gap-1 rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-800 hover:bg-emerald-50 transition-colors"
                                                title="No cambia el plan ni los datos: lo baja a la tira verde de arriba. Se deshace."
                                            >
                                                <Check className="w-3 h-3" />
                                                Marcar como resuelto
                                            </button>
                                        </div>
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
                    className="w-full border-t px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-slate-50 transition-colors"
                >
                    Ver las {ocultas} restantes
                </button>
            )}
            {!colapsado && verTodas && ordenados.length > VISIBLES && (
                <button
                    type="button"
                    onClick={() => setVerTodas(false)}
                    className="w-full border-t px-3 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-slate-50 transition-colors"
                >
                    Mostrar solo las primeras {VISIBLES}
                </button>
            )}
        </div>
    );
}
