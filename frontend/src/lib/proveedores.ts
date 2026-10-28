/**
 * Los proveedores del paso tercerizado: darlos de alta, editarlos y eliminarlos desde la
 * lista donde se eligen (19/10/2026, Julián: «que se pueda escribir, editar y eliminar en
 * la lista al elegirlo»).
 *
 * No van por /materia-prima/proveedores: con el Integral como dueño de las materias primas
 * esas rutas no escriben (y el modo práctica las frena en la pantalla). Van por /proveedores,
 * con el permiso de la OT, y SPMM manda en lo que se toca acá: el espejo del Integral no lo
 * vuelve a pisar (ver backend MateriaPrimaCatalogoService.editar_proveedor).
 */
import { API_URL } from "@/config";
import type { Proveedor } from "@/lib/materiaPrima";

export interface CambiosDeProveedor {
    razon_social?: string;
    fantasia?: string | null;
    cuit?: string | null;
    demora_dias?: number | null;
}

export interface RespuestaDeProveedor<T> {
    ok: boolean;
    data?: T;
    error?: string;
    /** 409: ya hay otro proveedor con ese nombre o CUIT. Se puede guardar igual. */
    requiereConfirmacion: boolean;
}

export interface ProveedorEliminado {
    id: number;
    /** «del_todo»: era de SPMM y nunca se usó. «de_las_listas»: ya se usó, o vino del Integral. */
    borrado: "del_todo" | "de_las_listas";
    usos: Record<string, number>;
}

const encabezados = (): HeadersInit => {
    const token = typeof window === "undefined" ? null : localStorage.getItem("access_token");
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<RespuestaDeProveedor<T>> {
    try {
        const res = await fetch(`${API_URL}${ruta}`, {
            method: metodo,
            headers: encabezados(),
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            const motivo = json?.errors?.[0]?.message ?? json?.errorDescription ?? json?.detail;
            return {
                ok: false,
                requiereConfirmacion: res.status === 409,
                error: typeof motivo === "string" ? motivo : "No se pudo guardar el proveedor.",
            };
        }
        return { ok: true, data: json?.data as T, requiereConfirmacion: false };
    } catch {
        return { ok: false, requiereConfirmacion: false, error: "No hay conexión con el servidor." };
    }
}

/** Un proveedor de la solapa Proveedores de Recursos, con en cuántos pasos está elegido. */
export interface ProveedorDeTercerizados {
    id: number;
    razon_social: string;
    fantasia: string | null;
    cuit: string | null;
    telefono: string | null;
    mail: string | null;
    demora_dias: number | null;
    /** En cuántos pasos tercerizados está elegido, y cuántos de esos no se terminaron. */
    pasos: number;
    pendientes: number;
}

/** Sin buscar: los que hacen trabajos de afuera (con días, o elegidos en algún paso).
 *  Buscando: cualquiera del catálogo que coincida, para sumarlo. */
export const listarProveedoresDeTercerizados = (buscar = "") =>
    pedir<ProveedorDeTercerizados[]>("GET", `/proveedores${buscar.trim() ? `?search=${encodeURIComponent(buscar.trim())}` : ""}`);

export const crearProveedorDelPaso = (razon_social: string, forzar = false) =>
    pedir<Proveedor>("POST", `/proveedores${forzar ? "?forzar=true" : ""}`, { razon_social });

export const editarProveedorDelPaso = (id: number, cambios: CambiosDeProveedor, forzar = false) =>
    pedir<Proveedor>("PUT", `/proveedores/${id}${forzar ? "?forzar=true" : ""}`, cambios);

export const eliminarProveedorDelPaso = (id: number) =>
    pedir<ProveedorEliminado>("DELETE", `/proveedores/${id}`);
