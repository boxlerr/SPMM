/**
 * Los retoques a mano de la vista previa del plan: la persona, la máquina o el horario
 * que alguien eligió para un paso en lugar de lo que había puesto el planificador.
 *
 * UN RETOQUE ES SÓLO LO QUE LA PERSONA CAMBIÓ, NO LA FILA ENTERA.
 *
 * Hasta el 30/09/2026 se guardaba la fila completa (`{ ...fila, [campo]: valor }`) y la
 * pantalla la ponía EN LUGAR de la fila del plan. Mientras el plan era el mismo daba
 * igual, pero un recálculo conserva los retoques: cada fila retocada volvía con la
 * persona, la máquina, los minutos y las fechas del plan VIEJO, encimada con el nuevo.
 * Salían procesos superpuestos y trabas ya resueltas que reaparecían. En el borrador 19
 * (29/09/2026) había un retoque idéntico a su fila —Celiz en la FRESADORA CNC para el
 * fresado de la OT 15644, justo lo que Lucas pidió corregir— que no cambiaba nada y
 * habría vuelto a imponerse en cualquier recálculo.
 *
 * Ahora el retoque guarda sólo los campos cambiados y se funde sobre la fila del plan que
 * esté en pantalla (`aplicarRetoque`). Volver a elegir lo que había puesto el plan saca
 * ese campo del retoque: ya no es un cambio.
 *
 * AL RECALCULAR, LA PERSONA Y LA MÁQUINA SE CONSERVAN; EL HORARIO, SÓLO SI LA FILA NO SE MOVIÓ.
 *
 * La persona y la máquina son una decisión que vale en cualquier plan: «este fresado lo
 * hace Gustavo» sigue siendo cierto después de recalcular, así que se aplican sobre la
 * fila nueva. El horario, en cambio, se escribió mirando el plan de ese momento —el hueco
 * que había, lo que venía antes y después— y el recálculo reacomoda todo sin saber de él,
 * porque el planificador no recibe los retoques. Imponerlo sobre el plan nuevo es encimar
 * ese paso con lo que el plan puso ahí, que es justamente el solape de antes. Por eso cada
 * horario escrito recuerda dónde tenía la fila el plan (`inicio_del_plan`) y vale mientras
 * el plan la siga poniendo ahí: al retomar el borrador (el mismo plan) sigue, y si un
 * recálculo mueve la fila, deja de aplicarse y queda el horario del plan nuevo.
 *
 * AL CONFIRMAR, EL HORARIO ESCRITO SE GUARDA EN MINUTOS, que es lo único que guarda el
 * plan: `horarioEscrito` dice cuál hay que convertir.
 *
 * Lo que sigue sin resolverse: el planificador tampoco recibe la persona elegida. Después
 * de recalcular, la fila lleva el horario que el plan armó para OTRA persona y a la
 * elegida se le puede encimar con lo suyo. Es lo mismo que pasa con cualquier retoque sin
 * recalcular, y se ve igual: la fila marcada y la carga en el panel de recurso humano.
 */

/** Los campos que se pueden cambiar a mano, sin contar el horario. */
export const CAMPOS_DEL_RETOQUE = [
    "id_operario", "id_maquinaria", "usa_maquina", "va_a_mano", "sin_maquinaria",
] as const;
type CampoDeRecurso = (typeof CAMPOS_DEL_RETOQUE)[number];

/** Lo que este módulo lee de una fila del plan. */
export type FilaDelPlan = {
    id_operario?: number | null;
    id_maquinaria?: number | null;
    usa_maquina?: boolean;
    va_a_mano?: boolean;
    sin_maquinaria?: boolean;
    fecha_inicio_estimada?: string | null;
    fecha_fin_estimada?: string | null;
    inicio_min?: number | null;
    fin_min?: number | null;
    operario_nombre?: string | null;
    maquinaria_nombre?: string | null;
};

/** Lo que alguien le cambió a mano a una fila del plan. Nada más que eso. */
export type Retoque = {
    id_operario?: number | null;
    id_maquinaria?: number | null;
    usa_maquina?: boolean;
    va_a_mano?: boolean;
    sin_maquinaria?: boolean;
    /** El inicio escrito a mano, tal como lo da el campo de la pantalla («2026-10-01T14:00»). */
    fecha_inicio_estimada?: string;
    /** Dónde tenía la fila el plan cuando se escribió ese inicio; null si no tenía horario
     *  (un paso que quedó afuera). El horario escrito vale mientras el plan la deje ahí. */
    inicio_del_plan?: string | null;
};

/** Lo que se le puede pedir a `cambiarRetoque`. */
export type CambiosDelRetoque = Omit<Retoque, "inicio_del_plan">;

