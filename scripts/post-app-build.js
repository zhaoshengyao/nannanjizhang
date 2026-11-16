// 云打包后处理：
// 1) 复制 nativeplugins（含编译好的 aar）到 dist/build/app —— HBuilderX 本地插件云打包必需
// 2) 写入最小 pages.json —— HBuilderX 以「manifest.json + pages.json 同时存在」判定项目为
//    uni-app 项目（nature=UniApp_Vue）；编译产物缺 pages.json 会被当成 5+App 项目，
//    导致 nativeplugins 不上传、云端报「插件未在插件市场购买或申请试用」
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist/build/app')

// 1) nativeplugins
const srcPlug = path.join(root, 'nativeplugins')
const dstPlug = path.join(dist, 'nativeplugins')
fs.cpSync(srcPlug, dstPlug, { recursive: true })
console.log('[post-app-build] copied nativeplugins ->', dstPlug)

// 2) pages.json
fs.writeFileSync(
  path.join(dist, 'pages.json'),
  JSON.stringify(
    {
      pages: [{ path: 'pages/home/home', style: { navigationStyle: 'custom' } }],
      globalStyle: { navigationStyle: 'custom' }
    },
    null,
    2
  )
)
console.log('[post-app-build] wrote pages.json (project type hint for HBuilderX)')
