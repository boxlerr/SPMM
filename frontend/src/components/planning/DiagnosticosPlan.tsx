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
 *
 * Quinta pasada (26/09/2026): el mockup que armó Julián, con sus pedidos copiados tal
 * cual —tipeos incluidos—: *"ademas todo esto quiero que lo mejores visualemnte como el
 * mock up que arme y te paso, tiene que ser asi mas ordenado mas legible mas lindo a la
 * vista. que no invada tanto"* y *"siento que hay espacios que podemos aprovechar bastante
 * mas para ver mejor la informacino ya que es una seccion en la cual se va a trabajar
 * bastante"*. De ahí:
 *
 *  - Se fue la caja que envolvía todo: son tarjetas sueltas con aire entre ellas (el
 *    resumen, los ajustes, una por aviso, los resueltos), cada una con su borde fino.
 *  - Los ajustes dejan de ser chips con la frase escondida en un `title`: cada uno es una
 *    fila numerada que dice qué toca —con los nombres en negrita—, qué aviso destraba y
 *    su «Deshacer» con nombre. La tarjeta trae además su propio «Guardar en Recursos».
 *  - En el aviso, lo que no se usa a cada rato se fue a un menú «…» (ver detalle, ir a
 *    Recursos, «Listo»), y los datos, las OT y la sugerencia tienen cada uno su renglón.
 *  - De cuándo es la revisión y el «cambió algo en Recursos» ya no se dicen acá: los
 *    cuenta la cabecera de la pantalla (PlanningPreviewScreen), que es donde se mira el
 *    estado del plan entero. Acá eran un renglón gris más, encima de todo.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Bell, Check, CheckCircle2, ChevronDown, Clock, Cog, Crosshair, Info, Layers, Lightbulb, Loader2, MoreHorizontal, PauseCircle, RefreshCw, RotateCcw, Save, SlidersHorizontal, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { API_URL } from "@/config";
import {
    claveDeAjuste, descripcionDeAccion, estadoDeAjuste, etiquetaCortaDeAccion, objetivosConNombre, objetivosDeAjuste,
    type AccionDeSolucion, type AjusteDelPlan, type EstadoDeAjuste, type GuardadoSinRecalcular, type ObjetivoDeAccion,
} from "@/lib/ajustesPlan";
import { enlaceARecursos, enlaceDeLoHecho, pestaniaDe } from "@/lib/avisoEnRecursos";
import { rangosActuales, type RangosActuales } from "@/lib/huellaRecursos";
import { usePermisos } from "@/hooks/usePermisos";

/** Cuántos avisos se ven antes de "Ver los N que faltan". */
// Cuatro y no seis: con el mockup del 26/09/2026 cada tarjeta mide unos 150px —título
// grande, un renglón de datos y la franja de la sugerencia—, y con seis la tabla del plan
// quedaba abajo del pliegue en una pantalla de notebook. (Este comentario decía que seis
// «ocupan casi lo mismo que cuatro filas de las viejas»; era de la tarjeta compacta de
// antes y ya no era cierto con el valor que tenía.)
const VISIBLES = 4;

/**
 * La clave de `confirmando` para el «Guardar en Recursos» de la tarjeta de ajustes.
 *
 * Comparte el estado con los botones de cada aviso a propósito: hay UNA confirmación
 * abierta a la vez, y la lista nueva de un recálculo las cierra a todas (ver el efecto
 * que limpia `confirmando`). La de la tanda se cierra además cuando cambia lo que se
 * guardaría (ver `firmaDelLote`): marcar otro ajuste con el cartel abierto lo metía en la
 * tanda sin que nadie lo hubiera revisado. No se confunde con la de un aviso
 * —`${d.id}-${índice}`— porque ésas terminan en un número.
 */
const CLAVE_LOTE = "ajustes-del-plan:lote";

/** La sombra del mockup: apenas para despegar la tarjeta del gris, no para que flote. */
const SOMBRA = "shadow-[0_1px_2px_rgba(16,24,40,0.04)]";

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
 * La frase de un ajuste con los nombres de lo que toca en negrita.
 *
 * La frase la arma `descripcionDeAccion` y es la misma del botón de aplicar y del toast:
 * acá no se reescribe, sólo se le resaltan los nombres —la máquina, el proceso, el
 * rango—, que es lo que se busca al barrer la lista (así viene en el mockup de Julián,
 * 26/09/2026). A diferencia de los avisos, esta frase no trae `**` del backend: se arma
 * en el front, así que los nombres se buscan en el texto.
 *
 * Cada nombre se busca como palabra entera y los más largos primero, para que «OFICIAL»
 * no se coma la mitad de «OFICIAL CNC». El borde de palabra va como grupo y no como
 * lookbehind: el Safari de las tablets viejas del taller no entiende `(?<!…)` y la
 * expresión tumbaría el panel entero.
 */
function conNombresEnNegrita(texto: string, nombres: string[]) {
    const unicos = Array.from(new Set(nombres.map((n) => n.trim()).filter((n) => n.length > 1)))
        .sort((a, b) => b.length - a.length);
    if (unicos.length === 0) return texto;
    const alternativas = unicos.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const patron = new RegExp(`(^|[^\\p{L}\\p{N}])(${alternativas})(?=$|[^\\p{L}\\p{N}])`, "u");
    // Con dos grupos de captura, `split` deja: texto, borde, nombre, texto, borde, nombre…
    return texto.split(patron).map((parte, i) =>
        i % 3 === 2 ? <strong key={i} className="font-semibold text-gray-900">{parte}</strong> : parte
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
 * La insignia de cada tarjeta y el círculo de su izquierda (mockup del 26/09/2026).
 *
 * Reemplaza a la barra de color del borde: el mockup no la tiene y el color lo cargan
 * el círculo y la insignia, que además DICEN qué es. «Terceros» y no «Hoy», que es lo
 * que trae el mockup en ese lugar: «Hoy» es la etiqueta de un dato (lo que el recurso
 * tiene hoy), y como insignia se leía como «esto pasa hoy».
 *
 * Los `title` de Alta y Media son los de siempre: el criterio de severidad escrito, para
 * que nadie tenga que adivinar por qué uno es rojo y el otro no.
 */
const INSIGNIA = {
    listo: {
        texto: "Listo",
        icono: Check,
        circulo: "bg-emerald-50 text-emerald-600 ring-emerald-200",
        chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        title: "No hace falta tocar nada: es para tener en cuenta.",
    },
    terceros: {
        texto: "Terceros",
        icono: Check,
        circulo: "bg-blue-50 text-blue-600 ring-blue-200",
        chip: "bg-blue-50 text-blue-700 ring-blue-200",
        title: "Lo hace alguien de afuera: el plan solo le guarda el lugar en la secuencia.",
    },
    media: {
        texto: "Media",
        icono: Info,
        circulo: "bg-amber-50 text-amber-600 ring-amber-200",
        chip: "bg-amber-50 text-amber-800 ring-amber-200",
        title: "Media: recomendación para afinar. El plan sale igual con el aviso o sin él; lo que falta lo sabe el taller.",
    },
    alta: {
        texto: "Alta",
        icono: AlertTriangle,
        circulo: "bg-rose-50 text-rose-600 ring-rose-200",
        chip: "bg-rose-50 text-rose-700 ring-rose-200",
        title: "Alta: por esto algo del plan salió mal — trabajo sin recurso humano, recurso maquinaria sin reservar o trabajo que no entró en el período.",
    },
    // Una pausa no es un problema del plan: alguien la pidió. Ámbar como lo que "sale
    // igual", con el ícono de pausa que usa toda la app.
    pausa: {
        texto: "Pausa",
        icono: PauseCircle,
        circulo: "bg-amber-50 text-amber-600 ring-amber-200",
        chip: "bg-amber-50 text-amber-800 ring-amber-200",
        title: "Alguien la pausó a mano: no entra en el plan hasta que la reanuden.",
    },
} as const;

/** Cómo se nombra cada tipo de ajuste en su chip, en el idioma de Recursos. */
const TIPO_DE_AJUSTE: Record<AccionDeSolucion["tipo"], string> = {
    maquinaria: "Máquinas",
    proceso: "Procesos",
    skill_nativa: "Recurso humano",
};

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
    /**
     * Cuál de las causas de «pidió máquina y no la tuvo» es (`rango_maquina`,
     * `sin_maquina`, `sin_familia`…). La manda el backend desde el 17/09.
     */
    causa?: string;
    /**
     * Lo que suma `unificarPreparaciones` (lib/unificarAvisos) cuando un proceso y su
     * preparación son la misma traba: los pasos que junta el aviso (la producción
     * primero), los ids de los avisos que se tragó y el título que tenía solo.
     */
    pasos?: PasoDelAviso[];
    absorbidos?: string[];
    tituloPropio?: string;
}

/** Un paso de un aviso unificado: «Prensa · 2 procesos, 2 OT». */
export interface PasoDelAviso {
    nombre: string;
    procesos: number;
    ots: number[];
    minutos: number;
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
 * Una "solución" que no se puede hacer desde acá: sin botón, sin objetivo y sin
 * pantalla de Recursos a la que llevar. «La habilidad a mano no destraba esto…» o
 * «O planificá menos OTs juntas» son consejos, y dibujados con la llave de las
 * soluciones se leían como un arreglo más (Julián, 25/09/2026).
 */
const esNota = (sol: DiagnosticoSolucion) =>
    !accionAjustable(sol) && !sol.objetivo && !pestaniaDe(sol.donde);

/**
 * Un aviso que no pide hacer nada: no es Alta, no es una pausa y ninguna de sus
 * soluciones se puede aplicar (ni guardar en Recursos ni probar en este plan). Son el
 * cuello que «entra todo, pero por turnos» y el trabajo que «sale del taller, nada que
 * corregir». Julián, 26/09/2026: «más sencillo, en menos renglones, ocupando menos
 * espacio». Llevan la insignia «Listo» (o «Terceros») y, en vez de la franja de qué
 * hacer, una sugerencia en azul o en verde: la franja ámbar o roja es para lo que hay
 * que tocar.
 */
const esInformativo = (d: Diagnostico) =>
    d.severidad !== "bloqueante"
    && !esPausa(d)
    && !d.soluciones.some((s) => s.accion || accionAjustable(s));

/**
 * Sin la «O » con que el backend encadena la segunda opción en adelante
 * (`_como_alternativa`, y a mano en «O planificá menos OTs juntas»). Leída sola —la
 * primera de la franja, o una nota— era una alternativa a nada. Respeta los `**`.
 */
const sinOInicial = (texto: string) =>
    texto.replace(/^O\s+(\**)(\S)/, (_, negrita: string, c: string) => negrita + c.toUpperCase());

/**
 * Si `valor` ya se lee en `texto`, como palabra entera y sin importar mayúsculas.
 *
 * Los chips de la tarjeta repetían lo que decía la frase de arriba: en el cuello de
 * FRESADORA CNC «1 máquina» salía en el título, en el resumen y en el chip Hoy
 * (Julián, 25/09/2026). Se compara texto, así que si el backend cambia la frase el
 * chip simplemente vuelve: no se pierde nada. Un resumen que corta la lista
 * («oficial (y 2 más)») no la contiene entera y el chip queda, que es el que la trae
 * completa.
 */
function yaLoDice(texto: string | undefined, valor: string): boolean {
    if (!texto || !valor.trim()) return false;
    const escapado = valor.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapado}(?=$|[^\\p{L}\\p{N}])`, "iu").test(texto.replace(/\*\*/g, ""));
}

/**
 * El detalle sin la frase que el resumen ya dijo arriba.
 *
 * El cuello decía «Entra todo, pero por turnos: hay 1 máquina…» en el resumen y, al
 * abrir, otra vez «Entra todo, pero por turnos: mientras una pieza…». Se saca la
 * cabeza del resumen (hasta los dos puntos) si aparece en el detalle, y la palabra que
 * sigue arranca en mayúscula. Si no aparece, el detalle queda como vino.
 */
function sinLoQueYaDijo(detalle: string, resumen?: string): string {
    const i = resumen ? resumen.indexOf(":") : -1;
    if (!resumen || i <= 0) return detalle;
    const cabeza = resumen.slice(0, i + 1).trim().toLowerCase();
    const j = detalle.toLowerCase().indexOf(cabeza);
    if (j < 0) return detalle;
    const despues = detalle.slice(j + cabeza.length).replace(/^\s+/, "")
        .replace(/^(\**)(\S)/, (_, negrita: string, c: string) => negrita + c.toUpperCase());
    return detalle.slice(0, j) + despues;
}

/**
 * Las cosas que toca una acción, siempre como lista.
 *
 * Sin `objetivos` la acción toca una sola y los datos están sueltos en la raíz: es el
 * formato viejo, que sigue llegando de backends ya desplegados. Estaba escrito dos veces
 * en este archivo —en el cartel de confirmación y en el guardado— y ahora lo usan tres
 * lugares: una sola vez, acá.
 */
function objetivosDeLaAccion(accion: DiagnosticoAccion): ObjetivoDeAccion[] {
    return accion.objetivos?.length
        ? accion.objetivos
        : [{ id: accion.id, nombre: accion.nombre, rangos: accion.rangos }];
}

/**
 * Por qué una acción NO se puede guardar desde la tarjeta de ajustes, o null si se puede.
 *
 * Desde el 26/09/2026 la tarjeta guarda SUMANDO a lo que la máquina tiene hoy en Recursos
 * (ver `guardarAjustesEnRecursos`), así que lo que hace falta es saber qué le suma el aviso
 * a cada cosa, en ids: `suma_ids`. Hasta entonces esto pedía el conjunto FINAL (`rangos`)
 * y lo mandaba tal cual, pero ese conjunto queda congelado desde que se marca el ajuste
 * —recalcular le cambia el estado, no la acción— y el PUT, que reemplaza, borraba en
 * producción lo que alguien hubiera cargado después en esa máquina. Sin `suma_ids` no se
 * sabe qué sumar, y a propósito NO se cae al conjunto final (el tercer camino de
 * `rangosQueSuma` en lib/avisoEnRecursos): sería volver a mandar lo viejo.
 *
 *  - Las que se arman en pantalla con `accionDelObjetivo` —los avisos Media que no traen
 *    botón— no traen ni `suma`: sólo los rangos PROPUESTOS.
 *  - Las de avisos calculados antes del 23/09/2026 (un borrador viejo) traen `suma` en
 *    nombres pero no `suma_ids`, y recalcular no se los agrega.
 *
 * Las de habilidad (`skill_nativa`) no tienen ese problema —prenden o apagan una sola
 * cosa, no reemplazan un conjunto—, pero sí necesitan sus `objetivos`: sin ellos no se
 * sabe de qué persona es.
 */
function motivoSinLoQueSuma(accion: DiagnosticoAccion): string | null {
    const objetivos = accion.objetivos ?? [];
    if (accion.tipo === "skill_nativa") {
        return objetivos.length > 0 ? null : "es de un aviso viejo, que no dice de quién es: cargalo en Recursos";
    }
    if (objetivos.length === 0 || !objetivos.every((o) => Array.isArray(o.suma))) {
        return "se arma con lo que propone el aviso: cargalo en Recursos";
    }
    if (!objetivos.every((o) => Array.isArray(o.suma_ids))) {
        return "es de un aviso viejo, que no dice qué le suma: cargalo en Recursos";
    }
    return null;
}

/**
 * Si la acción dice qué le suma a cada cosa que toca (`suma_ids`): entonces se guarda
 * sumándolo a lo que Recursos tiene HOY, y no mandando su conjunto final.
 */
const sumaALoQueHay = (accion: DiagnosticoAccion): boolean =>
    accion.tipo !== "skill_nativa"
    && (accion.objetivos?.length ?? 0) > 0
    && (accion.objetivos ?? []).every((o) => Array.isArray(o.suma_ids));

/** Lo que tiene hoy una máquina o un proceso, según lo que se acaba de leer de Recursos. */
const loQueTieneHoy = (hoy: RangosActuales, tipo: DiagnosticoAccion["tipo"], id: number): Set<number> =>
    (tipo === "proceso" ? hoy.procesos : hoy.maquinarias).get(id) ?? new Set<number>();

/**
 * Lo que se manda al guardar: lo que tiene hoy MÁS lo que suma el aviso, nunca menos.
 * `agrega` es lo que de verdad cambia: vacío, no hace falta mandar nada (ya lo tiene, o
 * el aviso no le cambiaba nada). Ordenado, como `payloadDeAjustes`, para que dos
 * guardados iguales manden el mismo cuerpo.
 */
function sumandoALoDeHoy(hoy: Set<number>, sumaIds: number[]): { final: number[]; agrega: number[] } {
    const agrega = Array.from(new Set(sumaIds)).filter((id) => !hoy.has(id)).sort((a, b) => a - b);
    const final = Array.from(new Set([...hoy, ...sumaIds])).sort((a, b) => a - b);
    return { final, agrega };
}

/** Lo que se dice cuando el servidor no contesta a tiempo un guardado. */
const SIN_RESPUESTA =
    "El servidor no contestó en 20 segundos (puede estar ocupado con otro cálculo). Fijate en Recursos si quedó guardado antes de volver a tocar.";

/**
 * Lo que se dice cuando no se pudo leer qué tiene hoy Recursos. Distinto de
 * `SIN_RESPUESTA` a propósito: acá se sabe que NO salió ningún PUT, y mandar a revisar
 * Recursos «por si quedó guardado» sería mandar a buscar algo que no pasó.
 */
const SIN_LEER =
    "No pude leer qué tiene hoy Recursos, así que no guardé nada: sin eso podía borrar lo que alguien cargó. Probá de nuevo en un rato.";

/** Las cabeceras de un guardado: JSON y el token, si se puede leer. */
function cabecerasDeGuardado(): Record<string, string> {
    let token: string | null = null;
    try {
        token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    } catch {
        // Sin acceso al almacenamiento (una ventana privada estricta) el PUT sale sin
        // token, el backend contesta 401 y eso se cuenta como falla: nada queda a medias.
    }
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

/** A dónde va el PUT de una de las cosas que toca una acción. */
function urlDelObjetivo(tipo: DiagnosticoAccion["tipo"], accionId: number, objetivoId: number): string {
    const base = API_URL.replace(/\/$/, "");
    return tipo === "proceso" ? `${base}/procesos/${objetivoId}/rangos`
        : tipo === "maquinaria" ? `${base}/maquinarias/${objetivoId}/rangos`
            // skill_nativa: el objetivo es el operario y el proceso va en la ruta.
            : `${base}/operarios/${objetivoId}/skills-nativas/${accionId}/estado`;
}

/**
 * Un PUT a Recursos. No tira: dice cómo salió.
 *
 * Con tope de 20 segundos. Sin tope, un PUT colgado —el pooler tiene 15 conexiones y un
 * recálculo de 4 minutos se queda con una— dejaba `aplicando` puesto, y eso apaga TODOS
 * los «Guardar en Recursos» del panel hasta recargar la página: botones que parecían
 * muertos.
 */
async function guardarObjetivo(
    url: string,
    cuerpo: { rangos: number[] } | { habilitado: boolean },
    cabeceras: Record<string, string>,
): Promise<"ok" | "falla" | "sin-respuesta"> {
    try {
        const r = await fetch(url, {
            method: "PUT",
            headers: cabeceras,
            body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(20000),
        });
        return r.ok ? "ok" : "falla";
    } catch (e) {
        return e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError") ? "sin-respuesta" : "falla";
    }
}

/**
 * Manda a Recursos lo que dice la acción de UN aviso: un PUT por cada cosa que toca. No
 * tira: cuenta.
 *
 * La usa el «Guardar en Recursos» de cada aviso. La tarjeta de ajustes guarda de a tanda y
 * junta los ajustes por máquina (`guardarAjustesEnRecursos`), pero con las mismas piezas
 * —`rangosActuales`, `sumandoALoDeHoy`, `guardarObjetivo`—: la red, los tiempos y el
 * recuento de fallas tienen que ser los mismos para los dos, o el día que se arregle uno el
 * otro queda con el bug. Cada botón decide después qué decir con el resultado.
 *
 * Si la acción dice qué suma (`suma_ids`), parte de lo que Recursos tiene HOY y le suma
 * eso (26/09/2026). El conjunto final de la acción se armó en el último cálculo: si
 * después alguien cargó algo en esa máquina —otra pestaña, otra persona— el PUT, que
 * reemplaza, se lo borraba. Lo que ya tiene no se manda (`yaEstaban`), y si no se puede
 * leer no sale ningún PUT a ciegas (`sinLeer`). Las acciones de backends viejos, sin
 * `suma_ids`, mandan su conjunto final como siempre: es el del último cálculo, y sin
 * saber qué suma no hay otra cosa que mandar.
 */
async function guardarAccionEnRecursos(
    accion: DiagnosticoAccion,
): Promise<{ total: number; fallidos: string[]; clavesFallidas: string[]; sinRespuesta: number; yaEstaban: string[]; sinLeer: boolean }> {
    const cabeceras = cabecerasDeGuardado();

    // Una solución puede tocar varias cosas (las tres soldadoras MIG, los dos
    // pasantes). Sin `objetivos` es una sola: el formato viejo.
    const objetivos = objetivosDeLaAccion(accion);
    // Las de `objetivosDeAjuste`, en el mismo orden: con eso se recorta la acción a lo
    // que entró cuando sale a medias (ver `recortada`).
    const claves = objetivosDeAjuste(accion);

    let hoy: RangosActuales | null = null;
    if (sumaALoQueHay(accion)) {
        hoy = await rangosActuales();
        if (!hoy) {
            return { total: objetivos.length, fallidos: objetivos.map((o) => o.nombre), clavesFallidas: claves, sinRespuesta: 0, yaEstaban: [], sinLeer: true };
        }
    }

    // En serie y no en paralelo: son pocos y así, si el tercero falla, los dos
    // primeros ya quedaron aplicados y el reintento no los pisa de nuevo.
    const fallidos: string[] = [];
    const clavesFallidas: string[] = [];
    const yaEstaban: string[] = [];
    let sinRespuesta = 0;
    for (const [i, o] of objetivos.entries()) {
        let cuerpo: { rangos: number[] } | { habilitado: boolean };
        if (accion.tipo === "skill_nativa") {
            cuerpo = { habilitado: accion.habilitado ?? true };
        } else if (hoy) {
            const { final, agrega } = sumandoALoDeHoy(loQueTieneHoy(hoy, accion.tipo, o.id), o.suma_ids ?? []);
            if (agrega.length === 0) {
                yaEstaban.push(o.nombre);
                continue;
            }
            cuerpo = { rangos: final };
        } else {
            cuerpo = { rangos: o.rangos ?? accion.rangos ?? [] };
        }
        const r = await guardarObjetivo(urlDelObjetivo(accion.tipo, accion.id, o.id), cuerpo, cabeceras);
        if (r !== "ok") {
            fallidos.push(o.nombre);
            clavesFallidas.push(claves[i]);
            if (r === "sin-respuesta") sinRespuesta += 1;
        }
    }
    // `total` son los PUT que salieron: lo que ya estaba no cuenta ni como guardado ni
    // como falla.
    return { total: objetivos.length - yaEstaban.length, fallidos, clavesFallidas, sinRespuesta, yaEstaban, sinLeer: false };
}

/**
 * La acción con sólo lo que SÍ quedó en Recursos, para anotar un guardado a medias
 * (26/09/2026).
 *
 * Anotada entera, la pantalla daba por guardada también la máquina que falló: la
 * nombraba en «Guardado en Recursos», apagaba sus botones con «Ya guardaste un cambio
 * en …: recalculá primero» aunque ahí no se había escrito nada, y daba de baja los
 * ajustes que la tocaban. Lo que ya tenía el dato (`yaEstaban`) cuenta como que entró:
 * está en Recursos. `fallaron` va en las claves de `objetivosDeAjuste`.
 */
function recortada(accion: DiagnosticoAccion, fallaron: ReadonlySet<string>): DiagnosticoAccion {
    const claves = objetivosDeAjuste(accion);
    return { ...accion, objetivos: objetivosDeLaAccion(accion).filter((_, i) => !fallaron.has(claves[i])) };
}

/** La línea del cartel para una habilidad: igual en el botón de un aviso y en la tanda. */
function lineaDeHabilidad(accion: DiagnosticoAccion, persona: string) {
    return (
        <>
            A <strong>{persona}</strong>{" "}
            {accion.habilitado === false ? "le apago" : "le vuelvo a encender"}{" "}
            <strong>{accion.nombre}</strong> en su ficha.
        </>
    );
}

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
 *
 * Es el cartel del botón de UN aviso. El de la tarjeta de ajustes es `ResumenDelLote`: el
 * 26/09/2026 éste recibió por un rato la lista de acciones de la tanda, pero su «hoy
 * tiene» es lo que había cuando se calculó el aviso —en un ajuste, a veces un borrador
 * de ayer—, y la tanda tiene que decir lo que hay AHORA y juntar lo que le suman varios
 * ajustes a la misma máquina en una sola línea.
 */
function ResumenDelCambio({ accion }: { accion: DiagnosticoAccion }) {
    const linea = (o: ObjetivoDeAccion) => {
        if (accion.tipo === "skill_nativa") return lineaDeHabilidad(accion, o.nombre);
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
        <div className="border-t border-amber-200 bg-amber-50/70 px-4 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                Esto es lo que va a cambiar
            </p>
            <ul className="mt-1 space-y-0.5">
                {objetivosDeLaAccion(accion).map((o) => (
                    <li key={`${accion.tipo}-${o.id}`} className="text-[12.5px] leading-snug text-amber-950">
                        · {linea(o)}
                    </li>
                ))}
            </ul>
            {/* La frase tiene que decir el ALCANCE, no el mecanismo: desde que hay un
                botón que aplica lo mismo sin guardar nada, lo único que distingue a
                este es que el dato queda para todos los planes que vengan. */}
            <p className="mt-1 text-[11.5px] text-amber-800/80">
                Queda guardado en Recursos para <strong>todos</strong> los planes, no solo para
                este. Se puede volver a cambiar desde Recursos cuando quieras.
            </p>
        </div>
    );
}

/**
 * Una cosa que toca la tanda de la tarjeta de ajustes, con lo que le suman TODOS los
 * ajustes de la tanda que la tocan (ver `guardarAjustesEnRecursos`).
 */
type ObjetivoDelLote = {
    /** La de `objetivosDeAjuste`: «maquinaria:12», «proceso:5», «skill_nativa:operario:proceso». */
    clave: string;
    id: number;
    nombre: string;
    /** De dónde sale: el tipo y, en una habilidad, qué proceso y si se prende o se apaga. */
    accion: DiagnosticoAccion;
    /** Lo que le suman, junto y sin repetir. Vacío en una habilidad. */
    sumaIds: number[];
};

/**
 * Lo que el cartel de la tanda leyó de Recursos al abrirse: leyendo, no se pudo, o lo que
 * tiene hoy cada máquina y cada proceso. `null` cuando la tanda no toca rangos (sólo
 * habilidades) y no hace falta leer nada.
 */
type LecturaDelLote = "leyendo" | "error" | RangosActuales | null;

/**
 * El cartel de la tanda: qué cambia en cada máquina, proceso o persona, dicho con lo que
 * Recursos tiene AHORA.
 *
 * Una línea por cosa y no por ajuste (26/09/2026): dos ajustes sobre FRESADORA CNC se
 * guardan con un solo PUT que suma los dos, y dos líneas sueltas sobre la misma máquina
 * se leían como dos cambios que se podían pisar.
 *
 * El «hoy tiene» sale de una lectura de Recursos hecha al abrir el cartel, no del aviso:
 * el del aviso es de cuando se calculó, y hasta el 26/09/2026 este cartel mostraba eso y
 * decía «si alguien lo cambió después, recalculá antes de guardar», que no servía —el
 * recálculo no le rearma la acción a un ajuste—. Mientras lee, o si no pudo, se dice qué
 * se suma sin inventar lo que hay.
 */
function ResumenDelLote({
    objetivos,
    lectura,
    nombreDelRango,
    onReintentar,
}: {
    objetivos: ObjetivoDelLote[];
    lectura: LecturaDelLote;
    nombreDelRango: (id: number) => string;
    onReintentar: () => void;
}) {
    const nombres = (ids: number[], conY = false) => {
        const lista = ids.map(nombreDelRango);
        return conY && lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}` : lista.join(", ");
    };
    const linea = (o: ObjetivoDelLote) => {
        if (o.accion.tipo === "skill_nativa") return lineaDeHabilidad(o.accion, o.nombre);
        const que = o.accion.tipo === "proceso" ? "Al proceso" : "A";
        // El aviso no le suma nada: no hace falta saber qué tiene para decirlo.
        if (o.sumaIds.length === 0) return <>{que} <strong>{o.nombre}</strong> no le cambia nada.</>;
        if (lectura === null || lectura === "leyendo" || lectura === "error") {
            return <>{que} <strong>{o.nombre}</strong> le agrego <strong>{nombres(o.sumaIds, true)}</strong></>;
        }
        const hoy = loQueTieneHoy(lectura, o.accion.tipo, o.id);
        const { agrega } = sumandoALoDeHoy(hoy, o.sumaIds);
        if (agrega.length === 0) {
            return (
                <>
                    {que} <strong>{o.nombre}</strong> no le cambia nada: ya tiene <strong>{nombres(o.sumaIds)}</strong>.
                </>
            );
        }
        const tiene = Array.from(hoy).sort((a, b) => a - b);
        return (
            <>
                {que} <strong>{o.nombre}</strong> le agrego <strong>{nombres(agrega, true)}</strong>
                <span className="text-amber-800/70">
                    {tiene.length > 0 ? ` (hoy tiene ${nombres(tiene)})` : " (hoy no tiene ninguno)"}
                </span>
            </>
        );
    };
    const tocaRangos = objetivos.some((o) => o.accion.tipo !== "skill_nativa");

    return (
        <div className="border-t border-amber-200 bg-amber-50/70 px-4 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                Esto es lo que va a cambiar
            </p>
            <ul className="mt-1 space-y-0.5">
                {objetivos.map((o) => (
                    <li key={o.clave} className="text-[12.5px] leading-snug text-amber-950">
                        · {linea(o)}
                    </li>
                ))}
            </ul>
            {lectura === "leyendo" && (
                <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-amber-800/80">
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    Fijándome qué tiene hoy Recursos…
                </p>
            )}
            {/* Sin la lectura no se guarda (el «Sí» queda apagado): sin saber qué hay, el
                PUT podía borrar lo que alguien cargó. Se ofrece volver a probar acá mismo,
                sin cerrar el cartel. */}
            {lectura === "error" && (
                <p className="mt-1 text-[11.5px] leading-snug text-amber-900">
                    No pude leer qué tiene hoy Recursos, y sin eso no guardo nada.{" "}
                    <button
                        type="button"
                        onClick={onReintentar}
                        className="font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
                    >
                        Probar de nuevo
                    </button>
                </p>
            )}
            {/* El alcance, igual que en el cartel de un aviso, y además cómo se guarda: se
                SUMA a lo que haya en ese momento, así que un cambio que otro haga mientras
                tanto no se pierde. */}
            <p className="mt-1 text-[11.5px] text-amber-800/80">
                {tocaRangos
                    ? <>Se suma a lo que tenga cada máquina o proceso en Recursos al guardar, y no se le saca nada. </>
                    : null}
                Queda guardado en Recursos para <strong>todos</strong> los planes, no solo para este.
            </p>
        </div>
    );
}

