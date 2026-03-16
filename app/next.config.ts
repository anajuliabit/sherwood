import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/skill.md',
        destination: 'https://raw.githubusercontent.com/imthatcarlos/sherwood/refs/heads/main/skill/SKILL.md',
      }
    ];
  },
};

export default nextConfig;
