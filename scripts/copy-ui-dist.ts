#!/usr/bin/env node

// Script to copy built UI files to dist directory
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const rootDir: string = path.resolve(__dirname, '..');

// Define source and target paths
const sourceUIDir: string = path.join(rootDir, 'src', 'app', 'ui');
const targetDir: string = path.join(rootDir, 'dist', 'src', 'app', 'ui');

async function copyUIBuild(): Promise<void> {
	try {
		// Check if UI build exists - if not, copy minimal files for development fallback
		const standalonePath = path.join(sourceUIDir, '.next', 'standalone');
		const hasUIBuild = fs.existsSync(standalonePath);

		if (!hasUIBuild) {
			console.log('⚠️  UI build not found, copying minimal files for development fallback');

			// Ensure the target directory exists
			await fs.ensureDir(targetDir);

			// Copy package.json and any existing public/static files for development mode
			const minimalFiles = [
				{ src: 'package.json', dest: 'package.json', required: false },
				{ src: 'public', dest: 'public', required: false },
			];

			for (const file of minimalFiles) {
				const srcPath = path.join(sourceUIDir, file.src);
				const destPath = path.join(targetDir, file.dest);

				if (fs.existsSync(srcPath)) {
					await fs.copy(srcPath, destPath, {
						overwrite: true,
						errorOnExist: false
					});
					console.log(`✅ Copied ${file.src} for development fallback`);
				}
			}

			console.log('✅ Minimal UI files copied for development fallback');
			return;
		}

		// Ensure the target directory doesn't exist to avoid conflicts
		if (fs.existsSync(targetDir)) {
			console.log('Removing existing target directory...');
			await fs.remove(targetDir);
		}

		console.log(`Copying built UI from ${sourceUIDir} to ${targetDir}...`);

		// Create target directory
		await fs.ensureDir(targetDir);

		// Validate that the source build exists
		if (!fs.existsSync(standalonePath)) {
			throw new Error('Next.js standalone build not found. Run `pnpm run build` in the UI directory first.');
		}

		// Copy only the essential files for production
		const filesToCopy = [
			{ src: '.next/standalone', dest: '.next/standalone', required: true },
			{ src: '.next/static', dest: '.next/static', required: true },
			{ src: 'public', dest: 'public', required: false },
			{ src: 'package.json', dest: 'package.json', required: false }
		];

		for (const file of filesToCopy) {
			const srcPath = path.join(sourceUIDir, file.src);
			const destPath = path.join(targetDir, file.dest);

			if (fs.existsSync(srcPath)) {
				await fs.copy(srcPath, destPath, {
					overwrite: true,
					errorOnExist: false
				});
				console.log(`✅ Copied ${file.src}`);
			} else if (file.required) {
				throw new Error(`Required file ${file.src} not found`);
			} else {
				console.log(`⚠️  Optional file ${file.src} not found, skipping`);
			}
		}

		// Ensure static files are available in the standalone build
		const staticSrcPath = path.join(sourceUIDir, '.next', 'static');
		const staticDestPath = path.join(targetDir, '.next', 'standalone', '.next', 'static');

		if (fs.existsSync(staticSrcPath)) {
			await fs.ensureDir(path.dirname(staticDestPath));
			await fs.copy(staticSrcPath, staticDestPath, { overwrite: true });
			console.log('✅ Copied static files to standalone location');
		}

		// Ensure public files are available in the standalone build
		const publicSrcPath = path.join(sourceUIDir, 'public');
		const publicDestPath = path.join(targetDir, '.next', 'standalone', 'public');

		if (fs.existsSync(publicSrcPath)) {
			await fs.copy(publicSrcPath, publicDestPath, { overwrite: true });
			console.log('✅ Copied public files to standalone location');
		}

		// Validate that the standalone server exists
		const standaloneServerPath = path.join(targetDir, '.next', 'standalone', 'server.js');
		if (!fs.existsSync(standaloneServerPath)) {
			throw new Error('Standalone server.js not found after copying');
		}

		// Ensure standalone server is executable
		await fs.chmod(standaloneServerPath, '755');
		console.log('✅ Standalone server configured');

		// Create a simple package.json for the distribution if it doesn't exist
		const distPackageJsonPath = path.join(targetDir, 'package.json');
		if (!fs.existsSync(distPackageJsonPath)) {
			const distPackageJson = {
				name: 'cipher-ui',
				version: '0.1.0',
				private: true,
				scripts: {
					start: 'node .next/standalone/server.js'
				}
			};
			await fs.writeFile(distPackageJsonPath, JSON.stringify(distPackageJson, null, 2));
			console.log('✅ Created distribution package.json');
		}

		console.log('✅ Successfully copied built UI to dist');
		console.log(`📁 UI files available at: ${targetDir}`);
		console.log(`🚀 Standalone server at: ${standaloneServerPath}`);
	} catch (err: unknown) {
		console.error('❌ Error copying built UI:', err);
		process.exit(1);
	}
}

// Execute the copy function
copyUIBuild(); 