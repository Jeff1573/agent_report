/**
 * 图标生成脚本
 * 
 * 功能：
 * 1. 生成绿色机器人 SVG 图标
 * 2. 转换为多种尺寸的 PNG
 * 3. 生成 macOS 的 .icns 格式
 * 4. 生成 Windows 的 .ico 格式
 * 
 * 使用：node scripts/generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 绿色机器人图标的 SVG 定义
const greenRobotSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <!-- 机器人主体 -->
  <rect x="128" y="128" width="256" height="256" rx="32" fill="#4ade80" stroke="#22c55e" stroke-width="4"/>

  <!-- 机器人头部（显示器） -->
  <rect x="160" y="160" width="192" height="128" rx="16" fill="#dcfce7" stroke="#4ade80" stroke-width="3"/>

  <!-- 眼睛 -->
  <circle cx="208" cy="208" r="12" fill="#4ade80"/>
  <circle cx="304" cy="208" r="12" fill="#4ade80"/>

  <!-- 嘴巴 -->
  <rect x="224" y="240" width="64" height="8" rx="4" fill="#4ade80"/>

  <!-- 天线 -->
  <line x1="256" y1="128" x2="256" y2="96" stroke="#4ade80" stroke-width="6" stroke-linecap="round"/>
  <circle cx="256" cy="88" r="8" fill="#4ade80"/>

  <!-- 手臂 -->
  <rect x="96" y="192" width="32" height="64" rx="16" fill="#4ade80"/>
  <rect x="384" y="192" width="32" height="64" rx="16" fill="#4ade80"/>

  <!-- 腿部 -->
  <rect x="192" y="384" width="32" height="64" rx="16" fill="#4ade80"/>
  <rect x="288" y="384" width="32" height="64" rx="16" fill="#4ade80"/>

  <!-- 身体装饰线条 -->
  <rect x="176" y="320" width="160" height="4" rx="2" fill="#22c55e"/>
  <rect x="200" y="340" width="112" height="4" rx="2" fill="#22c55e"/>
</svg>`;

const buildDir = path.join(__dirname, '..', 'build');
const resourcesDir = path.join(__dirname, '..', 'resources');
const tempDir = path.join(__dirname, '..', '.icon-temp');

// 确保目录存在
[buildDir, resourcesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 创建临时目录
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

async function generateIcons() {
  console.log('🤖 开始生成 MindForge Agent 图标...\n');

  try {
    // 1. 生成主图标 PNG (512x512)
    console.log('📝 步骤 1: 生成主图标 PNG (512x512)...');
    await sharp(Buffer.from(greenRobotSvg))
      .resize(512, 512)
      .png()
      .toFile(path.join(buildDir, 'icon.png'));
    console.log('   ✅ build/icon.png 生成完成');

    // 复制到 resources
    fs.copyFileSync(
      path.join(buildDir, 'icon.png'),
      path.join(resourcesDir, 'icon.png')
    );
    console.log('   ✅ resources/icon.png 生成完成\n');

    // 2. 生成 macOS 需要的多种尺寸
    console.log('📝 步骤 2: 生成 macOS .icns 所需的多种尺寸...');
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    
    for (const size of sizes) {
      await sharp(Buffer.from(greenRobotSvg))
        .resize(size, size)
        .png()
        .toFile(path.join(tempDir, `icon_${size}x${size}.png`));
      console.log(`   ✅ ${size}x${size} PNG 生成`);
    }

    // 3. 使用 iconutil 生成 .icns (仅 macOS)
    if (process.platform === 'darwin') {
      console.log('\n📝 步骤 3: 生成 macOS .icns 文件...');
      
      // 创建 iconset 目录
      const iconsetDir = path.join(tempDir, 'icon.iconset');
      if (!fs.existsSync(iconsetDir)) {
        fs.mkdirSync(iconsetDir, { recursive: true });
      }

      // 复制文件到 iconset，使用 macOS 要求的命名格式
      const iconsetMapping = {
        16: ['icon_16x16.png'],
        32: ['icon_16x16@2x.png', 'icon_32x32.png'],
        64: ['icon_32x32@2x.png'],
        128: ['icon_128x128.png'],
        256: ['icon_128x128@2x.png', 'icon_256x256.png'],
        512: ['icon_256x256@2x.png', 'icon_512x512.png'],
        1024: ['icon_512x512@2x.png']
      };

      for (const [size, names] of Object.entries(iconsetMapping)) {
        const srcFile = path.join(tempDir, `icon_${size}x${size}.png`);
        for (const name of names) {
          fs.copyFileSync(srcFile, path.join(iconsetDir, name));
        }
      }

      // 使用 iconutil 生成 .icns
      try {
        execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(buildDir, 'icon.icns')}"`, {
          stdio: 'inherit'
        });
        console.log('   ✅ build/icon.icns 生成完成');
      } catch (err) {
        console.error('   ⚠️  iconutil 生成失败，尝试使用 png2icons...');
        // 如果 iconutil 失败，尝试使用 npm 包
        await generateIcnsWithPng2Icons();
      }
    } else {
      console.log('\n⚠️  非 macOS 系统，跳过 .icns 生成');
    }

    // 4. 生成 Windows .ico 文件
    console.log('\n📝 步骤 4: 生成 Windows .ico 文件...');
    await generateIcoFile();

    // 5. 生成小尺寸图标 (用于其他用途)
    console.log('\n📝 步骤 5: 生成小尺寸图标...');
    await sharp(Buffer.from(greenRobotSvg))
      .resize(256, 256)
      .png()
      .toFile(path.join(buildDir, 'icon-small.png'));
    console.log('   ✅ build/icon-small.png 生成完成');

    // 清理临时文件
    console.log('\n🧹 清理临时文件...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('   ✅ 临时文件清理完成');

    // 显示文件信息
    console.log('\n📊 生成的图标文件：');
    const files = [
      path.join(buildDir, 'icon.png'),
      path.join(buildDir, 'icon.icns'),
      path.join(buildDir, 'icon.ico'),
      path.join(resourcesDir, 'icon.png')
    ];

    files.forEach(file => {
      if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        console.log(`   ${path.relative(process.cwd(), file)}: ${(stats.size / 1024).toFixed(2)} KB`);
      }
    });

    console.log('\n✅ 所有图标生成完成！');
    console.log('\n💡 下一步：');
    console.log('   1. 开发模式：npm run dev (图标会自动加载)');
    console.log('   2. 打包应用：npm run build:mac (macOS) 或 npm run build:win (Windows)');

  } catch (err) {
    console.error('\n❌ 图标生成失败:', err);
    // 清理临时文件
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
}

/**
 * 使用 sharp 生成 .ico 文件
 * Windows ICO 文件包含多个尺寸
 */
