#!/usr/bin/env node

/**
 * Cipher TypeScript Strict Mode Migration
 * Postupná migrace na strict: true s automatickými opravami
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function log(message) {
  console.log(`🔧 ${message}`);
}

function error(message) {
  console.error(`❌ ${message}`);
}

function success(message) {
  console.log(`✅ ${message}`);
}

function getTypeScriptErrors() {
  try {
    execSync('npm run typecheck', { stdio: 'pipe' });
    return [];
  } catch (_err) {
    const output = _err.stdout.toString() + _err.stderr.toString();
    const errorLines = output.split('\n')
      .filter(line => line.includes('error TS'))
      .map(line => {
        const match = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
        if (match) {
          return {
            file: match[1],
            line: parseInt(match[2]),
            column: parseInt(match[3]),
            code: match[4],
            message: match[5]
          };
        }
        return null;
      })
      .filter(Boolean);

    return errorLines;
  }
}

function fixNoImplicitReturns(filePath, lineNumber) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Najdi funkci na daném řádku a přidej return undefined
    const lineIndex = lineNumber - 1;
    const functionLine = lines[lineIndex];

    if (functionLine.includes('function') || functionLine.includes('=>')) {
      // Najdi konec funkce a přidej return před }
      let braceCount = 0;
      let inFunction = false;

      for (let i = lineIndex; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('{')) {
          braceCount++;
          inFunction = true;
        }

        if (line.includes('}') && inFunction) {
          braceCount--;

          if (braceCount === 0) {
            // Přidej return undefined před ukončení funkce
            lines[i] = lines[i].replace('}', '  return undefined;\n}');
            break;
          }
        }
      }

      fs.writeFileSync(filePath, lines.join('\n'));
      return true;
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function fixUndefinedPropertyAccess(filePath, lineNumber, message) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const lineIndex = lineNumber - 1;
    const line = lines[lineIndex];

    // Najdi vlastnost, která neexistuje
    const propertyMatch = message.match(/Property '(.+?)' does not exist/);
    if (propertyMatch) {
      const property = propertyMatch[1];

      // Přidej optional chaining
      const fixedLine = line.replace(
        new RegExp(`\\.${property}\\b`),
        `?.${property}`
      );

      if (fixedLine !== line) {
        lines[lineIndex] = fixedLine;
        fs.writeFileSync(filePath, lines.join('\n'));
        return true;
      }
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function fixPossiblyUndefined(filePath, lineNumber, message) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const lineIndex = lineNumber - 1;
    const line = lines[lineIndex];

    // Pro "possibly undefined" přidej null check
    if (message.includes('possibly undefined')) {
      const variableMatch = line.match(/(\w+)\s*\./);
      if (variableMatch) {
        const variable = variableMatch[1];

        const fixedLine = line.replace(
          new RegExp(`${variable}\\.`),
          `${variable}?.`
        );

        if (fixedLine !== line) {
          lines[lineIndex] = fixedLine;
          fs.writeFileSync(filePath, lines.join('\n'));
          return true;
        }
      }
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function fixStringUndefinedAssignment(filePath, lineNumber, message) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const lineIndex = lineNumber - 1;
    const line = lines[lineIndex];

    // Pro "string | undefined" není kompatibilní s "string"
    if (message.includes("'string | undefined' is not assignable to parameter of type 'string'")) {
      // Přidej || '' nebo non-null assertion
      const fixedLine = line.replace(
        /(\w+)(\s*\))/,
        '$1 || \'\'$2'
      );

      if (fixedLine !== line) {
        lines[lineIndex] = fixedLine;
        fs.writeFileSync(filePath, lines.join('\n'));
        return true;
      }
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function attemptAutoFix(error) {
  const { file, line, message, code } = error;

  let fixed = false;

  // TS7030: Not all code paths return a value
  if (code === 'TS7030') {
    fixed = fixNoImplicitReturns(file, line);
  }

  // TS2339: Property does not exist
  else if (code === 'TS2339') {
    fixed = fixUndefinedPropertyAccess(file, line, message);
  }

  // TS18048, TS2532: Possibly undefined
  else if (code === 'TS18048' || code === 'TS2532') {
    fixed = fixPossiblyUndefined(file, line, message);
  }

  // TS2345: Argument type issues
  else if (code === 'TS2345') {
    fixed = fixStringUndefinedAssignment(file, line, message);
  }

  return fixed;
}

function main() {
  console.log('🚀 Cipher TypeScript Strict Mode Migration');
  console.log('==========================================\n');

  log('Analyzuji TypeScript chyby...');
  const errors = getTypeScriptErrors();

  if (errors.length === 0) {
    success('Žádné TypeScript chyby nenalezeny! 🎉');

    // Zkus zapnout plný strict mode
    log('Zapínám plný strict mode...');
    const tsConfigPath = 'tsconfig.json';
    const content = fs.readFileSync(tsConfigPath, 'utf8');

    const updatedContent = content
      .replace('"strict": false,', '"strict": true,')
      .replace(/\s*\/\/ Postupná migrace na strict mode\n\s*"noImplicitAny": true,\n\s*"noImplicitReturns": true,/, '');

    fs.writeFileSync(tsConfigPath, updatedContent);

    // Zkontroluj, jestli stále prochází
    const newErrors = getTypeScriptErrors();
    if (newErrors.length === 0) {
      success('🎉 Úspěšně migrováno na strict: true!');
      return;
    } else {
      error(`Strict mode způsobil ${newErrors.length} nových chyb`);
      // Vrať zpět
      fs.writeFileSync(tsConfigPath, content);
    }

    return;
  }

  console.log(`📊 Nalezeno ${errors.length} TypeScript chyb\n`);

  // Zobraz přehled chyb podle typu
  const errorsByType = {};
  errors.forEach(err => {
    errorsByType[err.code] = (errorsByType[err.code] || 0) + 1;
  });

  console.log('📈 Přehled chyb podle typu:');
  Object.entries(errorsByType)
    .sort(([,a], [,b]) => b - a)
    .forEach(([code, count]) => {
      console.log(`   ${code}: ${count}x`);
    });

  console.log('\n🔧 Pokouším se o automatické opravy...\n');

  let fixedCount = 0;
  let attemptedFixes = new Set();

  for (const error of errors) {
    const key = `${error.file}:${error.line}:${error.code}`;

    // Předejdi duplicitním pokusům o opravu
    if (attemptedFixes.has(key)) {
      continue;
    }

    attemptedFixes.add(key);

    log(`Opravuji ${error.code} v ${path.basename(error.file)}:${error.line}`);

    if (attemptAutoFix(error)) {
      success(`  ✅ Opraveno: ${error.code}`);
      fixedCount++;
    } else {
      console.log(`  ⚠️  Automatická oprava není k dispozici pro: ${error.message}`);
    }
  }

  console.log(`\n📊 Výsledky:`);
  console.log(`• Opraveno automaticky: ${fixedCount}/${errors.length} chyb`);
  console.log(`• Zbývá ručně opravit: ${errors.length - fixedCount} chyb`);

  if (fixedCount > 0) {
    log('Spouštím znovu typecheck...');
    const remainingErrors = getTypeScriptErrors();
    success(`Sníženo z ${errors.length} na ${remainingErrors.length} chyb`);

    if (remainingErrors.length > 0) {
      console.log('\n🔍 Zbývající chyby vyžadují ruční opravu:');
      remainingErrors.slice(0, 10).forEach(err => {
        console.log(`   ${path.basename(err.file)}:${err.line} - ${err.code}: ${err.message}`);
      });

      if (remainingErrors.length > 10) {
        console.log(`   ... a ${remainingErrors.length - 10} dalších`);
      }
    }
  }

  console.log('\n💡 Doporučení pro dokončení migrace:');
  console.log('1. Postupně opravuj zbývající chyby ručně');
  console.log('2. Fokus na nejčastější typy chyb');
  console.log('3. Použij TypeScript strict flags postupně');
  console.log('4. Zkontroluj, že testy stále prochází po každé změně');
}

if (require.main === module) {
  main();
}