/**
 * El nombre de cada persona y de cada máquina, con el MISMO texto que le pone el plan a
 * `operario_nombre` y `maquinaria_nombre`. Sirve para que la fila retocada diga el nombre
 * de lo que se eligió —la hoja del pañol lo imprime— y para leer los retoques viejos (ver
 * `retoqueDeFilaEntera`). `undefined` quiere decir que no se sabe.
 */
export type Nombres = {
    operario: (id: number) => string | undefined;
    maquina: (id: number) => string | undefined;
};

/** Lo que vale un campo que la fila no trae: una fila sin `usa_maquina` usa máquina. */
const PREDETERMINADO: Record<CampoDeRecurso, unknown> = {
    id_operario: null,
    id_maquinaria: null,
    usa_maquina: true,
    va_a_mano: false,
    sin_maquinaria: false,
};

const valorDe = (campo: CampoDeRecurso, v: unknown) =>
    v === undefined || v === null ? PREDETERMINADO[campo] : v;

const mismoValor = (campo: CampoDeRecurso, a: unknown, b: unknown) =>
    valorDe(campo, a) === valorDe(campo, b);

/** El minuto de un horario: «…T14:00» (lo que da el campo) y «…T14:00:00» (lo que manda
 *  el backend) son el mismo. Vacío es «sin horario». */
const minutoDe = (v: unknown): string | null =>
    typeof v === "string" && v !== "" ? v.slice(0, 16) : null;

const mismoMinuto = (a: unknown, b: unknown) => minutoDe(a) === minutoDe(b);

const mismoNumero = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** El horario escrito a mano sigue valiendo: el plan tiene la fila donde la tenía cuando
 *  se escribió. */
export const horarioVigente = (fila: FilaDelPlan, retoque: Retoque): boolean =>
    retoque.fecha_inicio_estimada !== undefined
    && mismoMinuto(retoque.inicio_del_plan, fila.fecha_inicio_estimada);

/** Lo que da el campo de la pantalla cuando está completo: «2026-10-02T11:00». */
const FECHA_Y_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * El inicio escrito a mano que se GUARDA con esta fila, o `null` si la fila se guarda
 * con el horario del plan.
 *
 * Al confirmar no se guarda la fecha: se guardan los minutos del paso (`inicio_min`,
 * `fin_min`) y la fecha se vuelve a sacar de ellos al leer el plan. Hasta el 30/09/2026
 * la fila planificada se mandaba con los minutos del plan, así que el horario escrito se
 * veía en la pantalla y en la hoja del pañol y se perdía al guardar: se escribió 11:00
 * en un paso que el plan tenía a las 07:20 y quedó guardado a las 07:20. Esto dice qué
 * horario hay que pasar a minutos: el que sigue valiendo (`horarioVigente`), completo y
 * distinto del del plan. Uno en blanco —el campo a medio corregir— no mueve nada.
 */
export function horarioEscrito(fila: FilaDelPlan, retoque: Retoque | undefined): string | null {
    if (!retoque || !horarioVigente(fila, retoque)) return null;
    const escrito = minutoDe(retoque.fecha_inicio_estimada);
    if (!escrito || !FECHA_Y_HORA.test(escrito) || mismoMinuto(escrito, fila.fecha_inicio_estimada)) return null;
    return escrito;
}

/** Un retoque sin campos no es un retoque. */
const sinCampos = (retoque: Retoque) => Object.keys(retoque).length === 0;

/**
 * El retoque sin el horario que ya no vale; `null` si no queda nada. Si no había nada
 * que sacar devuelve EL MISMO objeto: así quien lo llama sabe que no cambió nada.
 */
function sinHorarioViejo(fila: FilaDelPlan, retoque: Retoque): Retoque | null {
    if (retoque.fecha_inicio_estimada !== undefined && horarioVigente(fila, retoque)) return retoque;
    if (retoque.fecha_inicio_estimada === undefined && !("inicio_del_plan" in retoque)) {
        return sinCampos(retoque) ? null : retoque;
    }
    const salida: Retoque = { ...retoque };
    delete salida.fecha_inicio_estimada;
    delete salida.inicio_del_plan;
    return sinCampos(salida) ? null : salida;
}

/** El nombre de lo elegido. Si no se encuentra, el de la fila sólo si es lo mismo. */
const nombreDe = (
    id: number | null | undefined,
    buscar: ((id: number) => string | undefined) | undefined,
    idDeLaFila: number | null | undefined,
    nombreDeLaFila: string | null | undefined,
): string | null => {
    if (id == null) return null;
    return buscar?.(id) ?? (id === idDeLaFila ? nombreDeLaFila ?? null : null);
};

