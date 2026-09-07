"use client";

import React from "react";
import { Info, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    esFoto,
    esPlano,
    formatearBytes,
    ordenarPlanosPrimero,
    rotuloDeArchivo,
    type Plano,
    type RotuloArchivo,
} from "@/lib/planos";
import { PlanoThumb } from "./PlanoThumb";
import { FileViewerModal } from "./FileViewerModal";

interface PlanoPanelProps {
    planos: Plano[];
    cargando?: boolean;
    /** Encabezado del bloque. Por defecto, "Planos". */
    titulo?: string;
    /** Qué decir cuando no hay NINGÚN archivo. */
    vacioTexto?: string;
    className?: string;
    /**
     * "auto" acomoda las tarjetas al ancho que tenga el contenedor (dos en una columna
     * de 300, siete en una solapa a pantalla completa). Un número fuerza esa cantidad.
     */
    columnas?: "auto" | number;
    /**
     * Alto máximo de la grilla, como clase de Tailwind ("max-h-64"). Con esto la galería
     * scrollea ADENTRO en vez de estirar al padre: es justo lo que rompía el desplegable
     * de Órdenes de Trabajo, donde quince archivos apilados estiraban la fila tanto que
     * había que scrollear la página entera para volver a la lista.
     */
    alto?: string;
    /** Tarjetas más chicas, para cuando el panel va en una columna angosta. */
    compacto?: boolean;
}

/** Ancho mínimo de tarjeta. De acá sale cuántas columnas entran en el ancho que haya. */
const ANCHO_MIN_COMPACTO = 104;
const ANCHO_MIN = 148;

/** Debajo de esto, recortar el nombre no ahorra nada y encima esconde información. */
const PREFIJO_MINIMO = 8;

const ESTILO_ROTULO: Record<RotuloArchivo, string> = {
    // Mismos colores que usa PlanoThumb para el ícono de respaldo (naranja el PDF, azul
    // la imagen), así el rótulo y la miniatura no se contradicen.
    Plano: "bg-orange-100 text-orange-700 ring-orange-200",
    Foto: "bg-blue-100 text-blue-700 ring-blue-200",
    Archivo: "bg-slate-100 text-slate-600 ring-slate-200",
};

/**
 * El pedazo de nombre que comparten todos.
 *
 * Los quince archivos de una pieza se llaman igual salvo el final: "Matriz 46x240x307mm
 * de 2 partes (1).jpg", "… (2).jpg", "… (15).jpg". Truncar con `truncate` corta por el
 * final —justo lo único que los distingue— y quedan quince renglones idénticos.
 */
const prefijoComun = (nombres: string[]): string => {
    if (nombres.length < 2) return "";

    let prefijo = nombres[0];
    for (const nombre of nombres) {
        let i = 0;
        while (i < prefijo.length && i < nombre.length && prefijo[i] === nombre[i]) i++;
        prefijo = prefijo.slice(0, i);
        if (!prefijo) return "";
    }

    // Se retrocede hasta el último separador para no cortar en la mitad de una palabra:
    // el prefijo crudo de "(1)" y "(15)" termina en "(1", y mostrar "5).jpg" no le dice
    // nada a nadie. Cortando en el separador queda "(1).jpg" y "(15).jpg", que sí se leen.
    //
    // No alcanza con mirar el espacio: la mitad de los nombres que llegan de Windows y de
    // las bajadas de Drive vienen con guión bajo o guión medio en vez de espacios
    // ("Matriz_46x240x307mm_1.jpg"), y ahí no había ningún espacio en el prefijo común,
    // se devolvía "" y las quince tarjetas volvían a leerse todas igual.
    const corte = Math.max(
        prefijo.lastIndexOf(" "),
        prefijo.lastIndexOf("_"),
        prefijo.lastIndexOf("-"),
        prefijo.lastIndexOf("(")
    );
    if (corte <= 0) return "";
    const recortado = prefijo.slice(0, corte + 1);
    return recortado.length >= PREFIJO_MINIMO ? recortado : "";
};

/** "1 plano · 15 fotos". El singular y el plural a mano: son tres casos y se leen mejor. */
export const contarArchivos = (lista: Plano[]) => {
    let planos = 0;
    let fotos = 0;
    let otros = 0;
    for (const p of lista) {
        if (esPlano(p.tipo_archivo)) planos++;
        else if (esFoto(p.tipo_archivo)) fotos++;
        else otros++;
    }

    const partes: string[] = [];
    if (planos) partes.push(`${planos} ${planos === 1 ? "plano" : "planos"}`);
    if (fotos) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
    if (otros) partes.push(`${otros} ${otros === 1 ? "archivo" : "archivos"}`);

    return { planos, fotos, otros, resumen: partes.join(" · ") };
};