async function generateIcoFile() {
  // 生成多个尺寸的 PNG
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of icoSizes) {
    const buffer = await sharp(Buffer.from(greenRobotSvg))
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buffer);
  }

  // 使用最大的图标作为 .ico（简化版本，实际 ICO 应该包含多个尺寸）
  // 对于完整的 ICO 支持，建议使用 png-to-ico 包
  const ico256 = await sharp(Buffer.from(greenRobotSvg))
    .resize(256, 256)
    .png()
    .toBuffer();

  // 尝试使用 png-to-ico（如果已安装）
  try {
    const pngToIco = require('png-to-ico');
    const icoBuffer = await pngToIco([
      path.join(tempDir, 'icon_256x256.png'),
      path.join(tempDir, 'icon_128x128.png'),
      path.join(tempDir, 'icon_64x64.png'),
      path.join(tempDir, 'icon_32x32.png'),
      path.join(tempDir, 'icon_16x16.png')
    ]);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
    console.log('   ✅ build/icon.ico 生成完成 (使用 png-to-ico)');
  } catch (err) {
    // 如果没有安装 png-to-ico，使用简化版本
    console.log('   ⚠️  png-to-ico 未安装，使用单尺寸 ICO');
    // 只复制 256x256 作为简单的 ICO（虽然不是真正的多尺寸 ICO）
    fs.copyFileSync(
      path.join(tempDir, 'icon_256x256.png'),
      path.join(buildDir, 'icon.ico')
    );
    console.log('   ✅ build/icon.ico 生成完成 (单尺寸)');
    console.log('   💡 提示：安装 png-to-ico 以生成完整的多尺寸 ICO: npm install --save-dev png-to-ico');
  }
}

/**
 * 使用 png2icons npm 包生成 .icns（备用方案）
 */
async function generateIcnsWithPng2Icons() {
  try {
    const png2icons = require('png2icons');
    const inputPng = fs.readFileSync(path.join(buildDir, 'icon.png'));
    const icnsBuffer = png2icons.createICNS(inputPng, png2icons.BILINEAR, 0);
    fs.writeFileSync(path.join(buildDir, 'icon.icns'), icnsBuffer);
    console.log('   ✅ build/icon.icns 生成完成 (使用 png2icons)');
  } catch (err) {
    console.error('   ❌ png2icons 生成失败:', err.message);
    console.log('   💡 提示：安装 png2icons: npm install --save-dev png2icons');
  }
}

// 执行生成
generateIcons();