/**
 * El menú «…» de cada aviso: lo que no se usa a cada rato.
 *
 * El mockup del 26/09/2026 saca de la franja el «Listo» y el «Ver en Recursos», que
 * ocupaban lugar en TODAS las tarjetas para algo que se toca de vez en cuando, y los
 * pone acá junto con abrir el detalle. El «Listo» sigue sin ser verde lleno por lo de
 * siempre: el verde lleno es lo que toca la base, y esto no cambia nada —baja el aviso
 * a «Resueltos» y se deshace—. En el detalle abierto también está, escrito entero.
 *
 * Tiene estado propio (abierto/cerrado) para poder cerrarse al elegir: un Popover de
 * Radix sin controlar se queda abierto después del click, y el «Listo» se llevaría la
 * tarjeta con el menú flotando en el aire.
 *
 * `titulo` es el del aviso, para nombrar lo que se toca (ver los `aria-label`).
 */
function MenuDelAviso({
    titulo,
    abierto,
    onDetalle,
    enlace,
    onListo,
}: {
    titulo: string;
    abierto: boolean;
    onDetalle: () => void;
    enlace: string | null;
    onListo: () => void;
}) {
    const [open, setOpen] = useState(false);
    const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-gray-700 transition-colors hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none";
    return (
        <Popover open={open} onOpenChange={setOpen}>
            {/* El título del aviso va en los `aria-label` y no en el `title`: el globito
                no necesita repetir el título que está al lado (como en
                MateriasPrimasOTFila), pero el lector de pantalla sí. El menú se abre en un
                portal, lejos de la tarjeta: sin el título, cuatro «Más acciones» iguales no
                dicen de qué aviso son, y el «Listo» —que antes estaba en la franja con su
                propio «Listo, no mostrar más: {título}»— marcaba sin decir cuál. */}
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Más acciones de: ${titulo}`}
                    title="Más acciones"
                    className="-my-1 -mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 data-[state=open]:bg-gray-100 data-[state=open]:text-gray-700"
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" collisionPadding={16} className="w-60 p-1" aria-label={`Acciones de: ${titulo}`}>
                <button
                    type="button"
                    className={item}
                    onClick={() => {
                        setOpen(false);
                        onDetalle();
                    }}
                >
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform", abierto && "rotate-180")} />
                    {abierto ? "Ocultar detalle" : "Ver detalle"}
                </button>
                {enlace && (
                    <a
                        href={enlace}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={item}
                        onClick={() => setOpen(false)}
                        title="Se abre en otra pestaña, ya parado en lo que hay que tocar"
                    >
                        {/* Sin «↗» en el texto: el ícono ya dice que abre otra pestaña, y
                            con los dos se leía «↗ Ver en Recursos ↗». */}
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        Ver en Recursos
                    </a>
                )}
                <div className="my-1 h-px bg-gray-100" />
                <button
                    type="button"
                    className={item}
                    onClick={() => {
                        setOpen(false);
                        onListo();
                    }}
                    title="No cambia el plan ni los datos: lo pasa a «Resueltos», abajo de la lista. Se deshace."
                    aria-label={`Listo, no mostrar más: ${titulo}`}
                >
                    <Check className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    Listo, no lo muestres más
                </button>
            </PopoverContent>
        </Popover>
    );
}

export function DiagnosticosPlan({
    diagnosticos,
    onResuelto,
    onRevisar,
    revisando = false,
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
    guardadosSinRecalcular = [],
    pendientes = 0,
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
     *
     * El «Guardar en Recursos» de la tarjeta de ajustes la llama una vez por cada
     * ajuste que guardó, todas seguidas al terminar la tanda y con `{ enLote: true }`
     * (ver `guardarAjustesEnRecursos`). Con `enLote` la pantalla no tira su propio
     * toast: lo que salió, y lo que se dio de baja de rebote, lo cuenta el único toast
     * del panel. Sin eso eran N+1 carteles apilados diciendo casi lo mismo. Y como son
     * llamadas seguidas, sin un render en el medio, la pantalla tiene que actualizar su
     * lista con updaters (`setAjustesDelPlan(prev => …)`): si no, cada una partiría de
     * la misma lista vieja y desharía la anterior.
     *
     * Un guardado que sale a medias (26/09/2026) manda sólo lo que se escribió de verdad
     * —en el botón de un aviso, la acción recortada a lo que entró; en la tanda, nada por
     * ese ajuste— y en `conservar` las claves de los ajustes que quedaron a medias, para
     * que la pantalla no los dé de baja: lo que les falló sigue sólo en ellos.
     */
    onResuelto?: (accionAplicada?: AccionDeSolucion, titulo?: string, opciones?: { enLote?: boolean; conservar?: string[] }) => void;
    /**
     * Volver a calcular para ver si lo que se arregló afuera (en Recursos) ya está.
     *
     * Los diagnósticos son una foto del momento del cálculo: si vas a Recursos,
     * cargás el rango que te pedía y volvés, el aviso sigue ahí igual de rojo
     * aunque el problema ya no exista. Peor con un borrador retomado, que puede ser
     * de ayer. No se puede revalidar sin recalcular —el diagnóstico se construye
     * con lo que el solver realmente hizo—, así que esto recalcula.
     *
     * Desde el 26/09/2026 se dibuja neutro y dice siempre «Volver a revisar». Hasta
     * entonces, con cambios marcados, se pintaba de ámbar y decía «Recalcular (N)»; pero
     * el botón fuerte de recalcular es el naranja del pie de la pantalla, y dos botones
     * gritando lo mismo se leían como dos acciones distintas. Con cambios marcados lo
     * cuenta el `title`.
     */
    onRevisar?: () => void;
    revisando?: boolean;
    // `calculadoEn` y `revisionAuto` vivían acá hasta el 26/09/2026 para dibujar el
    // renglón gris «Revisión del plan hace X…». Ese estado es del plan entero, no de los
    // avisos, y lo cuenta ahora la cabecera de la pantalla (PlanningPreviewScreen).
    /**
     * Plegado controlado desde la pantalla.
     *
     * Desplegado el panel se come buena parte de la pantalla arriba de la tabla del
     * plan. Quién decide si arranca plegado es el padre, porque es el único que sabe si
     * el plan tiene trabas sin resolver (con trabas no se pliega) y el único que
     * necesita poder abrirlo desde la cifra "Trabas sin resolver". Sin estas
     * props el componente sigue andando con su estado propio.
     *
     * Plegado queda SOLO la tarjeta del resumen, en un renglón. Que hay ajustes lo
     * recuerda la pastilla «Ajustes del plan» de la cabecera de la pantalla.
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
     * saca de la lista de pendientes y lo pasa a la tarjeta verde de resueltos, del
     * todo reversible. El recálculo manda: si el problema sigue, vuelve a la lista.
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
    /**
     * Lo que se guardó en Recursos desde acá y el plan todavía no tiene (no se
     * recalcula al guardar desde el 25/09/2026). Sirve para frenar un segundo
     * guardado sobre la misma máquina o proceso: las dos acciones se armaron contra
     * la base de ANTES y el PUT reemplaza el conjunto, así que el segundo borraría lo
     * que acaba de guardar el primero. Con «Solo en este plan» pasa lo mismo en
     * memoria: el ajuste reemplaza lo de la base y el plan saldría sin lo guardado.
     */
    guardadosSinRecalcular?: GuardadoSinRecalcular[];
    /**
     * Cuántos cambios marcados no tiene todavía el plan. Desde el 26/09/2026 sólo se
     * nombra en el `title` de «Volver a revisar» (ver `onRevisar`): los cuentan el botón
     * naranja del pie de la pantalla («Recalcular con N cambios») y el aviso de Confirmar.
     * El cartel naranja que los repetía arriba de los avisos se sacó ese mismo día.
     */
    pendientes?: number;
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
    //
    // Con el estado de cada uno (25/09/2026): marcado y sin recalcular, ya en el plan,
    // o saliendo en el próximo recálculo. Cada uno pinta el botón distinto.
    const estadoPorClave = new Map<string, EstadoDeAjuste>(ajustes.map((a) => [a.clave, estadoDeAjuste(a)]));
    const clavesAjustadas = new Set(estadoPorClave.keys());
    /**
     * Si alguno de los caminos de este aviso está en el plan que acaba de llegar.
     *
     * Lo mira el efecto de los resueltos, que corre ANTES de que la pantalla pase lo
     * enviado a «calculado» (el efecto del hijo corre primero). En ese momento los
     * «por agregar» ya viajaron y los «por quitar» no: por eso cuentan todos menos
     * esos. Sin los «por agregar», un aviso destrabado por un ajuste salía como «Se
     * arregló», afirmando algo que no se guardó.
     */
    const tieneAjuste = (d: Diagnostico) =>
        d.soluciones.some((s) => {
            const accion = accionAjustable(s);
            if (!accion) return false;
            const estado = estadoPorClave.get(claveDeAjuste(accion));
            return !!estado && estado !== "por-quitar";
        });
    /**
     * Qué máquina o proceso tiene un guardado sin recalcular, con su nombre, para
     * apagar los botones que lo pisarían y decir por qué.
     */
    const guardadoEn = new Map<string, string>();
    for (const g of guardadosSinRecalcular) {
        for (const o of objetivosConNombre(g.accion)) guardadoEn.set(o.clave, o.nombre);
    }
    /** El nombre de lo que ya se guardó y esta acción tocaría, o null si no pisa nada. */
    const pisaUnGuardado = (accion: AccionDeSolucion | null | undefined): string | null => {
        if (!accion || guardadoEn.size === 0) return null;
        for (const o of objetivosDeAjuste(accion)) {
            const nombre = guardadoEn.get(o);
            if (nombre) return nombre;
        }
        return null;
    };
    const motivoPisa = (nombre: string) => `Ya guardaste un cambio en ${nombre}: recalculá primero`;
    /**
     * Si un ajuste que sale al recalcular sale porque SE GUARDÓ ÉL en Recursos, y no
     * porque otro guardado le pisó la máquina (26/09/2026).
     *
     * Se separa identidad de choque: `pisaUnGuardado` mira la máquina, y un ajuste recién
     * guardado desde la tarjeta toca justo la máquina que se guardó, así que para ella
     * era «un ajuste pisado» más. La tarjeta seguía diciendo «Esto no quedó guardado en
     * Recursos… cargalo en Recursos» sobre lo que el toast acababa de dar por guardado,
     * y ofrecía «Dejarlo», que lo volvía a poner como ajuste temporal encima. Por
     * identidad se puede: `a.clave` sale siempre de `claveDeAjuste(a.accion)` y la tanda
     * le pasa `a.accion` tal cual a la pantalla, que la anota en `guardadosSinRecalcular`.
     */
    const clavesGuardadas = new Set(guardadosSinRecalcular.map((g) => claveDeAjuste(g.accion)));
    const yaGuardado = (a: AjusteDelPlan) => estadoDeAjuste(a) === "por-quitar" && clavesGuardadas.has(a.clave);
    /**
     * Los ajustes, mirados desde el efecto de los resueltos sin ser dependencia suya.
     *
     * Ese efecto corre cuando cambian los diagnósticos, no cuando cambian los
     * ajustes: meterlos en las dependencias lo haría recalcular de gusto cada vez
     * que alguien aplica o deshace uno, y esa función ACUMULA estado (los resueltos
     * de recálculos anteriores), así que correrla de más no es gratis.
     */
    const tieneAjusteRef = useRef(tieneAjuste);
    tieneAjusteRef.current = tieneAjuste;
    /**
     * `onResuelto` visto desde un guardado que terminó, y no el del render del click.
     *
     * Guardar tarda (un PUT por cosa, hasta 20 segundos cada uno) y lo que la pantalla
     * haga al anotar lo guardado —el toast, qué cuenta— tiene que partir de su estado de
     * AHORA, no del render del click: un ajuste que alguien tocó mientras tanto se perdía
     * al anotar. La lista de ajustes, además, la actualiza con updaters: la tarjeta de
     * ajustes avisa todos sus guardados seguidos, sin un render en el medio, y con la
     * lista del render cada aviso deshacía el anterior.
     */
    const onResueltoRef = useRef(onResuelto);
    onResueltoRef.current = onResuelto;
    /** Los ajustes de ahora, para contar al final de una tanda lo que se dio de baja. */
    const ajustesRef = useRef(ajustes);
    ajustesRef.current = ajustes;

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
    // En el orden en que se ven, para que la tarjeta verde no baraje de nuevo.
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
     * Los avisos que se guardaron en Recursos y, después de recalcular, siguen: el
     * botón vuelve a «Guardar en Recursos» (ver el efecto de los resueltos) y la
     * tarjeta dice que ya se guardó, para que nadie crea que el click no anduvo.
     */
    const [siguenTrasGuardar, setSiguenTrasGuardar] = useState<Set<string>>(new Set());
    /**
     * Los ajustes que se guardaron a medias, con lo que les falta: clave del ajuste →
     * nombres de lo que no entró (26/09/2026).
     *
     * El ajuste a medias se queda en la tarjeta como estaba (ver `guardarAjustesEnRecursos`)
     * y hasta ese día lo único que decía que una máquina había fallado era un toast que se
     * iba. Lo carga la tanda y el botón de un aviso cuya acción es la de un ajuste; se
     * borra cuando ese ajuste se guarda entero o se va de la tarjeta.
     *
     * No se limpia al recalcular, a propósito: el recálculo no guarda nada, y lo que
     * faltaba sigue faltando mientras el ajuste esté.
     */
    const [aMediasPorClave, setAMediasPorClave] = useState<Map<string, string[]>>(() => new Map());
    const firmaDeClaves = ajustes.map((a) => a.clave).join("\n");
    useEffect(() => {
        const vivas = new Set(firmaDeClaves ? firmaDeClaves.split("\n") : []);
        setAMediasPorClave((prev) => {
            if ([...prev.keys()].every((k) => vivas.has(k))) return prev;
            return new Map([...prev].filter(([k]) => vivas.has(k)));
        });
    }, [firmaDeClaves]);
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
     * Botón en dos pasos: el primer click muestra el cambio; aplica el botón del cartel
     * («Sí, aplicalo»), no un segundo click en el mismo botón.
     *
     * Estos cambios tocan quién puede usar una máquina — el 18/08 un cambio así,
     * hecho sin preguntar, abrió la PLEGADORA de 1 persona a 10 y hubo que
     * revertirlo. Un click de más es barato al lado de eso, y el paso intermedio
     * es donde se lee el "ojo, esto la habilita para N personas".
     *
     * Hasta el 26/09/2026 el segundo click en el mismo botón aplicaba: el botón no se
     * movía al armarse, así que un doble click (o dos Enter) guardaba en producción sin
     * que nadie hubiera leído el cartel. Ahora el botón sólo arma, y volver a tocarlo
     * no hace nada; el cartel se cierra con su «Cancelar» o con la lista nueva.
     *
     * Vale igual para el «Guardar en Recursos» de la tarjeta de ajustes (`CLAVE_LOTE`).
     */
    const [confirmando, setConfirmando] = useState<string | null>(null);


    /**
     * Aplicar la solución SOLO a este cálculo, o sacarla si ya estaba aplicada.
     *
     * De un click y sin confirmar, al revés que el botón que guarda en Recursos. No
     * es descuido: este no escribe absolutamente nada —el dato viaja con el pedido al
     * solver y muere ahí—, se ve en la tarjeta de ajustes y se deshace con un botón. La
     * confirmación en dos pasos existe para lo que NO se puede deshacer de un click,
     * y pedirla también acá haría que los dos caminos se sintieran igual de pesados,
     * que es justo lo contrario de lo que hay que transmitir.
     */
    const aplicarSoloEstePlan = (d: Diagnostico, clave: string, accion: AccionDeSolucion) => {
        // Ya no recalcula (25/09/2026): poner y sacar sólo lo marcan, y el recálculo se
        // pide una vez con el botón del pie. Tocarlo de nuevo lo desmarca, o revierte
        // el «se saca al recalcular» (ver `quitarAjusteDelPlan` en la pantalla).
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
    // Las guardadas, vistas desde el efecto de abajo sin ser dependencia suya.
    const aplicadasRef = useRef(aplicadas);
    aplicadasRef.current = aplicadas;

    useEffect(() => {
        const ahora = new Set(todos.map((d) => d.id));
        const antes = previos.current;
        setResueltos((prev) => {
            // Un aviso que VUELVE deja de estar resuelto. Sin esto se quedaba en la
            // tarjeta verde para siempre: la pantalla lo mostraba tachado ahí Y rojo en
            // la lista al mismo tiempo, o sea la tarjeta verde mentía justo sobre lo único
            // que tiene que decir. Es la misma limpieza que ya se le hacía a
            // `marcados` unas líneas más abajo, que al escribirla se pasó por alto acá.
            const siguen = prev.filter((d) => !ahora.has(d.id));

            // Los que se acaban de ir. En el primer render no hay nada resuelto: hay
            // un plan recién calculado, y `antes` está vacío.
            //
            // Los que destrabó un ajuste de "solo en este plan" NO entran acá: se
            // fueron de la lista igual que los otros, pero decir "Resuelto" y ofrecer
            // "Ver cómo quedó" apuntando a Recursos sería afirmar que se guardó algo
            // que no se guardó. Esos ya se cuentan, con su nombre, en la tarjeta de
            // ajustes («Destraba: …»), que además es la única que se puede deshacer.
            const yaEstan = new Set(siguen.map((d) => d.id));
            const recien = antes
                .filter((d) => !ahora.has(d.id) && !yaEstan.has(d.id) && !tieneAjusteRef.current(d))
                // Un aviso unificado («Prensa y su preparación») que se fue mientras su
                // preparación volvió sola: se arregló Prensa, no las dos. Con el título
                // unificado la tarjeta verde decía que se había arreglado algo que sigue
                // en la lista.
                .map((d) =>
                    d.tituloPropio && d.absorbidos?.some((id) => ahora.has(id))
                        ? { ...d, titulo: d.tituloPropio, pasos: undefined, absorbidos: undefined }
                        : d
                );

            // Se ACUMULAN entre recálculos. Antes cada cálculo pisaba la lista con los
            // de esa vuelta, así que arreglar dos cosas de a una dejaba ver sólo la
            // segunda: la primera desaparecía sin que nadie la hubiera cerrado.
            if (recien.length === 0 && siguen.length === prev.length) return prev;
            return [...recien, ...siguen];
        });
        previos.current = todos;

        // «Guardado» se suelta en los avisos que SIGUEN después de recalcular.
        //
        // La lista nueva de avisos sólo llega con un recálculo, y el recálculo ya salió
        // con lo guardado: si el aviso sigue, el guardado no alcanzó y el botón tiene que
        // volver a andar. Antes la marca no se limpiaba nunca y el botón quedaba
        // «Guardado», apagado para siempre; como la clave es `${aviso}-${índice}` y el
        // índice se corre entre recálculos, podía quedar así arriba de otra solución.
        // Las de avisos que se fueron se quedan: son las que usa «Se aplicó» de la
        // tarjeta verde.
        const idDe = (k: string) => k.slice(0, k.lastIndexOf("-"));
        const guardadasQueSiguen = [...aplicadasRef.current].filter((k) => ahora.has(idDe(k)));
        if (guardadasQueSiguen.length > 0) {
            setAplicadas((prev) => new Set([...prev].filter((k) => !ahora.has(idDe(k)))));
        }
        setSiguenTrasGuardar((prev) => {
            const siguen = new Set([...prev].filter((id) => ahora.has(id)));
            guardadasQueSiguen.forEach((k) => siguen.add(idDe(k)));
            return siguen.size === prev.size && [...siguen].every((id) => prev.has(id)) ? prev : siguen;
        });

        // Las marcas a mano de avisos que ya no están se tiran: el recálculo dijo
        // que el problema no existe más, así que ya lo cuenta la tarjeta verde. Sin
        // esto la marca queda pegada al id y, si el mismo aviso vuelve dentro de un
        // rato, vuelve ya tachado y sin que nadie lo haya mirado.
        if (marcados.size > 0) {
            const vivas = new Set([...marcados].filter((id) => ahora.has(id)));
            if (vivas.size !== marcados.size) cambiarMarcados(vivas);
        }
        // `marcados` a propósito fuera de las dependencias: la limpieza se hace
        // cuando cambian los diagnósticos, no cada vez que alguien marca uno.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todos]);

    /**
     * La confirmación no sobrevive a un recálculo.
     *
     * Antes la limpiaba el `onBlur` del botón, pero eso hacía imposible llegar al panel
     * con el teclado: al tabular hacia "Sí, aplicalo" el blur lo desmontaba. Ahora el
     * panel tiene su propio "Cancelar" y lo que hay que cubrir es el otro caso: que la
     * lista se renueve y el aviso que estabas por confirmar ya no exista.
     *
     * Lo mismo con el botón índigo que quedó trabajando: la lista nueva ES el plan que
     * ese click pidió, así que ahí termina de trabajar. Y con la confirmación de la
     * tarjeta de ajustes: el recálculo les cambia el estado a los ajustes, y lo que decía
     * el cartel ya no es lo que se guardaría.
     */
    useEffect(() => {
        setConfirmando(null);
    }, [diagnosticos]);

    /**
     * Aplica el cambio de rangos en Recursos, sin recalcular. Lo llama SÓLO el «Sí,
     * aplicalo» del cartel: el botón del aviso lo arma (`setConfirmando`) y nada más.
     *
     * Cambiar rangos toca quién puede usar una máquina o hacer un proceso, así que
     * el botón no adivina: el texto del aviso dice exactamente qué se va a cambiar
     * y a cuánta gente alcanza, y recién ahí se aplica.
     */
    const aplicar = async (clave: string, accion: DiagnosticoAccion, titulo?: string) => {
        // Guarda y no interruptor (26/09/2026, ver `confirmando`): si el cartel de esta
        // solución no está abierto, no se escribe nada.
        if (confirmando !== clave) return;
        setConfirmando(null);
        setAplicando(clave);
        try {
            const objetivos = objetivosDeLaAccion(accion);
            // La red, los tiempos y el recuento viven en `guardarAccionEnRecursos`, y
            // sus piezas son las mismas del guardado de la tarjeta de ajustes.
            const { total, fallidos, clavesFallidas, sinRespuesta, yaEstaban, sinLeer } = await guardarAccionEnRecursos(accion);
            // No se pudo leer qué tiene hoy Recursos: no salió ningún PUT.
            if (sinLeer) throw new Error("sin-leer");
            // Todo mal es un error; algo mal se dice con nombre y apellido, porque el
            // resto SÍ se aplicó y volver a tocar el botón repetiría lo que ya está.
            if (total > 0 && fallidos.length === total) {
                throw new Error(sinRespuesta > 0 ? "sin-respuesta" : "todos");
            }
            if (fallidos.length > 0) {
                toast.warning(`Quedó a medias: no se pudo con ${fallidos.join(", ")}`, {
                    description: "El resto se aplicó. Terminá esos desde Recursos.",
                });
            }
            setAplicadas((prev) => new Set(prev).add(clave));
            // Ya no recalcula (25/09/2026): el cambio queda anotado y entra en el
            // recálculo que se pide una vez, al terminar de revisar.
            //
            // Lo que ya tenía lo del aviso no se mandó (`yaEstaban`, ver
            // `guardarAccionEnRecursos`) y se dice: si no salió ningún PUT, «Guardado»
            // afirmaría un cambio que no hubo.
            const guardadas = objetivos.map((o) => o.nombre).filter((n) => !yaEstaban.includes(n));
            toast.success(
                total === 0
                    ? "Ya estaba cargado en Recursos"
                    : total === 1
                        ? `Guardado en Recursos: ${guardadas[0] ?? objetivos[0].nombre}`
                        : `Guardado en Recursos: ${total} cambios`,
                {
                    description: total > 0 && yaEstaban.length > 0
                        ? `Se ve en el plan al recalcular. ${yaEstaban.join(", ")} ya ${yaEstaban.length === 1 ? "lo tenía: no se tocó" : "lo tenían: no se tocaron"}.`
                        : "Se ve en el plan al recalcular.",
                },
            );
            // Con la acción y no vacío: lo que se acaba de guardar en Recursos puede ser
            // lo mismo que alguien había puesto como ajuste "solo en este plan", y ese
            // ajuste lleva el conjunto de rangos de ANTES. Si no se saca, el próximo
            // recálculo lo manda igual y pisa en memoria lo recién guardado.
            //
            // A medias va sólo lo que entró (26/09/2026, ver `recortada`): anotada entera,
            // la máquina que falló quedaba como guardada y con los botones apagados. Y si
            // es la acción de un ajuste de la tarjeta, ése se conserva con lo que le falta
            // a la vista: darlo de baja dejaba esa máquina sin el dato en los dos lados.
            const claveComoAjuste = claveDeAjuste(accion);
            if (fallidos.length > 0) {
                // Sólo si hay un ajuste así: si no, la marca quedaba suelta y aparecía
                // sobre uno que se pusiera después con la misma acción.
                if (ajustesRef.current.some((a) => a.clave === claveComoAjuste)) {
                    setAMediasPorClave((prev) => new Map(prev).set(claveComoAjuste, fallidos));
                }
                onResueltoRef.current?.(recortada(accion, new Set(clavesFallidas)), titulo, { conservar: [claveComoAjuste] });
            } else {
                setAMediasPorClave((prev) => {
                    if (!prev.has(claveComoAjuste)) return prev;
                    const siguiente = new Map(prev);
                    siguiente.delete(claveComoAjuste);
                    return siguiente;
                });
                onResueltoRef.current?.(accion, titulo);
            }
        } catch (e) {
            toast.error(`No se pudo actualizar ${accion.nombre}`, {
                description: e instanceof Error && e.message === "sin-leer"
                    ? SIN_LEER
                    : e instanceof Error && e.message === "sin-respuesta"
                        ? SIN_RESPUESTA
                        : "Probá de nuevo o hacelo desde Recursos.",
            });
        } finally {
            setAplicando(null);
        }
    };

    /**
     * Por qué un ajuste NO se puede pasar a Recursos desde la tarjeta de ajustes, o null
     * si se puede.
     *
     * Esto escribe en la base de producción, para todos los planes (el 18/08 un cambio
     * así, sin preguntar, abrió la PLEGADORA de 1 persona a 10), así que se cuenta sólo lo
     * que se puede guardar sin riesgo, en este orden:
     *
     *  - Lo que ya se guardó (`yaGuardado`): está en Recursos y sale del plan al recalcular.
     *  - Lo que se está sacando del plan: guardarlo sería lo contrario de lo que se pidió.
     *  - Lo que no dice qué le suma a cada cosa (`motivoSinLoQueSuma`): sin eso no hay
     *    forma de guardarlo sin pisar lo que la máquina ya tiene.
     *  - Sin permiso para escribir en esa solapa de Recursos (RF-24): el backend lo
     *    rechazaría igual, y un botón que falla siempre es peor que no tenerlo.
     *  - Lo que pisa un guardado sin recalcular (`pisaUnGuardado`): ese guardado da de
     *    baja los ajustes sobre esa máquina, y éste tiene que salir con ellos.
     *
     * Dos de la tanda sobre la misma máquina o proceso ya NO se excluyen (26/09/2026).
     * Hasta ese día iba sólo el primero y el cartel le decía al otro «guardalo después de
     * recalcular», pero al guardarse el primero la pantalla daba de baja todos los ajustes
     * de esa máquina (`olvidarAjustesPisadosPor`) y el otro no quedaba ni en Recursos ni
     * en el plan. Ahora se guardan juntos, con UN PUT que suma lo de los dos —la misma
     * cuenta que `payloadDeAjustes` hace en memoria—. Sólo quedan afuera las habilidades
     * que prenden y apagan lo mismo, que no se pueden sumar (ver `loteDeAjustes`).
     */
    const motivoParaNoGuardar = (a: AjusteDelPlan): string | null => {
        if (yaGuardado(a)) return "ya está guardado en Recursos";
        if (estadoDeAjuste(a) === "por-quitar") return "lo estás sacando del plan";
        const sinSuma = motivoSinLoQueSuma(a.accion);
        if (sinSuma) return sinSuma;
        if (!puedeGuardarEnRecursos(a.accion)) return "no tenés permiso para cambiarlo en Recursos";
        const pisa = pisaUnGuardado(a.accion);
        if (pisa) return `ya guardaste un cambio en ${pisa}: recalculá primero`;
        return null;
    };
    /**
     * Los ajustes que se guardan con el botón de la tarjeta y los que no (con su porqué), y
     * las cosas que toca la tanda: una por máquina, proceso o habilidad, con lo que le
     * suman todos los ajustes que la tocan.
     *
     * Se recorre al revés por las habilidades. Dos sobre el mismo par (persona, proceso),
     * una que prende y otra que apaga, no se pueden sumar, y en el plan gana la ÚLTIMA
     * (`payloadDeAjustes`, sin las que se están sacando): se guarda ésa, que es la que se
     * está viendo en el plan. La otra no se promete para después, porque al guardar
     * aquélla la pantalla la da de baja.
     */
    const loteDeAjustes = (() => {
        const guardables: AjusteDelPlan[] = [];
        const noGuardables: { ajuste: AjusteDelPlan; motivo: string }[] = [];
        const perdedoras = new Set<string>();
        const habilidadEnLaTanda = new Map<string, string>();
        for (const a of [...ajustes].reverse()) {
            let motivo = motivoParaNoGuardar(a);
            if (!motivo && a.accion.tipo === "skill_nativa") {
                const otro = objetivosConNombre(a.accion).find((o) => habilidadEnLaTanda.has(o.clave));
                if (otro) {
                    motivo = `choca con el otro cambio sobre ${otro.nombre}, que es el que vale en el plan: se guarda ése y éste se da de baja`;
                    perdedoras.add(a.clave);
                }
            }
            if (motivo) {
                noGuardables.push({ ajuste: a, motivo });
                continue;
            }
            guardables.push(a);
            if (a.accion.tipo === "skill_nativa") {
                for (const o of objetivosConNombre(a.accion)) habilidadEnLaTanda.set(o.clave, o.nombre);
            }
        }
        // De vuelta al orden de la tarjeta, que es el de los números.
        guardables.reverse();
        noGuardables.reverse();

        // Una entrada por cosa: lo que le suman todos los de la tanda que la tocan, junto.
        const porClave = new Map<string, ObjetivoDelLote>();
        const nombresDeSuma = new Map<number, string>();
        for (const a of guardables) {
            const claves = objetivosDeAjuste(a.accion);
            objetivosDeLaAccion(a.accion).forEach((o, i) => {
                const sumaIds = a.accion.tipo === "skill_nativa" ? [] : (o.suma_ids ?? []);
                // `suma` y `suma_ids` salen del mismo conjunto ordenado en el backend
                // (`_cambio`), así que van en el mismo orden: con eso se nombra lo que suma
                // aunque el catálogo de rangos de la pantalla no haya cargado.
                if (o.suma && o.suma.length === sumaIds.length) sumaIds.forEach((id, k) => nombresDeSuma.set(id, o.suma![k]));
                const previo = porClave.get(claves[i]);
                if (previo) {
                    previo.sumaIds = Array.from(new Set([...previo.sumaIds, ...sumaIds])).sort((x, y) => x - y);
                } else {
                    porClave.set(claves[i], {
                        clave: claves[i],
                        id: o.id,
                        nombre: o.nombre,
                        accion: a.accion,
                        sumaIds: [...sumaIds].sort((x, y) => x - y),
                    });
                }
            });
        }

        // Los que no se guardan pero tocan algo que sí: al guardar, la pantalla da de baja
        // todo ajuste sobre esa cosa (`olvidarAjustesPisadosPor`), y el cartel lo tiene
        // que decir en vez de dejarlo como si fuera a quedar. Menos los que ya se están
        // sacando, que no se tocan, y las habilidades que perdieron, que ya lo dicen.
        const noGuardablesDichos = noGuardables.map((n) => {
            if (perdedoras.has(n.ajuste.clave) || estadoDeAjuste(n.ajuste) === "por-quitar") return n;
            const toca = objetivosConNombre(n.ajuste.accion).find((o) => porClave.has(o.clave));
            return toca ? { ...n, motivo: `${n.motivo}; y se da de baja al guardar el otro cambio sobre ${toca.nombre}` } : n;
        });

        return { guardables, noGuardables: noGuardablesDichos, objetivos: Array.from(porClave.values()), nombresDeSuma };
    })();
    /** El nombre de un rango del cartel de la tanda: el catálogo, o el que mandó el backend. */
    const nombreDelRango = (id: number) => nombreDeRango?.(id) || loteDeAjustes.nombresDeSuma.get(id) || `rango ${id}`;
    const tocaRangosLaTanda = loteDeAjustes.objetivos.some((o) => o.accion.tipo !== "skill_nativa");

    /**
     * La confirmación de la tanda se cierra si cambia lo que se va a guardar.
     *
     * El efecto de `[diagnosticos]` sólo cubre el recálculo. Pero marcar «Solo en este
     * plan» en otro aviso, con el cartel abierto, no recalcula (25/09/2026), y el ajuste
     * nuevo entraba solo a la tanda: el botón pasaba a «Sí, guardalos (3)» y escribía en
     * Recursos uno que se había marcado como temporal y que nadie había revisado en el
     * cartel. Si cambia la tanda, se vuelve a pedir el primer paso.
     */
    const firmaDelLote = loteDeAjustes.guardables.map((a) => a.clave).join("\n");
    useEffect(() => {
        // Con updater y sólo si es la de la tanda: no cierra la confirmación de un aviso.
        setConfirmando((c) => (c === CLAVE_LOTE ? null : c));
    }, [firmaDelLote]);

    /**
     * Lo que el cartel de la tanda leyó de Recursos al abrirse (ver `ResumenDelLote`).
     *
     * Una lectura que llega tarde —se cerró y se volvió a abrir el cartel mientras leía—
     * se tira: `lecturaEnCurso` dice cuál es la última.
     */
    const [lecturaDelLote, setLecturaDelLote] = useState<Exclude<LecturaDelLote, null>>("leyendo");
    const lecturaEnCurso = useRef(0);
    const leerRecursosParaLaTanda = () => {
        const esta = ++lecturaEnCurso.current;
        setLecturaDelLote("leyendo");
        void rangosActuales().then((r) => {
            if (lecturaEnCurso.current === esta) setLecturaDelLote(r ?? "error");
        });
    };
    /**
     * El botón azul de la tarjeta: abre el cartel y lee qué tiene hoy Recursos. Nada más.
     *
     * Idempotente y no interruptor (26/09/2026): hasta ese día el mismo botón que armaba
     * la confirmación la ejecutaba al segundo click, y como no se movía, un doble click
     * escribía TODA la tanda en producción sin que nadie leyera el cartel. Guarda el «Sí,
     * guardalos», que está abajo, en otro lugar. Volver a tocar éste no relee: la lectura
     * de verdad se hace de nuevo al confirmar.
     */
    const abrirConfirmacionDelLote = () => {
        if (confirmando === CLAVE_LOTE) return;
        setConfirmando(CLAVE_LOTE);
        if (tocaRangosLaTanda) leerRecursosParaLaTanda();
    };

    /**
     * «Guardar en Recursos» de la tarjeta de ajustes: pasa los ajustes temporales a datos
     * de verdad. Lo llama SÓLO el «Sí, guardalos» del cartel; el botón azul lo abre
     * (`abrirConfirmacionDelLote`).
     *
     * Por cosa y no por ajuste (26/09/2026): se juntan por máquina, proceso o habilidad
     * (`loteDeAjustes.objetivos`) y sale UN PUT por cada una, en serie y con la misma red
     * que el botón de un aviso. Lo que se manda es lo que Recursos tiene en ESE momento —se
     * vuelve a leer al confirmar, por si cambió mientras se leía el cartel— más lo que le
     * suman todos los ajustes que la tocan: nunca se le saca nada, y lo que ya tiene no se
     * manda. Hasta ese día se mandaba el conjunto final congelado en cada ajuste, que
     * borraba lo que se hubiera cargado después en esa máquina, y dos ajustes sobre la
     * misma no se podían guardar juntos. Si no se puede leer, no sale ningún PUT.
     *
     * Al final avisa a la pantalla con `onResuelto(…, { enLote: true })` por cada ajuste
     * que entró ENTERO —todo lo que toca salió bien o ya lo tenía—: la pantalla lo anota
     * como guardado y da de baja el ajuste temporal (`olvidarAjustesPisadosPor`). El
     * recién marcado («Entra al recalcular») se desmarca en el acto, porque nunca entró al
     * plan, y el que ya estaba en el plan pasa a «Guardado en Recursos · sale al
     * recalcular»: con su conjunto de antes, cualquiera de los dos pisaría en memoria lo
     * que se acaba de guardar. Los otros ajustes sobre lo mismo también se dan de baja, y
     * eso lo cuenta el único toast del final, junto con lo que se guardó y lo que no.
     *
     * El que salió a medias NO se anota (26/09/2026). Hasta ese día contaba como guardado
     * entero: la máquina que falló perdía el ajuste temporal al recalcular y quedaba sin el
     * dato en Recursos y en el plan, mientras la tarjeta decía en verde «Ya quedó guardado»
     * y apagaba los botones sobre esa máquina. Ahora queda como estaba, con «Guardado a
     * medias · falta …» (`aMediasPorClave`), y va en `conservar` para que el guardado de
     * otro sobre la misma máquina no lo dé de baja. Volver a guardarlo no repite nada: lo
     * que entró sale «ya lo tenía» y se manda sólo lo que falta.
     */
    const guardarAjustesEnRecursos = async () => {
        if (confirmando !== CLAVE_LOTE || aplicando !== null) return;
        // La tanda es la que estaba escrita en el cartel en el momento del click.
        const { guardables: lote, objetivos } = loteDeAjustes;
        setConfirmando(null);
        if (lote.length === 0) return;
        setAplicando(CLAVE_LOTE);
        const resultado = new Map<string, "ok" | "ya-estaba" | "falla" | "sin-respuesta">();
        try {
            let hoy: RangosActuales | null = null;
            if (objetivos.some((o) => o.accion.tipo !== "skill_nativa")) {
                hoy = await rangosActuales();
                if (!hoy) {
                    toast.error("No se guardó nada", { description: SIN_LEER });
                    return;
                }
            }
            const cabeceras = cabecerasDeGuardado();
            for (const o of objetivos) {
                let cuerpo: { rangos: number[] } | { habilitado: boolean };
                if (o.accion.tipo === "skill_nativa") {
                    cuerpo = { habilitado: o.accion.habilitado ?? true };
                } else {
                    const { final, agrega } = sumandoALoDeHoy(loQueTieneHoy(hoy!, o.accion.tipo, o.id), o.sumaIds);
                    if (agrega.length === 0) {
                        resultado.set(o.clave, "ya-estaba");
                        continue;
                    }
                    cuerpo = { rangos: final };
                }
                resultado.set(o.clave, await guardarObjetivo(urlDelObjetivo(o.accion.tipo, o.accion.id, o.id), cuerpo, cabeceras));
            }
        } finally {
            setAplicando(null);
        }

        // Cada ajuste, según cómo salieron las cosas que toca.
        const falla = (r: string | undefined) => r === "falla" || r === "sin-respuesta";
        const guardados: AjusteDelPlan[] = [];
        const fallaron: string[] = [];
        const aMedias: { ajuste: AjusteDelPlan; nombre: string; entraron: string[]; faltan: string[] }[] = [];
        let sinRespuesta = 0;
        for (const a of lote) {
            const nombre = etiquetaCortaDeAccion(a.accion) || a.accion.nombre;
            const suyos = objetivosConNombre(a.accion);
            const mal = suyos.filter((o) => falla(resultado.get(o.clave)));
            if (mal.length === 0) {
                guardados.push(a);
                continue;
            }
            if (mal.some((o) => resultado.get(o.clave) === "sin-respuesta")) sinRespuesta += 1;
            if (mal.length === suyos.length) {
                fallaron.push(nombre);
                continue;
            }
            // A medias NO cuenta como guardado (26/09/2026, ver el comentario de arriba).
            aMedias.push({
                ajuste: a,
                nombre,
                entraron: suyos.filter((o) => !falla(resultado.get(o.clave))).map((o) => o.nombre),
                faltan: mal.map((o) => o.nombre),
            });
        }
        // Los de la tanda que no entraron enteros: la pantalla no los da de baja aunque
        // toquen algo que otro guardó (ver `conservar` en `onResuelto`).
        const clavesDeLosGuardados = new Set(guardados.map((a) => a.clave));
        const pendientesDelLote = lote.filter((a) => !clavesDeLosGuardados.has(a.clave)).map((a) => a.clave);
        setAMediasPorClave((prev) => {
            const siguiente = new Map(prev);
            for (const a of guardados) siguiente.delete(a.clave);
            for (const m of aMedias) siguiente.set(m.ajuste.clave, m.faltan);
            return siguiente;
        });

        // Lo que la pantalla va a dar de baja de rebote: ajustes que no entraron en lo
        // guardado y tocan algo que sí. Se cuenta ACÁ, con la lista de ahora, y no
        // sumando lo que diga cada `onResuelto`: dos de la tanda sobre la misma máquina se
        // contarían uno al otro como «de rebote». Los que quedaron pendientes no se dan de
        // baja, así que tampoco se cuentan.
        const quedanPendientes = new Set(pendientesDelLote);
        const tocados = new Set(guardados.flatMap((a) => objetivosDeAjuste(a.accion)));
        const deRebote = ajustesRef.current.filter((x) =>
            !clavesDeLosGuardados.has(x.clave)
            && !quedanPendientes.has(x.clave)
            && estadoDeAjuste(x) !== "por-quitar"
            && objetivosDeAjuste(x.accion).some((o) => tocados.has(o)));
        // Todos seguidos: la pantalla actualiza con updaters (ver `onResuelto`).
        for (const a of guardados) {
            onResueltoRef.current?.(a.accion, a.titulo, { enLote: true, conservar: pendientesDelLote });
        }

        // Lo que se dice de cada uno a medias: qué entró y qué falta. Y que se puede volver
        // a guardar: manda sólo lo que falta, lo demás sale «ya lo tenía».
        const dichoDeAMedias = aMedias.length === 0 ? ""
            : `${aMedias.length === 1 ? "Quedó a medias" : "Quedaron a medias"}: ${aMedias.map((m) =>
                `${m.nombre} (${m.entraron.join(", ")} ya ${m.entraron.length === 1 ? "está" : "están"} en Recursos; falta ${m.faltan.join(", ")})`).join("; ")}. `
                + `${aMedias.length === 1 ? "Sigue como ajuste de este plan y se puede" : "Siguen como ajustes de este plan y se pueden"} volver a guardar: se manda sólo lo que falta.`;

        if (guardados.length === 0 && aMedias.length > 0) {
            // Algo entró, pero ningún ajuste entero: no es un «no se pudo», y tampoco un
            // «guardado». Largo, porque lo que falta hay que leerlo con calma.
            toast.warning(aMedias.length === 1 ? "Quedó a medias" : `Quedaron a medias ${aMedias.length} ajustes`, {
                description: [
                    dichoDeAMedias,
                    fallaron.length > 0 && `No se pudo con ${fallaron.join(", ")}.`,
                    sinRespuesta > 0 && SIN_RESPUESTA,
                ].filter(Boolean).join(" "),
                duration: 15000,
            });
            return;
        }
        if (guardados.length === 0) {
            toast.error(lote.length === 1 ? `No se pudo guardar ${fallaron[0] ?? "el ajuste"}` : "No se pudo guardar ninguno", {
                description: sinRespuesta > 0 ? SIN_RESPUESTA : "Probá de nuevo o cargalos desde Recursos.",
            });
            return;
        }
        // Si no hizo falta mandar nada, «Guardado» afirmaría un cambio que no hubo.
        const noHizoFalta = Array.from(resultado.values()).every((r) => r === "ya-estaba");
        const titulo = noHizoFalta
            ? "Ya estaba cargado en Recursos"
            : guardados.length === 1
                ? `Guardado en Recursos: ${etiquetaCortaDeAccion(guardados[0].accion) || guardados[0].accion.nombre}`
                : `Guardados en Recursos: ${guardados.length} ajustes`;
        // Según en qué estaba cada uno al guardarlo (tomado de la tanda del click): el que
        // ya estaba en el plan sale al recalcular, el recién marcado ya se desmarcó.
        const desmarcados = guardados.filter((a) => estadoDeAjuste(a) === "por-agregar").length;
        const enElPlan = guardados.length - desmarcados;
        const yaTenian = objetivos.filter((o) => resultado.get(o.clave) === "ya-estaba").map((o) => o.nombre);
        const rebote = deRebote.length === 0 ? ""
            : deRebote.length === 1
                ? "Además se da de baja otro ajuste que tocaba lo mismo que guardaste."
                : `Además se dan de baja ${deRebote.length} ajustes que tocaban lo mismo que guardaste.`;
        const detalle = [
            "Se ve en el plan al recalcular.",
            enElPlan > 0 && (enElPlan === 1
                ? "El ajuste temporal sale en ese mismo recálculo."
                : "Los ajustes temporales salen en ese mismo recálculo."),
            desmarcados > 0 && (desmarcados === 1
                ? "El que estaba marcado sin recalcular ya se desmarcó: no hace falta."
                : "Los que estaban marcados sin recalcular ya se desmarcaron: no hacen falta."),
            !noHizoFalta && yaTenian.length > 0
                && `${yaTenian.join(", ")} ya ${yaTenian.length === 1 ? "lo tenía: no se tocó" : "lo tenían: no se tocaron"}.`,
            rebote,
        ].filter(Boolean).join(" ");
        const problemas = [
            fallaron.length > 0 && `No se pudo con ${fallaron.join(", ")}.`,
            dichoDeAMedias,
            sinRespuesta > 0 && SIN_RESPUESTA,
        ].filter(Boolean).join(" ");
        if (problemas) {
            toast.warning(titulo, { description: [problemas, rebote].filter(Boolean).join(" "), duration: 15000 });
        } else {
            toast.success(titulo, { description: detalle });
        }
    };

    // Antes se iba en null apenas la lista quedaba vacía. Justo el caso en que se
    // resolvió lo último: el aviso desaparecía sin decir que se había arreglado.
    //
    // Los ajustes cuentan igual que los resueltos: si destrabaste las últimas dos
    // trabas con ajustes de este plan, el panel se llevaría puesta la única tarjeta
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
    const bajada = items.length === 0
        ? (aMano.length > 0
            ? "Los diste por resueltos. Al recalcular, los que sigan trabando vuelven a la lista."
            : "Quedó todo resuelto.")
        // "Resolvelas para optimizar tu planificación" no concordaba ("lo rojo…
        // resolvelas") y encima era una frase de folleto: no decía qué pasa si lo
        // arreglás ni qué pasa si no.
        : hayBloqueantes
            ? "Lo rojo salió mal en el plan. Arreglalo y el plan mejora."
            : "El plan sale igual: esto es para afinarlo.";

    const visibles = verTodas ? ordenados : ordenados.slice(0, VISIBLES);
    const ocultas = ordenados.length - visibles.length;

    /** "Poner todo listo": ver el comentario del botón. */
    const marcarTodos = () => {
        const siguiente = new Set(marcados);
        ordenados.forEach((d) => siguiente.add(d.id));
        cambiarMarcados(siguiente);
        toast.success(
            `Listo: ${ordenados.length} ${ordenados.length === 1 ? "aviso" : "avisos"} fuera de la lista`,
            { description: "Siguen en el plan: al recalcular vuelven los que no se hayan arreglado." },
        );
    };

    /**
     * Los nombres que se resaltan en la frase de un ajuste: lo que toca, lo que le suma
     * y, en las acciones armadas en pantalla (sin `suma`), los rangos del conjunto que
     * la frase nombra con el catálogo.
     */
    const nombresDelAjuste = (accion: AccionDeSolucion): string[] => {
        const objetivos = objetivosDeLaAccion(accion);
        return [
            ...objetivos.map((o) => o.nombre),
            ...objetivos.flatMap((o) => o.suma ?? []),
            ...(accion.tipo === "skill_nativa" ? [accion.nombre] : []),
            ...(nombreDeRango ? objetivos.flatMap((o) => o.rangos ?? accion.rangos ?? []).map((id) => nombreDeRango(id)) : []),
        ].filter(Boolean);
    };
    const textoVerAvisos = items.length === 0 ? "Ver el detalle" : items.length === 1 ? "Ver el aviso" : "Ver los avisos";
    const hayPorAgregar = ajustes.some((a) => estadoDeAjuste(a) === "por-agregar");
    const confirmandoLote = confirmando === CLAVE_LOTE && loteDeAjustes.guardables.length > 0;
    // Lo que dice el recuadro de la tarjeta de ajustes (ver su comentario). Uno guardado a
    // medias no deja pintarlo de verde: lo que le falta no está en Recursos.
    const hayAMedias = ajustes.some((a) => aMediasPorClave.has(a.clave));
    const todosGuardados = ajustes.length > 0 && ajustes.every(yaGuardado) && !hayAMedias;
    const algunoGuardado = ajustes.some(yaGuardado);
    const quedaAlgunoEnElPlan = ajustes.some((a) => estadoDeAjuste(a) !== "por-quitar");
    // El «Sí, guardalos» espera la lectura de Recursos (ver `ResumenDelLote`).
    const esperandoLectura = tocaRangosLaTanda && (lecturaDelLote === "leyendo" || lecturaDelLote === "error");

    /** Los botones blancos con borde del mockup: los del resumen y el «Deshacer». */
    const botonBlanco = cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3",
        "text-[12.5px] font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900",
        "disabled:cursor-not-allowed disabled:opacity-60",
        SOMBRA,
    );

    return (
        /* Sin caja que envuelva todo (mockup de Julián, 26/09/2026): tarjetas sueltas, con
           aire entre ellas y el fondo de la pantalla de por medio. La caja única con
           franjas pegadas era lo que hacía que «invada tanto»: se leía como un solo bloque
           gigante encima de la tabla, y no como cosas distintas que se miran de a una. */
        <div className="mx-3 sm:mx-4 mt-3 mb-1 space-y-2.5">
            {/* ── El resumen ──
                Siempre a la vista, plegado o no. Es un <section> y no un <button> entero:
                adentro van «Marcar todo listo» y «Volver a revisar», y no se pueden anidar
                botones. Pliegan y despliegan la zona del texto y el chevron de la punta.

                `flex-wrap` (RF-27): los botones de la derecha no achican, y cuando no les
                queda lugar al lado del resumen bajan a un renglón propio. Antes se quedaban
                en la fila y el resumen se apretaba hasta leerse una palabra por renglón
                (en un teléfono le quedaban ~70px). El `basis-56` del resumen es lo que
                decide cuándo bajan; en una pantalla ancha, todo en una fila como siempre. */}
            <section
                aria-label="Avisos del plan"
                className={cn(
                    "rounded-xl border",
                    SOMBRA,
                    items.length === 0 ? "border-emerald-200 bg-emerald-50/60"
                        : hayBloqueantes ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70",
                )}
            >
                <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4", colapsado ? "py-2.5" : "py-3")}>
                    <button
                        type="button"
                        aria-expanded={!colapsado}
                        onClick={alternarColapso}
                        className="order-1 flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                    >
                        {items.length === 0 ? (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                        ) : hayBloqueantes ? (
                            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
                        ) : (
                            <Bell className="h-5 w-5 shrink-0 text-amber-500" />
                        )}
                        {/* Plegado es UN renglón: el título y, si entra, la bajada al lado en
                            gris. Antes plegado se perdía la bajada entera; ahora que el
                            encabezado lleva dos botones y no cinco, al lado del título sobra
                            lugar para decir si lo que hay es para arreglar o para afinar. */}
                        <span className={cn("min-w-0", colapsado && "flex items-baseline gap-2")}>
                            <span className="block shrink-0 text-[15px] font-semibold leading-tight text-gray-900">
                                {resumenHeader}
                            </span>
                            <span className={cn(
                                "block text-[12.5px] leading-snug text-gray-600",
                                colapsado ? "hidden min-w-0 truncate sm:block" : "mt-0.5",
                            )}>
                                {bajada}
                            </span>
                        </span>
                    </button>

                    <div className="order-3 ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 sm:order-2">
                        {/* "Poner todo listo": el caso es un lote de 60 OTs donde los Media
                            son media pantalla y ya se sabe qué son. No toca el plan ni los
                            datos —los pasa a la tarjeta verde de resueltos— y se deshace uno
                            por uno o entero, así que el riesgo de marcar de más es un click.
                            Sólo desplegado: plegado sería marcar lo que no se está viendo. */}
                        {!colapsado && items.length > 0 && (
                            <button
                                type="button"
                                onClick={marcarTodos}
                                className={botonBlanco}
                                title="Los pasa a «Resueltos», abajo de la lista, sin tocar el plan ni los datos. Se deshace."
                            >
                                <Check className="h-3.5 w-3.5 shrink-0" />
                                Marcar todo listo
                            </button>
                        )}

                        {onRevisar && (
                            <button
                                type="button"
                                onClick={onRevisar}
                                disabled={revisando}
                                className={botonBlanco}
                                title={revisando
                                    ? "Esperá a que termine el recálculo"
                                    : pendientes > 0
                                        ? `Recalcula el plan con ${pendientes === 1 ? "el cambio marcado" : `los ${pendientes} cambios marcados`} (lo mismo que el botón naranja de abajo)`
                                        : "Recalcular ahora para ver si lo que arreglaste en Recursos ya está"}
                            >
                                <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", revisando && "animate-spin")} />
                                {revisando ? "Recalculando…" : "Volver a revisar"}
                            </button>
                        )}
                    </div>

                    {/* El chevron de la punta, como en el mockup. Plegado dice además a
                        dónde lleva: sin palabra, en la franja de un renglón se leía como un
                        adorno y no como la puerta a los avisos.

                        Va afuera del grupo de botones y con `order` para que en el teléfono
                        se quede en el renglón del título: adentro del grupo, cuando los
                        botones bajaban, el chevron bajaba con ellos a un tercer renglón solo. */}
                    <button
                        type="button"
                        aria-expanded={!colapsado}
                        aria-label={colapsado ? textoVerAvisos : "Plegar los avisos"}
                        onClick={alternarColapso}
                        className="order-2 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[12.5px] font-medium text-gray-600 transition-colors hover:bg-white/70 hover:text-gray-900 sm:order-3"
                    >
                        {colapsado && <span className="hidden whitespace-nowrap sm:inline">{textoVerAvisos}</span>}
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-500 transition-transform", colapsado && "-rotate-90")} />
                    </button>
                </div>
            </section>

            {/* ── Lo que se está probando sin guardar ──
                Mientras esta tarjeta exista, el plan de abajo NO es el plan que sale de los
                datos cargados. El 26/09 había pasado a chips de un renglón con la frase en
                el `title` («en un solo renglón, como listo en verde»); el mockup de Julián
                del mismo día la vuelve a abrir, pero ordenada: una fila por ajuste, con qué
                toca, qué destraba y su «Deshacer» escrito, y el porqué a la vista y no
                detrás de una ⓘ.

                `id` y `scroll-mt-2`: la pastilla «Ajustes del plan» de la cabecera de la
                pantalla trae esta tarjeta a la vista con `scrollIntoView`. */}
            {!colapsado && ajustes.length > 0 && (
                <section
                    id="ajustes-del-plan"
                    aria-labelledby="ajustes-del-plan-titulo"
                    className={cn("scroll-mt-2 overflow-hidden rounded-xl border border-indigo-100 bg-white", SOMBRA)}
                >
                    <div className="flex items-center gap-2.5 bg-indigo-50/70 px-4 py-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-indigo-600 ring-1 ring-inset ring-indigo-100">
                            <Wrench className="h-3.5 w-3.5" />
                        </span>
                        <h3 id="ajustes-del-plan-titulo" className="text-[15px] font-semibold text-gray-900">
                            Ajustes solo para este plan ({ajustes.length})
                        </h3>
                    </div>

                    <ol className="divide-y divide-gray-100">
                        {ajustes.map((a, i) => {
                            // Marcado sin recalcular, en el plan, o saliendo al recalcular
                            // (25/09/2026: los ajustes ya no recalculan en el click).
                            const estado = estadoDeAjuste(a);
                            const saliendo = estado === "por-quitar";
                            // Sale porque se guardó ÉL en Recursos (`yaGuardado`), o porque
                            // lo sacaron / otro guardado le pisó la máquina: sólo lo segundo
                            // se tacha, y sólo ahí hay un «Dejarlo» (26/09/2026).
                            const guardadoEste = yaGuardado(a);
                            const tachado = saliendo && !guardadoEste;
                            // «Dejarlo» después de un guardado sobre lo mismo le devolvía al
                            // plan un conjunto armado ANTES de ese guardado, y la tanda de esta
                            // tarjeta lo mandaba a Recursos después del recálculo, pisando lo
                            // guardado. Se apaga con el motivo escrito; la pantalla tiene la
                            // misma red (`quitarAjusteDelPlan`).
                            const pisaDejar = tachado ? pisaUnGuardado(a.accion) : null;
                            // Guardado a medias (26/09/2026, ver `aMediasPorClave`): el ajuste
                            // sigue, y la fila dice qué no entró en vez de callarlo.
                            const faltan = aMediasPorClave.get(a.clave);
                            return (
                                <li key={a.clave} className="flex items-start gap-3 px-4 py-3">
                                    {/* El número es para poder decir «el 2» mirando la
                                        pantalla con otro, no un orden: los ajustes se suman
                                        y no importa cuál entró primero. */}
                                    <span className={cn(
                                        "mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums text-white",
                                        guardadoEste ? "bg-emerald-600" : "bg-indigo-600",
                                        tachado && "opacity-60",
                                    )}>
                                        {i + 1}
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                                        <div className={cn("flex min-w-0 flex-1 basis-[18rem] items-start gap-2.5", tachado && "opacity-60")}>
                                            <span className="mt-px shrink-0 rounded-md bg-indigo-50 px-2 py-0.5 text-[11.5px] font-medium text-indigo-700">
                                                {TIPO_DE_AJUSTE[a.accion.tipo] ?? "Ajuste"}
                                            </span>
                                            <div className="min-w-0">
                                                <p className={cn(
                                                    "text-[13px] leading-snug text-gray-800",
                                                    tachado && "line-through decoration-gray-400",
                                                )}>
                                                    {conNombresEnNegrita(a.descripcion, nombresDelAjuste(a.accion))}
                                                </p>
                                                {a.titulo && (
                                                    <p className="mt-0.5 text-[12px] leading-snug text-gray-500">
                                                        Destraba: <span className="font-medium text-gray-700">{a.titulo}</span>
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
                                            {/* Punteado = provisorio, el mismo par (índigo +
                                                punteado) que el botón «Solo en este plan». */}
                                            {estado === "por-agregar" && (
                                                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-indigo-300 bg-indigo-50/60 px-2 py-0.5 text-[11.5px] font-medium text-indigo-700">
                                                    <Clock className="h-3 w-3 shrink-0" />
                                                    Entra al recalcular
                                                </span>
                                            )}
                                            {/* Verde y sin «Dejarlo»: el dato ya está en Recursos,
                                                y lo que sale es sólo el ajuste temporal, que con su
                                                conjunto de antes pisaría lo guardado. */}
                                            {guardadoEste && (
                                                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-medium text-emerald-700">
                                                    <Check className="h-3 w-3 shrink-0" />
                                                    Guardado en Recursos · sale al recalcular
                                                </span>
                                            )}
                                            {faltan && (
                                                <span
                                                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800"
                                                    title="Lo demás ya está en Recursos. Volver a guardarlo manda sólo lo que falta."
                                                >
                                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                                    Guardado a medias · falta {faltan.join(", ")}
                                                </span>
                                            )}
                                            {tachado && (
                                                <span className="inline-flex items-center whitespace-nowrap rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11.5px] font-medium text-gray-500">
                                                    Sale al recalcular
                                                </span>
                                            )}
                                            {onQuitarAjuste && !guardadoEste && (
                                                <button
                                                    type="button"
                                                    onClick={() => onQuitarAjuste(a.clave)}
                                                    /* Mientras recalcula, igual que «Solo en este
                                                       plan»: el ajuste está viajando en ese pedido
                                                       y la lista que vuelve lo da por calculado. */
                                                    disabled={revisando || aplicando !== null || !!pisaDejar}
                                                    aria-label={saliendo ? `Dejar: ${a.descripcion}` : `Deshacer: ${a.descripcion}`}
                                                    title={revisando
                                                        ? "Esperá a que termine el recálculo"
                                                        : pisaDejar
                                                            ? motivoPisa(pisaDejar)
                                                            : saliendo
                                                                ? "Dejarlo: sigue en el plan y no se saca al recalcular"
                                                                : estado === "por-agregar"
                                                                    ? "Desmarcarlo: todavía no entró al plan"
                                                                    : "Deshacer: se saca del plan en el próximo recálculo"}
                                                    className={cn(
                                                        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-200 bg-white px-3",
                                                        "text-[12.5px] font-medium text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50",
                                                        "disabled:cursor-not-allowed disabled:opacity-50",
                                                    )}
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                                                    {saliendo ? "Dejarlo" : "Deshacer"}
                                                </button>
                                            )}
                                        </div>
                                        {/* Escrito y no sólo en el `title`, como en la franja de
                                            los avisos: en la tablet no hay hover, y un botón
                                            apagado sin motivo es un botón muerto. */}
                                        {pisaDejar && (
                                            <p className="basis-full text-right text-[11.5px] leading-snug text-amber-800">
                                                {motivoPisa(pisaDejar)}
                                            </p>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>

                    {/* La frase más importante de la tarjeta: alguien puede mirar este plan
                        mañana y prometer fechas que se apoyan en un rango que nadie cargó.
                        Y al lado, la salida: pasarlo a Recursos de verdad.

                        Dice la verdad sobre lo que YA se guardó (26/09/2026): después de
                        «Sí, guardalo» seguía diciendo «Esto no quedó guardado… cargalo en
                        Recursos» sobre lo que el toast acababa de dar por guardado. Todo
                        guardado, lo dice en verde; guardado a medias, el «no quedó
                        guardado» es para los que no dicen «Guardado en Recursos»; y la
                        invitación a cargarlo va sólo si queda alguno que no esté saliendo.
                        Un ajuste que entró sólo en parte («Guardado a medias», ver
                        `aMediasPorClave`) nunca deja el recuadro en verde, y se explica. */}
                    <div className="px-4 pb-4 pt-1">
                        <div className={cn(
                            "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg px-3.5 py-3",
                            todosGuardados ? "bg-emerald-50/70" : "bg-indigo-50/60",
                        )}>
                            <div className="flex min-w-0 flex-1 basis-[18rem] items-start gap-2.5">
                                {todosGuardados
                                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                    : <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />}
                                <p className="min-w-0 text-[12.5px] leading-relaxed text-gray-600">
                                    {todosGuardados ? (
                                        <>
                                            Ya quedó guardado en Recursos.{" "}
                                            {ajustes.length === 1 ? "El ajuste temporal sale" : "Los ajustes temporales salen"} en
                                            el próximo recálculo y el plan pasa a usar el dato cargado.
                                        </>
                                    ) : (
                                        <>
                                            {hayAMedias
                                                ? "Lo que no dice «Guardado en Recursos» no quedó guardado, o no entero:"
                                                : algunoGuardado
                                                    ? "Lo que no dice «Guardado en Recursos» no quedó guardado:"
                                                    : "Esto no quedó guardado en Recursos:"}{" "}
                                            el plan se calcula como si el dato estuviera, pero en el sistema sigue
                                            como antes. Se pierde si descartás el borrador.
                                            {hayAMedias && (
                                                <> Lo que dice «Guardado a medias» entró sólo en parte: lo que falta sigue como ajuste de este plan, y volver a guardarlo manda sólo eso.</>
                                            )}
                                            {quedaAlgunoEnElPlan && (loteDeAjustes.guardables.length > 0
                                                ? <> Para dejarlo cargado de verdad, usá <strong className="font-semibold text-blue-700">Guardar en Recursos</strong>.</>
                                                : <> Para dejarlo cargado de verdad, cargalo en Recursos.</>)}
                                            {hayPorAgregar && (
                                                <> Lo que dice «Entra al recalcular» se ve en el plan recién cuando recalcules.</>
                                            )}
                                        </>
                                    )}
                                </p>
                            </div>
                            {/* Azul y no verde, como en el mockup: está solo en su recuadro,
                                sin nada al lado con qué confundirse, y no escribe nada: abre el
                                cartel. El que escribe es el «Sí, guardalos» del cartel, y ése sí
                                es verde lleno como todo lo que toca la base.

                                Tocarlo con el cartel abierto no hace nada (26/09/2026): antes
                                el segundo click en este mismo botón guardaba, y un doble click
                                escribía la tanda entera sin que nadie la leyera. Por eso armado
                                dice «Confirmá abajo», que no invita a otro click. */}
                            {loteDeAjustes.guardables.length > 0 && (
                                <button
                                    type="button"
                                    onClick={abrirConfirmacionDelLote}
                                    disabled={aplicando !== null || revisando}
                                    aria-expanded={confirmandoLote}
                                    title={revisando
                                        ? "Esperá a que termine el recálculo"
                                        : aplicando !== null
                                            ? "Esperá a que termine de guardar"
                                            : confirmandoLote
                                                ? "Abajo está el detalle de lo que va a cambiar: se guarda desde ahí"
                                                : loteDeAjustes.guardables.length === ajustes.length
                                                    ? "Los deja cargados en Recursos para todos los planes. Antes te muestro qué cambia."
                                                    : `Guarda ${loteDeAjustes.guardables.length} de los ${ajustes.length}: los otros no se pueden guardar desde acá. Antes te muestro qué cambia.`}
                                    className={cn(
                                        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[12.5px] font-semibold text-white shadow-sm transition-colors",
                                        "disabled:cursor-not-allowed disabled:opacity-60",
                                        confirmandoLote ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700",
                                    )}
                                >
                                    {aplicando === CLAVE_LOTE
                                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                        : <Save className="h-3.5 w-3.5 shrink-0" />}
                                    {aplicando === CLAVE_LOTE ? "Guardando…" : confirmandoLote ? "Confirmá abajo" : "Guardar en Recursos"}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* El paso de confirmación de la tanda, igual que el de un aviso: qué
                        cambia en cada cosa —con lo que Recursos tiene AHORA, ver
                        `ResumenDelLote`—, qué NO se guarda y por qué, y recién ahí el botón
                        que escribe. Hasta el 26/09/2026 cerraba con «si alguien lo cambió
                        después, recalculá antes de guardar», que era falso: el recálculo no
                        le rearma la acción a un ajuste. Ahora se suma a lo que haya al
                        guardar, y el cartel lo dice. */}
                    {confirmandoLote && (
                        <div>
                            <ResumenDelLote
                                objetivos={loteDeAjustes.objetivos}
                                lectura={tocaRangosLaTanda ? lecturaDelLote : null}
                                nombreDelRango={nombreDelRango}
                                onReintentar={leerRecursosParaLaTanda}
                            />
                            <div className="space-y-2 bg-amber-50/70 px-4 pb-3">
                                {loteDeAjustes.noGuardables.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                                            Estos no se guardan desde acá
                                        </p>
                                        <ul className="mt-1 space-y-0.5">
                                            {loteDeAjustes.noGuardables.map(({ ajuste, motivo }) => (
                                                <li key={ajuste.clave} className="text-[12px] leading-snug text-amber-950">
                                                    · {ajuste.descripcion} <span className="text-amber-800/80">— {motivo}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setConfirmando(null)}
                                        className="rounded-md px-2.5 py-1 text-[12px] font-medium text-amber-900/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
                                    >
                                        Cancelar
                                    </button>
                                    {/* Apagado hasta tener la lectura: se confirma lo que se
                                        leyó, no un «hoy tiene» a medio llegar. */}
                                    <Button
                                        size="sm"
                                        onClick={guardarAjustesEnRecursos}
                                        disabled={aplicando !== null || revisando || esperandoLectura}
                                        title={esperandoLectura
                                            ? (lecturaDelLote === "error"
                                                ? "Sin saber qué tiene hoy Recursos no se guarda nada: probá de nuevo arriba"
                                                : "Esperá a que termine de leer Recursos")
                                            : undefined}
                                        className="h-8 gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700"
                                    >
                                        {aplicando !== null && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                        {loteDeAjustes.guardables.length === 1 ? "Sí, guardalo" : `Sí, guardalos (${loteDeAjustes.guardables.length})`}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* ── Los avisos ──
                Una tarjeta por aviso, con la anatomía del mockup de Julián (26/09/2026):
                círculo e insignia de color, la categoría en gris, título grande, una frase
                en criollo, los datos con su etiqueta y las OT en un renglón, y la
                sugerencia en una franja propia adentro de la tarjeta.

                Es más alta que la tarjeta compacta de antes, y eso es una decisión: Lucas
                había pedido lo contrario el 26/08 («pueden entrar más trabas»), pero con la
                lista de hoy se ven uno o dos avisos por plan, no once, y lo que costaba caro
                era no entenderlos. Por eso se muestran cuatro antes de «Ver los N que
                faltan» (`VISIBLES`): la tabla del plan tiene que seguir entrando. */}
            {!colapsado && ordenados.length > 0 && (
                <ul className="space-y-2" aria-label="Avisos">
                    {visibles.map((d) => {
                        const activo = abiertos.has(d.id);
                        const esBloq = d.severidad === "bloqueante";
                        const pausa = esPausa(d);
                        const informativo = esInformativo(d);
                        const recurso = recursoDe(d);
                        const Icono = recurso?.icono ?? Info;
                        const subtipo = subtipoDe(d);
                        const insignia = pausa ? INSIGNIA.pausa
                            : informativo ? (d.tipo === "trabajo_tercerizado" ? INSIGNIA.terceros : INSIGNIA.listo)
                                : esBloq ? INSIGNIA.alta : INSIGNIA.media;

                        // La solución que va en la franja de abajo.
                        //
                        // En un aviso que no pide nada (informativo) no hay botón que
                        // elegir: va la que lleva a Recursos, si alguna lleva, y si no el
                        // primer consejo. Las demás quedan para el detalle.
                        //
                        // En el resto se muestra UNA solución: la primera que se puede
                        // aplicar de un botón y, si ninguna se puede, la primera a secas.
                        // Las demás se cuentan al lado del texto y salen enteras al
                        // desplegar. Manda la que se puede guardar en Recursos; si ninguna
                        // se puede, la que al menos se puede probar en este plan; si
                        // tampoco, la primera a secas. El orden importa: mostrar plegada una
                        // solución que solo se puede probar, teniendo otra que se puede
                        // dejar cargada, escondería el arreglo de verdad detrás de un click.
                        let iSol: number;
                        if (informativo) {
                            const iLink = d.soluciones.findIndex((s) => enlace(d, s) !== null);
                            iSol = iLink >= 0 ? iLink : d.soluciones.findIndex((s) => esNota(s));
                        } else {
                            const conBoton = d.soluciones.findIndex((s) => s.accion);
                            const conAjuste = conBoton >= 0 ? conBoton : d.soluciones.findIndex((s) => accionAjustable(s));
                            iSol = conAjuste >= 0 ? conAjuste : (d.soluciones.length > 0 ? 0 : -1);
                        }
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
                        const estadoAjuste = claveAjuste ? estadoPorClave.get(claveAjuste) : undefined;
                        const ajustada = !!estadoAjuste;
                        // Guardado en Recursos sobre lo mismo y sin recalcular: los dos
                        // botones lo pisarían (ver `guardadosSinRecalcular`). No aplica al
                        // propio botón ya guardado, que ya está apagado por `hecha`.
                        //
                        // El índigo, puesto, sigue libre para desmarcarlo o sacarlo; pero
                        // «se saca al recalcular → dejarlo» es volver a poner un conjunto
                        // armado ANTES del guardado, y se apaga igual que uno nuevo
                        // (26/09/2026, ver `pisaDejar` en la tarjeta de ajustes).
                        const pisaAjuste = ajustada && estadoAjuste !== "por-quitar" ? null : pisaUnGuardado(accionSol);
                        const pisaGuardar = hecha ? null : pisaUnGuardado(sol?.accion);
                        // La solución de ESTA tarjeta que está esperando confirmación, si
                        // hay alguna. La clave es `${d.id}-${i}` y el id del aviso trae
                        // guiones ("maquina-incompatible-101"), así que se parte por el
                        // ÚLTIMO, no por el primero. La de la tarjeta de ajustes no es de
                        // ningún aviso.
                        const iArmada = confirmando && confirmando !== CLAVE_LOTE
                            && confirmando.slice(0, confirmando.lastIndexOf("-")) === d.id
                            ? Number(confirmando.slice(confirmando.lastIndexOf("-") + 1))
                            : -1;
                        const armada = iArmada >= 0 ? d.soluciones[iArmada] : null;
                        const link = sol ? enlace(d, sol) : null;
                        // El link que la franja muestra como botón «Ir a arreglarlo»: el de
                        // un aviso que no pide nada, o el de una solución sin botón que
                        // guarde. Cuando la solución SÍ trae «Guardar en Recursos», el link
                        // no va en la franja (ver el comentario del «dónde», más abajo).
                        const linkEnFranja = informativo || !sol?.accion ? link : null;
                        // «Ver en Recursos» del menú: sólo si la franja no muestra ya un
                        // link, y con el de la solución de la franja o, si no tiene, con la
                        // primera solución que lleve a algún lado.
                        const linkDelMenu = linkEnFranja
                            ? null
                            : link ?? d.soluciones.map((s) => enlace(d, s)).find((l): l is string => !!l) ?? null;
                        // Las notas (consejos sin nada que tocar) no son «opciones».
                        const otras = d.soluciones.filter((s, i) => i !== iSol && !esNota(s)).length;
                        const notas = d.soluciones.filter((s, i) => i !== iSol && esNota(s));

                        // El backend ya manda el impacto masticado ("3 procesos · 2 OT · 4h").
                        // Decía «3 proc» hasta el 17/09/2026, cuando se escribió entero del
                        // lado del backend (ver `_resumen`); el corte por «·» es el mismo.
                        // Se parte en datos en vez de reescribirlo: mismos datos, sin
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
                        // Plegada entran dos al final del renglón de datos. Abierta NINGUNA
                        // ahí: van todas en el detalle, y antes salían en los dos lados a
                        // la vez (Julián, 25/09/2026).
                        const otsVisibles = onVerOT && !activo ? otsDelAviso.slice(0, 2) : [];
                        const otsQueFaltan = onVerOT && !activo ? otsDelAviso.length - otsVisibles.length : 0;

                        /* Los datos del aviso, cada uno con su etiqueta, como en el mockup.
                           El impacto viene del backend masticado y en orden («2 procesos · 3 OT
                           · 4 jornadas»): procesos y OT se juntan en un dato —son la misma
                           pregunta, cuánto trabajo toca— y el tiempo va en el suyo. */
                        const [impProcesos, impOts, impTiempo] = impacto;
                        // Un aviso unificado cuenta sus pasos: «2 pasos · 3 procesos · 2 OT».
                        const trabajo = [
                            (d.pasos?.length ?? 0) > 1 && `${d.pasos!.length} pasos`,
                            impProcesos,
                            impOts,
                        ].filter(Boolean).join(" · ");
                        // Sin datos que repitan lo que ya dice la frase de arriba, ni un
                        // «Necesita» que es el mismo número que el Tiempo (el cuello pide
                        // «10 jornadas» y tarda «10 jornadas»).
                        const datos = ([
                            // En una pausa lo que viene en `tiene` es el motivo, no «lo que hay hoy».
                            d.tiene && { etiqueta: pausa ? "Motivo" : "Hoy", valor: d.tiene, icono: Icono },
                            d.pide && d.pide.trim().toLowerCase() !== (impTiempo ?? "").toLowerCase()
                                && { etiqueta: "Necesita", valor: d.pide, icono: Wrench },
                            trabajo && { etiqueta: "Trabajo", valor: trabajo, icono: Layers },
                            impTiempo && { etiqueta: "Tiempo", valor: impTiempo, icono: Clock },
                        ].filter(Boolean) as { etiqueta: string; valor: string; icono: LucideIcon }[])
                            .filter((dato) => !yaLoDice(d.resumen, dato.valor));

                        // La franja de qué hacer: rosa lo que salió mal, ámbar lo que sale
                        // igual y las pausas (que no son un error de nadie).
                        const franjaRosa = esBloq && !pausa;

                        return (
                            <li
                                key={d.id}
                                /* Sin barra de color al costado: Julián devolvió el 31/08 «ese
                                   detalle que tienen a la izquierda son muy molestas» —un riel
                                   grueso más un número de orden—; la versión del 17/09 lo había
                                   dejado en 3px, y el mockup del 26/09 no lo tiene. El color
                                   ahora lo cargan el círculo y la insignia, que además dicen
                                   qué es. */
                                className={cn(
                                    "overflow-hidden rounded-xl border bg-white transition-colors",
                                    SOMBRA,
                                    activo ? "border-gray-300" : "border-gray-200 hover:border-gray-300",
                                )}
                            >
                                <div className="flex items-start gap-3 px-4 py-3">
                                    <span className={cn(
                                        "grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset",
                                        insignia.circulo,
                                    )}>
                                        <insignia.icono className="h-3.5 w-3.5" strokeWidth={2.5} />
                                    </span>

                                    <div className="min-w-0 flex-1">
                                        {/* Severidad y categoría arriba, chiquitas: son para
                                            clasificar, no para leer. El título va abajo y grande. */}
                                        <div className="flex min-h-7 items-center gap-2">
                                            <span
                                                className={cn(
                                                    "shrink-0 rounded-md px-1.5 text-[10.5px] font-bold uppercase leading-[18px] tracking-wide ring-1 ring-inset",
                                                    insignia.chip,
                                                )}
                                                title={insignia.title}
                                            >
                                                {insignia.texto}
                                            </span>
                                            <span className="min-w-0 truncate text-[11.5px] text-gray-500">
                                                {recurso?.texto ?? "Plan"}{subtipo ? ` · ${subtipo}` : ""}
                                            </span>
                                            <span className="flex-1" />
                                            <MenuDelAviso
                                                titulo={d.titulo}
                                                abierto={activo}
                                                onDetalle={() => toggle(d.id)}
                                                enlace={linkDelMenu}
                                                onListo={() => marcar(d)}
                                            />
                                        </div>

                                        {/* Título y frase abren y cierran el detalle. Es un
                                            botón con sólo texto adentro: los datos, las OT y
                                            la franja van afuera porque tienen botones propios,
                                            y los botones no se anidan. */}
                                        <button
                                            type="button"
                                            aria-expanded={activo}
                                            onClick={() => toggle(d.id)}
                                            className="mt-0.5 block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                                        >
                                            <span className={cn(
                                                "block text-[15px] font-semibold leading-snug text-gray-900",
                                                !activo && "line-clamp-2",
                                            )} title={d.titulo}>
                                                {d.titulo}
                                            </span>
                                            {/* El texto de acá NO cambia al abrir la tarjeta. Antes
                                                cerrada mostraba el `resumen` y abierta lo REEMPLAZABA
                                                por el `detalle`: la frase que estabas leyendo se
                                                convertía en otra (Julián, 17/09/2026). El detalle
                                                aparece abajo al desplegar: no se reemplaza nada. */}
                                            <span className={cn(
                                                "mt-0.5 block text-[12.5px] leading-snug text-gray-500",
                                                !activo && !d.resumen && "line-clamp-2",
                                            )}>
                                                {d.resumen ? d.resumen : conNegritas(d.detalle)}
                                            </span>
                                        </button>

                                        {/* Los datos, cada uno con su etiqueta, y las OT al final
                                            del mismo renglón. Antes eran chips grises sueltos
                                            —«OPERARIO CALIFIC… → AYUDANTE o INGRESA…», «1 proc · 1
                                            OT · 1 min»— donde había que adivinar qué era cada
                                            número; con etiqueta se contesta la pregunta que hizo
                                            Lucas mirando la soldadora: «¿cuál es el rango que
                                            tiene?». */}
                                        {(datos.length > 0 || otsVisibles.length > 0) && (
                                            <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
                                                {datos.map((dato) => (
                                                    <span
                                                        key={dato.etiqueta}
                                                        className={cn("inline-flex min-w-0 items-center gap-2", !activo && "max-w-[17rem]")}
                                                        title={`${dato.etiqueta}: ${dato.valor}`}
                                                    >
                                                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-gray-200 bg-white">
                                                            <dato.icono className="h-3.5 w-3.5 text-gray-400" />
                                                        </span>
                                                        <span className="min-w-0">
                                                            <span className="block text-[10px] font-medium uppercase leading-none tracking-wide text-gray-400">
                                                                {dato.etiqueta}
                                                            </span>
                                                            {/* Abierta, el valor entero y no cortado: en la
                                                                tablet no hay `title`. */}
                                                            <span className={cn(
                                                                "mt-1 block text-[12.5px] leading-tight text-gray-700",
                                                                !activo && "truncate",
                                                            )}>
                                                                {dato.valor}
                                                            </span>
                                                        </span>
                                                    </span>
                                                ))}
                                                {/* La OT, de un click: "y vas a buscarla acá…
                                                    estaría bueno que hagas clic acá" (Lucas 28/08,
                                                    sobre la 15678). */}
                                                {otsVisibles.length > 0 && (
                                                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                                                        {otsVisibles.map((o) => (
                                                            <button
                                                                key={o.id}
                                                                type="button"
                                                                onClick={() => onVerOT?.(o.id)}
                                                                className="inline-flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-2 text-[12px] tabular-nums text-gray-600 transition-colors hover:border-indigo-200 hover:bg-white hover:text-indigo-700"
                                                                title={`Ir a la OT #${o.numero} en el plan`}
                                                            >
                                                                #{o.numero}
                                                            </button>
                                                        ))}
                                                        {otsQueFaltan > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => toggle(d.id)}
                                                                className="inline-flex h-7 items-center rounded-lg px-1.5 text-[12px] tabular-nums text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                                                                title={otsTexto ? `${otsTexto} — tocá para verlas todas` : "Tocá para verlas todas"}
                                                            >
                                                                +{otsQueFaltan}
                                                            </button>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* ── La sugerencia, en su franja ──
                                            Los que no piden nada: si hay a dónde ir, en azul
                                            con el botón que lleva; si no, el consejo en verde.
                                            Así un aviso «Listo» no se viste de tarea. */}
                                        {informativo && sol && (link ? (
                                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-blue-50/70 px-3 py-2 text-[12.5px] text-gray-700">
                                                <div className="flex min-w-0 flex-1 basis-[15rem] items-start gap-2.5">
                                                    <Crosshair className="mt-px h-4 w-4 shrink-0 text-blue-600" />
                                                    <p className="min-w-0 leading-snug">{conNegritas(sinOInicial(sol.texto))}</p>
                                                </div>
                                                <a
                                                    href={link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 text-[12.5px] font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
                                                    title={`Abre ${sol.donde} en otra pestaña, ya parado en lo que hay que tocar. Al volver acá se revisa solo.`}
                                                >
                                                    Ir a arreglarlo
                                                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                                                </a>
                                            </div>
                                        ) : (
                                            <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
                                                <Lightbulb className="mt-px h-4 w-4 shrink-0 text-emerald-600" />
                                                <p className="min-w-0 leading-snug">{conNegritas(sinOInicial(sol.texto))}</p>
                                            </div>
                                        ))}

                                        {/* ── Qué hacer ──
                                            Franja propia, del color del aviso: es lo que hace que
                                            un Media sin botón verde deje de parecer un cartel que
                                            sólo informa. Desde el 26/09/2026 va redondeada ADENTRO
                                            de la tarjeta, como en el mockup, y no pegada al borde. */}
                                        {!informativo && (
                                            <div className={cn(
                                                "mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2 text-[12.5px]",
                                                franjaRosa ? "bg-rose-50" : "bg-amber-50",
                                            )}>
                                                {/* Ícono y texto en un bloque que no se parte: sueltos,
                                                    en el teléfono la llave quedaba sola en un renglón y
                                                    el texto abajo. */}
                                                <div className="flex min-w-0 flex-[3] basis-[15rem] items-start gap-2.5">
                                                <Wrench className={cn("mt-px h-4 w-4 shrink-0", franjaRosa ? "text-rose-600" : "text-amber-600")} />
                                                <p className={cn(
                                                    "min-w-0 font-medium leading-snug text-gray-800",
                                                    !activo && "line-clamp-2",
                                                )}>
                                                    {sol ? (
                                                        <>
                                                            {conNegritas(sinOInicial(sol.texto))}
                                                            {/* Sin link a Recursos (una pausa, o sin permiso
                                                                para esa solapa), el «dónde» se escribe: es lo
                                                                único que dice dónde se hace. */}
                                                            {!link && sol.donde && (
                                                                <span className="font-normal text-gray-500"> · {sol.donde}</span>
                                                            )}
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
                                                </div>

                                                {/* Acá iba el chip del «dónde» con su link cuando la
                                                    solución trae «Guardar en Recursos» (sin botón que
                                                    guarde, el link es el «Ir a arreglarlo» de abajo).
                                                    Desde el 26/09/2026 ese link vive en el menú «…»
                                                    («Ver en Recursos»): con el chip y los dos botones, a
                                                    la solución le quedaba un tercio de la franja y se
                                                    leía cortada en cuatro renglones —medido a 1000px—,
                                                    y es lo único de la franja que hay que leer. Adónde
                                                    va el cambio ya lo dice el botón verde. */}

                                                {/* Los botones, al final de la franja y siempre en el
                                                    mismo orden: primero lo que se prueba y se deshace,
                                                    después lo que queda cargado. Así la mano aprende la
                                                    fila una vez y no una por tipo de aviso. El «Listo»,
                                                    que era el tercero, vive ahora en el menú «…».

                                                    `max-w-full`: sin tope, en el teléfono el par de
                                                    botones medía más que la franja y «Guardar en
                                                    Recursos» quedaba cortado afuera de la tarjeta; con
                                                    tope, el grupo se ajusta y los botones bajan. */}
                                                <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
                                                    {/* ── El camino que NO toca nada ──
                                                        Va primero de la fila, y es de otro color, otro
                                                        borde y otro ícono que el que guarda: los dos hacen
                                                        lo mismo con el plan y cosas opuestas con los
                                                        datos, así que la única forma de que no se
                                                        confundan es que no se parezcan en nada. Punteado =
                                                        provisorio, el mismo par (índigo + punteado) que la
                                                        etiqueta «Entra al recalcular» de los ajustes.

                                                        Ya aplicado, el mismo botón lo saca: un "Deshacer"
                                                        aparte serían tres botones en la fila, y el de la
                                                        tarjeta de ajustes ya hace exactamente eso. */}
                                                    {accionSol && onAplicarSoloEstePlan && (
                                                        <button
                                                            type="button"
                                                            /* `revisando` también, y no sólo `aplicando`: `aplicando` es
                                                               el estado del botón verde (el que pega en los endpoints) y
                                                               este no pega en ninguno, así que mientras el plan se
                                                               recalculaba quedaba vivo. El velo de recálculo es
                                                               `pointer-events-none`, o sea que el click pasaba igual y
                                                               salían dos POST /planificar encimados. */
                                                            disabled={aplicando !== null || revisando || !!pisaAjuste}
                                                            onClick={() => aplicarSoloEstePlan(d, claveAjuste, accionSol)}
                                                            title={revisando
                                                                ? "Esperá a que termine el recálculo"
                                                                : pisaAjuste
                                                                    ? motivoPisa(pisaAjuste)
                                                                    : estadoAjuste === "por-agregar"
                                                                        ? "Marcado para el próximo recálculo. Tocá para desmarcarlo."
                                                                        : estadoAjuste === "por-quitar"
                                                                            ? "Se saca al recalcular. Tocá para dejarlo."
                                                                            : ajustada
                                                                                ? "Sacarlo de este plan en el próximo recálculo"
                                                                                : `${descripcionDeAccion(accionSol, nombreDeRango)} — solo para este cálculo, en Recursos no se guarda nada. Entra al recalcular.`}
                                                            /* Lo que el botón HACE, para el lector de pantalla y para el
                                                               que llega con el teclado: la etiqueta de la cara puesta es
                                                               un estado ("Puesto en este plan") y sola no dice que se
                                                               puede tocar para desarmarlo. */
                                                            aria-label={ajustada
                                                                ? `Sacar de este plan: ${d.titulo}`
                                                                : `Aplicar solo en este plan: ${d.titulo}`}
                                                            className={cn(
                                                                "group inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50",
                                                                estadoAjuste === "por-agregar" || estadoAjuste === "por-quitar"
                                                                    ? "border-indigo-400 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                                                                    : ajustada
                                                                        ? "border-indigo-400 bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                                                                        : "border-dashed border-indigo-300 bg-white text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50"
                                                            )}
                                                        >
                                                            {estadoAjuste === "por-agregar" || estadoAjuste === "por-quitar"
                                                                ? <Clock className="h-3.5 w-3.5 shrink-0" />
                                                                : ajustada
                                                                    ? <Check className="h-3.5 w-3.5 shrink-0" />
                                                                    : <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />}
                                                            {estadoAjuste === "por-agregar" ? (
                                                                <>Marcado · falta recalcular</>
                                                            ) : estadoAjuste === "por-quitar" ? (
                                                                <>Se saca al recalcular</>
                                                            ) : ajustada ? (
                                                                /* "Puesto en este plan" es un estado, pero el botón que lo
                                                                   dice es el que lo SACA, y eso vivía sólo en el `title=`:
                                                                   el que se arrepiente lo lee como etiqueta y no lo toca.
                                                                   Al pasar el mouse o al enfocarlo con el teclado pasa a
                                                                   decir qué hace. Las dos frases miden casi lo mismo a
                                                                   propósito (19 y 20 caracteres): así el botón no cambia
                                                                   de ancho y no empuja a los de al lado. */
                                                                <>
                                                                    <span className="group-hover:hidden group-focus:hidden">Puesto en este plan</span>
                                                                    <span className="hidden group-hover:inline group-focus:inline">Sacarlo de este plan</span>
                                                                </>
                                                            ) : (
                                                                <>Solo en este plan</>
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
                                                        prueba y se deshace, después lo que queda cargado—, así
                                                        la mano aprende la fila una vez y no una por tipo de
                                                        aviso. */}
                                                    {!sol?.accion && link && (
                                                        <a
                                                            href={link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 text-[12px] font-semibold text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-50"
                                                            title={`Abre ${sol?.donde} en otra pestaña, ya parado en lo que hay que tocar. Al volver acá se revisa solo.`}
                                                        >
                                                            Ir a arreglarlo
                                                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                                                        </a>
                                                    )}
                                                    {/* ── El camino que SÍ toca la base ──
                                                        Verde lleno y con ícono de guardar, que en esta
                                                        pantalla es lo único que quiere decir "esto queda
                                                        cargado". El nombre dice DÓNDE queda: "Aplicar y
                                                        recalcular" no decía nada de eso, y al lado de un
                                                        botón que aplica y recalcula sin guardar era
                                                        directamente indistinguible. */}
                                                    {sol?.accion && puedeGuardarEnRecursos(sol.accion) && (
                                                        <Button
                                                            size="sm"
                                                            disabled={hecha || aplicando !== null || !!pisaGuardar}
                                                            /* Sólo arma el cartel: guarda el «Sí, aplicalo»
                                                               de abajo (ver `confirmando`). */
                                                            onClick={() => setConfirmando(claveSol)}
                                                            aria-expanded={confirmando === claveSol}
                                                            title={hecha
                                                                ? "Ya está guardado en Recursos. Se ve en el plan al recalcular."
                                                                : pisaGuardar
                                                                    ? motivoPisa(pisaGuardar)
                                                                    : aplicando !== null
                                                                        ? "Esperá a que termine de guardar"
                                                                        : confirmando === claveSol
                                                                            ? "Abajo está el detalle de lo que va a cambiar: se guarda desde ahí"
                                                                            : "Queda guardado en Recursos para siempre, para todos los planes"}
                                                            /* Sin ancho fijo: con dos botones en la fila, dos
                                                               anchos fijos no entran en una notebook y el par se
                                                               partía en dos renglones. */
                                                            className={cn(
                                                                "h-8 justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold shadow-none",
                                                                hecha
                                                                    ? "bg-transparent text-emerald-700 hover:bg-transparent"
                                                                    : confirmando === claveSol
                                                                        ? "bg-amber-500 text-white hover:bg-amber-600"
                                                                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                                                            )}
                                                        >
                                                            {aplicando === claveSol ? (
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            ) : hecha ? (
                                                                <Check className="h-3.5 w-3.5" />
                                                            ) : (
                                                                <Save className="h-3.5 w-3.5" />
                                                            )}
                                                            {hecha
                                                                ? "Guardado · falta recalcular"
                                                                : confirmando === claveSol
                                                                    ? "Confirmá abajo"
                                                                    : "Guardar en Recursos"}
                                                        </Button>
                                                    )}
                                                </div>
                                                {/* Escrito y no sólo en el `title`: en la tablet no hay
                                                    hover, y un botón apagado sin motivo es un botón muerto. */}
                                                {(pisaGuardar || pisaAjuste) && (
                                                    <p className="basis-full text-right text-[11.5px] leading-snug text-amber-800">
                                                        {motivoPisa((pisaGuardar || pisaAjuste)!)}
                                                    </p>
                                                )}
                                                {siguenTrasGuardar.has(d.id) && !hecha && (
                                                    <p className="basis-full text-right text-[11.5px] leading-snug text-gray-500">
                                                        Lo guardaste en Recursos, pero después de recalcular el aviso sigue.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* Abierto: el porqué largo, TODAS las soluciones que no
                                            están en la franja (cada una con su link y su botón),
                                            los consejos y todas las OT. */}
                                        {activo && (
                                            <div className="mt-3 space-y-2.5 border-t border-gray-100 pt-3 text-[12.5px] leading-relaxed text-gray-600">
                                                {/* El porqué largo. Sólo si hay un `resumen`: cuando no
                                                    lo hay, el detalle YA se está leyendo arriba y
                                                    repetirlo sería decir dos veces lo mismo. */}
                                                {d.resumen && d.detalle && (
                                                    <p>{conNegritas(sinLoQueYaDijo(d.detalle, d.resumen))}</p>
                                                )}
                                                {/* Un proceso y su preparación trabados por lo mismo
                                                    vienen en un solo aviso (lib/unificarAvisos): acá se
                                                    dice qué junta y por qué alcanza con un arreglo. */}
                                                {d.pasos && d.pasos.length > 1 && (
                                                    <div>
                                                        <span className="font-semibold text-gray-700">Pasos: </span>
                                                        {d.pasos.map((p, k) => (
                                                            <span key={`${p.nombre}-${k}`}>
                                                                {k > 0 && <span className="text-gray-400"> + </span>}
                                                                <span className="font-medium text-gray-800">{p.nombre}</span>
                                                                {" · "}{p.procesos} {p.procesos === 1 ? "proceso" : "procesos"}, {p.ots.length} OT
                                                            </span>
                                                        ))}
                                                        <span className="block text-[11.5px] text-gray-500">
                                                            {d.pasos.length > 2
                                                                ? <>Las preparaciones usan el rango de {d.pasos[0].nombre}: se arreglan con el mismo cambio.</>
                                                                : <>La preparación usa el rango de {d.pasos[0].nombre}: se arregla con el mismo cambio.</>}
                                                        </span>
                                                    </div>
                                                )}
                                                {/* Las OTRAS opciones, no todas: la que se ve en la
                                                    franja de arriba se saltea. Estaba dos veces, una
                                                    arriba y otra acá, palabra por palabra — se ve en la
                                                    captura que mandó Julián el 17/09/2026. */}
                                                {otras > 0 && (
                                                    <ul className="space-y-1.5">
                                                        {d.soluciones.map((s, idx) => {
                                                            // Las notas van aparte, abajo y en gris.
                                                            if (idx === iSol || esNota(s)) return null;
                                                            const clave = `${d.id}-${idx}`;
                                                            const hechaEsta = aplicadas.has(clave);
                                                            const linkEste = enlace(d, s);
                                                            // Los dos caminos, también acá: desplegada la tarjeta
                                                            // salen TODAS las soluciones, y si el botón de probar
                                                            // solo estuviera en la franja, las alternativas ("O
                                                            // ponele el rango a la otra fresadora") no se podrían
                                                            // probar sin guardarlas.
                                                            const accionEsta = accionAjustable(s);
                                                            // Mismo criterio que arriba: el ajuste se reconoce por lo
                                                            // que toca, no por el número de renglón.
                                                            const claveAjusteEsta = accionEsta ? claveDeAjuste(accionEsta) : "";
                                                            const estadoEsta = claveAjusteEsta ? estadoPorClave.get(claveAjusteEsta) : undefined;
                                                            const ajustadaEsta = !!estadoEsta;
                                                            const pendienteEsta = estadoEsta === "por-agregar" || estadoEsta === "por-quitar";
                                                            // Mismo criterio que en la franja: puesto se puede
                                                            // sacar, pero no volver a dejar sobre un guardado.
                                                            const pisaAjusteEsta = ajustadaEsta && estadoEsta !== "por-quitar" ? null : pisaUnGuardado(accionEsta);
                                                            const pisaGuardarEsta = hechaEsta ? null : pisaUnGuardado(s.accion);
                                                            return (
                                                                <li key={idx} className="flex items-start gap-2">
                                                                    <Wrench className="mt-[4px] h-3.5 w-3.5 shrink-0 text-gray-400" />
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
                                                                                        className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-px align-baseline text-[11px] text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                                                                                        title="Abrir en otra pestaña, ya parado en lo que hay que tocar"
                                                                                    >
                                                                                        {s.donde}
                                                                                        <ArrowUpRight className="h-3 w-3" />
                                                                                    </a>
                                                                                ) : (
                                                                                    /* Mismo criterio que arriba: sin forma de
                                                                                       cartelito, porque no lleva a ningún lado. */
                                                                                    <span className="inline-block whitespace-nowrap px-1 py-px align-baseline text-[11px] text-gray-400">
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
                                                                                    /* Igual que el de la franja: mientras el plan se
                                                                                       recalcula este botón no se puede tocar, o salen
                                                                                       dos POST /planificar encimados. */
                                                                                    disabled={aplicando !== null || revisando || !!pisaAjusteEsta}
                                                                                    onClick={() => aplicarSoloEstePlan(d, claveAjusteEsta, accionEsta)}
                                                                                    title={revisando
                                                                                        ? "Esperá a que termine el recálculo"
                                                                                        : pisaAjusteEsta
                                                                                            ? motivoPisa(pisaAjusteEsta)
                                                                                            : estadoEsta === "por-agregar"
                                                                                                ? "Marcado para el próximo recálculo. Tocá para desmarcarlo."
                                                                                                : estadoEsta === "por-quitar"
                                                                                                    ? "Se saca al recalcular. Tocá para dejarlo."
                                                                                                    : ajustadaEsta
                                                                                                        ? "Sacarlo de este plan en el próximo recálculo"
                                                                                                        : `${descripcionDeAccion(accionEsta, nombreDeRango)} — solo para este cálculo, en Recursos no se guarda nada. Entra al recalcular.`}
                                                                                    aria-label={ajustadaEsta
                                                                                        ? `Sacar de este plan: ${d.titulo}`
                                                                                        : `Aplicar solo en este plan: ${d.titulo}`}
                                                                                    className={cn(
                                                                                        "group inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border px-2 align-baseline text-[11px] font-medium transition-colors disabled:opacity-50",
                                                                                        pendienteEsta
                                                                                            ? "border-indigo-400 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                                                                                            : ajustadaEsta
                                                                                                ? "border-indigo-400 bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
                                                                                                : "border-dashed border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
                                                                                    )}
                                                                                >
                                                                                    {pendienteEsta
                                                                                        ? <Clock className="h-3 w-3" />
                                                                                        : ajustadaEsta
                                                                                            ? <Check className="h-3 w-3" />
                                                                                            : <SlidersHorizontal className="h-3 w-3" />}
                                                                                    {estadoEsta === "por-agregar" ? "Marcado · falta recalcular"
                                                                                    : estadoEsta === "por-quitar" ? "Se saca al recalcular"
                                                                                    : ajustadaEsta ? (
                                                                                        /* Mismo cambio de cara que en la franja: puesto
                                                                                           dice el estado, y con el mouse encima o con el
                                                                                           foco del teclado dice que ése es el botón que
                                                                                           lo saca. */
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
                                                                                    disabled={hechaEsta || aplicando !== null || !!pisaGuardarEsta}
                                                                                    onClick={() => setConfirmando(clave)}
                                                                                    aria-expanded={confirmando === clave}
                                                                                    title={hechaEsta
                                                                                        ? "Ya está guardado en Recursos. Se ve en el plan al recalcular."
                                                                                        : pisaGuardarEsta
                                                                                            ? motivoPisa(pisaGuardarEsta)
                                                                                            : aplicando !== null
                                                                                                ? "Esperá a que termine de guardar"
                                                                                                : confirmando === clave
                                                                                                    ? "Abajo está el detalle de lo que va a cambiar: se guarda desde ahí"
                                                                                                    : "Queda guardado en Recursos para siempre, para todos los planes"}
                                                                                    className={cn(
                                                                                        "h-6 gap-1 rounded-md px-2 align-baseline text-[11px]",
                                                                                        hechaEsta
                                                                                            ? "text-emerald-700"
                                                                                            : confirmando === clave
                                                                                                ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                                                                                : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                                                                                    )}
                                                                                >
                                                                                    {aplicando === clave ? (
                                                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                                                    ) : hechaEsta ? (
                                                                                        <Check className="h-3 w-3" />
                                                                                    ) : (
                                                                                        <Save className="h-3 w-3" />
                                                                                    )}
                                                                                    {/* Mismo texto que el botón de la franja: es el
                                                                                        mismo cambio y la misma clave, y con dos
                                                                                        nombres distintos para el mismo botón —"Tocá de
                                                                                        nuevo para confirmar" acá, "Mirá abajo qué
                                                                                        cambia" arriba— el paso del medio parecía otra
                                                                                        cosa según de dónde lo hubieras tocado. Armado
                                                                                        dice «Confirmá abajo» y no «Mirá y confirmá»
                                                                                        (26/09/2026): tocarlo otra vez ya no guarda, y
                                                                                        el texto no tiene que invitar a hacerlo. */}
                                                                                    {hechaEsta
                                                                                        ? "Guardado · falta recalcular"
                                                                                        : confirmando === clave
                                                                                            ? "Confirmá abajo"
                                                                                            : "Guardar en Recursos"}
                                                                                </Button>
                                                                            </>
                                                                        )}
                                                                        {(pisaGuardarEsta || pisaAjusteEsta) && (
                                                                            <span className="mt-0.5 block text-[11.5px] leading-snug text-amber-800">
                                                                                {motivoPisa((pisaGuardarEsta || pisaAjusteEsta)!)}
                                                                            </span>
                                                                        )}
                                                                        {/* Qué hace exactamente el botón índigo, escrito.
                                                                            Hasta acá eso vivía sólo en un `title=`: en una
                                                                            tablet no hay hover, y es el mismo argumento con
                                                                            el que este cambio sacó el criterio Alta/Media de
                                                                            un tooltip. Va en la tarjeta DESPLEGADA, que es
                                                                            donde hay alto para gastar; en la franja sigue
                                                                            alcanzando el nombre del botón, porque la
                                                                            tarjeta plegada es para barrer la lista. */}
                                                                        {accionEsta && onAplicarSoloEstePlan && (
                                                                            <span className="mt-0.5 flex items-start gap-1 text-[11.5px] leading-snug text-indigo-800/90">
                                                                                <SlidersHorizontal className="mt-[3px] h-3 w-3 shrink-0" />
                                                                                <span className="min-w-0">
                                                                                    <strong className="font-semibold">
                                                                                        {estadoEsta === "por-agregar"
                                                                                            ? "Marcado solo para este plan (entra al recalcular): "
                                                                                            : estadoEsta === "por-quitar"
                                                                                                ? "Se saca de este plan al recalcular: "
                                                                                                : ajustadaEsta ? "Puesto solo en este plan: " : "Solo en este plan: "}
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
                                                {/* Consejos que no se tocan desde acá («planificá menos
                                                    OTs juntas»): en gris y con la ⓘ, no con la llave de
                                                    las soluciones. */}
                                                {notas.length > 0 && (
                                                    <ul className="space-y-1">
                                                        {notas.map((s, k) => (
                                                            <li key={k} className="flex items-start gap-2 text-[12px] leading-snug text-gray-500">
                                                                <Info className="mt-[3px] h-3.5 w-3.5 shrink-0 text-gray-400" />
                                                                <span>
                                                                    {conNegritas(sinOInicial(s.texto))}
                                                                    {s.donde && <span className="text-gray-400"> · {s.donde}</span>}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                                {/* Todas las OT, como chips que envuelven: plegada se
                                                    ven dos en el renglón de datos, abierta todas acá.
                                                    Sin `onVerOT` no llevan a ningún lado y van como
                                                    texto. */}
                                                {otsDelAviso.length > 0 && (
                                                    <div>
                                                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                                            OT ({otsDelAviso.length})
                                                        </p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {otsDelAviso.map((o) => onVerOT ? (
                                                                <button
                                                                    key={o.id}
                                                                    type="button"
                                                                    onClick={() => onVerOT(o.id)}
                                                                    className="inline-flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-2 text-[12px] tabular-nums text-gray-600 transition-colors hover:border-indigo-200 hover:bg-white hover:text-indigo-700"
                                                                    title={`Ir a la OT #${o.numero} en el plan`}
                                                                >
                                                                    #{o.numero}
                                                                </button>
                                                            ) : (
                                                                <span
                                                                    key={o.id}
                                                                    className="inline-flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-2 text-[12px] tabular-nums text-gray-500"
                                                                >
                                                                    #{o.numero}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {/* El mismo «Listo» del menú, pero acá adentro hay
                                                    lugar para decir qué hace de verdad: no arregla
                                                    nada, deja de mostrarlo. Se llamaba "Marcar como
                                                    resuelto", que era el quinto nombre distinto para la
                                                    misma acción en la misma pantalla —"Marcar todo listo",
                                                    "Listo", "Marcar como resuelto", "Lo diste listo",
                                                    "Marcado como resuelto"—: ahora todos empiezan igual.
                                                    De texto y en gris: el verde quedó para lo que toca
                                                    la base, y de las acciones de la tarjeta ésta es la
                                                    que menos hace. */}
                                                <div className="flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => marcar(d)}
                                                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                                                        title="No cambia el plan ni los datos: lo pasa a «Resueltos», abajo de la lista. Se deshace."
                                                        aria-label={`Listo, no mostrar más: ${d.titulo}`}
                                                    >
                                                        <Check className="h-3.5 w-3.5" />
                                                        Listo, no lo muestres más
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* El paso de confirmación, con el cambio escrito, al pie de
                                    la tarjeta. Antes el botón armado solo decía "Tocá de
                                    nuevo": pedía confirmar sin haber dicho nunca qué. Vale
                                    para el botón de la franja y para los del detalle — sale
                                    de `confirmando`, que es el mismo estado para todos.

                                    Hasta el 26/09/2026 estos botones llevaban `onMouseDown`
                                    con preventDefault, porque el botón de arriba limpiaba
                                    `confirmando` en su onBlur y el panel se desmontaba antes
                                    de que llegara el click. Ese onBlur ya no existe (ver el
                                    efecto que limpia `confirmando`), y con él la razón. */}
                                {armada?.accion && (
                                    <>
                                        <ResumenDelCambio accion={armada.accion} />
                                        <div className="flex flex-wrap items-center justify-end gap-2 bg-amber-50/70 px-4 pb-3">
                                            <button
                                                type="button"
                                                onClick={() => setConfirmando(null)}
                                                className="rounded-md px-2.5 py-1 text-[12px] font-medium text-amber-900/70 transition-colors hover:bg-amber-100 hover:text-amber-900"
                                            >
                                                Cancelar
                                            </button>
                                            <Button
                                                size="sm"
                                                onClick={() => aplicar(confirmando!, armada.accion!, d.titulo)}
                                                disabled={aplicando !== null}
                                                className="h-8 gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700"
                                            >
                                                {aplicando !== null && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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

            {/* Discretos y centrados, debajo de la lista: son para ver más, no una acción
                sobre los avisos. Dice las que FALTAN y no el total: antes había otro igual
                en el encabezado («+N más») y con dos números distintos para lo mismo había
                que pararse a pensar cuál era cuál. */}
            {!colapsado && (ocultas > 0 || (verTodas && ordenados.length > VISIBLES)) && (
                <div className="flex justify-center">
                    {ocultas > 0 ? (
                        <button
                            type="button"
                            onClick={() => setVerTodas(true)}
                            className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900"
                        >
                            Ver los {ocultas} que faltan
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setVerTodas(false)}
                            className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-800"
                        >
                            Mostrar solo las primeras {VISIBLES}
                        </button>
                    )}
                </div>
            )}

            {/* ── Resueltos y marcados a mano ──
                Después de la lista y no antes (mockup del 26/09/2026): son la confirmación
                de que algo se arregló, no algo para leer primero. Mismas filas de siempre,
                en una tarjeta verde compacta. */}
            {!colapsado && (resueltos.length > 0 || aMano.length > 0) && (
                <section
                    aria-labelledby="avisos-resueltos-titulo"
                    className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 pb-3 pt-2.5"
                >
                    {/* Marcado a mano no es resuelto (ver `resumenHeader`): el título dice
                        cuál de las dos cosas hay, o las dos. */}
                    <h3 id="avisos-resueltos-titulo" className="flex items-center gap-1.5 px-1 pb-2 text-[13px] font-semibold text-emerald-900">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        {resueltos.length > 0 && aMano.length > 0
                            ? "Resueltos y dados por listos"
                            : resueltos.length > 0 ? "Resueltos" : "Dados por listos"}
                        {" "}({resueltos.length + aMano.length})
                    </h3>
                    <ul className="space-y-1.5">
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
                            const linkBase = solAplicada ? enlace(d, solAplicada) : null;
                            // Con `hecho=1`: Recursos dice «Ya quedó aplicado» en vez de «Qué
                            // hacer: …», que hacía parecer que el botón no había hecho nada.
                            const linkResuelto = linkBase ? enlaceDeLoHecho(linkBase) : null;
                            return (
                                <li
                                    key={clave}
                                    className="overflow-hidden rounded-lg border border-emerald-200 bg-white/80"
                                >
                                    <button
                                        type="button"
                                        aria-expanded={abierta}
                                        onClick={() => toggle(clave)}
                                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-emerald-50/60"
                                    >
                                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                        {/* "Se arregló" y no "Resuelto": en la misma tarjeta
                                            están los que alguien dio por resueltos a mano, y con
                                            los dos diciendo lo mismo no había forma de saber cuál
                                            de las dos filas era un problema que ya no existe y
                                            cuál un problema que sigue ahí. */}
                                        <span className="inline-flex min-w-[104px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-semibold leading-[18px] text-emerald-700">
                                            Se arregló
                                        </span>
                                        <span className={cn(
                                            "min-w-0 flex-1 text-[13px] leading-tight text-gray-500 decoration-emerald-600/40",
                                            abierta ? "line-clamp-none" : "truncate line-through"
                                        )}>
                                            {d.titulo}
                                        </span>
                                        <ChevronDown className={cn(
                                            "h-4 w-4 shrink-0 text-emerald-700/50 transition-transform",
                                            abierta && "rotate-180"
                                        )} />
                                    </button>
                                    {abierta && (
                                        <div className="space-y-1.5 border-t border-emerald-100 bg-white/60 px-3 py-2">
                                            <p className="text-[12px] leading-snug text-gray-600">
                                                <span className="font-semibold text-gray-700">Qué pasaba: </span>
                                                {conNegritas(d.detalle)}
                                            </p>
                                            {solAplicada ? (
                                                <p className="text-[12px] leading-snug text-gray-600">
                                                    <span className="font-semibold text-emerald-700">Se aplicó: </span>
                                                    {conNegritas(sinOInicial(solAplicada.texto))}
                                                    {/* Lo único que se le atribuye al arreglo es lo
                                                        probado: la preparación usa el rango de su
                                                        producción, así que se fue con el mismo cambio. */}
                                                    {(d.pasos?.length ?? 0) > 1 && (
                                                        <> {d.pasos!.length > 2 ? "Sus preparaciones se arreglaron" : "Su preparación se arregló"} con el mismo cambio.</>
                                                    )}
                                                </p>
                                            ) : (
                                                /* Sin atribuirle la causa a nadie: el solver no es
                                                   determinista (varios hilos, tope de tiempo), así que
                                                   un aviso puede irse de un cálculo a otro sin que nadie
                                                   haya tocado nada. Decía «o lo arreglaste en Recursos, o
                                                   la OT salió del plan», y en la preparación que se había
                                                   ido con el arreglo de Prensa era falso. */
                                                <p className="text-[12px] leading-snug text-gray-500">
                                                    Ya no aparece en este cálculo. Puede haberlo destrabado otro arreglo, un cambio en Recursos, o que la OT salió del plan.
                                                </p>
                                            )}
                                            {linkResuelto && (
                                                <a
                                                    href={linkResuelto}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-50"
                                                    title={`Abrir ${solAplicada?.donde} para revisar cómo quedó`}
                                                >
                                                    Ver cómo quedó
                                                    <ArrowUpRight className="h-3 w-3" />
                                                </a>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}

                        {/* Los marcados a mano van en la misma tarjeta pero NO dicen
                            "Resuelto": dicen quién lo dio por resuelto. La diferencia
                            importa —el problema sigue en el plan— y es lo único que
                            separa esta fila de la de arriba. */}
                        {aMano.map((d) => (
                            <li
                                key={`marcado-${d.id}`}
                                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/80 px-2.5 py-1.5"
                            >
                                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                                <span className="inline-flex min-w-[104px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50/70 px-1.5 text-[11px] font-semibold leading-[18px] text-emerald-700">
                                    {/* Dice QUIÉN lo cerró, que es la única diferencia con la fila
                                        de arriba: el problema sigue en el plan, lo único que pasó es
                                        que alguien lo dio por visto. Y usa la misma palabra que el
                                        botón ("Listo") para que se lea como la misma acción. */}
                                    Lo diste por listo
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[13px] leading-tight text-gray-500 line-through decoration-emerald-600/30" title={d.titulo}>
                                    {d.titulo}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => desmarcar(d.id)}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-800"
                                    title="Devolverlo a la lista de avisos"
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Deshacer
                                </button>
                            </li>
                        ))}

                        {aMano.length > 1 && (
                            <li className="pt-0.5 text-right">
                                <button
                                    type="button"
                                    onClick={() => cambiarMarcados(new Set())}
                                    className="rounded-md px-2 py-0.5 text-[12px] font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-800"
                                >
                                    Devolver los {aMano.length} a la lista
                                </button>
                            </li>
                        )}
                    </ul>
                </section>
            )}
        </div>
    );
}
