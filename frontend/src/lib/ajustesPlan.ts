/**
 * Los "ajustes solo para este plan": arreglar una traba SIN tocar Recursos.
 *
 * Los avisos del planificador ya traían un botón que aplicaba la solución, pero ese
 * botón escribe en Recursos: abrirle una fresadora a MEDIO OFICIAL para que entre
 * esta tanda deja a la fresadora abierta para siempre, para todos los planes y para
 * todo el que la mire después. El pedido de Julián (17/09/2026), copiado tal cual se
 * escribió —tipeos incluidos: una cita "arreglada" ya no se puede buscar ni verificar
 * contra el original—: *"si por ejemplo esas medianas solo se quieren solucionar para
 * esa planificacion un boton para aplicar la solucion solo para esta pla ificacion y no
 * me cambie todo en la base de datos"*.
 *
 * Entonces son dos caminos distintos y a propósito:
 *
 *  - **Permanente** (el que ya estaba): pega en los endpoints de rangos/skills, queda
 *    en la base, lo ve todo el mundo. Pide confirmación en dos pasos.
 *  - **Solo este plan** (esto): no escribe NADA. El ajuste vive en el estado de la
 *    vista previa, viaja en el body de `/planificar` como `ajustes_del_plan` y el
 *    backend lo aplica en memoria al armar el cálculo. Se deshace con un botón y se
 *    pierde si se descarta el borrador.
 *
 * Por qué vive acá y no adentro de `DiagnosticosPlan`: el array `diagnosticos` se
 * reemplaza entero en cada recálculo, así que cualquier estado guardado ahí adentro
 * se perdería justo cuando vuelve el plan que el ajuste produjo. El dueño del estado
 * es la vista previa; el panel solo dibuja y avisa.
 *
 * Y por qué la dependencia va en UN solo sentido —el panel importa de acá, acá no
 * importa del panel—: si el tipo de la acción viviera en el componente, esta lib
 * arrastraría un archivo `"use client"` de 1500 líneas para definir tres campos.
 */

/**
 * Cada cosa que toca una solución: para skill_nativa un operario, si no un proceso o
 * una máquina.
 *
 * `suma` y `tenia` vienen con los NOMBRES de los rangos, no con ids: son lo que se
 * muestra antes de aplicar, porque un conjunto final no se puede leer —no dice si
 * agrega uno o tres—. `rangos` sí es el conjunto final, que es lo que se manda.
 *
 * Tiene nombre propio (y no queda escrito adentro de la acción) porque el fallback de
 * `objetivosDe` arma uno a mano: sin un tipo común, TypeScript ve dos arrays distintos
 * y no deja ni recorrerlos con `.map()`.
 */
export type ObjetivoDeAccion = {
    id: number;
    nombre: string;
    rangos?: number[];
    suma?: string[];
    tenia?: string[];
    /**
     * Lo mismo que `suma`, en ids: lo que el aviso le AGREGA a este objetivo. Es lo que
     * viaja en el link «Ir a arreglarlo» (ver `lib/avisoEnRecursos`). Los avisos
     * calculados antes del 23/09/2026 no lo traen.
     */
    suma_ids?: number[];
};

/**
 * La forma de una acción de solución, tal como la manda el backend.
 *
 * Es la misma que `DiagnosticoAccion` del panel de avisos: se define acá y el panel
 * la re-exporta, para que no haya dos definiciones que se puedan ir separando.
 *
 * `rangos` es el conjunto FINAL (los que ya tenía más los nuevos), no un agregado:
 * así lo manda el backend y así lo esperan tanto los endpoints de Recursos como el
 * `ajustes_del_plan` de `/planificar`.
 */
export type AccionDeSolucion = {
    tipo: "proceso" | "maquinaria" | "skill_nativa";
    id: number;
    nombre: string;
    rangos?: number[];
    /** Para skill_nativa: a qué estado se lleva la habilidad. */
    habilitado?: boolean;
    /** Cada cosa a tocar. Sin esto la acción toca una sola: es el formato viejo. */
    objetivos?: ObjetivoDeAccion[];
};

