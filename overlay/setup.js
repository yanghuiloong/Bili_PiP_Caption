/**
 * setup.js — One-time setup for Native Messaging host registration.
 * Run: node setup.js
 * 
 * This script:
 * 1. Asks for your Chrome extension ID
 * 2. Creates the Native Messaging host manifest
 * 3. Registers it in the Windows registry
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('=== Bili-PiP Caption — Native Messaging 配置 ===\n');
console.log('请打开 Chrome，进入 chrome://extensions/');
console.log('找到 "Bili-PiP Caption" 扩展的 ID（一串字母）\n');

rl.question('请输入扩展 ID: ', (extensionId) => {
  extensionId = extensionId.trim();
  if (!extensionId || extensionId.length < 10) {
    console.error('错误：无效的扩展 ID');
    rl.close();
    process.exit(1);
  }

  const hostName = 'com.bili_pip_caption';
  const manifestPath = path.join(__dirname, hostName + '.json');
  const launchPath = path.join(__dirname, 'host.bat');

  // Create NM host manifest
  const manifest = {
    name: hostName,
    description: 'Bili-PiP Caption Overlay — 桌面透明字幕悬浮窗',
    path: launchPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ 已创建 NM 主机清单: ${manifestPath}`);

  // Register in Windows registry
  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`;
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'pipe' });
    console.log(`✅ 已注册注册表项: ${regKey}`);
  } catch (e) {
    console.error('❌ 注册表写入失败:', e.message);
    console.log(`请手动运行: reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  }

  console.log('\n🎉 配置完成！重启 Chrome 后即可使用。');
  console.log('点击 B 站视频下方的「字幕悬浮」按钮，overlay 将自动启动。\n');
  rl.close();
});
