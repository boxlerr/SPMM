"use client";

/**
 * El dibujito del formato: qué es cada medida, con una letra (A, B, C…) en cada cota.
 *
 * POR QUÉ
 *
 * «Ø exterior» y «Ø interior» se entienden solos, pero «Ala A», «Ala B» o el orden de la
 * PLACA (espesor × ancho × largo) no: en el viejo la misma PLACA quedó cargada en dos
 * órdenes distintos según quién la dio de alta, y la PLANCHUELA con el espesor y el
 * ancho cruzados. Con la figura al lado de los campos, la letra de cada campo está en la
 * cota que mide: no hay que adivinar cuál es cuál. El campo que tiene el foco se pinta
 * en rojo en el dibujo.
 *
 * Las letras siguen el ORDEN de las medidas del formato (`etiquetas` del catálogo, la
 * semilla de la migración): A es la primera, B la segunda… Si un formato llega con
 * otra cantidad de medidas que la que el dibujo sabe mostrar (alguien lo cambió en la
 * base), se usa el genérico: mejor un dibujo que no dice de más que uno que miente.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const LETRAS = ["A", "B", "C", "D", "E"];

// Los colores van escritos acá y no como clases: son atributos de SVG.
const TRAZO = "#64748b"; // slate-500
const RELLENO = "#e2e8f0"; // slate-200
const RELLENO_CLARO = "#f1f5f9"; // slate-100
const RELLENO_OSCURO = "#cbd5e1"; // slate-300
const COTA = "#94a3b8"; // slate-400
const LETRA = "#334155"; // slate-700
const ENCENDIDA = "#DC143C"; // el rojo de la casa

type Punto = [number, number];

interface Dibujo {
    /** Cuántas medidas sabe mostrar. */
    medidas: number;
    dibujar: (c: (indice: number, desde: Punto, hasta: Punto, extra?: ExtraCota) => ReactNode) => ReactNode;
}

interface ExtraCota {
    /** Líneas de referencia desde la pieza hasta la cota. */
    extensiones?: [Punto, Punto][];
    /** Dónde va la letra cuando no entra sobre la línea (espesores): se une con una guía. */
    letraEn?: Punto;
}

const forma = (puntos: Punto[], relleno = RELLENO) => (
    <polygon points={puntos.map((p) => p.join(",")).join(" ")} fill={relleno} stroke={TRAZO} strokeWidth={1.5} strokeLinejoin="round" />
);