/** Un ajuste vigente: una solución aplicada SOLO a este cálculo. */
export type AjusteDelPlan = {
    /**
     * La identidad del ajuste, la que arma `claveDeAjuste`: a QUÉ le cambia el dato.
     * Con eso se saca de la tira y se evita que la misma cosa entre dos veces.
     */
    clave: string;
    /** El título del aviso que destraba, para poder contarlo en la tira. */
    titulo: string;
    /** Qué hace, en una línea y en criollo. Ej: "A FRESADORA 1 y FRESADORA 2 se les suma OFICIAL CNC". */
    descripcion: string;
    accion: AccionDeSolucion;
    /**
     * Si el plan que está en pantalla ya salió con este ajuste.
     *
     * Hasta el 25/09/2026 marcar un ajuste recalculaba en el mismo click, así que todo
     * ajuste de la lista estaba, por definición, adentro del plan. Julián: *"cada vez
     * que hago un cambio de alguna traba se replanifica todo, cuando tendría que
     * dejarme terminar de verlas y ahí se replanifique"* —con 48 OT cada vuelta son
     * unos 4 minutos—. Ahora se marcan de a varios y se recalcula una vez, y entre
     * medio hay que saber cuáles ya están en el plan y cuáles no:
     *
     *  - `calculado`: el plan de la pantalla salió con él.
     *  - `por-agregar`: marcado, entra en el próximo recálculo.
     *  - `por-quitar`: está en el plan de la pantalla, se va en el próximo recálculo.
     *
     * Sin estado vale `calculado`: los borradores de antes no lo traen y todo lo que
     * tenían se había calculado.
     */
    estado?: EstadoDeAjuste;
};

export type EstadoDeAjuste = "calculado" | "por-agregar" | "por-quitar";

/** El estado de un ajuste, con el valor de los borradores viejos. */
export const estadoDeAjuste = (a: AjusteDelPlan): EstadoDeAjuste => a.estado ?? "calculado";

/** Los que van en el PRÓXIMO recálculo: todos menos los que se están sacando. */
export const ajustesParaElProximo = (l: AjusteDelPlan[]): AjusteDelPlan[] =>
    (l ?? []).filter((a) => estadoDeAjuste(a) !== "por-quitar");

/**
 * Con los que salió el plan que está EN PANTALLA: todos menos los recién marcados.
 *
 * Es lo que se cuenta al guardar el plan sin recalcular: el rastro tiene que decir con
 * qué se calculó de verdad lo que se guarda, no lo que alguien marcó después.
 */
export const ajustesDelPlanMostrado = (l: AjusteDelPlan[]): AjusteDelPlan[] =>
    (l ?? []).filter((a) => estadoDeAjuste(a) !== "por-agregar");

/** Los marcados que el plan de la pantalla todavía no tiene (para agregar o para sacar). */
export const ajustesPendientes = (l: AjusteDelPlan[]): AjusteDelPlan[] =>
    (l ?? []).filter((a) => estadoDeAjuste(a) !== "calculado");

/**
 * La lista como queda después de un recálculo que mandó `ajustesParaElProximo(l)`:
 * los que se sacaban ya no están y el resto quedó calculado.
 */
export const ajustesComoCalculados = (l: AjusteDelPlan[]): AjusteDelPlan[] =>
    ajustesParaElProximo(l).map((a) => (a.estado && a.estado !== "calculado" ? { ...a, estado: "calculado" as const } : a));

/**
 * Un cambio que se guardó en Recursos desde el panel de avisos y que el plan de la
 * pantalla todavía no tiene, porque desde el 25/09/2026 guardar no recalcula.
 * No va al borrador: al retomarlo, la huella de Recursos lo detecta sola.
 */
export type GuardadoSinRecalcular = {
    id: number;
    titulo: string;
    descripcion: string;
    accion: AccionDeSolucion;
};

