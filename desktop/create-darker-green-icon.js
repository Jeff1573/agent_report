const sharp = require('sharp');
const fs = require('fs');

// 创建更暗绿色机器人图标的SVG
const darkerGreenRobotSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <!-- 机器人主体 -->
  <rect x="128" y="128" width="256" height="256" rx="32" fill="#16a34a" stroke="#15803d" stroke-width="4"/>

  <!-- 机器人头部（显示器） -->
  <rect x="160" y="160" width="192" height="128" rx="16" fill="#dcfce7" stroke="#16a34a" stroke-width="3"/>

  <!-- 眼睛 -->
  <circle cx="208" cy="208" r="12" fill="#16a34a"/>
  <circle cx="304" cy="208" r="12" fill="#16a34a"/>

  <!-- 嘴巴 -->
  <rect x="224" y="240" width="64" height="8" rx="4" fill="#16a34a"/>

  <!-- 天线 -->
  <line x1="256" y1="128" x2="256" y2="96" stroke="#16a34a" stroke-width="6" stroke-linecap="round"/>
  <circle cx="256" cy="88" r="8" fill="#16a34a"/>

  <!-- 手臂 -->
  <rect x="96" y="192" width="32" height="64" rx="16" fill="#16a34a"/>
  <rect x="384" y="192" width="32" height="64" rx="16" fill="#16a34a"/>

  <!-- 腿部 -->
  <rect x="192" y="384" width="32" height="64" rx="16" fill="#16a34a"/>
  <rect x="288" y="384" width="32" height="64" rx="16" fill="#16a34a"/>

  <!-- 身体装饰线条 -->
  <rect x="176" y="320" width="160" height="4" rx="2" fill="#15803d"/>
  <rect x="200" y="340" width="112" height="4" rx="2" fill="#15803d"/>
</svg>`;

// 保存SVG文件用于调试
fs.writeFileSync('darker-green-robot-icon.svg', darkerGreenRobotSvg);

// 转换为PNG
sharp(Buffer.from(darkerGreenRobotSvg))
  .png()
  .toFile('build/icon.png')
  .then(() => {
    console.log('✅ 更暗绿色机器人图标已生成');

    // 复制到resources目录
    fs.copyFileSync('build/icon.png', 'resources/icon.png');
    console.log('✅ 已复制到resources目录');

    // 检查文件大小
    const stats = fs.statSync('build/icon.png');
    console.log('图标文件大小:', (stats.size / 1024).toFixed(2), 'KB');

    // 清理临时文件
    fs.unlinkSync('create-darker-green-icon.js');
  })
  .catch(err => {
    console.error('❌ 生成失败:', err);
    fs.unlinkSync('create-darker-green-icon.js');
  });
