# Aurora Player — 粒子音乐播放器

一个基于 Three.js + Web Audio API 的沉浸式音乐播放器。纯黑空间中 **87,500 个 GPU 粒子**随音乐律动，播放时汇聚成专辑封面并以 6 条不规则波浪立体浮动。

![Aurora Player](https://img.shields.io/badge/Three.js-0.160.0-black?logo=threedotjs)
![Node.js](https://img.shields.io/badge/Node.js-22-green?logo=nodedotjs)

---

## ✨ 核心特性

### 🎨 视觉系统
- **87,500 粒子**（250×350）— 自定义 GLSL 着色器，3D 球型光照（漫反射 + Blinn-Phong 高光 + 菲涅尔边缘）
- **纯黑空间** — 全黑背景 + 中心呼吸光晕，营造深邃沉浸感
- **悬浮毛玻璃 UI** — 左右两侧玻璃态面板，idle 半透明 / hover 毛玻璃双态平滑过渡（0.5s cubic-bezier）
- **粒子方形点击交互** — 点击封面方形 → 控制面板脉冲激活 1.5s

### 🌊 粒子动画
- **封面汇聚** — 播放时粒子从随机位置平滑过渡为专辑封面形状
- **6 条不规则波浪** — 对角线 / 反对角线 / 水平 / 垂直 / 径向 / 交叉棋盘，独立速度 0.48~1.30
- **Y轴 + Z轴立体浮动** — 垂直 + 深度方向双重浮动，形成立体波浪效果
- **视角对齐波浪调制** — 正面/反面 ±5° 死区波浪归零，旋转后逐渐恢复
- **圆形粒子零间隙覆盖** — uPointScale=28，片元着色器 soft edge 抗锯齿

### 🎧 音频功能
- **本地文件导入** — 支持 MP3/WAV/FLAC 等格式
- **频谱实时分析** — Web Audio API AnalyserNode 驱动粒子脉动
- **完整播放控制** — 播放/暂停/上一首/下一首/进度拖拽/音量/静音
- **播放列表** — 右侧抽屉（19vw），正在播放 / 全部歌曲 / 最近播放三区域

### 🎵 在线音乐
- **网易云音乐搜索** — 内建 NeteaseCloudMusicApi，支持关键词搜索歌曲/歌手
- **在线播放** — 搜索结果可「播放」（立即播放 + 入库）或「添加」（仅入库）
- **搜索历史** — localStorage 持久化，最多 15 条，点击即搜

### 📝 歌词系统
- **本地提取** — ID3v2 USLT/SYLT/TXXX/Lyrics3v2 多格式解析
- **在线匹配** — LRCLIB API 自动搜索同步歌词（优先带时间戳的 syncedLyrics）
- **逐字放大** — rAF 同步时间戳，当前播放字 scale 平滑放大，CSS transition 回缩
- **拖拽滚动** — 鼠标拖拽 / 滚轮浏览歌词，3 秒后自动恢复跟播
- **两段式点击** — 首次居中不 seek，再次点击跳转到该时间戳

### 🖼️ 封面管理
- **ID3v2 APIC 自动提取** — 支持 v2.3/v2.4 JPEG/PNG 嵌入封面
- **手动上传** — 点击封面按钮自定义专辑封面
- **IndexedDB 持久化** — 刷新后封面自动恢复，按曲目独立存储

### 🎛️ 交互设计
| 交互 | 说明 |
|------|------|
| **左侧控制面板** | 8 按钮垂直排列：播放/上一首/下一首/导入/封面/播放列表/静音/波浪，idle 半透明 → hover 毛玻璃 |
| **右侧歌词面板** | 毛玻璃整体组件，含封面缩略图 + 歌词滚动 + 拖拽缩放手柄 |
| **拖拽缩放歌词区** | 鼠标拖拽左边缘，范围 1/8 ~ 1/3 页面宽，歌词和封面按比例跟随 |
| **进度条拖拽** | mousedown → mousemove 实时反馈 → mouseup seek |
| **键盘快捷键** | 空格播放/暂停，←→ 进退 5s，Shift+←→ 切歌，M 静音 |

---

## 🚀 一键启动

```bash
# Windows：双击项目目录下的
start.bat

# 或在文件根目录下的cmd命令行手动输入
node server.js

#也可以通过快捷方式开启
```

浏览器自动打开 `http://localhost:8080`，搜索功能立即可用。

> **架构**：`server.js` 自动拉起网易云 API（端口 3000）+ Express 静态服务（端口 8080），API 请求由代理透明转发，无 CORS 问题。

---

## 🏗️ 技术架构

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 3D 渲染 | Three.js 0.160.0 | 自定义 ShaderMaterial，87,500 粒子 GPU 渲染 |
| 音频 | Web Audio API | AnalyserNode 频谱分析 + AudioContext 播放 |
| 存储 | IndexedDB | 播放列表 + 音频文件 + 封面持久化 |
| 缓存 | localStorage | 音量/波浪/静音/搜索历史/最近播放/歌词区宽度 |
| 后端 | Node.js + Express | 统一启动服务器，API 代理 + 静态文件 |
| 在线音乐 | NeteaseCloudMusicApi 4.32.0 | 本地 API 服务，搜索/歌曲URL/歌词 |
| CSS | 纯 CSS 毛玻璃 | backdrop-filter，vw/vh 视口自适应，无 @media 断点 |

### 文件结构

```
播放器/
├── index.html              # 主页面（纯黑背景 + 悬浮玻璃态 UI）
├── start.bat               # Windows 一键启动脚本
├── server.js               # 统一服务器（API + 前端 + 浏览器自动打开）
├── css/
│   └── style.css           # 毛玻璃双态 UI / 搜索弹窗 / 播放列表抽屉
├── js/
│   ├── main.js             # 主入口（UI 交互 / 歌词 / 搜索 / 状态管理）
│   ├── particleSystem.js   # Three.js 粒子系统（自定义 Shader + 射线点击）
│   ├── audioEngine.js      # 音频引擎（频谱分析 / ID3 解析 / 歌词提取）
│   ├── ncmApi.js           # 网易云 API 客户端
│   └── storage.js          # IndexedDB 封装（TrackStorage 单例）
├── api-server/
│   ├── start.js            # 网易云 API 服务入口
│   └── node_modules/       # NeteaseCloudMusicApi + Express
└── assets/
    └── three.module.js     # Three.js 本地引用（离线可用）
```

### 着色器设计

**顶点着色器**：
1. `mix(randomPos, targetPos, delayedT)` — 随机球面 → 封面方形平滑过渡
2. `sin(diagProgress * freq - uTime * speed)` — 6 条不规则波浪叠加
3. `pos.y += yWave; pos.z += zWave` — Y轴上下 + Z轴向用户立体浮动
4. `uWaveAlign` — 视角对齐调制（正面/反面死区波浪归零）

**片元着色器**：
1. 3D 球型光照 — 漫反射 + Blinn-Phong 高光 + 菲涅尔边缘发光
2. 圆形 soft edge — 距离圆心 > 0.5 时 alpha 平滑衰减
3. 密度亮度补偿 — `vAlpha *= 1/(0.4 + uDensity * 0.6)`

---

## 🔧 数据持久化

| 数据 | 存储方式 | 说明 |
|------|----------|------|
| 播放列表 + 音频文件 | IndexedDB (`aurora_player_db`) | 刷新后自动恢复，封面按曲目独立存储 |
| 音量 / 波浪 / 静音 | localStorage (`aurora_player`) | 页面加载自动恢复 |
| 最近播放 | localStorage (`aurora_recent`) | 最多 20 条，去重上移，显示相对时间 |
| 搜索历史 | localStorage (`aurora_search_history`) | 最多 15 条，点击即搜 |
| 歌词区宽度 | localStorage (`aurora_lyrics_width`) | 拖拽缩放后持久化 |

---

## 📝 版本记录

### v2.0 — 2026.07
- 网易云音乐在线搜索 + 播放
- 搜索历史记录
- 歌词区拖拽缩放（1/8 ~ 1/3 宽）
- 歌词区统一毛玻璃组件（防止穿模）
- 一键启动脚本 + 浏览器自动打开
- API 服务自动健康检查 + 重试连接

### v1.0 — 2025.07
- Three.js 粒子系统（87,500 粒子）
- 6 条不规则波浪 + 立体浮动
- 播放列表 / 最近播放 / IDB 持久化
- 歌词逐字放大 + 拖拽滚动
- 毛玻璃双态 UI 面板
