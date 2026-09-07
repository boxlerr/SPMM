import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    Loader2,
    Download,
    Printer,
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Maximize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { esImagen, esPdf, imprimirPlano, traerArchivoPlano } from "@/lib/planos";

export interface ArchivoVisible {
    id: number;
    nombre: string;
    tipo_archivo: string;
}

interface FileViewerModalProps {
    file: ArchivoVisible | null;
    isOpen: boolean;
    onClose: () => void;
    /**
     * Todos los planos de la ficha. Si viene, el visor deja pasar de uno a otro sin
     * cerrar: el que mira un plano en el taller compara con el de al lado, y cerrar y
     * volver a abrir por cada uno es un ida y vuelta al listado por plano.
     */
    planos?: ArchivoVisible[];
    /** Cuál de `planos` se está viendo. */
    indice?: number;
    onIndiceChange?: (indice: number) => void;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
const acotarZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const FileViewerModal = ({
    file: archivoSuelto,
    isOpen,
    onClose,
    planos,
    indice,
    onIndiceChange,
}: FileViewerModalProps) => {
    const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [zoom, setZoom] = React.useState(1);
    // El visor de PDF del navegador es el que sabe imprimirlo: se le habla por acá.
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const zonaRef = React.useRef<HTMLDivElement>(null);

    const lista = planos && planos.length > 0 ? planos : null;

    // El índice se guarda acá aunque el padre lo controle: así el visor sigue andando
    // si lo abren sin `onIndiceChange` (una ficha que solo quiere mostrar la lista).
    const [posicion, setPosicion] = React.useState(indice ?? 0);
    React.useEffect(() => {
        setPosicion(indice ?? 0);
    }, [indice, isOpen]);

    const pos = lista ? Math.min(Math.max(posicion, 0), lista.length - 1) : 0;
    const file = lista ? lista[pos] ?? archivoSuelto : archivoSuelto;

    const irA = React.useCallback(
        (destino: number) => {
            if (!lista) return;
            // Da la vuelta: del último al primero. Con tres planos, llegar al final y
            // tener que volver flecha por flecha es peor que seguir de largo.
            const n = ((destino % lista.length) + lista.length) % lista.length;
            setPosicion(n);
            onIndiceChange?.(n);
        },
        [lista, onIndiceChange]
    );

    const fileId = file?.id ?? null;

    React.useEffect(() => {
        if (!isOpen || fileId == null) {
            setObjectUrl(null);
            setError(null);
            return;
        }

        let vivo = true;
        let creada: string | null = null;
        setLoading(true);
        setError(null);
        setZoom(1);

        traerArchivoPlano(fileId)
            .then((blob) => {
                if (!vivo) return;
                // El objectURL se crea acá y se revoca acá: el cache de lib/planos
                // guarda el Blob, no la URL, justamente para que cada pantalla maneje
                // la suya y ninguna le rompa la imagen a otra al cerrarse.
                creada = URL.createObjectURL(blob);
                setObjectUrl(creada);
            })
            .catch((err) => {
                console.error("Error fetching file:", err);
                if (vivo) setError("Ocurrió un error al cargar el archivo. Por favor, reintenta.");
            })
            .finally(() => {
                if (vivo) setLoading(false);
            });

        return () => {
            vivo = false;
            if (creada) URL.revokeObjectURL(creada);
            setObjectUrl(null);
        };
    }, [isOpen, fileId]);

    const isImage = esImagen(file?.tipo_archivo);
    const isPdf = esPdf(file?.tipo_archivo);

    // Flechas del teclado para pasar de plano. Escape no se toca: ya lo cierra el
    // Dialog, y redefinirlo acá lo haría cerrar dos veces.
    React.useEffect(() => {
        if (!isOpen || !lista || lista.length < 2) return;
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                e.preventDefault();
                irA(pos - 1);
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                irA(pos + 1);
            }
        };
        window.addEventListener("keydown", alTeclear);
        return () => window.removeEventListener("keydown", alTeclear);
    }, [isOpen, lista, pos, irA]);

    // Ctrl + rueda para acercar la imagen.
    //
    // Va como listener nativo y no como `onWheel`: React registra `wheel` en modo
    // pasivo, ahí `preventDefault()` no hace nada, y el ctrl+rueda termina agrandando
    // TODA la pantalla del navegador en vez del plano.
    //
    // Solo para imágenes: el PDF lo dibuja el visor del navegador, que ya trae su
    // propio zoom, y encimarle otro deja dos controles peleándose por lo mismo.
    React.useEffect(() => {
        const nodo = zonaRef.current;
        if (!nodo || !isImage) return;
        const alRodar = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => acotarZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        };
        nodo.addEventListener("wheel", alRodar, { passive: false });
        return () => nodo.removeEventListener("wheel", alRodar);
    }, [isImage, objectUrl]);

    // Imprimir el plano que se está viendo (pedido de Camilo, 3/9): el taller necesita
    // el plano en papel junto con la OT.
    //
    // Estando el PDF acá, se le pide imprimir al iframe que YA lo está mostrando: es el
    // visor del propio navegador, ya cargado y con el plano a la vista, así que no hay
    // que bajar ni esperar nada. Todo lo demás —las imágenes, y este mismo caso cuando
    // el navegador no deja tocar el visor embebido— va por `imprimirPlano`, que es la
    // misma función que usa la biblioteca de planos para imprimir sin abrir el visor.
    const handlePrint = async () => {
        if (!file || !objectUrl) return;

        if (isPdf) {
            try {
                const marco = iframeRef.current;
                if (marco?.contentWindow) {
                    marco.contentWindow.focus();
                    marco.contentWindow.print();
                    return;
                }
            } catch {
                // Algunos navegadores no dejan tocar el visor de PDF embebido.
            }
        }

        try {
            // Ya está en el cache de lib/planos —es el mismo archivo que se está
            // mirando—, así que esto no sale de nuevo a la red.
            const blob = await traerArchivoPlano(file.id);
            const como = await imprimirPlano(blob, file.nombre, file.tipo_archivo);
            if (como === "en_pestana") {
                toast.info("Se abrió el plano en una pestaña nueva: imprimilo desde ahí.");
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "No se pudo imprimir el plano.");
        }
    };

    const hayVarios = !!lista && lista.length > 1;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-none sm:max-w-none w-[95vw] h-[92vh] p-0 overflow-hidden flex flex-col bg-slate-50/95 backdrop-blur-md border-slate-200 shadow-2xl">
                <DialogHeader className="px-6 py-4 bg-white border-b border-slate-100 flex-shrink-0">
                    <div className="flex items-center justify-between gap-4 pr-8">
                        <div className="flex items-center gap-2 min-w-0">
                            <DialogTitle className="text-sm font-bold text-slate-800 truncate">
                                {file?.nombre}
                            </DialogTitle>
                            {hayVarios && (
                                <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">
                                    {pos + 1} de {lista!.length}
                                </span>
                            )}
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            {objectUrl && isImage && (
                                <div className="flex items-center gap-1 mr-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setZoom((z) => acotarZoom(z / 1.25))}
                                        className="h-8 w-8 p-0 border-slate-200"
                                        title="Alejar"
                                    >
                                        <ZoomOut className="w-4 h-4" />
                                    </Button>
                                    <span className="text-[11px] font-medium text-slate-500 w-10 text-center tabular-nums">
                                        {Math.round(zoom * 100)}%
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setZoom((z) => acotarZoom(z * 1.25))}
                                        className="h-8 w-8 p-0 border-slate-200"
                                        title="Acercar (o Ctrl + rueda del mouse)"
                                    >
                                        <ZoomIn className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setZoom(1)}
                                        className="h-8 w-8 p-0 border-slate-200"
                                        title="Ajustar a la pantalla"
                                    >
                                        <Maximize className="w-4 h-4" />
                                    </Button>
                                </div>
                            )}

                            {objectUrl && (
                                <>
                                    {(isImage || isPdf) && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handlePrint()}
                                            className="h-8 gap-2 border-slate-200"
                                            title="Imprimir este plano"
                                        >
                                            <Printer className="w-4 h-4" />
                                            Imprimir
                                        </Button>
                                    )}
                                    <Button variant="outline" size="sm" asChild className="h-8 gap-2 border-slate-200">
                                        <a href={objectUrl} download={file?.nombre}>
                                            <Download className="w-4 h-4" />
                                            Descargar
                                        </a>
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </DialogHeader>

                {/* Envoltorio que NO scrollea. Las flechas viven acá y no adentro del
                    área del plano: cuando se hace zoom, esa área pasa a `overflow-auto` y
                    todo lo posicionado adentro se va con el scroll — o sea que justo
                    cuando alguien está mirando un detalle de cerca, las flechas se le
                    escapaban de la pantalla. */}
                <div className="flex-grow relative min-h-0 flex">
                    {/* Las flechas van A LOS COSTADOS y no en el encabezado (pedido de
                        Julián, 7/9). Arriba quedaban perdidas entre el zoom y los
                        botones, y encima lejos: se mira el plano en el centro de la
                        pantalla y hay que subir hasta la barra para pasar al siguiente.
                        Acá caen justo donde la mano ya está.

                        Van por ENCIMA del visor de PDF (z-20): un <iframe> se dibuja
                        arriba de todo lo que no tenga su propio contexto de apilado, así
                        que sin esto las flechas quedaban tapadas justo en los PDF, que es
                        la mayoría de los planos. */}
                    {hayVarios && (
                        <>
                            <button
                                type="button"
                                onClick={() => irA(pos - 1)}
                                title="Plano anterior (o flecha izquierda del teclado)"
                                aria-label="Plano anterior"
                                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full
                                           bg-white/90 backdrop-blur border border-slate-200 shadow-lg
                                           flex items-center justify-center text-slate-600
                                           hover:bg-white hover:text-slate-900 hover:scale-105
                                           active:scale-95 transition
                                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <button
                                type="button"
                                onClick={() => irA(pos + 1)}
                                title="Plano siguiente (o flecha derecha del teclado)"
                                aria-label="Plano siguiente"
                                /* Separada del borde a propósito: el visor de PDF del
                                   navegador dibuja SU barra de scroll pegada a la derecha,
                                   y con la flecha ahí encima, arrastrar la barra a media
                                   altura saltaba al plano siguiente en vez de scrollear. */
                                className="absolute right-7 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full
                                           bg-white/90 backdrop-blur border border-slate-200 shadow-lg
                                           flex items-center justify-center text-slate-600
                                           hover:bg-white hover:text-slate-900 hover:scale-105
                                           active:scale-95 transition
                                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                            >
                                <ChevronRight className="w-6 h-6" />
                            </button>
                        </>
                    )}
                <div
                    ref={zonaRef}
                    className={cn(
                        "flex-grow flex p-4 min-h-0",
                        // Con zoom la imagen desborda y hay que poder recorrerla; el
                        // `m-auto` de adentro es el que la centra sin comerse el borde
                        // de arriba, cosa que `items-center` sí hace cuando desborda.
                        isImage && zoom !== 1 ? "overflow-auto" : "items-center justify-center overflow-hidden"
                    )}
                >
                    {loading && (
                        <div className="m-auto flex flex-col items-center gap-3">
                            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                            <p className="text-xs font-medium text-slate-500">Cargando archivo...</p>
                        </div>
                    )}

                    {error && (
                        <div className="m-auto text-center p-8 bg-white rounded-xl border border-red-100 shadow-sm">
                            <p className="text-sm text-red-600 font-medium">{error}</p>
                        </div>
                    )}

                    {!loading && !error && objectUrl && (
                        <>
                            {isImage ? (
                                <img
                                    src={objectUrl}
                                    alt={file?.nombre}
                                    style={
                                        zoom === 1
                                            ? undefined
                                            : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }
                                    }
                                    className={cn(
                                        "m-auto shadow-2xl rounded-sm transition-all animate-in fade-in zoom-in-95 duration-300",
                                        zoom === 1 && "max-w-full max-h-full object-contain"
                                    )}
                                />
                            ) : isPdf ? (
                                <iframe
                                    ref={iframeRef}
                                    src={objectUrl}
                                    className="w-full h-full rounded-md border border-slate-200 shadow-inner bg-white animate-in fade-in slide-in-from-bottom-2 duration-400"
                                    title={file?.nombre}
                                />
                            ) : (
                                <div className="m-auto text-center p-12 bg-white rounded-2xl border border-slate-200 shadow-xl max-w-sm">
                                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                         <Download className="w-8 h-8 text-slate-400" />
                                    </div>
                                    <h3 className="text-slate-800 font-bold mb-2">Vista previa no disponible</h3>
                                    <p className="text-xs text-slate-500 mb-6">Este tipo de archivo no puede visualizarse directamente.</p>
                                    <Button asChild className="w-full">
                                        <a href={objectUrl} download={file?.nombre}>
                                            Descargar Archivo
                                        </a>
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
