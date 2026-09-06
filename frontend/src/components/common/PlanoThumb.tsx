"use client";

import React from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { esImagen, esPdf, traerArchivoPlano } from "@/lib/planos";
import { miniaturaDePdf } from "@/lib/pdfThumb";

interface PlanoThumbProps {
    plano: { id: number; nombre: string; tipo_archivo?: string | null; bytes?: number | null };
    className?: string;
    onClick?: () => void;
}

type Estado = "espera" | "cargando" | "listo" | "sin_vista";

/**
 * A partir de acá no se dibuja miniatura: se muestra el ícono y listo.
 *
 * Para pintar la miniatura hay que bajarse el archivo ENTERO —no existe media bajada de
 * un PDF—, así que una grilla de 48 tarjetas son 48 descargas. Con los planos que vinieron
 * de Drive eso no se nota (~27 KB cada uno, medido sobre la carpeta), pero nada impide que
 * alguien suba a mano un PDF escaneado de 20 MB, y ahí la biblioteca se comería la conexión
 * del taller para mostrar dibujitos de 100 píxeles. El tamaño ya viene en el listado, así
 * que se decide ANTES de pedir nada.
 */
const MAX_BYTES_MINIATURA = 3 * 1024 * 1024;

/**
 * La miniatura de un plano.
 *
 * Se dibuja recién cuando entra en pantalla. La biblioteca de planos puede tener
 * cientos, y cada uno cuesta una bajada más —si es PDF— un render de pdf.js: montarlos
 * todos de una deja la pestaña clavada varios segundos aunque se vean seis.
 */
export const PlanoThumb = ({ plano, className, onClick }: PlanoThumbProps) => {
    const marco = React.useRef<HTMLDivElement>(null);
    const [visible, setVisible] = React.useState(false);
    const [src, setSrc] = React.useState<string | null>(null);
    const [estado, setEstado] = React.useState<Estado>("espera");

    React.useEffect(() => {
        if (visible) return;
        const nodo = marco.current;
        if (!nodo) return;
        // Sin IntersectionObserver (navegador viejo del taller) se dibuja y listo:
        // preferimos la pantalla lenta antes que la tarjeta vacía para siempre.
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const obs = new IntersectionObserver(
            (entradas) => {
                if (entradas.some((e) => e.isIntersecting)) {
                    setVisible(true);
                    obs.disconnect();
                }
            },
            // Se adelanta un poco al scroll para que la miniatura ya esté cuando llega.
            { rootMargin: "200px" }
        );
        obs.observe(nodo);
        return () => obs.disconnect();
    }, [visible]);

    const pesado = (plano.bytes ?? 0) > MAX_BYTES_MINIATURA;

    React.useEffect(() => {
        if (!visible) return;
        if (pesado) {
            setEstado("sin_vista");
            return;
        }

        let vivo = true;
        let creada: string | null = null;
        setEstado("cargando");

        traerArchivoPlano(plano.id)
            .then(async (blob) => {
                if (esImagen(plano.tipo_archivo)) {
                    creada = URL.createObjectURL(blob);
                    // Si la tarjeta se desmontó mientras bajaba el archivo, la limpieza
                    // del efecto ya pasó y no vio esta URL: se suelta acá o queda colgada
                    // para siempre. Con la biblioteca en 1183 planos y el scroll rápido,
                    // eso son cientos de imágenes retenidas en memoria.
                    if (!vivo) {
                        URL.revokeObjectURL(creada);
                        creada = null;
                        return null;
                    }
                    return creada;
                }
                if (esPdf(plano.tipo_archivo)) return await miniaturaDePdf(blob, 400, plano.id);
                return null;
            })
            .then((imagen) => {
                if (!vivo) return;
                if (imagen) {
                    setSrc(imagen);
                    setEstado("listo");
                } else {
                    setEstado("sin_vista");
                }
            })
            .catch(() => {
                // Un PDF roto o un tipo raro no es un error para mostrarle a nadie: se
                // cae al ícono genérico y el plano igual se puede abrir y descargar.
                if (vivo) setEstado("sin_vista");
            });

        return () => {
            vivo = false;
            if (creada) URL.revokeObjectURL(creada);
        };
    }, [visible, pesado, plano.id, plano.tipo_archivo]);

    const imagen = esImagen(plano.tipo_archivo);

    return (
        <div
            ref={marco}
            onClick={onClick}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onClick();
                          }
                      }
                    : undefined
            }
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            title={plano.nombre}
            className={cn(
                "relative h-24 w-full flex items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white",
                onClick && "cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                className
            )}
        >
            {estado === "listo" && src ? (
                <img
                    src={src}
                    alt={plano.nombre}
                    className="max-h-full max-w-full object-contain animate-in fade-in duration-200"
                />
            ) : estado === "sin_vista" ? (
                <div
                    className={cn(
                        "w-full h-full flex items-center justify-center shadow-inner",
                        imagen
                            ? "bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600"
                            : "bg-gradient-to-br from-orange-50 to-orange-100 text-orange-600"
                    )}
                >
                    {imagen ? <ImageIcon className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                </div>
            ) : (
                <div className="w-full h-full bg-slate-100 animate-pulse" />
            )}
        </div>
    );
};
