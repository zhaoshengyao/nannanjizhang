# 楠楠记账本

一款纯本地的个人记账 App：手动记账、微信/支付宝账单导入，以及通过 Android「通知使用权」识别支付通知自动记账。数据默认只保存在本机，不注册、不联网、无广告。

- 当前版本：`1.0.8`（versionCode `108`）
- 包名：`com.nannan.jizhang`
- 最低系统：Android 6.0（API 23），targetSdkVersion 33
- 技术栈：uni-app（Vue 3）+ TypeScript + Vite + Pinia

## 功能

- **记账**：支出/收入、分类、备注，可修改日期时间；首页底部弹层快速记一笔。
- **明细与统计**：按月查看明细、分类占比与月度趋势。
- **预算告警**：设置月预算与多档阈值（如 50%/80%/100%），支持「每次」「每天」「每档一次」三种提醒频率。
- **账单导入**：微信账单 XLSX、支付宝账单 CSV（GBK 编码自动识别），导入结果写入本地账本。
- **自动记账**：用户主动开启「通知使用权」后，解析微信支付、支付宝支付通知中的金额并生成账单。
- **导出**：全部账单导出为 CSV（UTF-8 带 BOM，Excel 可直接打开），优先写入系统 Download，不可写时回退到应用内 `_doc/export/`。
- **个性化**：头像、昵称、分类管理，支持清空账单与恢复初始状态。

## 目录结构

```
jz-app/
├── src/
│   ├── pages/            # home 首页、list 明细、stats 统计、me 我的
│   │   ├── onboard/      # 首次引导
│   │   ├── record/       # 记账详情/编辑
│   │   ├── import/       # 账单导入
│   │   ├── threshold/    # 预算与告警
│   │   ├── categories/   # 分类管理
│   │   └── permission/   # 自动记账授权引导
│   ├── components/       # 通用组件（月份切换条等）
│   ├── store/app.ts      # Pinia 状态、持久化与重置
│   ├── utils/            # 存储、CSV/GBK、金额、分类、告警、文件读写
│   ├── static/           # 图标、启动图、tabBar 图标
│   ├── App.vue
│   ├── main.ts
│   ├── manifest.json     # 应用配置、权限、版本号
│   ├── pages.json        # 页面与 tabBar
│   └── uni.scss
├── nativeplugins/
│   └── NotificationListener/   # 通知监听原生插件（Java 源码 + aar）
├── scripts/post-app-build.js   # 云打包前处理：复制插件、补 pages.json
├── static/                     # App 图标与启动图资源
└── package.json
```

## 开发

```bash
npm install

# H5 调试（浏览器中可用导入、导出，无通知监听能力）
npm run dev:h5

# 构建 App 端产物（输出到 dist/build/app）
npm run build:app
```

`build:app` 会额外执行 `scripts/post-app-build.js`：把 `nativeplugins/`（含已编译的 aar）复制进产物，并补一个最小 `pages.json`，否则 HBuilderX 会把产物识别成 5+App 项目，导致原生插件不被上传。

真机运行与正式打包：

1. 用 HBuilderX 导入 **项目根目录**（`jz-app/`），而不是 `dist/build/app`。
2. 调试可用自定义基座；**提交应用市场必须使用正式云打包的 release 包**，自定义基座不能替代。
3. 云打包时确认已勾选 64 位（`arm64-v8a`）并核对目标商店的 targetSdkVersion 门槛。

## 原生插件 NotificationListener

纯 Java 实现，核心为 `NotificationListenerService`：

| 文件 | 作用 |
| --- | --- |
| `NLService.java` | 接收通知回调，仅处理微信（`com.tencent.mm`）与支付宝（`com.eg.android.AlipayGphone`）的支付类通知，解析金额并去重 |
| `AlertEngine.java` | 原生侧维护本月支出与告警档位、后台暂存待入库账单（最多 200 条）、诊断日志（最多 20 条） |
| `NotificationListenerModule.java` | 暴露给 JS 的方法：保存到 Download、读取 content URI、拉取暂存记录等 |

注意：

- 服务由系统绑定，必须由用户在系统「通知使用权」中手动授权，App 内不能自行开启。
- 只处理明确的支付语义通知，群聊中出现的“支付 xx 元”不会入库。
- 修改 Java 源码后需要重新编译 aar 并替换 `nativeplugins/NotificationListener/android/NotificationListener.aar`。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `BIND_NOTIFICATION_LISTENER_SERVICE` | 读取微信/支付宝支付通知，自动记账的唯一入口，用户可随时关闭 |
| `POST_NOTIFICATIONS` | 预算告警与监听状态通知 |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_SPECIAL_USE` | 监听服务的前台运行声明 |
| `VIBRATE` | 告警震动 |
| `WAKE_LOCK` | 保证后台处理通知时不被立即挂起 |
| `ACCESS_NETWORK_STATE` | 运行时依赖声明 |

未声明无障碍服务；拒绝通知使用权后，手动记账与账单导入仍可正常使用。

## 数据与隐私

- 账单、预算、分类、昵称头像等均保存在本地（`uni` 存储 key：`jz-state-v1`），不上传服务器。
- 原生侧暂存的待入库记录与诊断日志同样只存在本机，可由「恢复初始状态」清除。
- 导出的 CSV 写入系统 Download；不可写时回退到应用私有目录 `_doc/export/`，App 内会提示实际保存位置。
- 微信、支付宝仅作为通知来源被识别，项目未集成其 SDK，也无任何合作关系。

## 版本

发布前请递增 `src/manifest.json` 中的 `versionName` 与 `versionCode`，并保留正式签名证书的离线备份，否则无法覆盖更新。
