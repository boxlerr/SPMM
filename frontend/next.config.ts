import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    root: process.cwd(), // Especificar el directorio raíz del proyecto
  },
};

export default nextConfig;
