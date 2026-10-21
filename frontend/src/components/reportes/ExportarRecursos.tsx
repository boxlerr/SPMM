"use client";

/**
 * «Recursos del taller»: las personas y las máquinas en un archivo, para organizar la
 * producción con una IA junto con el reporte «OT pendientes con sus procesos» (Lucas,
 * 21/10/2026). Está en el Dashboard (Reportes) y en Recursos › Recurso humano, donde
 * reemplaza a «Exportar habilidades»: trae esas mismas tablas y además las horas, las
 * máquinas con sus procesos y los feriados.
 *
 * El menú Exportar ya viaja en las dos pantallas; los datos y el armado del archivo
 * (lib/recursos, lib/paraClaude) se bajan recién al tocar una opción.
 */
import { useRef } from "react";
import { ExportarMenu } from "@/components/common/ExportarMenu";

export function ExportarRecursos({ className, disabled, align, textoBoton = "Recursos del taller" }: {
    /** En Recursos dice «Exportar recursos»; en el Dashboard, el nombre del archivo. */
    textoBoton?: string;
    className?: string;
    disabled?: boolean;
    align?: "start" | "end";
}) {
    // Los renglones de «Para tener en cuenta» salen de los mismos datos que las tablas:
    // se guardan al cargarlas y el menú los lee después (ver ExportarMenu, `filtros`).
    const renglones = useRef<string[]>([]);
    return (
        <ExportarMenu
            titulo="Recursos del taller"
            archivo="recursos_del_taller"
            textoBoton={textoBoton}
            rotulo="Personas y máquinas, para organizar la producción"
            cargarSecciones={async () => {
                const { pedirRecursos, renglonesDeRecursos, seccionesDeRecursos } = await import("@/lib/recursos");
                const r = await pedirRecursos();
                renglones.current = renglonesDeRecursos(r);
                return seccionesDeRecursos(r);
            }}
            filtros={() => renglones.current}
            rotuloFiltros="Para tener en cuenta"
            subtitulo="Las personas disponibles con sus habilidades y sus horas, y las máquinas con sus procesos y quién las usa."
            rotuloExtras="Para la IA"
            extras={[{
                rotulo: "Recursos para la IA (.md)",
                ayuda: "Texto para subir junto con el de OT pendientes",
                hacer: async () => {
                    const [{ pedirRecursos, textoDeRecursosParaClaude }, { bajarTexto }] = await Promise.all([
                        import("@/lib/recursos"), import("@/lib/paraClaude"),
                    ]);
                    return bajarTexto(textoDeRecursosParaClaude(await pedirRecursos()), "recursos_para_la_ia");
                },
            }]}
            disabled={disabled}
            align={align}
            className={className}
        />
    );
}

export default ExportarRecursos;
