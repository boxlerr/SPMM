"use client";

/**
 * Los catálogos del alta de insumos (materiales con sus calidades, formatos con sus
 * medidas, unidades), pedidos UNA vez y compartidos.
 *
 * POR QUÉ UN ALMACÉN Y NO UN `useEffect` EN CADA FORMULARIO
 *
 * Los usan la lista de insumos (los chips de Material y Formato), la ficha (el
 * formulario) y el diálogo de «+ Nuevo insumo» que se abre desde la OT, a veces los tres
 * montados a la vez. Pedirlos en cada uno eran tres idas al servidor para lo mismo y,
 * peor, tres copias: si en el formulario se daba de alta el material «GRILON», el chip
 * de la lista no lo conocía hasta recargar la pantalla. Acá hay una sola copia: el alta
 * de un material o de una calidad la actualiza y todos los que la miran se enteran.
 *
 * Si el pedido falla, no queda guardado el error: el próximo que monte vuelve a probar.
 */

import { useEffect, useSyncExternalStore } from "react";
import { API_URL } from "@/config";
import {
    AVISO_ESPEJO,
    fijarModoEspejoMP,
    mpGet,
    mpPost,
    TIPOS_INSUMO,
    UNIDADES_LINEA,
    UNIDADES_PIEZA,
    type Calidad,
    type CalidadIn,
    type Catalogos,
    type Material,
    type MaterialIn,
} from "@/lib/materiaPrima";

export interface EstadoCatalogos {
    catalogos: Catalogos | null;
    cargando: boolean;
    error: string | null;
    sinServidor: boolean;
}

let estado: EstadoCatalogos = { catalogos: null, cargando: false, error: null, sinServidor: false };
const oyentes = new Set<() => void>();
let enVuelo: Promise<void> | null = null;

function publicar(cambios: Partial<EstadoCatalogos>) {
    estado = { ...estado, ...cambios };
    oyentes.forEach((o) => o());
}

const suscribir = (oyente: () => void) => {
    oyentes.add(oyente);
    return () => {
        oyentes.delete(oyente);
    };
};
const leer = () => estado;

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");

/**
 * Lo que vino, sin huecos: un material sin calidades trae `[]`, un formato sin etiquetas vacías.
 *
 * `dueno`: sólo «integral» prende el modo espejo. Un backend de antes de la prueba
 * piloto no lo manda, y ausente (o cualquier otra cosa) es «spmm», que es como andaba
 * ese backend: si no, un front nuevo con un backend viejo trabaría la sección entera.
 */
function normalizar(c: Catalogos): Catalogos {
    const aviso = typeof c.aviso_dueno === "string" && c.aviso_dueno.trim() ? c.aviso_dueno.trim() : null;
    return {
        materiales: (c.materiales ?? []).map((m) => ({ ...m, calidades: m.calidades ?? [] })),
        formatos: (c.formatos ?? []).map((f) => ({ ...f, etiquetas: (f.etiquetas ?? []).filter((e) => !!e) })),
        unidades: c.unidades?.length ? c.unidades : [...UNIDADES_PIEZA],
        unidades_linea: c.unidades_linea?.length ? c.unidades_linea : [...UNIDADES_LINEA],
        tipos: c.tipos?.length ? c.tipos : [...TIPOS_INSUMO],
        espesor_sierra_mm: c.espesor_sierra_mm ?? 3,
        dueno: c.dueno === "integral" ? "integral" : "spmm",
        aviso_dueno: aviso,
    };
}

/** Pide los catálogos (si ya están, no hace nada salvo `forzar`). Varios pedidos a la vez comparten uno. */
export function cargarCatalogos(forzar = false): Promise<void> {
    if (enVuelo) return enVuelo;
    if (estado.catalogos && !forzar) return Promise.resolve();
    publicar({ cargando: true });
    enVuelo = mpGet<Catalogos>(`${API_URL}/materia-prima/catalogos`).then((r) => {
        enVuelo = null;
        if (r.ok && r.data) {
            const catalogos = normalizar(r.data);
            // El candado de los pedidos (lib/materiaPrima.ts) sigue al dueño. Si el pedido
            // falla, queda como estaba: un error de red no destraba el modo espejo.
            fijarModoEspejoMP(catalogos.dueno === "integral" ? (catalogos.aviso_dueno ?? AVISO_ESPEJO) : null);
            publicar({ catalogos, cargando: false, error: null, sinServidor: false });
        } else {
            publicar({ cargando: false, error: r.error, sinServidor: r.sinServidor });
        }
    });
    return enVuelo;
}

/** Los catálogos, y que se pidan si todavía nadie lo hizo. */
export function useCatalogosMP(): EstadoCatalogos {
    const actual = useSyncExternalStore(suscribir, leer, leer);
    useEffect(() => {
        if (!estado.catalogos && !enVuelo) void cargarCatalogos();
    }, []);
    return actual;
}

export interface ResultadoAlta<T> {
    dato: T | null;
    error: string | null;
}

/**
 * Da de alta un material y lo deja en el catálogo compartido. El nombre va en
 * mayúsculas, como todos los del viejo (ACERO, BRONCE): la descripción del insumo lo
 * escribe tal cual y «Acero» al lado de «ACERO» serían dos materiales para el taller.
 */
export async function altaMaterial(nombre: string): Promise<ResultadoAlta<Material>> {
    const cuerpo: MaterialIn = { nombre: nombre.trim().replace(/\s+/g, " ").toUpperCase() };
    const r = await mpPost<Material>(`${API_URL}/materia-prima/materiales`, cuerpo);
    if (!r.ok || !r.data) {
        // Un 422 «ya existe» casi siempre es que otro lo cargó mientras tanto: se vuelven
        // a pedir los catálogos para que aparezca en la lista.
        if (r.status === 422) void cargarCatalogos(true);
        return { dato: null, error: r.error ?? "No se pudo dar de alta el material." };
    }
    const material: Material = { ...r.data, calidades: r.data.calidades ?? [] };
    if (estado.catalogos) {
        const materiales = [...estado.catalogos.materiales.filter((m) => m.id !== material.id), material].sort(porNombre);
        publicar({ catalogos: { ...estado.catalogos, materiales } });
    }
    return { dato: material, error: null };
}

/**
 * Da de alta una calidad del material. Se guarda como se escribió (hay calidades con
 * minúsculas a propósito en el viejo: «PU 90 shoreA»), sin espacios de más.
 */
export async function altaCalidad(idMaterial: number, nombre: string): Promise<ResultadoAlta<Calidad>> {
    const cuerpo: CalidadIn = { nombre: nombre.trim().replace(/\s+/g, " ") };
    const r = await mpPost<Calidad>(`${API_URL}/materia-prima/materiales/${idMaterial}/calidades`, cuerpo);
    if (!r.ok || !r.data) {
        if (r.status === 422) void cargarCatalogos(true);
        return { dato: null, error: r.error ?? "No se pudo dar de alta la calidad." };
    }
    const calidad = r.data;
    if (estado.catalogos) {
        const materiales = estado.catalogos.materiales.map((m) =>
            m.id === idMaterial
                ? { ...m, calidades: [...m.calidades.filter((c) => c.id !== calidad.id), calidad].sort(porNombre) }
                : m,
        );
        publicar({ catalogos: { ...estado.catalogos, materiales } });
    }
    return { dato: calidad, error: null };
}
