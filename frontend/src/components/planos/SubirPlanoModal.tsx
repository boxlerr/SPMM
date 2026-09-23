"use client";

import React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { API_URL } from "@/config";
import { formatearBytes } from "@/lib/planos";
import { FileText, Image as ImageIcon, Info, Loader2, UploadCloud, X } from "lucide-react";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

interface Articulo {
    id: number;
    cod_articulo: string;
    descripcion: string;
}

interface SubirPlanoModalProps {
    abierto: boolean;
    onClose: () => void;
    /** Se llama cuando entró al menos un archivo, para que la lista se vuelva a pedir. */
    onSubido: () => void;
}

/**
 * Subir planos a un PRODUCTO desde la biblioteca.
 *
 * Es distinto de adjuntar un archivo a una orden (eso está en la ficha de la OT): lo que
 * se sube acá cuelga del producto, así que lo ven todas las órdenes que lo fabrican, las
 * que ya existen y las que se carguen mañana. Por eso el aviso está a la vista y no en
 * un tooltip: el que se equivoca de lugar no se entera hasta que el plano aparece en una
 * OT que no le corresponde.
 *
 * Se sube de a un archivo por pedido porque el endpoint recibe uno solo, y se van
 * contando: elegir cinco escaneos y quedarse mirando un botón trabado no dice si está
 * andando o si se colgó.
 */
