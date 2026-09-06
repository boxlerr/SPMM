"use client";

import { BibliotecaPlanos } from "@/components/planos/BibliotecaPlanos";

/**
 * La pantalla Planos.
 *
 * Es una cáscara a propósito: la grilla vive en `BibliotecaPlanos` porque lo mismo se
 * monta adentro de Recursos, y tener dos copias garantiza que en algún momento una de
 * las dos se quede sin el botón nuevo.
 */
export default function PlanosPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="w-full px-2 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-8">
                <BibliotecaPlanos />
            </div>
        </div>
    );
}
