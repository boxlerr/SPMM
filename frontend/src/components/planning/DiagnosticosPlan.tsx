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
 *
 * Pedido de Julián (17/09/2026), copiado tal cual se escribió —tipeos incluidos, y por
 * lo mismo que en `lib/ajustesPlan`: una cita "arreglada" ya no se puede buscar ni
 * verificar contra el original—: *"si por ejemplo esas medianas solo se quieren
 * solucionar para esa planificacion un boton para aplicar la solucion solo para esta
 * pla ificacion y no me cambie todo en la base de datos"*, y *"quiero las explicaciones
 * mas faciles de entender"*. De ahí salen las dos cosas nuevas:
 *
 *  - CADA SOLUCIÓN TIENE DOS CAMINOS y hay que poder distinguirlos sin leer un
 *    manual: **Guardar en Recursos** (verde, con ícono de guardar) escribe el dato
 *    y queda para siempre; **Solo en este plan** (índigo, punteado) no escribe
 *    nada, vale para este cálculo y se deshace. El verde conserva su confirmación
 *    en dos pasos —el 18/08 un cambio así, sin preguntar, abrió la PLEGADORA de 1
 *    persona a 10—; el índigo va de un click, justamente porque no toca ningún dato.
 *  - Un color = un significado: verde lleno SOLO para lo que toca la base. El
 *    "dar por resuelto", que no cambia nada, dejó de ser verde lleno y pasó a
 *    borde: competía de igual a igual con el botón que sí cambia el dato.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock, Cog, Info, Layers, ListChecks, Loader2, PauseCircle, RefreshCw, RotateCcw, Save, SlidersHorizontal, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { antiguedadTexto } from "@/lib/borradorPlan";
import { claveDeAjuste, descripcionDeAccion, type AccionDeSolucion, type AjusteDelPlan } from "@/lib/ajustesPlan";
import { enlaceARecursos, pestaniaDe } from "@/lib/avisoEnRecursos";
import { usePermisos } from "@/hooks/usePermisos";

/** Cuántas líneas se ven antes de "Ver todas". */
// Con la tarjeta compacta seis avisos ocupan casi lo mismo que ocupaban cuatro filas
// de las viejas (384px contra 356px, medido en Chrome): mostrar cuatro sería dejar
// pantalla sin usar y hacer tocar "Ver todas" de gusto.
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
    maquina: { texto: "Recurso maquinaria", icono: Cog },
    humano: { texto: "Recurso humano", icono: Users },
    // RF-03: la OT (o un paso) que alguien pausó. Es la única excepción a las cuatro
    // de arriba y no es un recurso que falte: es una decisión del taller (ver
    // DiagnosticoPlanificacion.py, ORDEN/PAUSA). El ícono es el de la pausa en toda
    // la app (la franja de la ficha, la marca en las listas). «OT» y no «Orden de
    // trabajo»: en el teléfono el rótulo largo se cortaba a mitad de palabra.
    orden: { texto: "OT", icono: PauseCircle },
};

const SUBTIPO: Record<string, string> = {
    rango: "Rango",
    capacidad: "Capacidad",
    skill: "Skill",
    pausa: "Pausa",
};

/**
 * De qué recurso habla un aviso que llegó sin `recurso`.
 *
 * El backend se despliega a mano y a destiempo del frontend (Cloud Run contra
 * Vercel): entre un deploy y el otro los avisos llegan con el formato viejo. Sin
 * esto la columna quedaría vacía justo en la pantalla que Lucas mira.
 */
const RECURSO_POR_TIPO: Record<string, "maquina" | "humano" | "orden"> = {
    proceso_sin_operarios: "humano",
    proceso_sin_rango: "humano",
    puestos_vacantes: "humano",
    maquina_incompatible: "maquina",
    cuello_de_maquina: "maquina",
    trabajo_tercerizado: "maquina",
    ot_pausada: "orden",
};

const SUBTIPO_POR_TIPO: Record<string, string> = {
    proceso_sin_operarios: "rango",
    proceso_sin_rango: "rango",
    puestos_vacantes: "rango",
    maquina_incompatible: "rango",
    cuello_de_maquina: "capacidad",
    trabajo_tercerizado: "capacidad",
    ot_pausada: "pausa",
};

const recursoDe = (d: Diagnostico) => RECURSO[d.recurso ?? RECURSO_POR_TIPO[d.tipo] ?? "maquina"];
const subtipoDe = (d: Diagnostico) => SUBTIPO[d.subtipo ?? SUBTIPO_POR_TIPO[d.tipo] ?? ""] ?? "";
const esPausa = (d: Diagnostico) => (d.subtipo ?? SUBTIPO_POR_TIPO[d.tipo]) === "pausa";

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
 *
 * La forma vive en `@/lib/ajustesPlan` y acá queda el alias con el nombre de
 * siempre: la misma acción viaja ahora por dos caminos —el que escribe en Recursos
 * y el que vale solo para este cálculo— y con dos definiciones iguales pero
 * separadas era cuestión de tiempo que una se corriera de la otra. La dependencia
 * va en un solo sentido: el componente importa de la lib, la lib no importa de acá.
 */
export type DiagnosticoAccion = AccionDeSolucion;

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
    /** Taxonomía cerrada (Lucas 28/08). Opcionales: el backend viejo no las manda.
     *  «orden · pausa» es la excepción de RF-03: la OT o el paso que alguien pausó. */
    recurso?: "maquina" | "humano" | "orden";
    subtipo?: "rango" | "capacidad" | "skill" | "pausa";
    /** Qué tiene hoy el recurso ("Medio oficial") y qué le pide el proceso ("Oficial").
     *  En una pausa, `tiene` es el motivo («Falta material»). */
    tiene?: string;
    pide?: string;
    titulo: string;
    /**
     * Una frase, la que se lee con el aviso cerrado (Lucas 10/09: "cortita y al pie").
     * Opcional: un borrador guardado antes del 10/09 trae sus diagnósticos adentro y
     * no la tiene, así que en ese caso se cae al `detalle` como venía siendo.
     */
    resumen?: string;
    detalle: string;
    impacto: {
        procesos: number;
        ots: number[];
        minutos: number;
        resumen: string;
    };
    soluciones: DiagnosticoSolucion[];
}

// El link «Ir a arreglarlo» (`enlaceARecursos`) y a qué solapa apunta cada «dónde»
// (`pestaniaDe`) viven en `@/lib/avisoEnRecursos`, junto con la lectura del otro
// lado: el formato del link es un contrato entre este panel y Recursos.

/** RF-24: qué sección de Recursos hay que poder ver para que el link sirva. */
const SECCION_DE_PESTANIA = {
    maquinas: "recursos_maquinaria",
    procesos: "recursos_procesos",
    operarios: "recursos_humano",
} as const;

/**
 * La acción que se puede probar "solo en este plan", venga o no con botón propio.
 *
 * Los avisos Media casi nunca traen `accion` —qué rango va lo sabe el taller, no el
 * planificador— pero varios sí traen `objetivo` con los rangos PROPUESTOS: es el
 * mismo dato, solo que pensado para armar un link a Recursos y no un botón. Para
 * probarlo en el cálculo alcanza y sobra, y son justamente los avisos que Julián
 * nombró ("esas medianas"), así que se arma la acción acá con lo que ya vino.
 *
 * No se arma cuando el objetivo es un operario ni cuando no trae rangos: no hay
 * nada que ajustar, y un botón que no cambia nada es peor que no tener botón.
 */
function accionDelObjetivo(sol: DiagnosticoSolucion): AccionDeSolucion | null {
    const o = sol.objetivo;
    if (!o || o.tipo === "operario" || !o.rangos?.length) return null;
    return {
        tipo: o.tipo === "maquinaria" ? "maquinaria" : "proceso",
        id: o.id,
        nombre: o.nombre,
        rangos: o.rangos,
        objetivos: [{ id: o.id, nombre: o.nombre, rangos: o.rangos }],
    };
}

/** La acción aplicable de una solución: la propia, o la que se deduce del objetivo. */
const accionAjustable = (sol: DiagnosticoSolucion): AccionDeSolucion | null =>
    sol.accion ?? accionDelObjetivo(sol);


/**
 * Qué toca la solución, dicho ANTES de aplicarla.
 *
 * Lucas, 28/08: *"te da miedo apretar"*. El botón decía "Aplicar y recalcular" y no
 * había forma de saber qué iba a cambiar hasta después de que cambiara. Esto lo dice
 * con nombre y apellido: qué máquina, qué le agrega y qué tenía hasta ahora.
 *
 * Los nombres de los rangos los manda el backend en `suma` / `tenia`: acá los ids no
 * significan nada, y traducirlos en pantalla obligaría a pedir la tabla de rangos solo
 * para armar un cartel. Si el backend es viejo y no los manda, se muestra igual la
 * lista de lo que se toca — que ya es más de lo que había antes.
 */
