import { redirect } from "next/navigation";

/**
 * `/ordenes` ya no es una sección propia.
 *
 * La lista de TODAS las órdenes vive ahora como una solapa adentro de Operaciones ›
 * Órdenes de Trabajo. Tener las dos cosas —una sección del menú y una solapa, las dos
 * llamadas "Órdenes de Trabajo"— era justamente lo confuso.
 *
 * La ruta se deja viva y redirige, porque estuvo publicada un día y puede haber
 * quedado en el historial o en un favorito de alguien: mejor que caiga en el lugar
 * correcto a que dé 404.
 */
export default function OrdenesRedirect() {
    redirect("/operaciones");
}
