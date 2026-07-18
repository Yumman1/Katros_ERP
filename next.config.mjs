/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Tree-shake barrel imports so each page only compiles the icons/charts it uses.
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
