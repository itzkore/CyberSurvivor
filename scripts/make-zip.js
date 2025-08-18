const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const buildDir = path.join(__dirname, '..', 'release', 'CyberSurvivor-win32-x64');
const zipPath = path.join(__dirname, '..', 'release', 'CyberSurvivor-win32-x64.zip');

if (!fs.existsSync(buildDir)) {
  console.error('[make-zip] Build dir missing:', buildDir);
  process.exit(1);
}

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  execSync(`powershell -Command Compress-Archive -Path \"${buildDir}/*\" -DestinationPath \"${zipPath}\" -Force`, { stdio: 'inherit' });
  const size = fs.statSync(zipPath).size;
  console.log(`[make-zip] Created ${zipPath} (${(size/1024/1024).toFixed(2)} MB)`);
} catch (e) {
  console.error('[make-zip] Failed:', e.message);
  process.exit(1);
}
