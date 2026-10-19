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
