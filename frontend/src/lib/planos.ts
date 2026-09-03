/**
 * Bajar un plano de una OT.
 *
 * El endpoint que sirve el archivo pide token (va en el header `Authorization`), y un
 * `<a href>` común no lo manda: el navegador navega "pelado" y la API contesta que no
 * está autenticado. Por eso los links que apuntaban derecho a
 * `/planos/{id}/archivo?download=true` no bajaban nada.
 *
 * Se trae el archivo con fetch —que sí lleva el token—, se hace un blob y se dispara
 * la descarga desde ahí.
 */
import { API_URL } from "@/config";

const authHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function descargarPlano(id: number, nombre: string): Promise<void> {
    const res = await fetch(`${API_URL}/planos/${id}/archivo?download=true`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`No se pudo bajar el archivo (error ${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre || `plano-${id}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // Se le da un momento al navegador para que arranque la descarga antes de
        // soltar el blob; si se revoca en el acto, algunos la cancelan.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}
