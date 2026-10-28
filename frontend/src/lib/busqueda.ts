/**
 * Lo que se busca en los buscadores de OT (Paso 1 y «Agregar OTs» de la vista previa).
 *
 * Se puede pegar una lista de OT —«13345 13343», «#13345, #13343»— y cada número busca
 * por su cuenta (el # y los separadores se ignoran). Un texto normal («ceramica cañuelas»)
 * se busca entero, como frase; con comas, cada parte por separado.
 *
 * El renglón que devuelve Claude («OT: 15922, 15842 y 15866», ver lib/paraClaude) también:
 * el rótulo «OT:» —o «**OT:**», en negrita— no se busca. Y si se pega la respuesta entera,
 * cuentan sólo los números de ese renglón (el resto trae fechas, horas y años). Reunión con
 * Lucas del 17/10/2026: la lista de Claude se pega en el buscador y con el tilde de arriba
 * se tildan todas.
 *
 * Los términos vuelven en minúscula y sin vacíos: sin términos, se muestra todo.
 */
export function terminosDeBusqueda(texto: string | null | undefined): string[] {
    const crudo = (texto ?? "").trim();
    if (!crudo) return [];
    const renglonOT = crudo.match(/\bOTs?[\s*_`]*[:：][\s*_`]*((?:#?\d+(?:\s*(?:[,;]|\by\b)\s*|\s+)?)+)/i);
    const base = renglonOT ? renglonOT[1] : crudo;
    const tokens = base.split(/[\s,;]+/).map(t => t.replace(/^#/, "")).filter(Boolean);
    const sinRotulo = tokens.filter(t => !/^ots?[:：]?$/i.test(t) && t.toLowerCase() !== "y");
    const esListaDeNumeros = sinRotulo.length > 0 && sinRotulo.every(t => /^\d+$/.test(t));
    const terminos = esListaDeNumeros
        ? sinRotulo
        : crudo.includes(",")
            ? tokens
            : [crudo.replace(/^#/, "")];
    return terminos.map(t => t.toLowerCase()).filter(Boolean);
}

/**
 * Los números de una lista de OT pegada en el buscador que no son ninguna de las OT de
 * la lista que se está mirando (reunión con Lucas del 28/10/2026: pegó las 29 que le
 * pasó Claude, se tildaron 28 y no había cómo saber cuál faltaba). Se compara el número
 * EXACTO de la OT —el del Integral, o el interno—: buscar «1598» encuentra la 15981, pero
 * esa no es la que se pidió. `null` si lo buscado no es una lista de números.
 */
export function numerosQueNoEstan(
    texto: string | null | undefined,
    ots: ReadonlyArray<{ id: number; id_otvieja?: number | null }>,
): { pedidos: number; faltan: number[] } | null {
    const terminos = terminosDeBusqueda(texto);
    if (terminos.length === 0 || !terminos.every(t => /^\d+$/.test(t))) return null;
    const numeros = [...new Set(terminos.map(Number))];
    const hay = new Set<number>();
    for (const o of ots) {
        hay.add(o.id);
        if (o.id_otvieja != null) hay.add(Number(o.id_otvieja));
    }
    return { pedidos: numeros.length, faltan: numeros.filter(n => !hay.has(n)) };
}
