/**
 * La limitación de una máquina, para mostrarla donde se la elige.
 *
 * Es la nota que se carga en Recursos ("Falla en avance automático", "No entra
 * material de más de 3 metros"): texto libre, opcional, distinto por máquina.
 *
 * El planificador NO la mira para decidir —no es un rango ni una habilidad, no
 * saca a la máquina del dominio de nadie—, así que el único momento en que se
 * puede tener en cuenta es cuando una persona elige la máquina a mano. Por eso
 * va en el desplegable, debajo del nombre (pedido de Julián, 28/08/2026).
 */
export function limitacionDeMaquina(maquina?: { limitacion?: string | null } | null): string {
    const texto = (maquina?.limitacion || "").trim();
    // Solo la primera letra en mayúscula: es texto libre, no un nombre a normalizar.
    return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "";
}