const DIBUJOS: Record<string, Dibujo> = {
    "BARRA REDONDO": {
        medidas: 1,
        dibujar: (c) => (
            <>
                <circle cx={60} cy={48} r={32} fill={RELLENO} stroke={TRAZO} strokeWidth={1.5} />
                {c(0, [28, 48], [92, 48])}
            </>
        ),
    },
    "BARRA CUADRADO": {
        medidas: 1,
        dibujar: (c) => (
            <>
                <rect x={30} y={14} width={60} height={60} fill={RELLENO} stroke={TRAZO} strokeWidth={1.5} />
                {c(0, [30, 86], [90, 86], { extensiones: [[[30, 77], [30, 89]], [[90, 77], [90, 89]]] })}
            </>
        ),
    },
    "BARRA HEXAGONAL": {
        medidas: 1,
        dibujar: (c) => (
            <>
                {forma([[90.6, 48], [73.3, 18], [38.7, 18], [21.4, 48], [38.7, 78], [73.3, 78]])}
                {c(0, [106, 18], [106, 78], { extensiones: [[[77, 18], [109, 18]], [[77, 78], [109, 78]]] })}
            </>
        ),
    },
    "BARRA RECTANGULAR": {
        medidas: 2,
        dibujar: (c) => (
            <>
                <rect x={16} y={30} width={80} height={34} fill={RELLENO} stroke={TRAZO} strokeWidth={1.5} />
                {c(0, [16, 78], [96, 78], { extensiones: [[[16, 67], [16, 81]], [[96, 67], [96, 81]]] })}
                {c(1, [108, 30], [108, 64], { extensiones: [[[99, 30], [111, 30]], [[99, 64], [111, 64]]] })}
            </>
        ),
    },
    "TUBO REDONDO": {
        medidas: 2,
        dibujar: (c) => (
            <>
                <circle cx={60} cy={44} r={32} fill={RELLENO} stroke={TRAZO} strokeWidth={1.5} />
                <circle cx={60} cy={44} r={20} fill="white" stroke={TRAZO} strokeWidth={1.5} />
                {c(1, [40, 44], [80, 44])}
                {c(0, [28, 88], [92, 88], { extensiones: [[[28, 50], [28, 91]], [[92, 50], [92, 91]]] })}
            </>
        ),
    },
    "TUBO CUADRADO": {
        medidas: 2,
        dibujar: (c) => (
            <>
                <rect x={24} y={12} width={62} height={62} fill={RELLENO} stroke={TRAZO} strokeWidth={1.5} />
                <rect x={32} y={20} width={46} height={46} fill="white" stroke={TRAZO} strokeWidth={1.5} />
                {c(0, [24, 86], [86, 86], { extensiones: [[[24, 77], [24, 89]], [[86, 77], [86, 89]]] })}
                {c(1, [78, 43], [86, 43], { letraEn: [104, 43] })}
            </>
        ),
    },
    "TUBO RECTANGULAR": {
        medidas: 3,
        dibujar: (c) => (
            <>
                <rect x={14} y={24} width={82} height={48} fill={RELLENO} stroke={TRAZO} strokeWidth={1.5} />
                <rect x={21} y={31} width={68} height={34} fill="white" stroke={TRAZO} strokeWidth={1.5} />
                {c(0, [14, 84], [96, 84], { extensiones: [[[14, 75], [14, 87]], [[96, 75], [96, 87]]] })}
                {c(1, [108, 24], [108, 72], { extensiones: [[[99, 24], [111, 24]], [[99, 72], [111, 72]]] })}
                {c(2, [40, 31], [40, 24], { letraEn: [40, 10] })}
            </>
        ),
    },
    // Espesor × ancho × largo, en ese orden (el de la descripción de la PLACA).
    PLACA: {
        medidas: 3,
        dibujar: (c) => (
            <>
                {forma([[14, 56], [78, 56], [100, 34], [36, 34]], RELLENO_CLARO)}
                {forma([[14, 56], [78, 56], [78, 65], [14, 65]], RELLENO)}
                {forma([[78, 56], [100, 34], [100, 43], [78, 65]], RELLENO_OSCURO)}
                {c(0, [7, 65], [7, 56], { letraEn: [7, 44], extensiones: [[[12, 56], [4, 56]], [[12, 65], [4, 65]]] })}
                {c(1, [85, 72], [107, 50], { extensiones: [[[80, 67], [88, 75]], [[102, 45], [110, 53]]] })}
                {c(2, [14, 78], [78, 78], { extensiones: [[[14, 68], [14, 81]], [[78, 68], [78, 81]]] })}
            </>
        ),
    },
    // Ancho × espesor: la sección de la barra chata, con el largo hacia atrás.
    PLANCHUELA: {
        medidas: 2,
        dibujar: (c) => (
            <>
                {forma([[22, 44], [98, 44], [110, 32], [34, 32]], RELLENO_CLARO)}
                {forma([[98, 44], [110, 32], [110, 46], [98, 58]], RELLENO_OSCURO)}
                {forma([[22, 44], [98, 44], [98, 58], [22, 58]], RELLENO)}
                {c(0, [22, 72], [98, 72], { extensiones: [[[22, 61], [22, 75]], [[98, 61], [98, 75]]] })}
                {c(1, [11, 58], [11, 44], { letraEn: [11, 30], extensiones: [[[20, 44], [8, 44]], [[20, 58], [8, 58]]] })}
            </>
        ),
    },
    "ANGULOS IGUALES": {
        medidas: 2,
        dibujar: (c) => (
            <>
                {forma([[30, 20], [40, 20], [40, 74], [90, 74], [90, 84], [30, 84]])}
                {c(0, [30, 94], [90, 94], { extensiones: [[[30, 87], [30, 97]], [[90, 87], [90, 97]]] })}
                {c(1, [30, 12], [40, 12], { letraEn: [54, 12], extensiones: [[[30, 18], [30, 9]], [[40, 18], [40, 9]]] })}
            </>
        ),
    },
    "ANGULOS DESIGUALES": {
        medidas: 3,
        dibujar: (c) => (
            <>
                {forma([[30, 28], [39, 28], [39, 75], [98, 75], [98, 84], [30, 84]])}
                {c(0, [30, 94], [98, 94], { extensiones: [[[30, 87], [30, 97]], [[98, 87], [98, 97]]] })}
                {c(1, [18, 28], [18, 84], { extensiones: [[[27, 28], [15, 28]], [[27, 84], [15, 84]]] })}
                {c(2, [30, 20], [39, 20], { letraEn: [53, 20], extensiones: [[[30, 26], [30, 17]], [[39, 26], [39, 17]]] })}
            </>
        ),
    },
    "PERFIL U": {
        medidas: 3,
        dibujar: (c) => (
            <>
                {forma([[36, 18], [90, 18], [90, 27], [45, 27], [45, 73], [90, 73], [90, 82], [36, 82]])}
                {c(0, [22, 18], [22, 82], { extensiones: [[[33, 18], [19, 18]], [[33, 82], [19, 82]]] })}
                {c(1, [36, 9], [90, 9], { extensiones: [[[36, 15], [36, 6]], [[90, 15], [90, 6]]] })}
                {c(2, [36, 50], [45, 50], { letraEn: [60, 50] })}
            </>
        ),
    },
    "PERFIL T": {
        medidas: 3,
        dibujar: (c) => (
            <>
                {forma([[18, 22], [94, 22], [94, 31], [60.5, 31], [60.5, 86], [51.5, 86], [51.5, 31], [18, 31]])}
                {c(0, [106, 22], [106, 86], { extensiones: [[[97, 22], [109, 22]], [[63, 86], [109, 86]]] })}
                {c(1, [18, 12], [94, 12], { extensiones: [[[18, 19], [18, 9]], [[94, 19], [94, 9]]] })}
                {c(2, [51.5, 62], [60.5, 62], { letraEn: [76, 62] })}
            </>
        ),
    },
};

