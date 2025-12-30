export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

if (!process.env.NEXT_PUBLIC_API_URL && typeof window !== 'undefined') {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.error(
            `CRITICAL: NEXT_PUBLIC_API_URL is missing! Defaulting to ${API_URL}. Requests will likely fail.`
        );
    }
}
