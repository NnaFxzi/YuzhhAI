# 工作空间图片 OCR 链路补全设计

日期：2026-07-10

## 1. 背景与现状

工作空间创建页已经支持选择图片资料。当前代码中已有一版 OCR 实现：

1. `WorkspaceMaterialUpload` 将图片标记为 `kind: 'image'`。
2. 用户点击创建后，`createWorkspaceFromUploadedMaterials` 调用
   `window.electron.dialog.extractImageText`。
3. 主进程通过 `documentTextExtractor.ts` 调用 `tesseract.js`。
4. OCR 文本写入 `extractionSources[].text`。
5. 有文本的资料进入工作空间知识库的文档处理和向量索引流程。

这版实现仍有以下缺口：

- OCR IPC 通道名在主进程和预加载层使用裸字符串，没有复用共享常量。
- Tesseract worker/core 可以定位，但语言训练数据没有显式纳入应用资源；首次运行可能依赖 CDN。
- 多张图片使用 `Promise.all` 并行创建 worker，容易造成较高的 CPU 和内存峰值。
- OCR 失败、空结果和进度状态没有形成完整的资料级状态反馈。
- 当前测试覆盖了渲染层调用分支，但没有覆盖 OCR 资源路径、异常降级和 IPC 契约。

## 2. 目标

- 用户在创建工作空间时上传图片后，图片中的印刷文字能够被提取并作为资料文本保存。
- OCR 默认使用本地资源，不依赖运行时网络请求。
- OCR 进度可以反馈到资料列表；多张图片按顺序处理。
- OCR 失败时保留原图附件，工作空间仍然可以创建，不因单张图片失败而整体失败。
- OCR 成功的文本进入现有工作空间知识库处理和向量索引链路。
- 保留现有非图片资料、单文件兼容路径和图片预览行为。

## 3. 非目标

- 不实现手写体识别、表格结构还原或复杂版面重建。
- 不为扫描 PDF 增加 OCR；本次只处理被识别为图片的上传资料。
- 不引入云端 OCR 服务，不上传用户图片。
- 不修改工作空间知识库“后续添加文档”的既有行为，除非共享 OCR 入口必须复用。
- 不做工作空间模块的大规模拆分或重命名。

## 4. 设计方案

### 4.1 OCR 执行时机

保留“点击创建工作空间时执行 OCR”的时机，而不是用户每次选择图片后立即执行。这样可以避免用户选择后删除图片仍然消耗 OCR
资源，也可以保证写入数据库前已经拿到最终的资料文本。

创建期间图片资料进入以下状态：

```text
待处理 → OCR 中（带进度） → 成功并写入文本
                         ↘ 失败或空结果，保留图片附件
```

OCR 结果为空时与 OCR 失败采用相同的降级策略：不写入空文本，资料仍以图片附件形式保存，知识库索引状态保持为“已处理但无可索引文本”。

### 4.2 本地 OCR 资源

新增一个小型 OCR 资源解析边界，负责根据开发环境或打包环境定位：

- 使用 esbuild 从 Tesseract.js Node worker 源码生成的 self-contained worker；
- Tesseract core WASM；
- `eng` 和 `chi_sim` 语言训练数据。

Node worker 资源名为 `worker.node.cjs`；构建时同时复制 Tesseract.js 7 的全部 core WASM 变体，确保不同 CPU 特性下的 core
选择都能离线加载。开发环境从项目资源目录读取，打包环境从 `process.resourcesPath` 下的 OCR 资源目录读取。打包配置需要把这些资源复制到应用的
`Resources/ocr` 目录。OCR 调用必须显式传入 `langPath`，禁止回退到默认 CDN 地址；资源缺失时返回可识别的错误，由上层执行附件降级。

新增 `scripts/ensure-ocr-language-data.cjs`，固定校验
`resources/ocr/eng.traineddata.gz` 和 `resources/ocr/chi_sim.traineddata.gz`，缺失时在构建阶段从
`https://cdn.jsdelivr.net/npm/@tesseract.js-data/{lang}/4.0.0_best_int/{lang}.traineddata.gz`
下载；构建脚本在 renderer/main 编译和 Electron 打包前调用该检查。运行时不下载语言数据。资源文件不写入日志，日志只记录资源缺失、转换失败等错误原因。

### 4.3 IPC 契约

在 `src/shared/dialog/constants.ts` 中增加：

- 图片 OCR 请求通道；
- 图片 OCR 进度事件通道。

主进程和 preload 统一从该模块导入，禁止继续使用对应的裸字符串。进度 payload 保持为：

```ts
{
  filePath: string;
  progress: number;
}
```

请求返回保留现有结构，并明确 `success: false` 时只返回错误信息，不把图片内容通过 IPC 回传：

```ts
{
  success: boolean;
  content?: string;
  parser?: 'image';
  error?: string;
}
```

### 4.4 主进程 OCR 服务

继续以 `extractImageText(filePath, options)` 作为纯主进程入口，职责保持清晰：

1. 规范化并校验路径，确认目标为普通文件。
2. 校验图片大小，不超过现有富文档上限。
3. 对 HEIC/HEIF 先转换为 PNG；其他已支持图片格式直接读取。
4. 使用本地 worker/core/语言数据创建 worker。
5. 将 Tesseract 的识别进度归一化到 `[0, 1]` 并通过 `onProgress` 上报。
6. 返回去除首尾空白的文本；文本为空时返回空内容而不是伪造结果。
7. 在 `finally` 中终止 worker，避免异常时泄漏。