/** El genérico: una chapa con un corte adentro (pantógrafo, láser, lo que no tiene dibujo propio). */
function dibujarGenerico(c: (indice: number, desde: Punto, hasta: Punto, extra?: ExtraCota) => ReactNode, medidas: number) {
    return (
        <>
            <rect x={16} y={16} width={80} height={60} rx={2} fill={RELLENO_CLARO} stroke={TRAZO} strokeWidth={1.5} />
            <path
                d="M30 30 H62 L78 44 V62 H30 Z"
                fill={RELLENO}
                stroke={TRAZO}
                strokeWidth={1.2}
                strokeDasharray="4 3"
                strokeLinejoin="round"
            />
            <circle cx={46} cy={48} r={6} fill="white" stroke={TRAZO} strokeWidth={1.2} strokeDasharray="3 2.5" />
            {medidas >= 1 && c(0, [16, 88], [96, 88], { extensiones: [[[16, 79], [16, 91]], [[96, 79], [96, 91]]] })}
            {medidas >= 2 && c(1, [108, 16], [108, 76], { extensiones: [[[99, 16], [111, 16]], [[99, 76], [111, 76]]] })}
        </>
    );
}

const normal = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export interface FiguraFormatoProps {
    /** El nombre del formato («TUBO REDONDO»). Sin formato se dibuja el genérico, apagado. */
    formato?: string | null;
    /** Qué es cada medida, en orden. Sólo para el texto accesible y para saber cuántas son. */
    etiquetas?: string[] | null;
    /** La medida que se está escribiendo (0 = A): su cota va en rojo. */
    activa?: number | null;
    /** Sin cotas ni letras: el iconito de la cabecera de la ficha. */
    soloForma?: boolean;
    className?: string;
}

export function FiguraFormato({ formato, etiquetas, activa = null, soloForma = false, className }: FiguraFormatoProps) {
    const nombre = normal(formato);
    const propio = nombre ? DIBUJOS[nombre] : undefined;
    const cuantas = etiquetas?.length ?? propio?.medidas ?? 0;
    // Si el catálogo dice otra cantidad de medidas que el dibujo, el genérico (ver arriba).
    const dibujo = propio && (!etiquetas || etiquetas.length === propio.medidas) ? propio : null;

    const cota = (indice: number, desde: Punto, hasta: Punto, extra: ExtraCota = {}): ReactNode => {
        if (soloForma || indice >= Math.max(cuantas, 0)) return null;
        const encendida = activa === indice;
        const color = encendida ? ENCENDIDA : COTA;
        const [x1, y1] = desde;
        const [x2, y2] = hasta;
        const largo = Math.hypot(x2 - x1, y2 - y1) || 1;
        // Las marcas de los extremos, perpendiculares a la cota (como en un plano).
        const nx = (-(y2 - y1) / largo) * 3;
        const ny = ((x2 - x1) / largo) * 3;
        const [lx, ly] = extra.letraEn ?? [(x1 + x2) / 2, (y1 + y2) / 2];
        return (
            <g key={indice}>
                {extra.extensiones?.map(([a, b], i) => (
                    <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={0.6} opacity={0.8} />
                ))}
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={encendida ? 1.5 : 1} />
                <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} stroke={color} strokeWidth={encendida ? 1.5 : 1} />
                <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} stroke={color} strokeWidth={encendida ? 1.5 : 1} />
                {extra.letraEn && (
                    <line x1={x2} y1={y2} x2={lx} y2={ly} stroke={color} strokeWidth={0.6} strokeDasharray="2 1.5" />
                )}
                <text
                    x={lx}
                    y={ly}
                    dy="0.36em"
                    textAnchor="middle"
                    fontSize={encendida ? 12 : 10.5}
                    fontWeight={700}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    fill={encendida ? ENCENDIDA : LETRA}
                    stroke="white"
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                >
                    {LETRAS[indice]}
                </text>
            </g>
        );
    };

    const texto = !nombre
        ? "Todavía no se eligió el formato"
        : `${formato}${etiquetas?.length ? ": " + etiquetas.map((e, i) => `${LETRAS[i]} = ${e}`).join(", ") : ""}`;

    return (
        <svg
            viewBox="0 0 120 100"
            role="img"
            aria-label={texto}
            className={cn("select-none", !nombre && "opacity-40", className)}
        >
            <title>{texto}</title>
            {dibujo ? dibujo.dibujar(cota) : dibujarGenerico(cota, Math.min(cuantas, 2))}
        </svg>
    );
}

export default FiguraFormato;