/**
 * La fila tal como se ve: la del plan con lo que cambió la persona encima.
 *
 * Con la persona o la máquina cambia también el nombre: la fila del plan trae el de lo
 * que había elegido el planificador, y la hoja del pañol imprimía ése aunque en la
 * pantalla se hubiera elegido a otro.
 */
export function aplicarRetoque<T extends FilaDelPlan>(fila: T, retoque: Retoque | undefined, nombres?: Nombres): T {
    if (!retoque) return fila;
    const salida: T = { ...fila };
    const campos = salida as Record<string, unknown>;
    for (const campo of CAMPOS_DEL_RETOQUE) {
        if (campo in retoque) campos[campo] = retoque[campo];
    }
    if ("id_operario" in retoque) {
        salida.operario_nombre = nombreDe(retoque.id_operario, nombres?.operario, fila.id_operario, fila.operario_nombre);
    }
    if ("id_maquinaria" in retoque) {
        salida.maquinaria_nombre = nombreDe(retoque.id_maquinaria, nombres?.maquina, fila.id_maquinaria, fila.maquinaria_nombre);
    }
    if (horarioVigente(fila, retoque)) salida.fecha_inicio_estimada = retoque.fecha_inicio_estimada;
    return salida;
}

/**
 * El retoque de una fila después de que la persona cambió algo; `null` si no queda
 * ningún cambio.
 *
 * Lo que queda igual a lo que puso el plan se saca: elegir de vuelta a la persona que
 * había elegido el planificador no es un retoque, y así la fila deja de marcarse como
 * cambiada. Un horario en blanco —lo que da el campo mientras se lo está corrigiendo— se
 * guarda como tal: devolverle a la fuerza el horario del plan le borraría a la persona lo
 * que está escribiendo.
 */
export function cambiarRetoque(
    fila: FilaDelPlan,
    retoque: Retoque | undefined,
    cambios: CambiosDelRetoque,
): Retoque | null {
    const nuevo: Retoque = { ...(retoque ?? {}) };
    const campos = nuevo as Record<string, unknown>;
    for (const campo of CAMPOS_DEL_RETOQUE) {
        if (!(campo in cambios)) continue;
        if (mismoValor(campo, cambios[campo], fila[campo])) delete campos[campo];
        else campos[campo] = valorDe(campo, cambios[campo]);
    }
    if ("fecha_inicio_estimada" in cambios) {
        const escrito = cambios.fecha_inicio_estimada ?? "";
        if (mismoMinuto(escrito, fila.fecha_inicio_estimada)) {
            delete nuevo.fecha_inicio_estimada;
            delete nuevo.inicio_del_plan;
        } else {
            nuevo.fecha_inicio_estimada = escrito;
            nuevo.inicio_del_plan = fila.fecha_inicio_estimada ?? null;
        }
    }
    return sinHorarioViejo(fila, nuevo);
}

/** Si la fila, con el retoque encima, queda distinta de como la dejó el plan. */
export function hayCambios(fila: FilaDelPlan, retoque: Retoque | undefined): boolean {
    if (!retoque) return false;
    if (CAMPOS_DEL_RETOQUE.some(c => c in retoque && !mismoValor(c, retoque[c], fila[c]))) return true;
    return horarioVigente(fila, retoque) && !mismoMinuto(retoque.fecha_inicio_estimada, fila.fecha_inicio_estimada);
}

/** Un retoque guardado antes del 30/09/2026: la fila entera del plan. */
export const esFilaEntera = (valor: unknown): boolean =>
    !!valor && typeof valor === "object" && ("orden_id" in valor || "inicio_min" in valor);

/**
 * Si la persona cambió este id en el plan sobre el que hizo el retoque viejo.
 *
 * El retoque viejo cambiaba el id y NUNCA el nombre, así que el nombre que trae es el de
 * lo que había elegido aquel plan: si el id elegido tiene otro nombre, lo eligió la
 * persona. Si el id no se encuentra no se puede saber, y se conserva.
 */
const laEligioLaPersona = (
    id: number | null | undefined,
    nombreDelPlan: string | null | undefined,
    buscar: ((id: number) => string | undefined) | undefined,
): boolean => {
    if (id == null) return nombreDelPlan != null;
    const nombre = buscar?.(id);
    if (nombre === undefined) return true;
    return nombre !== (nombreDelPlan ?? null);
};

