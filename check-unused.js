const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const dependencies = Object.keys(packageJson.dependencies || {});

console.log('Scanning for unused dependencies...');

const srcDir = path.join(__dirname, 'src');

function findInDir(dir, pattern) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(findInDir(file, pattern));
    } else { 
      if (file.endsWith('.ts')) {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes(pattern)) {
          results.push(file);
        }
      }
    }
  });
  return results;
}

const unused = [];
dependencies.forEach(dep => {
  // Special cases for types or libraries used differently
  if (dep.startsWith('@types')) return;
  if (dep === 'reflect-metadata') return;
  if (dep === 'rxjs') return;
  
  // Naive check: search for 'from "dep"' or 'from \'dep\'' or 'require("dep")'
  // and also just the string "dep" might be enough for a quick check, but risky.
  // We'll search for the package name in imports.
  // Regex: from ['"]package-name['"] or require\(['"]package-name['"]\)
  
  try {
    // Grep is faster
    const cmd = `grep -r "${dep}" src`;
    execSync(cmd);
  } catch (e) {
    unused.push(dep);
  }
});

console.log('Potentially unused dependencies:', unused);
