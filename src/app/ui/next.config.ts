import type { NextConfig } from 'next';
import os from 'os';

const interfaces = os.networkInterfaces();
const allowedOrigins: string[] = ['http://localhost:3000'];
Object.values(interfaces).forEach(list =>
	list?.forEach(iface => {
		if (iface.family === 'IPv4' && !iface.internal) {
			allowedOrigins.push(`http://${iface.address}:3000`);
		}
	})
);

const isWindows = process.platform === 'win32';
const wantsStandalone = process.env.BUILD_STANDALONE === 'true';
const forceStandalone = process.env.FORCE_STANDALONE === 'true';
const canUseStandalone = wantsStandalone && (!isWindows || forceStandalone);

if (wantsStandalone && isWindows && !forceStandalone) {
	console.warn(
		'⚠️  Standalone UI build disabled on Windows. Enable Developer Mode, run the build from an elevated shell, or set FORCE_STANDALONE=true to override.'
	);
}

const nextConfig: NextConfig = {
	reactStrictMode: true,
	...(canUseStandalone && { output: 'standalone' as const }),
	eslint: {
		ignoreDuringBuilds: true,
	},
	allowedDevOrigins: allowedOrigins,
	async rewrites() {
		const apiPort = process.env.API_PORT ?? '3001';
		return [
			{
				source: '/api/:path*',
				destination: `http://localhost:${apiPort}/api/:path*`,
			},
		];
	},
	async headers() {
		return [
			{
				source: '/_next/:path*',
				headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
			},
		];
	},
};

export default nextConfig;