图片 OCR 不改变已有普通文档解析器的分派逻辑；`extractDocumentTextFromFile` 仍然可以复用同一个图片入口。

### 4.5 创建工作空间的资料编排

`createWorkspaceFromUploadedMaterials` 改为顺序遍历资料：

- 非图片资料直接复用已有文本；
- 已有文本的图片跳过 OCR；
- 无文本的图片调用 OCR；
- 每张图片完成后移除对应的 IPC 进度监听；
- 成功时写入 `text`，并将该资料标记为待文档处理/待向量索引；
- 失败或空结果时不写入 `text`，保留图片附件；
- 单张图片失败不抛出到创建流程外，不阻塞其他资料和工作空间创建。

编排层增加资料级 OCR 状态回调，至少覆盖 `processing`、`completed`、`failed` 三种状态，并携带 `itemId`。这样 `WorkspaceCreate`
可以在列表中显示进度和失败提示，而不需要把 OCR 细节放入组件内部。

### 4.6 UI 反馈

创建按钮处于处理中时：

- 图片资料显示 OCR 进度条；
- OCR 成功显示完成标记；
- OCR 失败显示本地化的失败提示，并保留删除图片的能力；
- 非图片资料继续显示原有文件大小/截断提示。

所有新增用户可见文本在 `src/renderer/services/i18n.ts` 中同时提供中文和英文翻译。开发日志继续使用
`[EnterpriseLeadWorkspace]` 或 `[dialog]` 模块前缀。

## 5. 数据流与边界

```text
WorkspaceMaterialUpload
        │ filePath + kind=image
        ▼
WorkspaceCreate
        │ createWorkspaceFromUploadedMaterials
        ▼
preload dialog.extractImageText
        │ IPC
        ▼
main extractImageText
        │ local Tesseract resources
        ▼
OCR text / failure
        ▼
EnterpriseLeadExtractionSource
        ▼
processDocumentSource → content knowledge vector store
```

边界约束：

- renderer 不直接访问文件系统、Tesseract 或语言资源；
- main 不依赖 renderer 的状态类型；
- shared 只存 IPC 常量和稳定 payload 类型，不放实现逻辑；
- OCR 失败不能导致空文本覆盖已有用户资料文本；
- 原图路径仍作为来源元数据保存，OCR 文本作为可检索内容保存。

## 6. 错误处理

| 场景            | 行为                        |
|---------------|---------------------------|
| 路径为空或不是文件     | OCR 返回失败，工作空间保留附件         |
| 图片超过大小限制      | 上传阶段拒绝，显示已有文件大小错误         |
| HEIC 转换失败     | 当前图片标记 OCR 失败，保留附件        |
| OCR 资源缺失      | 返回本地资源不可用错误，保留附件          |
| OCR worker 异常 | 终止 worker，保留附件，记录 warning |
| OCR 返回空字符串    | 不生成空索引文本，保留附件             |
| 多图片中部分失败      | 成功图片照常入库，失败图片继续保留         |
| 工作空间创建失败      | 沿用现有创建失败提示                |

## 7. 测试设计

### 主进程/资源层

- 支持的图片扩展名能进入图片解析器；
- 非图片扩展名不会进入 OCR；
- OCR 资源解析返回开发环境和打包环境的正确路径；
- 语言数据路径缺失时返回可断言的错误；
- Tesseract 返回文本时正确 trim、标记 parser 和大小；
- Tesseract 抛错时 worker 仍然执行 terminate；
- 进度回调只产生 `[0, 1]` 范围内的值。

### 渲染编排层

- 多张图片按输入顺序串行调用 OCR；
- 已有文本的图片跳过 OCR；
- OCR 成功文本写入对应 extraction source；
- OCR 失败不阻塞工作空间创建；
- 空结果不会生成待索引空文本；
- 每张图片的进度/失败状态回调携带正确的 `itemId`；
- 非图片资料不触发 OCR。

### 契约与质量门

- 运行相关 Vitest 测试；
- 对所有修改的 TypeScript/TSX 文件运行仓库规定的 ESLint 命令；
- 运行 `npm run compile:electron` 验证主进程和 preload；
- 运行 `npm run build` 验证 renderer 和资源引用；
- 检查打包配置确保 OCR 资源进入 `Resources/ocr`，不依赖运行时网络。

## 8. 影响范围

预计修改范围：

- `src/shared/dialog/constants.ts`；
- `src/main/libs/documentTextExtractor.ts`；
- `src/main/libs/ocrAssets.ts`，负责开发/打包环境的 OCR 资源路径解析；
- `src/main/main.ts`；
- `src/main/preload.ts`；
- `src/renderer/types/electron.d.ts`；
- `src/renderer/components/enterpriseLeadWorkspace/enterpriseLeadWorkspaceUi.ts`；
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceCreate.tsx`；
- `src/renderer/components/enterpriseLeadWorkspace/WorkspaceMaterialUpload.tsx`；
- `scripts/ensure-ocr-language-data.cjs`；
- `resources/ocr/eng.traineddata.gz` 和 `resources/ocr/chi_sim.traineddata.gz`；
- 相关测试、i18n 和 Electron 打包资源配置。

不修改 OpenClaw runtime、数据库 schema 或已有工作空间业务模型。