/** El cuerpo que entiende el backend (`AjustesDelPlanDTO`). */
export type AjustesDelPlanPayload = {
    /** proceso_id -> conjunto FINAL de rangos. */
    procesos: Record<number, number[]>;
    /** maquinaria_id -> conjunto FINAL de rangos. */
    maquinarias: Record<number, number[]>;
    skills_nativas: { operario_id: number; proceso_id: number; habilitado: boolean }[];
};

/**
 * Los objetivos de una acción, siempre como lista.
 *
 * Sin `objetivos` la acción toca una sola cosa y los datos están sueltos en la raíz:
 * es el formato viejo, que sigue llegando de backends ya desplegados.
 */
function objetivosDe(accion: AccionDeSolucion): ObjetivoDeAccion[] {
    return accion.objetivos?.length
        ? accion.objetivos
        : [{ id: accion.id, nombre: accion.nombre, rangos: accion.rangos }];
}

/**
 * Cada cosa que toca, para detectar que dos ajustes se pisan. Ej: ["maquinaria:3","maquinaria:5"].
 *
 * Para `skill_nativa` no alcanza con el operario: la habilidad es el par (operario,
 * proceso), y apagarle SOLDADURA a Leonardo no se pisa con encenderle TORNEADO. Por
 * eso ahí el objetivo lleva los dos ids, en el mismo orden en que los guarda el
 * payload —el operario viene en `objetivos` y el proceso es el `id` de la acción—.
 */
export function objetivosDeAjuste(accion: AccionDeSolucion): string[] {
    if (!accion) return [];
    return objetivosDe(accion).map((o) =>
        accion.tipo === "skill_nativa"
            ? `skill_nativa:${o.id}:${accion.id}`
            : `${accion.tipo}:${o.id}`,
    );
}

/**
 * Lo mismo que `objetivosDeAjuste`, con el nombre de cada cosa al lado: para poder
 * escribir «Ya guardaste un cambio en PRENSA 1» sin ir a buscarlo a otro lado.
 */
export function objetivosConNombre(accion: AccionDeSolucion): { clave: string; nombre: string }[] {
    if (!accion) return [];
    const claves = objetivosDeAjuste(accion);
    return objetivosDe(accion).map((o, i) => ({ clave: claves[i], nombre: o.nombre }));
}

/**
 * La identidad de un ajuste: A QUÉ le cambia el dato, no en qué renglón del panel apareció.
 *
 * Se ordenan los objetivos antes de juntarlos para que la clave no dependa del orden
 * en que vinieron: la misma solución sobre PRENSA 1 y PRENSA 2 tiene que dar la misma
 * clave venga como venga. El orden es alfabético y no numérico a propósito: lo único
 * que se le pide es ser siempre el mismo. El tipo va adelante igual —aunque los
 * objetivos ya lo lleven— para que la clave se lea de un vistazo cuando aparece en un
 * log o en el React key de la tira.
 *
 * Por qué NO se usa el índice de la solución (`${diagnosticoId}-${indice}`), que es lo
 * primero que sale: el backend arma la lista de soluciones de cada aviso a partir de
 * los rangos —qué rango ya está en la máquina, cuántos lo tienen, a quién hay que
 * encenderle el proceso— y esos rangos son justo lo que el ajuste cambia. En el
 * recálculo que el propio ajuste dispara, la solución 0 pasa a ser otra, y la clave
 * queda apuntando a algo que nadie pidió. Lo que el ajuste toca, en cambio, no se
 * mueve de lugar.
 */
export function claveDeAjuste(accion: AccionDeSolucion): string {
    if (!accion) return "";
    // Los rangos propuestos van DENTRO de la clave, no sólo a qué cosa apuntan.
    //
    // Con la clave hecha nada más que de objetivos, dos soluciones DISTINTAS sobre la
    // misma fresadora eran el mismo ajuste: puesta una, el botón de la otra se dibujaba
    // como «Puesto en este plan» sin haberse aplicado nunca, y tocarlo borraba el ajuste
    // del primer aviso. Son dos cambios distintos sobre la misma máquina y tienen que
    // poder convivir; quien los suma es `payloadDeAjustes`.
    const partes = objetivosDe(accion).map((o) => {
        const que = accion.tipo === "skill_nativa"
            ? `skill_nativa:${o.id}:${accion.id}:${accion.habilitado === false ? "off" : "on"}`
            : `${accion.tipo}:${o.id}`;
        if (accion.tipo === "skill_nativa") return que;
        const rangos = [...(o.rangos ?? accion.rangos ?? [])].sort((a, b) => a - b);
        return `${que}=${rangos.join(",")}`;
    });
    return `${accion.tipo}|${Array.from(new Set(partes)).sort().join("+")}`;
}

