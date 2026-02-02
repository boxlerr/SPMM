export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Derivar WS_URL de API_URL
export const WS_URL = (() => {
    if (typeof window === 'undefined') return ""; // Server-side fallback

    // Si API_URL es relativa (empieza con /), usar el origen actual
    const base = API_URL.startsWith('/')
        ? window.location.origin + API_URL
        : API_URL;

    // Reemplazar protocolo
    return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
})();

if (!process.env.NEXT_PUBLIC_API_URL && typeof window !== 'undefined') {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.error(
            `CRITICAL: NEXT_PUBLIC_API_URL is missing! Defaulting to ${API_URL}. Requests will likely fail.`
        );
    }
}