export function SubirPlanoModal({ abierto, onClose, onSubido }: SubirPlanoModalProps) {
    const base = API_URL.replace(/\/$/, "");

    const [articulos, setArticulos] = React.useState<Articulo[]>([]);
    const [cargandoArticulos, setCargandoArticulos] = React.useState(false);
    const [articuloId, setArticuloId] = React.useState("");
    const [descripcion, setDescripcion] = React.useState("");
    const [archivos, setArchivos] = React.useState<File[]>([]);
    const [subiendo, setSubiendo] = React.useState(false);
    /** Cuántos ya se intentaron. Sirve para el "subiendo 2 de 5" y para la barra. */
    const [hechos, setHechos] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);

    const inputArchivos = React.useRef<HTMLInputElement>(null);

    // El catálogo se pide recién al abrir y una sola vez: son ~7000 artículos y no hace
    // falta tenerlos cargados mientras se mira la grilla de planos.
    React.useEffect(() => {
        if (!abierto || articulos.length > 0) return;

        let vivo = true;
        setCargandoArticulos(true);
        fetch(`${base}/articulos`, { headers: getAuthHeaders() })
            .then(async (res) => {
                if (!res.ok) throw new Error(`error ${res.status}`);
                const json = await res.json();
                return Array.isArray(json) ? json : (json?.data ?? []);
            })
            .then((lista: Articulo[]) => {
                if (!vivo) return;
                setArticulos(lista);
            })
            .catch(() => {
                if (!vivo) return;
                setError("No se pudo traer la lista de productos. Cerrá y probá de nuevo.");
            })
            .finally(() => {
                if (vivo) setCargandoArticulos(false);
            });

        return () => {
            vivo = false;
        };
    }, [abierto, base, articulos.length]);

    const limpiar = React.useCallback(() => {
        setArticuloId("");
        setDescripcion("");
        setArchivos([]);
        setHechos(0);
        setError(null);
        if (inputArchivos.current) inputArchivos.current.value = "";
    }, []);

    const cerrar = () => {
        // Con una subida en curso no se cierra: el modal es el único lugar donde se ve
        // cuántos entraron y cuáles fallaron.
        if (subiendo) return;
        limpiar();
        onClose();
    };

    const articuloElegido = articulos.find((a) => a.id.toString() === articuloId);

    const alElegirArchivos = (e: React.ChangeEvent<HTMLInputElement>) => {
        const nuevos = Array.from(e.target.files ?? []);
        if (nuevos.length === 0) return;
        // Se suman a lo que ya había: en el taller los planos de una pieza suelen estar
        // en carpetas distintas y se eligen en dos tandas. Pero el que no ve que ya lo
        // había agregado y lo elige de nuevo terminaba subiendo el mismo PDF dos veces y
        // dejando el producto con dos planos iguales: nada lo deduplica más adelante.
        // Se compara por nombre + tamaño + fecha, que es lo que distingue a dos archivos
        // sin leerlos.
        const huella = (a: File) => `${a.name}|${a.size}|${a.lastModified}`;
        setArchivos((previos) => {
            const yaEstan = new Set(previos.map(huella));
            return [...previos, ...nuevos.filter((a) => !yaEstan.has(huella(a)))];
        });
        setError(null);
        // El input se vacía para que volver a elegir el MISMO archivo dispare el change.
        e.target.value = "";
    };

    const sacarArchivo = (i: number) => {
        setArchivos((previos) => previos.filter((_, n) => n !== i));
    };

    const subir = async () => {
        if (!articuloId) {
            setError("Elegí a qué producto pertenece el plano.");
            return;
        }
        if (archivos.length === 0) {
            setError("Elegí al menos un archivo.");
            return;
        }

        setSubiendo(true);
        setHechos(0);
        setError(null);

        // Si la descripción se deja vacía va la del producto: es lo que alguien quiere
        // leer cuando abre el plano desde una orden, y escribirla a mano en cada archivo
        // termina en la mitad vacía.
        const textoDescripcion = descripcion.trim() || articuloElegido?.descripcion?.trim() || "";

        let entraron = 0;
        // Se guarda el ARCHIVO y no su nombre: si alguien eligió "plano.pdf" de dos
        // carpetas distintas y solo falló el segundo, filtrar por nombre dejaba los dos
        // en la lista y el reintento volvía a subir el que ya había entrado.
        const fallaron: File[] = [];

        for (const archivo of archivos) {
            try {
                const cuerpo = new FormData();
                cuerpo.append("nombre", archivo.name);
                if (textoDescripcion) cuerpo.append("descripcion", textoDescripcion);
                cuerpo.append("tipo_archivo", archivo.type || "application/octet-stream");
                cuerpo.append("id_articulo", articuloId);
                cuerpo.append("archivo", archivo);

                const res = await fetch(`${base}/planos`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: cuerpo,
                });
                if (!res.ok) throw new Error(`error ${res.status}`);
                entraron++;
            } catch (e) {
                // Un archivo roto no frena a los demás: el que eligió cinco escaneos
                // prefiere que entren cuatro y que le digan cuál falló, antes que
                // volver a empezar de cero.
                console.error(`No se pudo subir el plano ${archivo.name}`, e);
                fallaron.push(archivo);
            } finally {
                setHechos((n) => n + 1);
            }
        }

        setSubiendo(false);

        if (entraron > 0) {
            toast.success(
                entraron === 1
                    ? "Se subió 1 plano"
                    : `Se subieron ${entraron} planos`,
                articuloElegido
                    ? { description: `Quedaron en ${articuloElegido.cod_articulo}` }
                    : undefined
            );
            // OJO: acá NO se toca la lista cacheada de "órdenes con plano". Esa lista
            // mira únicamente los planos pegados a una ORDEN, y de acá siempre sale un
            // plano de PRODUCTO, así que no cambia. Es a propósito (ver la regla en
            // find_ordenes_con_plano): la columna Plano de planificación va a seguir
            // diciendo lo mismo para esas órdenes aunque el producto ya tenga su dibujo.
            onSubido();
        }

        if (fallaron.length > 0) {
            toast.error(
                fallaron.length === 1
                    ? "Un archivo no se pudo subir"
                    : `${fallaron.length} archivos no se pudieron subir`,
                { description: fallaron.map((a) => a.name).join(", ") }
            );
            // Los que fallaron quedan en la lista para reintentar solo esos.
            setArchivos(fallaron);
            setHechos(0);
            return;
        }

        limpiar();
        onClose();
    };

    const total = archivos.length;
    const avance = total === 0 ? 0 : Math.round((hechos / total) * 100);

    return (
        <Dialog open={abierto} onOpenChange={(o) => !o && cerrar()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UploadCloud className="w-5 h-5 text-blue-600" />
                        Subir plano
                    </DialogTitle>
                    <DialogDescription className="text-left">
                        El plano queda pegado al producto: lo van a ver todas las órdenes que lo
                        fabriquen, las de ahora y las que se carguen después. Si es un archivo de
                        una orden puntual, subilo desde esa orden.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold text-gray-400 uppercase">
                            Producto <span className="text-red-500">*</span>
                        </Label>
                        <SearchableSelect
                            options={articulos.map((a) => ({
                                value: a.id.toString(),
                                label: `${a.cod_articulo} — ${a.descripcion}`,
                            }))}
                            value={articuloId}
                            onValueChange={(v) => {
                                setArticuloId(v);
                                setError(null);
                            }}
                            disabled={subiendo || cargandoArticulos}
                            placeholder={
                                cargandoArticulos
                                    ? "Trayendo los productos..."
                                    : "Buscá por código o por descripción"
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold text-gray-400 uppercase">
                            Descripción <span className="font-normal normal-case">(opcional)</span>
                        </Label>
                        <Input
                            value={descripcion}
                            onChange={(e) => setDescripcion(e.target.value)}
                            disabled={subiendo}
                            placeholder={
                                articuloElegido?.descripcion || "Si la dejás vacía va la del producto"
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold text-gray-400 uppercase">
                            Archivos <span className="text-red-500">*</span>
                        </Label>

                        <div className="relative">
                            <input
                                ref={inputArchivos}
                                type="file"
                                multiple
                                accept="application/pdf,image/*"
                                onChange={alElegirArchivos}
                                disabled={subiendo}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <div
                                className={cn(
                                    "flex items-center justify-center gap-2 py-4 px-3 rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-500 transition-colors",
                                    !subiendo && "hover:border-blue-400 hover:bg-blue-50/50"
                                )}
                            >
                                <UploadCloud className="w-4 h-4 text-gray-400" />
                                {total === 0
                                    ? "Elegí uno o varios archivos (PDF o imagen)"
                                    : "Agregar más archivos"}
                            </div>
                        </div>

                        {total > 0 && (
                            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                {archivos.map((a, i) => (
                                    <li
                                        key={`${a.name}-${i}`}
                                        className="flex items-center gap-2 rounded-md border border-gray-100 bg-gray-50/70 px-2 py-1.5"
                                    >
                                        {a.type.startsWith("image/") ? (
                                            <ImageIcon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                        ) : (
                                            <FileText className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                                        )}
                                        <span className="text-xs text-gray-700 truncate" title={a.name}>
                                            {a.name}
                                        </span>
                                        <span className="text-[11px] text-gray-400 ml-auto whitespace-nowrap">
                                            {formatearBytes(a.size)}
                                        </span>
                                        {!subiendo && (
                                            <button
                                                type="button"
                                                onClick={() => sacarArchivo(i)}
                                                title={`Sacar ${a.name} de la lista`}
                                                className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {subiendo && (
                        <div className="space-y-1.5">
                            <p className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                                Subiendo {Math.min(hechos + 1, total)} de {total}...
                            </p>
                            <Progress value={avance} className="h-1.5" />
                        </div>
                    )}

                    {!subiendo && total > 1 && (
                        <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
                            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            Los {total} archivos van al mismo producto.
                        </p>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" type="button" onClick={cerrar} disabled={subiendo}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        onClick={() => void subir()}
                        disabled={subiendo || !articuloId || total === 0}
                    >
                        {subiendo ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Subiendo...
                            </>
                        ) : total > 1 ? (
                            `Subir ${total} planos`
                        ) : (
                            "Subir plano"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