/**
 * El cuerpo que viaja a `/planificar`. `undefined` si no hay ningún ajuste.
 *
 * El `undefined` importa: mandar `{procesos:{}, maquinarias:{}, skills_nativas:[]}`
 * haría que el backend registre "plan con ajustes" en el log y deje rastro de algo
 * que no pasó. Sin ajustes, el request tiene que ser exactamente el de antes.
 *
 * Si dos ajustes tocan el mismo proceso o la misma máquina, los rangos se SUMAN.
 *
 * Esto cambió y el porqué importa. Antes ganaba el último, apoyado en que el backend
 * armaba cada solución mirando los rangos ya ajustados: el segundo ajuste sobre la
 * misma fresadora traía adentro lo que había puesto el primero, así que pisarlo no
 * perdía nada. Eso dejó de ser cierto el 17/09/2026, cuando las acciones pasaron a
 * calcularse contra lo que dice Recursos —para que el botón que SÍ guarda no escriba
 * el rango temporal de un ajuste—. Desde entonces cada conjunto final es «lo que hay
 * guardado ∪ lo que propone ESTA solución», y pisar uno con otro borraba en silencio
 * el primero: la tira mostraba dos ajustes y el plan tenía uno solo.
 *
 * Sumarlos es exacto, no una aproximación: la unión de dos conjuntos así da
 * «lo guardado ∪ propuesta A ∪ propuesta B», que es justo el plan que se está
 * mirando. Y no depende del orden, con lo cual sacar uno cualquiera de los dos deja
 * el otro intacto sin tener que arrastrar nada.
 */
export function payloadDeAjustes(ajustes: AjusteDelPlan[]): AjustesDelPlanPayload | undefined {
    const procesos: Record<number, number[]> = {};
    const maquinarias: Record<number, number[]> = {};
    // Por (operario, proceso) y no una lista suelta: prender y después apagar la misma
    // habilidad tiene que quedar apagada, no mandar las dos órdenes y que decida el
    // orden en que el backend las lea.
    const skills = new Map<string, { operario_id: number; proceso_id: number; habilitado: boolean }>();

    for (const ajuste of ajustes ?? []) {
        const accion = ajuste?.accion;
        if (!accion) continue;
        for (const objetivo of objetivosDe(accion)) {
            if (accion.tipo === "skill_nativa") {
                skills.set(`${objetivo.id}-${accion.id}`, {
                    operario_id: objetivo.id,
                    proceso_id: accion.id,
                    habilitado: accion.habilitado ?? true,
                });
            } else {
                // La unión con lo que ya haya para esa misma cosa (ver el comentario de
                // arriba). Ordenado para que el cuerpo del request no cambie según en qué
                // orden se aplicaron los ajustes: si no, dos planes idénticos mandan dos
                // JSON distintos y comparar dos corridas se vuelve imposible.
                const destino = accion.tipo === "maquinaria" ? maquinarias : procesos;
                const juntos = new Set([
                    ...(destino[objetivo.id] ?? []),
                    ...(objetivo.rangos ?? accion.rangos ?? []),
                ]);
                destino[objetivo.id] = Array.from(juntos).sort((a, b) => a - b);
            }
        }
    }

    const skillsNativas = Array.from(skills.values());
    if (
        Object.keys(procesos).length === 0 &&
        Object.keys(maquinarias).length === 0 &&
        skillsNativas.length === 0
    ) {
        return undefined;
    }
    return { procesos, maquinarias, skills_nativas: skillsNativas };
}