/**
 * Lo que la persona había cambiado, sacado de un retoque viejo (la fila entera).
 *
 * Se compara con la fila del mismo borrador. Si el retoque se hizo sobre ESE plan (la
 * fila tiene los mismos minutos), la diferencia es exactamente lo que se tocó. Si se hizo
 * sobre un plan anterior —hubo un recálculo después, y el recálculo conservaba la fila
 * vieja entera—, además de lo que tocó la persona trae lo que había elegido aquel plan,
 * que no es un retoque de nadie. Por eso:
 *
 *  - la persona y la máquina se conservan sólo si NO son las que había puesto el plan del
 *    retoque, y eso lo dice el nombre que trae la fila vieja (ver `laEligioLaPersona`).
 *    Se mira aunque los minutos coincidan: un recálculo puede devolver la fila con los
 *    mismos minutos y otra persona;
 *  - el horario y el «No necesita» sólo si es el mismo plan. Sobre un plan anterior, el
 *    horario es el del plan viejo o uno escrito mirándolo —es lo que se descarta al
 *    recalcular—, y «No necesita» ya quedó guardado en la OT, así que el plan nuevo lo trae.
 *
 * Devuelve `null` si no queda nada: el retoque no cambiaba nada.
 */
export function retoqueDeFilaEntera(vieja: FilaDelPlan, fila: FilaDelPlan, nombres?: Nombres): Retoque | null {
    const retoque: Retoque = {};
    if (!mismoValor("id_operario", vieja.id_operario, fila.id_operario)
        && laEligioLaPersona(vieja.id_operario, vieja.operario_nombre, nombres?.operario)) {
        retoque.id_operario = vieja.id_operario ?? null;
    }
    if (!mismoValor("id_maquinaria", vieja.id_maquinaria, fila.id_maquinaria)
        && laEligioLaPersona(vieja.id_maquinaria, vieja.maquinaria_nombre, nombres?.maquina)) {
        retoque.id_maquinaria = vieja.id_maquinaria ?? null;
    }
    const mismoPlan = mismoNumero(vieja.inicio_min, fila.inicio_min)
        && mismoNumero(vieja.fin_min, fila.fin_min)
        && mismoMinuto(vieja.fecha_fin_estimada, fila.fecha_fin_estimada);
    if (mismoPlan) {
        for (const campo of ["usa_maquina", "va_a_mano", "sin_maquinaria"] as const) {
            if (!mismoValor(campo, vieja[campo], fila[campo])) retoque[campo] = valorDe(campo, vieja[campo]) as boolean;
        }
        if (!mismoMinuto(vieja.fecha_inicio_estimada, fila.fecha_inicio_estimada)) {
            retoque.fecha_inicio_estimada = vieja.fecha_inicio_estimada ?? "";
            retoque.inicio_del_plan = fila.fecha_inicio_estimada ?? null;
        }
    }
    return sinCampos(retoque) ? null : retoque;
}

/**
 * Los retoques puestos al día con el plan que está en pantalla. Se usa al abrir la vista
 * previa y cada vez que cambia el plan:
 *
 *  - un retoque viejo (la fila entera) pasa a ser lo que la persona cambió, y si no
 *    cambiaba nada, se va;
 *  - un horario escrito donde el plan ya no tiene la fila, se va;
 *  - un retoque que se queda sin nada, se va.
 *
 * El retoque de una fila que ya no está en el plan (se sacó la OT, se cambió el proceso)
 * queda como está: si la fila vuelve, vuelve con él. Salvo que sea una fila entera, que
 * sin su fila no tiene contra qué compararse y es justo lo que no se quiere imponer.
 *
 * Si no hay nada que cambiar devuelve EL MISMO objeto, para no disparar un guardado del
 * borrador por nada.
 */
export function retoquesAlDia(
    ediciones: Record<string, unknown> | null | undefined,
    filaDe: (clave: string) => FilaDelPlan | undefined,
    nombres?: Nombres,
): Record<string, Retoque> {
    const salida: Record<string, Retoque> = {};
    let cambio = false;
    for (const [clave, valor] of Object.entries(ediciones ?? {})) {
        let retoque: Retoque | null = null;
        if (valor && typeof valor === "object") {
            const fila = filaDe(clave);
            if (esFilaEntera(valor)) retoque = fila ? retoqueDeFilaEntera(valor as FilaDelPlan, fila, nombres) : null;
            else retoque = fila ? sinHorarioViejo(fila, valor as Retoque) : (valor as Retoque);
        }
        if (retoque !== valor) cambio = true;
        if (retoque) salida[clave] = retoque;
    }
    return cambio ? salida : (ediciones as Record<string, Retoque>) ?? salida;
}

/** Cuántos horarios escritos a mano dejan de valer con este plan (para avisarlo). */
export function horariosQueNoVan(
    ediciones: Record<string, Retoque>,
    filaDe: (clave: string) => FilaDelPlan | undefined,
): number {
    let n = 0;
    for (const [clave, retoque] of Object.entries(ediciones)) {
        const fila = filaDe(clave);
        if (fila && !esFilaEntera(retoque) && retoque.fecha_inicio_estimada !== undefined
            && !horarioVigente(fila, retoque)) n++;
    }
    return n;
}