/**
 * La galería de planos y fotos de una orden.
 *
 * La misma se monta en tres lugares con anchos muy distintos —la columna de 300px que va
 * al lado de la carga de procesos, la solapa Planos a pantalla completa y el modal de
 * editar OT—, así que no puede tener tarjetas de ancho fijo: se acomodan con `grid` y
 * `minmax`, y el alto lo pone el que la monta con `alto` para que scrollee adentro.
 *
 * Quien carga los pasos de una orden está leyendo el plano mientras lo hace: si el plano
 * se abre en un modal que tapa la pantalla, la cuenta la tiene que hacer de memoria. Por
 * eso la miniatura vive al costado, siempre visible, y el visor grande aparece solo
 * cuando hace falta mirar el detalle.
 */
export const PlanoPanel = ({
    planos,
    cargando = false,
    titulo = "Planos",
    vacioTexto = "Todavía no hay ningún archivo cargado.",
    className,
    columnas = "auto",
    alto,
    compacto = false,
}: PlanoPanelProps) => {
    const [abierto, setAbierto] = React.useState<number | null>(null);

    const ordenados = React.useMemo(() => ordenarPlanosPrimero(planos), [planos]);
    const conteo = React.useMemo(() => contarArchivos(ordenados), [ordenados]);

    /**
     * Qué texto lleva cada tarjeta, en el mismo orden que `ordenados`.
     *
     * El prefijo se calcula POR GRUPO (los planos entre planos, las fotos entre fotos):
     * el único PDF de un producto tiene que mostrar su nombre entero, y las quince fotos
     * que se llaman igual, solo la parte que las diferencia.
     */
    const etiquetas = React.useMemo(() => {
        const grupos = new Map<RotuloArchivo, number[]>();
        ordenados.forEach((plano, i) => {
            const rotulo = rotuloDeArchivo(plano.tipo_archivo);
            const grupo = grupos.get(rotulo);
            if (grupo) grupo.push(i);
            else grupos.set(rotulo, [i]);
        });

        const salida = ordenados.map((p) => p.nombre);
        for (const [rotulo, indices] of grupos) {
            const prefijo = prefijoComun(indices.map((i) => ordenados[i].nombre));
            const repetidos = new Map<string, number>();

            indices.forEach((i) => {
                const nombre = ordenados[i].nombre;
                const corto =
                    prefijo && nombre.startsWith(prefijo) ? nombre.slice(prefijo.length).trim() : nombre;
                salida[i] = corto.length >= 2 ? (prefijo ? `…${corto}` : corto) : "";
                repetidos.set(salida[i], (repetidos.get(salida[i]) ?? 0) + 1);
            });

            // Cuando hay más de uno, SIEMPRE se numera.
            //
            // Julián: "si ponemos producto o algo así, cómo va a saber diferenciar de qué
            // es cada foto". Y no hay forma de saberlo por el nombre: los quince archivos
            // de una pieza se llaman igual y en Drive nadie los va a renombrar. Lo que sí
            // se puede dar es una referencia estable para hablar entre personas —"mirá la
            // foto 3"— y para saber cuántas faltan. Si además quedó una cola que
            // distingue ("…(3).jpeg"), se muestra al lado; el nombre completo va en el
            // title de la tarjeta.
            indices.forEach((i, n) => {
                if (indices.length === 1) return;
                const orden = `${rotulo} ${n + 1} de ${indices.length}`;
                const cola = (repetidos.get(salida[i]) ?? 0) > 1 ? "" : salida[i];
                salida[i] = cola ? `${orden} · ${cola}` : orden;
            });
        }
        return salida;
    }, [ordenados]);

    const estiloGrilla: React.CSSProperties = {
        // auto-FILL y no auto-fit: con un solo plano, auto-fit lo estira a todo el ancho
        // de la solapa y queda una tarjeta gigante y sola. Con auto-fill mantiene su
        // tamaño y la fila queda vacía a la derecha, que es lo que uno espera ver.
        gridTemplateColumns:
            columnas === "auto"
                ? `repeat(auto-fill, minmax(${compacto ? ANCHO_MIN_COMPACTO : ANCHO_MIN}px, 1fr))`
                : `repeat(${columnas}, minmax(0, 1fr))`,
    };

    const claseGrilla = cn("grid", compacto ? "gap-2" : "gap-3");
    // El scroll se monta solo si le pusieron alto: sin `max-h`, un `overflow-y-auto`
    // suelto no scrollea nada pero igual recorta las sombras de las tarjetas.
    const claseScroll = alto ? cn("overflow-y-auto pr-1", alto) : undefined;

    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Paperclip className="w-3 h-3" />
                    {titulo}
                </h4>
                {!cargando && conteo.resumen && (
                    <span className="text-[10px] font-semibold text-gray-500 tabular-nums">
                        {conteo.resumen}
                    </span>
                )}
            </div>

            {/* El caso que abrió Julián (PS00M001): quince archivos, ni un dibujo. No es un
                error, es lo que hay en Drive, pero si la pantalla no lo dice parece roto. */}
            {/* Ojo con de quién son las fotos: acá llegan listas mezcladas (OrderFiles
                pasa los de la orden MÁS los del producto). Decir "de este producto" sobre
                fotos que subió alguien a la orden es echarle la culpa al catálogo por algo
                que no le corresponde, y manda a buscar a Drive un plano que quizás sí
                está. Se dice solo lo que la lista deja afirmar. */}
            {!cargando && conteo.planos === 0 && conteo.fotos > 0 && (() => {
                const hayDelProducto = planos.some((p) => p.origen === "articulo");
                const cuantas = conteo.fotos === 1 ? "una foto" : `${conteo.fotos} fotos`;
                return (
                    <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
                        <Info className="w-3 h-3 mt-px shrink-0" />
                        <span>
                            {hayDelProducto
                                ? `De este producto no hay ningún plano cargado: lo que hay son ${cuantas} de la pieza.`
                                : `Acá no hay ningún plano: lo que hay son ${cuantas} de la pieza.`}
                        </span>
                    </p>
                );
            })()}

            {cargando ? (
                <div className={claseScroll}>
                    <div className={claseGrilla} style={estiloGrilla}>
                        {[0, 1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="rounded-xl border border-gray-200 bg-white p-2 animate-pulse"
                            >
                                <div
                                    className={cn(
                                        "w-full bg-slate-100 rounded-lg",
                                        compacto ? "h-16" : "h-24"
                                    )}
                                />
                                <div className="h-2.5 w-3/4 bg-slate-100 rounded mt-2" />
                            </div>
                        ))}
                    </div>
                </div>
            ) : ordenados.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-4 py-6 text-center">
                    <p className="text-[11px] text-gray-400">{vacioTexto}</p>
                </div>
            ) : (
                <div className={claseScroll}>
                    <div className={claseGrilla} style={estiloGrilla}>
                        {ordenados.map((plano, i) => {
                            const rotulo = rotuloDeArchivo(plano.tipo_archivo);
                            const delProducto = plano.origen === "articulo";
                            return (
                                <button
                                    key={plano.id}
                                    type="button"
                                    onClick={() => setAbierto(i)}
                                    // El nombre completo vive acá: la tarjeta muestra solo
                                    // lo que distingue, pero el que duda pasa el mouse.
                                    title={plano.nombre}
                                    className="min-w-0 text-left p-2 rounded-xl border border-gray-200 bg-white shadow-sm hover:border-blue-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                >
                                    <div className="relative">
                                        <PlanoThumb
                                            plano={plano}
                                            className={cn("border-slate-100", compacto ? "h-16" : "h-24")}
                                        />
                                        <span
                                            className={cn(
                                                "absolute left-1 top-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 shadow-sm",
                                                ESTILO_ROTULO[rotulo]
                                            )}
                                        >
                                            {rotulo}
                                        </span>
                                    </div>
                                    <div className="mt-1.5 min-w-0">
                                        <p
                                            className={cn(
                                                "font-bold text-gray-700 truncate",
                                                compacto ? "text-[10px]" : "text-xs"
                                            )}
                                        >
                                            {etiquetas[i]}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                            <span
                                                className={cn(
                                                    "text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap",
                                                    delProducto
                                                        ? "bg-indigo-50 text-indigo-600"
                                                        : "bg-slate-100 text-slate-500"
                                                )}
                                            >
                                                {delProducto ? "Del producto" : "De esta orden"}
                                            </span>
                                            {!compacto && plano.bytes != null && (
                                                <span className="text-[9px] text-gray-400 whitespace-nowrap">
                                                    {formatearBytes(plano.bytes)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <FileViewerModal
                isOpen={abierto !== null}
                onClose={() => setAbierto(null)}
                file={abierto !== null ? ordenados[abierto] ?? null : null}
                planos={ordenados}
                indice={abierto ?? 0}
                onIndiceChange={setAbierto}
            />
        </div>
    );
};