/** "A y B", "A, B y C", "A, B y 3 más" — para no tapar la tira con veinte nombres. */
function enumerar(nombres: string[]): string {
    const limpios = nombres.filter(Boolean);
    if (limpios.length === 0) return "";
    if (limpios.length === 1) return limpios[0];
    if (limpios.length === 2) return `${limpios[0]} y ${limpios[1]}`;
    if (limpios.length === 3) return `${limpios[0]}, ${limpios[1]} y ${limpios[2]}`;
    return `${limpios.slice(0, 2).join(", ")} y ${limpios.length - 2} más`;
}

/**
 * Una línea que dice qué toca la acción, en el idioma del taller.
 *
 * Se muestra antes de aplicar (en el botón, para que nadie apriete a ciegas) y
 * después (en la tira de ajustes vigentes, para poder sacar el que no era). Los dos
 * lugares tienen que decir exactamente lo mismo, y por eso el texto se arma en un
 * solo lado.
 *
 * Y por eso mismo habla en impersonal —"se le suma", "se le apaga"— y no en primera
 * persona: un "le sumo" deja preguntando quién es ese yo, y un "le sumás" no cierra en
 * la tira, donde el ajuste ya está puesto y nadie está por apretar nada. El impersonal
 * sirve para los dos momentos y es el registro en el que ya estaban las otras ramas de
 * acá abajo ("lo puede hacer", "la puede usar").
 *
 * `nombreDeRango` es opcional porque el caso normal no lo necesita: el backend manda
 * los nombres en `suma`/`tenia` y con eso alcanza. Hace falta cuando la acción se
 * armó en pantalla a partir de un `objetivo` de solución —los avisos Media, que no
 * traen acción— y ahí lo único que hay son ids. Sin el traductor la tira diría
 * «rangos 3, 7», que es justo la jerga que se pidió sacar.
 */
export function descripcionDeAccion(
    accion: AccionDeSolucion,
    nombreDeRango?: (id: number) => string,
): string {
    if (!accion) return "";
    const objetivos = objetivosDe(accion);
    const listado = enumerar(objetivos.map((o) => o.nombre));
    const varios = objetivos.length > 1;

    if (accion.tipo === "skill_nativa") {
        const verbo = accion.habilitado === false
            ? (varios ? "se les apaga" : "se le apaga")
            : (varios ? "se les vuelve a encender" : "se le vuelve a encender");
        return `A ${listado} ${verbo} ${accion.nombre}`;
    }

    const quien = accion.tipo === "proceso"
        ? (varios ? "A los procesos" : "Al proceso")
        : (varios ? "A las máquinas" : "A la máquina");

    // `suma` es el delta —lo que se le agrega— y es lo que se entiende de un vistazo.
    // Se junta el de todos los objetivos porque la tira es una línea sola: cuando son
    // tres soldadoras con el mismo agregado, repetirlo tres veces no dice nada nuevo.
    const suma = Array.from(new Set(objetivos.flatMap((o) => o.suma ?? [])));
    if (suma.length > 0) {
        return `${quien} ${listado} ${varios ? "se les suma" : "se le suma"} ${enumerar(suma)}`;
    }

    // Sin delta queda el conjunto final, que es lo único que trae una acción armada en
    // pantalla. Se dice como conjunto ("puede hacerlo/usarla esta gente"), no como
    // agregado, porque reemplaza: decir "se le suma" sería mentir.
    const finales = objetivos[0]?.rangos ?? accion.rangos ?? [];
    if (finales.length > 0 && nombreDeRango) {
        const nombres = finales.map((id) => nombreDeRango(id)).filter(Boolean);
        if (nombres.length > 0) {
            return accion.tipo === "proceso"
                ? `${quien} ${listado} ${varios ? "los pueden" : "lo puede"} hacer ${enumerar(nombres)}`
                : `${quien} ${listado} ${varios ? "las pueden" : "la puede"} usar ${enumerar(nombres)}`;
        }
    }

    return `${quien} ${listado} ${varios ? "se les cambia" : "se le cambia"} quién ${accion.tipo === "proceso" ? "lo puede hacer" : "la puede usar"}`;
}
