/**
 * El catálogo de artículos (productos), guardado unos minutos en la pestaña.
 *
 * El modal de la OT lo pedía ENTERO cada vez que se abría: ~7.000 artículos, 945 KB de
 * JSON (200 KB comprimidos) para llenar un desplegable, aunque se abrieran diez OT
 * seguidas. Medido el 20/10/2026.
 *
 * Se puede guardar porque SPMM no crea artículos: vienen del sistema viejo, que los trae
 * cada 10 minutos. Por eso dura lo mismo: un artículo nuevo tarda como mucho lo que ya
 * tardaba en llegar. Un pedido que falla no se guarda (el próximo vuelve a intentar).
 */
import { API_URL } from "@/config";

const VIGENCIA_MS = 10 * 60_000;

let guardado: { hasta: number; pedido: Promise<any[]> } | null = null;

export function pedirArticulos(headers: HeadersInit): Promise<any[]> {
    const ahora = Date.now();
    if (guardado && guardado.hasta > ahora) return guardado.pedido;
    const pedido = fetch(`${API_URL}/articulos`, { headers }).then(async (res) => {
        if (!res.ok) throw new Error(`articulos: ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : (data?.data || []);
    });
    guardado = { hasta: ahora + VIGENCIA_MS, pedido };
    pedido.catch(() => {
        if (guardado?.pedido === pedido) guardado = null;
    });
    return pedido;
}