function ResumenDelCambio({ accion }: { accion: DiagnosticoAccion }) {
    const objetivos = accion.objetivos?.length
        ? accion.objetivos
        : [{ id: accion.id, nombre: accion.nombre, rangos: accion.rangos, suma: undefined, tenia: undefined }];

    const linea = (o: { nombre: string; suma?: string[]; tenia?: string[] }) => {
        if (accion.tipo === "skill_nativa") {
            return (
                <>
                    A <strong>{o.nombre}</strong>{" "}
                    {accion.habilitado === false ? "le apago" : "le vuelvo a encender"}{" "}
                    <strong>{accion.nombre}</strong> en su ficha.
                </>
            );
        }
        const que = accion.tipo === "proceso" ? "Al proceso" : "A";
        if (o.suma && o.suma.length === 0) {
            return (
                <>
                    {que} <strong>{o.nombre}</strong> no le cambia nada
                    {o.tenia?.length ? <>: ya tiene <strong>{o.tenia.join(", ")}</strong>.</> : "."}
                </>
            );
        }
        return (
            <>
                {que} <strong>{o.nombre}</strong>
                {o.suma?.length ? (
                    <>
                        {" "}le agrego <strong>{o.suma.join(" y ")}</strong>
                        {o.tenia?.length
                            ? <span className="text-amber-800/70"> (hoy tiene {o.tenia.join(", ")})</span>
                            : <span className="text-amber-800/70"> (hoy no tiene ninguno)</span>}
                    </>
                ) : (
                    <> le cambio quién la puede usar. Volvé a calcular el plan para verlo con el detalle.</>
                )}
            </>
        );
    };

    return (
        <div className="border-t border-amber-200 bg-amber-50/70 px-3 py-2">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-amber-900">
                Esto es lo que va a cambiar
            </p>
            <ul className="mt-1 space-y-0.5">
                {objetivos.map((o) => (
                    <li key={`${accion.tipo}-${o.id}`} className="text-[11.5px] leading-snug text-amber-950">
                        · {linea(o)}
                    </li>
                ))}
            </ul>
            {/* La frase tiene que decir el ALCANCE, no el mecanismo: desde que hay un
                botón que aplica lo mismo sin guardar nada, lo único que distingue a
                este es que el dato queda para todos los planes que vengan. */}
            <p className="mt-1 text-[10.5px] text-amber-800/80">
                Queda guardado en Recursos para <strong>todos</strong> los planes, no solo para
                este. Se puede volver a cambiar desde Recursos cuando quieras.
            </p>
        </div>
    );
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
    nombreDeRango,
    ajustes: ajustesProp,
    onAplicarSoloEstePlan,
    onQuitarAjuste,
}: {
    diagnosticos?: Diagnostico[];
    /**
     * Se llama después de aplicar un cambio, para recalcular el plan con el dato nuevo.
     *
     * Va con la acción que se acaba de guardar en Recursos, y no vacía como antes,
     * porque la pantalla necesita saber QUÉ objetivos tocó: si sobre esa misma máquina
     * había un ajuste "solo en este plan", ese ajuste manda un conjunto de rangos que
     * ya quedó viejo y en el recálculo pisaría lo que se acaba de guardar. Con la
     * acción en la mano la pantalla lo saca (`claveDeAjuste` de `lib/ajustesPlan` da
     * la identidad de los dos lados). Es opcional: quien no la use sigue andando.
     */
    onResuelto?: (accionAplicada?: AccionDeSolucion) => void;
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
     * Cómo se escribe en pantalla un número de `impacto.ots`.
     *
     * `impacto.ots` YA TRAE el número que el taller conoce: el del sistema viejo
     * (`id_otvieja`), o el `id` si la OT nació en SPMM. La traducción la hace el
     * backend una sola vez (PlanificacionService, `nro_visible`) y la fija
     * backend/tests/test_planner_pausas.py. Hasta el 25/9 este comentario decía
     * que venía el `orden_id` interno; era falso desde el 15/8, y por eso los
     * chips #OT no abrían ninguna OT. Sin esta función los números no se
     * muestran (la tira se usa también sin el plan al lado).
     */
    numeroDeOT?: (numero: number) => string;
    /**
     * Abrir la OT del aviso de un click (Lucas, 28/08: "estaría bueno que hagas
     * clic acá"). Recibe el número VISIBLE, tal cual viene en `impacto.ots`: pasarlo
     * al `orden_id` interno de la tabla lo hace la pantalla, que es la que tiene el
     * plan a mano; el aviso sólo sabe a qué OT apunta.
     */
    onVerOT?: (numero: number) => void;
    /**
     * El nombre de un rango, a partir del id.
     *
     * Los avisos que traen `accion` ya vienen con los nombres puestos desde el backend
     * (`suma` / `tenia`). Los Media no traen acción —qué rango va lo sabe el taller, no
     * el planificador— y la acción se arma acá con el `objetivo`, donde sólo hay ids.
     * Sin traductor, la frase que dice qué va a hacer el botón queda en "le cambio
     * quién la puede usar", que no dice nada. El catálogo lo tiene la pantalla.
     */
    nombreDeRango?: (id: number) => string;
    /**
     * Los ajustes que valen SOLO para este cálculo (pedido de Julián, 17/09/2026).
     *
     * El caso es "esas medianas solo se quieren solucionar para esa planificacion":
     * querés ver cómo sale el plan si esa fresadora aceptara ese rango, pero no
     * querés que el dato quede cargado en Recursos para todos los planes que vengan.
     * El ajuste se manda al solver y el plan sale como si el dato estuviera; en la
     * base no se escribe nada.
     *
     * Viven en la pantalla y no acá: los estados locales del panel (`aplicadas`,
     * `confirmando`) se limpian con cada lista nueva de diagnósticos, y un ajuste
     * que se borrara en el recálculo que él mismo disparó no serviría para nada.
     * Además tienen que viajar al borrador para poder retomarlo mañana.
     *
     * Las tres props son opcionales: sin ellas el panel anda como antes, con el
     * único camino que había (guardar en Recursos).
     */
    ajustes?: AjusteDelPlan[];
    onAplicarSoloEstePlan?: (ajuste: AjusteDelPlan) => void;
    onQuitarAjuste?: (clave: string) => void;
}) {
    const todos = diagnosticos ?? [];
    const ajustes = ajustesProp ?? [];
    /**
     * Un ajuste se reconoce por lo que TOCA, no por el renglón donde se apretó.
     *
     * La clave salía de `${d.id}-${índice de la solución}` y ese índice no es estable
     * entre recálculos: en los avisos de máquina incompatible el orden de las
     * soluciones lo deciden los rangos de cada máquina, que es justamente lo que el
     * ajuste cambia. Bastaba un recálculo para que el botón quedara marcado "Puesto en
     * este plan" arriba de una solución que nunca se aplicó. La identidad la da ahora
     * `claveDeAjuste`, que se arma con los objetivos: la misma cosa tocada del mismo
     * modo es el mismo ajuste, venga del renglón que venga.
     *
     * La clave del botón PERMANENTE sigue siendo `${d.id}-${i}`: ése no viaja a ningún
     * lado ni sobrevive al recálculo, sólo marca qué botón de ESTA lista se apretó.
     */
    const clavesAjustadas = new Set(ajustes.map((a) => a.clave));
    /** Si alguno de los caminos de este aviso ya está puesto como ajuste de este plan. */
    const tieneAjuste = (d: Diagnostico) =>
        d.soluciones.some((s) => {
            const accion = accionAjustable(s);
            return !!accion && clavesAjustadas.has(claveDeAjuste(accion));
        });
    /**
     * Los ajustes, mirados desde el efecto de la tira verde sin ser dependencia suya.
     *
     * Ese efecto corre cuando cambian los diagnósticos, no cuando cambian los
     * ajustes: meterlos en las dependencias lo haría recalcular de gusto cada vez
     * que alguien aplica o deshace uno, y esa función ACUMULA estado (los resueltos
     * de recálculos anteriores), así que correrla de más no es gratis.
     */
    const tieneAjusteRef = useRef(tieneAjuste);
    tieneAjusteRef.current = tieneAjuste;

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
        //
        // Y dice "no lo muestro más" y no "resuelto": esto no arregla nada, solo lo
        // baja de la lista. Con el botón que guarda en Recursos al lado, la palabra
        // "resuelto" en los dos lados hacía parecer que hacían lo mismo.
        toast.success("Listo, no lo muestro más", { description: d.titulo });
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
     * RF-24: «Guardar en Recursos» escribe en Recursos, no en el plan, y el backend pide
     * lo mismo que si se hiciera desde allá: los rangos de un proceso o de una máquina
     * son la solapa Rangos; la habilidad de una persona, la solapa Recurso humano. Quien
     * planifica sin eso ve el aviso y puede usar «Solo en este plan», pero no el botón
     * que guarda.
     */
    const { puedeSeccion } = usePermisos();
    const puedeGuardarEnRecursos = (accion: AccionDeSolucion) =>
        accion.tipo === "skill_nativa"
            ? puedeSeccion("recursos_humano", "write")
            : puedeSeccion("recursos_rangos", "write");
    /**
     * El link a Recursos de una solución, o null si no hay a dónde ir.
     *
     * Null también cuando quien mira no puede ver esa solapa (RF-24): Recursos abre
     * entonces la primera que sí puede ver, y un "Ir a arreglarlo" que termina en
     * otra lista, sin lo que el aviso pedía, es la misma pantalla vacía con otro
     * decorado. La solución se sigue leyendo; lo que no aparece es el botón.
     */
    const enlace = (d: Diagnostico, s: DiagnosticoSolucion) => {
        const pestania = pestaniaDe(s.donde);
        if (!pestania || !puedeSeccion(SECCION_DE_PESTANIA[pestania])) return null;
        return enlaceARecursos(s, d.titulo, nombreDeRango);
    };
    /**
     * Cuál de los botones índigo disparó el recálculo que está corriendo.
     *
     * El botón no pega en ningún endpoint —el ajuste viaja adentro del pedido del
     * plan— así que no tiene un "aplicando" propio: lo que tarda es el recálculo, y de
     * eso se entera el panel por `revisando`. Sin esto el botón se quedaba quieto
     * mientras el plan se rehacía y, como el velo de recálculo es `pointer-events-none`,
     * el segundo click pasaba igual y salían dos POST encimados.
     */
    const [ajustando, setAjustando] = useState<string | null>(null);
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
     * Aplicar la solución SOLO a este cálculo, o sacarla si ya estaba aplicada.
     *
     * De un click y sin confirmar, al revés que el botón que guarda en Recursos. No
     * es descuido: este no escribe absolutamente nada —el dato viaja con el pedido al
     * solver y muere ahí—, se ve en la tira de arriba y se deshace con un botón. La
     * confirmación en dos pasos existe para lo que NO se puede deshacer de un click,
     * y pedirla también acá haría que los dos caminos se sintieran igual de pesados,
     * que es justo lo contrario de lo que hay que transmitir.
     */
    const aplicarSoloEstePlan = (d: Diagnostico, clave: string, accion: AccionDeSolucion) => {
        // Poner y sacar disparan los dos un recálculo, así que los dos tienen que dejar
        // el botón trabajando hasta que vuelva el plan.
        setAjustando(clave);
        if (clavesAjustadas.has(clave)) {
            onQuitarAjuste?.(clave);
            return;
        }
        const descripcion = descripcionDeAccion(accion, nombreDeRango);
        // El aviso del toast lo da la pantalla, no el panel. Acá había uno propio
        // ("Ajustado solo para este plan") y la pantalla tira el suyo al aplicar el
        // ajuste, así que un click dejaba DOS carteles pisados diciendo lo mismo con
        // dos verbos distintos —ajustado / aplicado—, que se lee como dos cosas que
        // pasaron. Avisa la pantalla porque es la dueña del estado: sabe si el
        // ajuste entró de verdad y traduce los rangos a nombres, que acá no se puede.
        onAplicarSoloEstePlan?.({ clave, titulo: d.titulo, descripcion, accion });
    };

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
        setResueltos((prev) => {
            // Un aviso que VUELVE deja de estar resuelto. Sin esto se quedaba en la
            // tira verde para siempre: la pantalla lo mostraba tachado arriba Y rojo
            // abajo al mismo tiempo, o sea la tira verde mentía justo sobre lo único
            // que tiene que decir. Es la misma limpieza que ya se le hacía a
            // `marcados` unas líneas más abajo, que al escribirla se pasó por alto acá.
            const siguen = prev.filter((d) => !ahora.has(d.id));

            // Los que se acaban de ir. En el primer render no hay nada resuelto: hay
            // un plan recién calculado, y `antes` está vacío.
            //
            // Los que destrabó un ajuste de "solo en este plan" NO entran acá: se
            // fueron de la lista igual que los otros, pero decir "Resuelto" y ofrecer
            // "Ver cómo quedó" apuntando a Recursos sería afirmar que se guardó algo
            // que no se guardó. Esos ya se cuentan, con su nombre, en la tira índigo
            // de ajustes, que además es la única que se puede deshacer.
            const yaEstan = new Set(siguen.map((d) => d.id));
            const recien = antes.filter(
                (d) => !ahora.has(d.id) && !yaEstan.has(d.id) && !tieneAjusteRef.current(d)
            );

            // Se ACUMULAN entre recálculos. Antes cada cálculo pisaba la lista con los
            // de esa vuelta, así que arreglar dos cosas de a una dejaba ver sólo la
            // segunda: la primera desaparecía sin que nadie la hubiera cerrado.
            if (recien.length === 0 && siguen.length === prev.length) return prev;
            return [...recien, ...siguen];
        });
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
    /**
     * La confirmación no sobrevive a un recálculo.
     *
     * Antes la limpiaba el `onBlur` del botón, pero eso hacía imposible llegar al panel
     * con el teclado: al tabular hacia "Sí, aplicalo" el blur lo desmontaba. Ahora el
     * panel tiene su propio "Cancelar" y lo que hay que cubrir es el otro caso: que la
     * lista se renueve y el aviso que estabas por confirmar ya no exista.
     *
     * Lo mismo con el botón índigo que quedó trabajando: la lista nueva ES el plan que
     * ese click pidió, así que ahí termina de trabajar.
     */
    useEffect(() => {
        setConfirmando(null);
        setAjustando(null);
    }, [diagnosticos]);

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
            // Con la acción y no vacío: lo que se acaba de guardar en Recursos puede ser
            // lo mismo que alguien había puesto como ajuste "solo en este plan", y ese
            // ajuste lleva el conjunto de rangos de ANTES. Si no se saca, el próximo
            // recálculo lo manda igual y pisa en memoria lo recién guardado.
            onResuelto?.(accion);
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
    //
    // Los ajustes cuentan igual que los resueltos: si destrabaste las últimas dos
    // trabas con ajustes de este plan, el panel se llevaría puesta la única tira
    // que dice que este plan está calculado con datos que NO están cargados, y con
    // ella el botón para deshacerlos.
    if (items.length === 0 && resueltos.length === 0 && aMano.length === 0 && ajustes.length === 0) return null;

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
        ? (aMano.length > 0
            ? "Todo listo, marcado por vos"
            // Sin trabas PERO con datos inventados para este cálculo no es lo mismo
            // que sin trabas: la primera línea del panel no puede callar eso.
            : ajustes.length > 0 ? "Sin trabas, con ajustes de este plan" : "Sin trabas ni avisos")
        : [
            bloqueantes.length > 0 && `${bloqueantes.length} ${bloqueantes.length === 1 ? "traba detectada" : "trabas detectadas"}`,
            avisos.length > 0 && `${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`,
        ].filter(Boolean).join(" y ");

    const visibles = verTodas ? ordenados : ordenados.slice(0, VISIBLES);
    const ocultas = ordenados.length - visibles.length;

    /**
     * Cuántos datos de este plan NO están cargados en Recursos.
     *
     * Lo mismo, plegado y desplegado: la tira índigo vive adentro del panel y el panel
     * se pliega —es sticky y tapa la tabla, así que plegarlo es lo normal—, con lo cual
     * en el estado más común no quedaba NADA en pantalla diciendo que el plan de abajo
     * se calculó con rangos que nadie cargó. El encabezado los nombraba sólo cuando ya
     * no quedaban trabas ("Sin trabas, con ajustes de este plan"), que es justo el caso
     * en que menos se mira.
     *
     * De alto no cuesta un píxel: h-7 contra los ~36px que ya mide la fila plegada,
     * igual que "+N más" y "Marcar todo listo".
     */
    const chipAjustes = (
        <>
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            {ajustes.length} {ajustes.length === 1 ? "ajuste" : "ajustes"}
            {/* Abajo de lg el encabezado ya pelea por el ancho con los otros botones:
                el número y el ícono son lo que no se puede perder. */}
            <span className="hidden lg:inline">de este plan</span>
        </>
    );

    return (
        <div className="mx-3 sm:mx-4 mt-4 mb-2 rounded-xl border border-gray-200 overflow-hidden bg-white">
            {/* La fila es un div y no un <button>: adentro van "Ver todas" y "Volver a
                revisar", y no se pueden anidar botones. El toggle queda como botón propio.

                `flex-wrap` (RF-27): los botones de la derecha no achican, y cuando no les
                queda lugar al lado del resumen bajan a un renglón propio. Antes se quedaban
                en la fila y el resumen se apretaba hasta leerse una palabra por renglón
                (en un teléfono le quedaban ~70px). El `basis-56` del resumen es lo que
                decide cuándo bajan; en una pantalla ancha, todo en una fila como siempre. */}
            <div
                className={cn(
                    "w-full flex flex-wrap items-center gap-x-2",
                    items.length === 0 ? "bg-emerald-50/70"
                        : hayBloqueantes ? "bg-rose-50/70" : "bg-amber-50/60"
                )}
            >
                <button
                    type="button"
                    aria-expanded={!colapsado}
                    onClick={alternarColapso}
                    className={cn(
                        "flex-1 basis-56 min-w-0 px-3 flex gap-2.5 text-left",
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
                                    // "Resolvelas para optimizar tu planificación" no concordaba
                                    // ("lo rojo… resolvelas") y encima era una frase de folleto:
                                    // no decía qué pasa si lo arreglás ni qué pasa si no.
                                    : hayBloqueantes
                                        ? "Lo rojo salió mal en el plan. Arreglalo y el plan mejora."
                                        : "El plan sale igual: esto es para afinarlo."}
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

                {/* Plegado es un botón y abre el panel, porque ahí abajo está el
                    "Deshacer" de cada ajuste: sin esto, para sacar uno había que
                    acordarse de que existían. Desplegado deja de ser botón —la tira con
                    el detalle y los "Deshacer" está dos renglones más abajo, y un botón
                    que no lleva a ningún lado es el cartelito muerto de siempre. */}
                <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 pl-3 pb-1.5 sm:pb-0">
                {ajustes.length > 0 && (colapsado ? (
                    <button
                        type="button"
                        onClick={alternarColapso}
                        className="shrink-0 h-7 inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 bg-indigo-50 px-2 text-[12px] font-semibold text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100 whitespace-nowrap transition-colors"
                        title="Este plan se calculó con datos que NO están cargados en Recursos. Tocá para verlos y deshacerlos."
                    >
                        {chipAjustes}
                    </button>
                ) : (
                    <span
                        className="shrink-0 h-7 inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 bg-indigo-50 px-2 text-[12px] font-semibold text-indigo-700 whitespace-nowrap"
                        title="Este plan se calculó con datos que NO están cargados en Recursos. Abajo está cada uno, con su Deshacer."
                    >
                        {chipAjustes}
                    </span>
                ))}

                {/* Con borde, como en el mockup: es la salida a "las veo todas" y tiene
                    que verse como acción, no como texto suelto.

                    Dice las que FALTAN y no el total: este botón y el de abajo de la
                    lista hacen exactamente lo mismo, y decían dos números distintos
                    ("Ver las 9" arriba, "Ver las 3 restantes" abajo). Se leía como dos
                    acciones distintas y obligaba a pararse a pensar cuál era cuál. */}
                {ocultas > 0 && !colapsado && (
                    <button
                        type="button"
                        onClick={() => setVerTodas(true)}
                        className="shrink-0 h-7 inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white/70 px-2.5 text-[12px] font-medium text-gray-700 hover:bg-white hover:text-gray-900 whitespace-nowrap transition-colors"
                    >
                        +{ocultas} más <span aria-hidden="true">→</span>
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
                                `Listo: ${ordenados.length} ${ordenados.length === 1 ? "aviso" : "avisos"} fuera de la lista`,
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
            </div>

            {!colapsado && (
                /* De cuándo es esta foto y quién la mantiene al día. Antes acá había
                   un "tocá Volver a revisar" que aparecía recién a la hora; ahora la
                   revisión corre sola al volver a la pantalla y lo único que falta
                   decir es eso, para que nadie quede esperando un botón. */
                <div className="border-t bg-slate-50 px-3 py-1.5 text-[11.5px] leading-snug text-slate-600">
                    <div className="flex items-center gap-2">
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

                </div>
            )}

            {/* ── Lo que se está probando sin guardar ──
                Tiene que estar arriba de todo y ser imposible de no ver: mientras esta
                tira exista, el plan de abajo NO es el plan que sale de los datos
                cargados. Índigo y punteado, el mismo par que el botón que los crea:
                sin leer una palabra se ata un ajuste de la tira con el botón del aviso. */}
            {!colapsado && ajustes.length > 0 && (
                <div className="border-t border-indigo-200 bg-indigo-50/60 px-3 py-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-900">
                        Ajustes solo para este plan ({ajustes.length})
                    </p>
                    <ul className="mt-1 space-y-1">
                        {ajustes.map((a) => (
                            <li key={a.clave} className="flex items-start gap-2">
                                <SlidersHorizontal className="mt-[3px] w-3 h-3 shrink-0 text-indigo-500" />
                                <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-indigo-950">
                                    {a.descripcion}
                                    <span className="block text-[10.5px] text-indigo-800/70">{a.titulo}</span>
                                </span>
                                {onQuitarAjuste && (
                                    <button
                                        type="button"
                                        onClick={() => onQuitarAjuste(a.clave)}
                                        className="shrink-0 inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
                                        title="Sacar este ajuste y volver a calcular el plan con los datos como están"
                                    >
                                        <RotateCcw className="w-3 h-3" />
                                        Deshacer
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                    {/* La frase más importante del panel entero: alguien puede mirar este
                        plan mañana, ver que entra todo y salir a prometer fechas que se
                        apoyan en un rango que nadie cargó nunca. */}
                    <p className="mt-1.5 text-[10.5px] leading-snug text-indigo-900/80">
                        Esto <strong>no quedó guardado en Recursos</strong>: el plan se calculó como si el
                        dato estuviera, pero en el sistema sigue como antes. Se pierde si descartás el
                        borrador. Para dejarlo cargado de verdad, usá <strong>Guardar en Recursos</strong>.
                    </p>
                </div>
            )}

            {/* Misma geometría que las tarjetas de abajo —barra de color, chip del mismo
                ancho, título— para que resueltos y pendientes se lean como una sola
                lista y no como dos tablas pegadas. De una línea: son la confirmación de
                que algo se arregló, no algo para leer. */}
            {!colapsado && (resueltos.length > 0 || aMano.length > 0) && (
                <ul className="border-t bg-emerald-50/40 p-2 space-y-1">
                    {/* Un aviso resuelto se sigue pudiendo abrir.
                        Antes esta fila era texto muerto: aplicabas la solución, el aviso
                        bajaba acá tachado y no había forma de volver a tocarlo para ver
                        qué era ni qué se había cambiado (Lucas, 28/08 00:37:44). Ahora
                        despliega el problema original, cuál de las soluciones se aplicó y
                        el link a Recursos para ir a mirarlo o dejarlo como estaba. */}
                    {resueltos.map((d) => {
                        const clave = `resuelto-${d.id}`;
                        const abierta = abiertos.has(clave);
                        const iAplicada = d.soluciones.findIndex((_, i) => aplicadas.has(`${d.id}-${i}`));
                        const solAplicada = iAplicada >= 0 ? d.soluciones[iAplicada] : null;
                        const linkResuelto = solAplicada ? enlace(d, solAplicada) : null;
                        return (
                            <li
                                key={clave}
                                className="rounded-lg border border-emerald-200 bg-white/70 overflow-hidden"
                            >
                                <button
                                    type="button"
                                    aria-expanded={abierta}
                                    onClick={() => toggle(clave)}
                                    className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-emerald-50/60 transition-colors"
                                >
                                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                                    {/* "Se arregló" y no "Resuelto": abajo, en la misma tira,
                                        están los que alguien dio por resueltos a mano, y con
                                        los dos diciendo lo mismo no había forma de saber cuál
                                        de las dos filas era un problema que ya no existe y
                                        cuál un problema que sigue ahí. */}
                                    <span className="shrink-0 min-w-[96px] inline-flex items-center justify-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold leading-[15px] text-emerald-700 whitespace-nowrap">
                                        Se arregló
                                    </span>
                                    <span className={cn(
                                        "flex-1 min-w-0 text-[13px] leading-tight text-gray-500 decoration-emerald-600/40",
                                        abierta ? "line-clamp-none" : "truncate line-through"
                                    )}>
                                        {d.titulo}
                                    </span>
                                    <ChevronDown className={cn(
                                        "w-3.5 h-3.5 shrink-0 text-emerald-700/50 transition-transform",
                                        abierta && "rotate-180"
                                    )} />
                                </button>
                                {abierta && (
                                    <div className="border-t border-emerald-100 bg-white/60 px-3 py-2 space-y-1.5">
                                        <p className="text-[11.5px] leading-snug text-gray-600">
                                            <span className="font-semibold text-gray-700">Qué pasaba: </span>
                                            {conNegritas(d.detalle)}
                                        </p>
                                        {solAplicada ? (
                                            <p className="text-[11.5px] leading-snug text-gray-600">
                                                <span className="font-semibold text-emerald-700">Se aplicó: </span>
                                                {conNegritas(solAplicada.texto)}
                                            </p>
                                        ) : (
                                            <p className="text-[11.5px] leading-snug text-gray-500">
                                                Ya no aparece en este cálculo: o lo arreglaste en Recursos, o la OT salió del plan.
                                            </p>
                                        )}
                                        {linkResuelto && (
                                            <a
                                                href={linkResuelto}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-800 hover:bg-emerald-50 transition-colors"
                                                title={`Abrir ${solAplicada?.donde} para revisar cómo quedó`}
                                            >
                                                Ver cómo quedó
                                                <ArrowUpRight className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}

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
                                {/* Dice QUIÉN lo cerró, que es la única diferencia con la fila
                                    de arriba: el problema sigue en el plan, lo único que pasó es
                                    que alguien lo dio por visto. Y usa la misma palabra que el
                                    botón ("Listo") para que se lea como la misma acción. */}
                                Lo diste por listo
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
                        // Manda la que se puede guardar en Recursos; si ninguna se puede,
                        // la que al menos se puede probar en este plan; si tampoco, la
                        // primera a secas. El orden importa: mostrar plegada una solución
                        // que solo se puede probar, teniendo otra que se puede dejar
                        // cargada, escondería el arreglo de verdad detrás de un click.
                        const conBoton = d.soluciones.findIndex((s) => s.accion);
                        const conAjuste = conBoton >= 0 ? conBoton : d.soluciones.findIndex((s) => accionAjustable(s));
                        const iSol = conAjuste >= 0 ? conAjuste : (d.soluciones.length > 0 ? 0 : -1);
                        const sol = iSol >= 0 ? d.soluciones[iSol] : null;
                        // Misma clave que la lista desplegada: aplicar desde cualquiera de
                        // los dos lados marca el mismo botón.
                        const claveSol = `${d.id}-${iSol}`;
                        const hecha = aplicadas.has(claveSol);
                        // Lo que se puede probar sin guardar. Puede venir de la acción del
                        // aviso o deducirse del objetivo (los Media con rangos propuestos).
                        const accionSol = sol ? accionAjustable(sol) : null;
                        // Por lo que TOCA y no por el renglón (ver `clavesAjustadas`): el
                        // índice de la solución se corre entre recálculos y el botón
                        // terminaba marcado arriba de la solución equivocada.
                        const claveAjuste = accionSol ? claveDeAjuste(accionSol) : "";
                        const ajustada = !!claveAjuste && clavesAjustadas.has(claveAjuste);
                        // La solución de ESTA tarjeta que está esperando confirmación, si
                        // hay alguna. La clave es `${d.id}-${i}` y el id del aviso trae
                        // guiones ("maquina-incompatible-101"), así que se parte por el
                        // ÚLTIMO, no por el primero.
                        const iArmada = confirmando && confirmando.slice(0, confirmando.lastIndexOf("-")) === d.id
                            ? Number(confirmando.slice(confirmando.lastIndexOf("-") + 1))
                            : -1;
                        const armada = iArmada >= 0 ? d.soluciones[iArmada] : null;
                        const link = sol ? enlace(d, sol) : null;
                        const otras = d.soluciones.length - 1;

                        // El backend ya manda el impacto masticado ("3 procesos · 2 OT · 4h").
                        // Decía «3 proc» hasta el 17/09/2026, cuando se escribió entero del
                        // lado del backend (ver `_resumen`); el corte por «·» es el mismo.
                        // Se parte en chips en vez de reescribirlo: mismos datos, sin
                        // inventar campos y sin decir dos veces lo mismo.
                        const impacto = d.impacto.resumen.split("·").map((t) => t.trim()).filter(Boolean);
                        // El aviso ya trae el número que el taller conoce (el del sistema
                        // viejo), no el id interno. Sin `numeroDeOT` (esta tira se usa
                        // también sin el plan al lado) no se muestran: sin la tabla al
                        // lado, el chip no tendría adónde llevar.
                        const otsDelAviso = numeroDeOT
                            ? d.impacto.ots.map((n) => ({ id: n, numero: numeroDeOT(n) }))
                            : [];
                        const otsTexto = otsDelAviso.length > 0
                            ? `OTs: ${otsDelAviso.map((o) => `#${o.numero}`).join(", ")}`
                            : undefined;
                        // Plegada entran dos sin empujar el "dónde"; abierta van todas.
                        const otsVisibles = activo ? otsDelAviso : otsDelAviso.slice(0, 2);

                        /* Los datos del aviso, cada uno con su etiqueta, como en el mockup.
                           El impacto viene del backend masticado y en orden («2 procesos · 3 OT
                           · 4 jornadas»): procesos y OT se juntan en una caja —son la misma
                           pregunta, cuánto trabajo toca— y el tiempo va en la suya. */
                        const [impProcesos, impOts, impTiempo] = impacto;
                        const trabajo = [impProcesos, impOts].filter(Boolean).join(" · ");
                        const datos = [
                            // En una pausa lo que viene en `tiene` es el motivo, no «lo que hay hoy».
                            d.tiene && { etiqueta: esPausa(d) ? "Motivo" : "Hoy", valor: d.tiene, icono: Icono },
                            d.pide && { etiqueta: "Necesita", valor: d.pide, icono: Wrench },
                            trabajo && { etiqueta: "Trabajo", valor: trabajo, icono: Layers },
                            impTiempo && { etiqueta: "Tiempo", valor: impTiempo, icono: Clock },
                        ].filter(Boolean) as { etiqueta: string; valor: string; icono: LucideIcon }[];

                        return (
                            <li
                                key={d.id}
                                /* La barra de color vuelve, pero fina y sin numerito.
                                   Julián devolvió el 31/08 «ese detalle que tienen a la
                                   izquierda son muy molestas» —era un riel grueso MÁS un
                                   número de orden que empujaban el título—; el mockup que
                                   pasó el 17/09 tiene una barra de 3px y nada más, que es
                                   lo que deja barrer la lista por color sin robarle ancho
                                   a lo único que hay que leer. */
                                className={cn(
                                    "overflow-hidden rounded-xl border border-gray-200 border-l-[3px] bg-white transition-shadow",
                                    esBloq ? "border-l-rose-500" : "border-l-amber-400",
                                    activo ? "shadow-sm" : "hover:shadow-sm",
                                )}
                            >
                                {/* La tarjeta, con la anatomía del mockup que pasó Julián el
                                    17/09/2026: círculo de color, severidad, título grande, una
                                    frase en criollo, los datos en cajas con etiqueta y la acción
                                    en una franja propia abajo.

                                    Es más alta que la anterior —unos 145px contra 76— y eso es
                                    una decisión, no un descuido: Lucas había pedido lo contrario
                                    el 26/08 («pueden entrar más trabas»), pero con la lista de
                                    hoy se ven uno o dos avisos por plan, no once, y lo que
                                    costaba caro era no entenderlos. Por eso además bajan de seis
                                    a cuatro los que se muestran antes del «Ver todas»: la tabla
                                    del plan tiene que seguir entrando en la pantalla. */}
                                <button
                                    type="button"
                                    aria-expanded={activo}
                                    onClick={() => toggle(d.id)}
                                    className="flex w-full min-w-0 items-start gap-3 px-3 py-2.5 text-left"
                                >
                                    <span className={cn(
                                        "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                                        esBloq ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                                    )}>
                                        {esBloq ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                                    </span>

                                    <span className="min-w-0 flex-1">
                                        {/* Severidad y categoría arriba, chiquitas: son para
                                            clasificar, no para leer. El título va abajo y grande. */}
                                        <span className="flex items-center gap-2">
                                            <span
                                                className={cn(
                                                    "shrink-0 rounded-full px-2 text-[10px] font-bold uppercase leading-[18px] tracking-wide",
                                                    esBloq ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                                                )}
                                                title={esBloq
                                                    ? "Alta: por esto algo del plan salió mal — trabajo sin recurso humano, recurso maquinaria sin reservar o trabajo que no entró en el período."
                                                    : "Media: recomendación para afinar. El plan sale igual con el aviso o sin él; lo que falta lo sabe el taller."}
                                            >
                                                {esBloq ? "Alta" : "Media"}
                                            </span>
                                            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-gray-500">
                                                <Icono className="h-3 w-3 shrink-0" />
                                                <span className="truncate">
                                                    {recurso?.texto ?? "Plan"}{subtipo ? ` · ${subtipo}` : ""}
                                                </span>
                                            </span>
                                            <span className="flex-1" />
                                            <ChevronDown className={cn(
                                                "h-4 w-4 shrink-0 text-gray-400 transition-transform",
                                                activo && "rotate-180"
                                            )} />
                                        </span>

                                        <span className={cn(
                                            "mt-1 block text-[15px] font-semibold leading-snug text-gray-900",
                                            !activo && "line-clamp-2"
                                        )} title={d.titulo}>
                                            {d.titulo}
                                        </span>

                                        {/* El texto de acá NO cambia al abrir la tarjeta. Antes
                                            cerrada mostraba el `resumen` y abierta lo REEMPLAZABA
                                            por el `detalle`: la frase que estabas leyendo se
                                            convertía en otra (Julián, 17/09/2026). El detalle
                                            aparece abajo al desplegar: no se reemplaza nada. */}
                                        <span className={cn(
                                            "mt-0.5 block text-[12px] leading-snug text-gray-600",
                                            !activo && !d.resumen && "line-clamp-2"
                                        )}>
                                            {d.resumen ? d.resumen : conNegritas(d.detalle)}
                                        </span>

                                        {/* Los datos, cada uno con su etiqueta. Antes eran chips
                                            grises sueltos —«OPERARIO CALIFIC… → AYUDANTE o
                                            INGRESA…», «1 proc · 1 OT · 1 min»— donde había que
                                            adivinar qué era cada número y de qué lado de la flecha
                                            estaba cada rango. Es lo que hace el mockup y es lo que
                                            contesta la pregunta que hizo Lucas mirando la
                                            soldadora: «¿cuál es el rango que tiene?». */}
                                        {datos.length > 0 && (
                                            <span className="mt-2 flex flex-wrap gap-1.5">
                                                {datos.map((dato) => (
                                                    <span
                                                        key={dato.etiqueta}
                                                        className="inline-flex min-w-0 max-w-[15rem] items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50/70 px-2 py-1"
                                                        title={`${dato.etiqueta}: ${dato.valor}`}
                                                    >
                                                        <dato.icono className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                                        <span className="min-w-0">
                                                            <span className="block text-[9.5px] uppercase leading-none tracking-wide text-gray-400">
                                                                {dato.etiqueta}
                                                            </span>
                                                            <span className="mt-0.5 block truncate text-[11.5px] font-medium leading-none text-gray-700">
                                                                {dato.valor}
                                                            </span>
                                                        </span>
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                    </span>
                                </button>

                                {/* ── Qué hacer ──
                                    Franja propia, del color del aviso: es lo que hace que un
                                    Media sin botón verde deje de parecer un cartel que sólo
                                    informa. */}
                                <div className={cn(
                                    "flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t px-3 py-2",
                                    esBloq ? "border-rose-100 bg-rose-50/50" : "border-amber-100 bg-amber-50/50"
                                )}>
                                    <span className={cn(
                                        "grid h-6 w-6 shrink-0 place-items-center rounded-md",
                                        esBloq ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700"
                                    )}>
                                        <Wrench className="h-3.5 w-3.5" />
                                    </span>
                                    <p className={cn(
                                        "min-w-0 flex-[3] basis-[15rem] text-[12px] font-medium leading-snug text-gray-800",
                                        !activo && "line-clamp-2"
                                    )}>
                                        {sol ? (
                                            <>
                                                {conNegritas(sol.texto)}
                                                {otras > 0 && !activo && (
                                                    <span className="ml-1 font-normal text-gray-400">
                                                        +{otras} {otras === 1 ? "opción" : "opciones"}
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="font-normal text-gray-400">Este aviso no trae una solución sugerida.</span>
                                        )}
                                    </p>

                                    {/* La OT, de un click: "y vas a buscarla acá… estaría bueno
                                        que hagas clic acá" (Lucas 28/08, sobre la 15678). */}
                                    {onVerOT && otsVisibles.map((o) => (
                                        <button
                                            key={o.id}
                                            type="button"
                                            onClick={() => onVerOT(o.id)}
                                            className="shrink-0 rounded-md bg-white/80 px-1.5 text-[10.5px] font-medium leading-[19px] text-slate-600 tabular-nums ring-1 ring-inset ring-slate-200 hover:bg-white hover:text-indigo-700 transition-colors"
                                            title={`Ir a la OT #${o.numero} en el plan`}
                                        >
                                            #{o.numero}
                                        </button>
                                    ))}
                                    {onVerOT && !activo && otsDelAviso.length > otsVisibles.length && (
                                        <button
                                            type="button"
                                            onClick={() => toggle(d.id)}
                                            className="shrink-0 rounded px-1 text-[10.5px] leading-[19px] text-gray-400 hover:bg-white hover:text-gray-700 transition-colors"
                                            title={otsTexto ? `${otsTexto} — tocá para verlas todas` : "Tocá para verlas todas"}
                                        >
                                            +{otsDelAviso.length - otsVisibles.length}
                                        </button>
                                    )}

                                    {/* El "dónde" sólo cuando NO hay un botón que lleve ahí: con
                                        "Ir a arreglarlo" al lado, el chip decía dos veces lo
                                        mismo y le comía ancho a la solución. */}
                                    {sol?.accion && sol.donde && (link ? (
                                        <a
                                            href={link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-md bg-white/80 px-1.5 text-[10.5px] leading-[19px] text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-white hover:text-blue-700 transition-colors"
                                            title={`${sol.donde} — se abre en otra pestaña, ya parado en lo que hay que tocar`}
                                        >
                                            <span className="truncate">{sol.donde}</span>
                                            <ArrowUpRight className="w-2.5 h-2.5 shrink-0" />
                                        </a>
                                    ) : (
                                        <span className="min-w-0 shrink-0 truncate rounded-md bg-white/80 px-1.5 text-[10.5px] leading-[19px] text-slate-500">
                                            {sol.donde}
                                        </span>
                                    ))}
                                    {/* Los botones, al final de la franja y siempre en el mismo
                                        orden: primero lo que se prueba y se deshace, después lo
                                        que queda cargado, último lo que sólo esconde el aviso.
                                        Así la mano aprende la fila una vez y no una por tipo de
                                        aviso. */}
                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                            {/* ── El camino que NO toca nada ──
                                                Va primero de la fila, y es de otro color, otro borde
                                                y otro ícono que el que guarda: los dos hacen lo mismo
                                                con el plan y cosas opuestas con los datos, así que la
                                                única forma de que no se confundan es que no se
                                                parezcan en nada. Punteado = provisorio, el mismo par
                                                (índigo + punteado) que la tira de arriba.

                                                Ya aplicado, el mismo botón lo saca: un "Deshacer"
                                                aparte serían tres botones en la fila, y el de la
                                                tira de arriba ya hace exactamente eso. */}
                                            {accionSol && onAplicarSoloEstePlan && (
                                                <button
                                                    type="button"
                                                    /* `revisando` también, y no sólo `aplicando`: `aplicando` es
                                                       el estado del botón verde (el que pega en los endpoints) y
                                                       este no pega en ninguno, así que mientras el plan se
                                                       recalculaba quedaba vivo. El velo de recálculo es
                                                       `pointer-events-none`, o sea que el click pasaba igual y
                                                       salían dos POST /planificar encimados. */
                                                    disabled={aplicando !== null || revisando}
                                                    onClick={() => aplicarSoloEstePlan(d, claveAjuste, accionSol)}
                                                    title={ajustada
                                                        ? "Sacar este ajuste y volver a calcular con los datos como están"
                                                        : `${descripcionDeAccion(accionSol, nombreDeRango)} — solo para este cálculo, en Recursos no se guarda nada.`}
                                                    /* Lo que el botón HACE, para el lector de pantalla y para el
                                                       que llega con el teclado: la etiqueta de la cara puesta es
                                                       un estado ("Puesto en este plan") y sola no dice que se
                                                       puede tocar para desarmarlo. */
                                                    aria-label={ajustada
                                                        ? `Sacar de este plan: ${d.titulo}`
                                                        : `Aplicar solo en este plan: ${d.titulo}`}
                                                    className={cn(
                                                        "group inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 text-[10.5px] font-semibold transition-colors disabled:opacity-50",
                                                        ajustada
                                                            ? "border-indigo-400 bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                                                            : "border-dashed border-indigo-300 bg-indigo-50/60 text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100"
                                                    )}
                                                >
                                                    {ajustando === claveAjuste && revisando
                                                        ? <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
                                                        : ajustada
                                                            ? <Check className="w-3 h-3 shrink-0" />
                                                            : <SlidersHorizontal className="w-3 h-3 shrink-0" />}
                                                    {ajustada ? (
                                                        /* "Puesto en este plan" es un estado, pero el botón que lo
                                                           dice es el que lo SACA, y eso vivía sólo en el `title=`:
                                                           el que se arrepiente lo lee como etiqueta y no lo toca.
                                                           Al pasar el mouse o al enfocarlo con el teclado pasa a
                                                           decir qué hace. Las dos frases miden casi lo mismo a
                                                           propósito (19 y 20 caracteres): así el botón no cambia
                                                           de ancho y no empuja a los de al lado. Y no es un botón
                                                           más en la fila, que ya tiene tres. */
                                                        <>
                                                            <span className="group-hover:hidden group-focus:hidden">Puesto en este plan</span>
                                                            <span className="hidden group-hover:inline group-focus:inline">Sacarlo de este plan</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            Solo en este plan
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                            {/* La puerta a Recursos para los Media, que casi nunca
                                                traen botón —"los de media van a estar siempre porque
                                                es una recomendación", Lucas 28/08— y cuya única salida
                                                era el chip gris del "dónde", que no se lee como acción.
                                                Se abre en otra pestaña: el borrador queda donde está y
                                                al volver se revisa solo.

                                                Va DESPUÉS del de "solo en este plan" a propósito: el
                                                orden de la fila es siempre el mismo —primero lo que se
                                                prueba y se deshace, después lo que queda cargado,
                                                último lo que solo esconde el aviso—, así la mano
                                                aprende la fila una vez y no una por tipo de aviso. */}
                                            {!sol?.accion && link && (
                                                <a
                                                    href={link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 text-[10.5px] font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                                    title={`Abre ${sol?.donde} en otra pestaña, ya parado en lo que hay que tocar. Al volver acá se revisa solo.`}
                                                >
                                                    Ir a arreglarlo
                                                    <ArrowUpRight className="w-3 h-3 shrink-0" />
                                                </a>
                                            )}
                                            {/* ── El camino que SÍ toca la base ──
                                                Verde lleno y con ícono de guardar, que en esta
                                                pantalla es ahora lo único que quiere decir "esto
                                                queda cargado". El nombre dice DÓNDE queda: "Aplicar
                                                y recalcular" no decía nada de eso, y al lado de un
                                                botón que aplica y recalcula sin guardar era
                                                directamente indistinguible. */}
                                            {sol?.accion && puedeGuardarEnRecursos(sol.accion) && (
                                                <Button
                                                    size="sm"
                                                    disabled={hecha || aplicando !== null}
                                                    onClick={() => aplicar(claveSol, sol.accion!)}
                                                    title={confirmando === claveSol
                                                        ? "Abajo está el detalle de lo que va a cambiar"
                                                        : "Queda guardado en Recursos para siempre, para todos los planes"}
                                                    /* Sin ancho fijo: con dos botones en la fila, dos
                                                       anchos fijos no entran abajo de 2xl y el par se
                                                       partía en dos renglones. La alineación de tarjeta
                                                       en tarjeta se la queda ahora el par entero. */
                                                    className={cn(
                                                        "h-7 justify-center gap-1 px-2.5 text-[10.5px] font-semibold shadow-none",
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
                                                    ) : (
                                                        <Save className="w-3 h-3" />
                                                    )}
                                                    {hecha
                                                        ? "Guardado"
                                                        : confirmando === claveSol
                                                            ? "Mirá y confirmá"
                                                            : (
                                                                /* De 2xl para arriba queda "Guardar" a secas. Se
                                                                   pierde el DÓNDE, que es justo lo que este nombre
                                                                   vino a decir, pero no se pierde del todo: el paso
                                                                   de confirmación —que sale sí o sí antes de tocar
                                                                   un dato— lo dice con todas las letras, y el
                                                                   título y la leyenda también. Lo que se gana son
                                                                   ~60px para el texto de la solución, que ahí
                                                                   arriba se lee cortado a la mitad. */
                                                                <>
                                                                    Guardar en Recursos
                                                                </>
                                                            )}
                                                </Button>
                                            )}
                                            {/* Darlo por resuelto, SOLO donde no hay un botón que lo
                                                arregle de verdad.

                                                Al lado de "Guardar en Recursos" no tiene sentido y
                                                confunde (Julián, 31/08): son dos botones verdes pegados
                                                que hacen cosas opuestas —uno cambia el dato, el otro
                                                dice "no me lo muestres más"— y el chiquito parecía el
                                                confirmar del grande. Ahí el aviso se va solo cuando el
                                                cambio se aplica, así que no hace falta.

                                                Donde SÍ va es en los Media, que no traen botón porque
                                                qué corregir lo sabe el taller: es la única acción de la
                                                tarjeta y por eso va con nombre, no un tilde gris que
                                                nadie encuentra. Para las Alta con botón, el "Listo"
                                                sigue estando adentro de la tarjeta desplegada.

                                                Dejó de ser verde lleno: el verde lleno quedó reservado
                                                para lo único que toca la base ("Guardar en Recursos").
                                                Este no cambia nada y competía de igual a igual con el
                                                que sí cambia el dato — en una tarjeta Media puede
                                                aparecer al lado de "Solo en este plan", y dos botones
                                                pintados igual que hacen cosas tan distintas es
                                                exactamente lo que había que sacar.

                                                Sin borde tampoco: al lado de "Ir a arreglarlo", que es
                                                blanco con borde, dos botones iguales que hacen cosas
                                                opuestas serían el mismo problema de nuevo, solo que en
                                                gris. De las tres acciones de una tarjeta Media esta es
                                                la que menos hace, y el peso visual lo dice. */}
                                            {!sol?.accion && (
                                                <button
                                                    type="button"
                                                    onClick={() => marcar(d)}
                                                    title="No lo muestres más. No cambia el plan ni los datos: lo baja a la tira verde de arriba, y se deshace."
                                                    aria-label={`Listo, no mostrar más: ${d.titulo}`}
                                                    className="inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-[10.5px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
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
                                                className="grid h-7 w-7 shrink-0 place-items-center rounded text-gray-400 hover:bg-slate-100 hover:text-gray-600 transition-colors"
                                            >
                                                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", activo && "rotate-180")} />
                                            </button>
                                    </div>
                                </div>

                                {/* Abierto: TODAS las soluciones (no solo la que se ve plegada),
                                    cada una con su link y su botón, más las OTs. */}
                                {activo && (
                                    <div className="border-t bg-slate-50/70 px-2 py-1.5 space-y-1.5">
                                        {/* El porqué largo. Sólo si hay un `resumen`: cuando no lo
                                            hay, el detalle YA se está leyendo arriba y repetirlo
                                            sería decir dos veces lo mismo. */}
                                        {d.resumen && (
                                            <p className="text-[11.5px] leading-[1.4] text-gray-600">
                                                {conNegritas(d.detalle)}
                                            </p>
                                        )}
                                        {/* Las OTRAS opciones, no todas: la que se ve en la
                                            franja de arriba se saltea. Estaba dos veces, una
                                            arriba y otra acá, palabra por palabra — se ve en la
                                            captura que mandó Julián el 17/09/2026. */}
                                        {d.soluciones.some((_, idx) => idx !== iSol) && (
                                            <ul className="space-y-1">
                                                {d.soluciones.map((s, idx) => {
                                                    if (idx === iSol) return null;
                                                    const clave = `${d.id}-${idx}`;
                                                    const hechaEsta = aplicadas.has(clave);
                                                    const linkEste = enlace(d, s);
                                                    // Los dos caminos, también acá: desplegada la tarjeta
                                                    // salen TODAS las soluciones, y si el botón de probar
                                                    // solo estuviera en la plegada, las alternativas ("O
                                                    // ponele el rango a la otra fresadora") no se podrían
                                                    // probar sin guardarlas.
                                                    const accionEsta = accionAjustable(s);
                                                    // Mismo criterio que arriba: el ajuste se reconoce por lo
                                                    // que toca, no por el número de renglón.
                                                    const claveAjusteEsta = accionEsta ? claveDeAjuste(accionEsta) : "";
                                                    const ajustadaEsta = !!claveAjusteEsta && clavesAjustadas.has(claveAjusteEsta);
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
                                                                            /* Mismo criterio que arriba: sin forma de
                                                                               cartelito, porque no lleva a ningún lado. */
                                                                            <span className="inline-block text-slate-400 text-[10px] px-1 py-px whitespace-nowrap align-baseline">
                                                                                {s.donde}
                                                                            </span>
                                                                        )}
                                                                    </>
                                                                )}
                                                                {accionEsta && onAplicarSoloEstePlan && (
                                                                    <>
                                                                        {" "}
                                                                        <button
                                                                            type="button"
                                                                            /* Igual que el de la tarjeta plegada: mientras el plan
                                                                               se recalcula este botón no se puede tocar, o salen
                                                                               dos POST /planificar encimados. */
                                                                            disabled={aplicando !== null || revisando}
                                                                            onClick={() => aplicarSoloEstePlan(d, claveAjusteEsta, accionEsta)}
                                                                            title={ajustadaEsta
                                                                                ? "Sacar este ajuste y volver a calcular con los datos como están"
                                                                                : `${descripcionDeAccion(accionEsta, nombreDeRango)} — solo para este cálculo, en Recursos no se guarda nada.`}
                                                                            aria-label={ajustadaEsta
                                                                                ? `Sacar de este plan: ${d.titulo}`
                                                                                : `Aplicar solo en este plan: ${d.titulo}`}
                                                                            className={cn(
                                                                                "group inline-flex h-5 items-center gap-1 whitespace-nowrap rounded border px-1.5 align-baseline text-[10px] font-medium transition-colors disabled:opacity-50",
                                                                                ajustadaEsta
                                                                                    ? "border-indigo-400 bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                                                                                    : "border-dashed border-indigo-300 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100"
                                                                            )}
                                                                        >
                                                                            {ajustando === claveAjusteEsta && revisando
                                                                                ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                                                : ajustadaEsta
                                                                                    ? <Check className="w-2.5 h-2.5" />
                                                                                    : <SlidersHorizontal className="w-2.5 h-2.5" />}
                                                                            {ajustadaEsta ? (
                                                                                /* Mismo cambio de cara que arriba: puesto dice el
                                                                                   estado, y con el mouse encima o con el foco del
                                                                                   teclado dice que ése es el botón que lo saca. */
                                                                                <>
                                                                                    <span className="group-hover:hidden group-focus:hidden">Puesto en este plan</span>
                                                                                    <span className="hidden group-hover:inline group-focus:inline">Sacarlo de este plan</span>
                                                                                </>
                                                                            ) : "Solo en este plan"}
                                                                        </button>
                                                                    </>
                                                                )}
                                                                {s.accion && puedeGuardarEnRecursos(s.accion) && (
                                                                    <>
                                                                        {" "}
                                                                        <Button
                                                                            size="sm"
                                                                            variant={hechaEsta ? "ghost" : "outline"}
                                                                            disabled={hechaEsta || aplicando !== null}
                                                                            onClick={() => aplicar(clave, s.accion!)}
                                                                            title={confirmando === clave
                                                                                ? "Abajo está el detalle de lo que va a cambiar"
                                                                                : "Queda guardado en Recursos para siempre, para todos los planes"}
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
                                                                            ) : (
                                                                                <Save className="w-2.5 h-2.5" />
                                                                            )}
                                                                            {/* Mismo texto que el botón de la tarjeta plegada:
                                                                                es el mismo cambio y la misma clave, y con dos
                                                                                nombres distintos para el mismo botón —"Tocá de
                                                                                nuevo para confirmar" acá, "Mirá abajo qué
                                                                                cambia" arriba— el paso del medio parecía otra
                                                                                cosa según de dónde lo hubieras tocado. */}
                                                                            {hechaEsta
                                                                                ? "Guardado"
                                                                                : confirmando === clave
                                                                                    ? "Mirá y confirmá"
                                                                                    : "Guardar en Recursos"}
                                                                        </Button>
                                                                    </>
                                                                )}
                                                                {/* Qué hace exactamente el botón índigo, escrito.
                                                                    Hasta acá eso vivía sólo en un `title=`: en una
                                                                    tablet no hay hover, y es el mismo argumento con
                                                                    el que este cambio sacó el criterio Alta/Media de
                                                                    un tooltip. Va en la tarjeta DESPLEGADA, que es
                                                                    donde hay alto para gastar; plegada sigue
                                                                    alcanzando el nombre del botón, porque la
                                                                    tarjeta plegada es para barrer la lista. */}
                                                                {accionEsta && onAplicarSoloEstePlan && (
                                                                    <span className="mt-0.5 flex items-start gap-1 text-[10.5px] leading-snug text-indigo-800/90">
                                                                        <SlidersHorizontal className="mt-[2px] w-2.5 h-2.5 shrink-0" />
                                                                        <span className="min-w-0">
                                                                            <strong className="font-semibold">
                                                                                {ajustadaEsta ? "Puesto solo en este plan: " : "Solo en este plan: "}
                                                                            </strong>
                                                                            {descripcionDeAccion(accionEsta, nombreDeRango)}. En Recursos no se guarda nada.
                                                                        </span>
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                        {/* El chip «hoy → hace falta» de la tarjeta vive en un
                                            `lg:inline-flex`, o sea que abajo de 1024px NO EXISTE — y en
                                            un notebook de 1366 con la barra de navegación abierta el
                                            panel ronda los 700px. Justo ahí desaparecía la respuesta a
                                            la pregunta que hizo Lucas mirando la soldadora ("¿cuál es el
                                            rango que tiene?"). Acá se escribe con los dos lados
                                            rotulados, y solo en los anchos donde el chip no está. */}
                                        {d.tiene && (
                                            <p className="text-[10.5px] leading-snug text-gray-500 lg:hidden">
                                                <span className="font-semibold text-gray-600">Hoy: </span>{d.tiene}
                                                {d.pide && (
                                                    <>
                                                        {" · "}
                                                        <span className="font-semibold text-gray-600">Hace falta: </span>{d.pide}
                                                    </>
                                                )}
                                            </p>
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
                                                                        title={`Ir a la OT #${o.numero} en el plan`}
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
                                            {/* El mismo "Listo" del botón de arriba, pero acá adentro
                                                hay lugar para decir qué hace de verdad: no arregla
                                                nada, deja de mostrarlo. Se llamaba "Marcar como
                                                resuelto", que era el quinto nombre distinto para la
                                                misma acción en la misma pantalla —"Marcar todo listo",
                                                "Listo", "Marcar como resuelto", "Lo diste listo",
                                                "Marcado como resuelto"—: ahora todos empiezan igual.
                                                En gris y no en verde por lo mismo que el de arriba: el
                                                verde quedó para lo que toca la base. */}
                                            <button
                                                type="button"
                                                onClick={() => marcar(d)}
                                                className="shrink-0 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                                title="No cambia el plan ni los datos: lo baja a la tira verde de arriba. Se deshace."
                                            >
                                                <Check className="w-3 h-3" />
                                                Listo, no lo muestres más
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* El paso de confirmación, con el cambio escrito.
                                    Antes el botón armado solo decía "Tocá de nuevo": pedía
                                    confirmar sin haber dicho nunca qué. Vale para el botón
                                    plegado y para los de la lista desplegada — sale de
                                    `confirmando`, que es el mismo estado para los dos.

                                    `onMouseDown` con preventDefault en los botones: el botón
                                    de arriba limpia `confirmando` en su onBlur, así que sin
                                    esto el panel se desmontaba antes de que el click llegara. */}
                                {armada?.accion && (
                                    <>
                                        <ResumenDelCambio accion={armada.accion} />
                                        <div className="flex flex-wrap items-center justify-end gap-2 bg-amber-50/70 px-3 pb-2">
                                            <button
                                                type="button"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => setConfirmando(null)}
                                                className="rounded px-2 py-1 text-[11px] font-medium text-amber-900/70 hover:bg-amber-100 hover:text-amber-900 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <Button
                                                size="sm"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => aplicar(confirmando!, armada.accion!)}
                                                disabled={aplicando !== null}
                                                className="h-6 gap-1 bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                            >
                                                {aplicando !== null && <Loader2 className="w-3 h-3 animate-spin" />}
                                                Sí, aplicalo
                                            </Button>
                                        </div>
                                    </>
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
                    Ver los {ocultas} que faltan
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
