#!/usr/bin/env node

/**
 * Cipher Secret Detection Hook
 * Detekuje potenciální API klíče a secrets před commitem
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Seznam patternů pro detekci různých typů API klíčů
const SECRET_PATTERNS = [
  // OpenAI API klíče
  { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{48}/, severity: 'HIGH' },

  // Anthropic API klíče
  { name: 'Anthropic API Key', pattern: /sk-ant-api03-[a-zA-Z0-9\-_]{95}/, severity: 'HIGH' },

  // Google/Gemini API klíče
  { name: 'Google/Gemini API Key', pattern: /AIza[0-9A-Za-z\-_]{35}/, severity: 'HIGH' },

  // OpenRouter API klíče
  { name: 'OpenRouter API Key', pattern: /sk-or-v1-[a-f0-9]{64}/, severity: 'HIGH' },

  // Obecné dlouhé API klíče
  { name: 'Generic API Key', pattern: /[a-zA-Z0-9]{32,}/, severity: 'MEDIUM' },

  // AWS Access Keys
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/, severity: 'HIGH' },
  { name: 'AWS Secret Key', pattern: /[0-9a-zA-Z\/+]{40}/, severity: 'MEDIUM' },

  // Database connection strings
  { name: 'PostgreSQL URL', pattern: /postgresql:\/\/.*:.*@/, severity: 'HIGH' },
  { name: 'MongoDB URL', pattern: /mongodb(\+srv)?:\/\/.*:.*@/, severity: 'HIGH' },

  // JWT tokens
  { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/, severity: 'HIGH' },

  // Private keys
  { name: 'Private Key', pattern: /-----BEGIN (RSA )?PRIVATE KEY-----/, severity: 'CRITICAL' }
];

// Soubory které se mají ignorovat
const IGNORED_FILES = [
  '.env.example',
  '.env.template',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'detect-secrets.js',
  'CLAUDE.md',
  'README.md'
];

// Adresáře které se mají ignorovat
const IGNORED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  '.next',
  'coverage',
  'build',
  '.husky'
];

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return output.trim().split('\n').filter(file => file.length > 0);
  } catch (error) {
    console.error('❌ Chyba při získávání staged souborů:', error.message);
    return [];
  }
}

function shouldIgnoreFile(filePath) {
  // Ignoruj soubory podle jména
  const fileName = path.basename(filePath);
  if (IGNORED_FILES.includes(fileName)) {
    return true;
  }

  // Ignoruj soubory v určitých adresářích
  const pathParts = filePath.split(path.sep);
  for (const dir of IGNORED_DIRS) {
    if (pathParts.includes(dir)) {
      return true;
    }
  }

  // Ignoruj binární soubory
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.exe', '.dll'];
  if (binaryExts.includes(ext)) {
    return true;
  }

  return false;
}

function scanFileForSecrets(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const findings = [];

    SECRET_PATTERNS.forEach(({ name, pattern, severity }) => {
      const lines = content.split('\n');

      lines.forEach((line, lineNumber) => {
        const matches = line.match(pattern);
        if (matches) {
          // Speciální kontrola pro Generic API Key - ignoruj krátké nebo běžné stringy
          if (name === 'Generic API Key') {
            const match = matches[0];

            // Ignoruj placeholder hodnoty
            if (match.includes('placeholder') ||
                match.includes('your-') ||
                match.includes('example') ||
                match.includes('XXXXXXXXX') ||
                match.length < 40) {
              return;
            }

            // Ignoruj běžné hodnoty jako jsou package názvy, hex barvy, atd.
            if (/^[a-f0-9]{32}$/i.test(match) && match.length === 32) {
              return; // Pravděpodobně hex hash
            }
          }

          // Speciální kontrola pro PostgreSQL - ignoruj placeholder hesla
          if (name === 'PostgreSQL URL' && (line.includes('placeholder') || line.includes('your-password'))) {
            return;
          }

          findings.push({
            file: filePath,
            line: lineNumber + 1,
            type: name,
            severity,
            content: line.trim(),
            match: matches[0]
          });
        }
      });
    });

    return findings;
  } catch (error) {
    console.warn(`⚠️  Nelze načíst soubor ${filePath}:`, error.message);
    return [];
  }
}

function main() {
  console.log('🔍 Cipher Secret Detection - Kontrola staged souborů...\n');

  const stagedFiles = getStagedFiles();

  if (stagedFiles.length === 0) {
    console.log('✅ Žádné staged soubory k kontrole.');
    process.exit(0);
  }

  let allFindings = [];
  let checkedFilesCount = 0;

  stagedFiles.forEach(file => {
    if (shouldIgnoreFile(file)) {
      return;
    }

    checkedFilesCount++;
    const findings = scanFileForSecrets(file);
    allFindings = allFindings.concat(findings);
  });

  console.log(`📊 Zkontrolováno ${checkedFilesCount} souborů z ${stagedFiles.length} staged souborů.\n`);

  if (allFindings.length === 0) {
    console.log('✅ Žádné secrets nebo API klíče nenalezeny. Commit může pokračovat.');
    process.exit(0);
  }

  // Seřadí nálezy podle severity
  const severityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  allFindings.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

  console.log('🚨 DETEKOVANÉ POTENCIÁLNÍ SECRETS:');
  console.log('=' .repeat(50));

  let criticalCount = 0;
  let highCount = 0;

  allFindings.forEach(({ file, line, type, severity, content, match }) => {
    const severityEmoji = {
      CRITICAL: '🔥',
      HIGH: '⚠️ ',
      MEDIUM: '💛',
      LOW: '📝'
    };

    console.log(`\n${severityEmoji[severity]} ${severity} - ${type}`);
    console.log(`   📄 Soubor: ${file}:${line}`);
    console.log(`   🔍 Nalezeno: ${match.substring(0, 20)}${match.length > 20 ? '...' : ''}`);
    console.log(`   📝 Řádek: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

    if (severity === 'CRITICAL') criticalCount++;
    if (severity === 'HIGH') highCount++;
  });

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Celkem nalezeno: ${allFindings.length} potenciálních secrets`);
  console.log(`🔥 Kritické: ${criticalCount} | ⚠️  Vysoké: ${highCount}`);

  console.log('\n🛠️  DOPORUČENÉ KROKY:');
  console.log('1. Odstraň skutečné API klíče ze souborů');
  console.log('2. Přesuň secrets do .env souboru (který je v .gitignore)');
  console.log('3. Použij placeholder hodnoty (např. "placeholder-key")');
  console.log('4. Pro false-positive případy přidej do IGNORED_FILES');

  if (criticalCount > 0 || highCount > 0) {
    console.log('\n❌ COMMIT ZABLOKOVÁN - nalezeny kritické nebo vysoké security nálezy!');
    console.log('💡 Tip: Použij "git commit --no-verify" pro přeskočení (NEDOPORUČUJE SE)');
    process.exit(1);
  } else {
    console.log('\n⚠️  UPOZORNĚNÍ: Nalezeny podezřelé patterns, ale commit může pokračovat.');
    console.log('🔍 Prosím zkontroluj nálezy ručně.');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}