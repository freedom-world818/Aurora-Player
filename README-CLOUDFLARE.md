# Aurora Player — Cloudflare 部署与网易云 API 集成指南

本文档详细说明如何将 Aurora Player 部署到 Cloudflare，并启用网易云音乐在线搜索/播放功能。

---

## 📋 目录

1. [三种部署方案对比](#-三种部署方案对比)
2. [方案 A：独立 Worker（最稳定，推荐）](#-方案-a独立-worker最稳定推荐)
3. [方案 B：Pages Functions 代理（最简单）](#-方案-bpages-functions-代理最简单)
4. [方案 C：仅用公共 API（零配置，但不稳定）](#-方案-c仅用公共-api零配置但不稳定)
5. [前端配置](#-前端配置)
6. [故障排查](#-故障排查)
7. [GitHub 参考项目](#-github-参考项目)

---

## ⚖️ 三种部署方案对比

| 方案 | 复杂度 | 稳定性 | 延迟 | 是否跨域 | VIP 歌曲支持 |
|------|--------|--------|------|----------|-------------|
| **A. 独立 Worker** | ⭐⭐ 中等 | ⭐⭐⭐⭐⭐ 高 | 快 | 同域（Worker 子域名） | ✅ 支持配置 Cookie |
| **B. Pages Functions** | ⭐ 简单 | ⭐⭐⭐⭐ 中 | 最快 | ✅ 完全同域 | ⚠️ 需额外配置上游 |
| **C. 公共 API** | ⭐ 零配置 | ⭐⭐ 低 | 中 | 跨域 | ❌ 无 |

---

## 🚀 方案 A：独立 Worker（最稳定，推荐）

使用 [harewise/meting-api-serverless](https://github.com/harewise/meting-api-serverless)，这是目前维护最活跃的 Cloudflare Workers 版 Meting API。

### 步骤 1：一键部署

点击下面的按钮，按照提示登录 Cloudflare 并部署：

> 👉 **[点此前往 GitHub 仓库获取 Deploy 按钮](https://github.com/harewise/meting-api-serverless)**

README 顶部有 **「Deploy to Cloudflare」** 按钮，点击后：
1. 登录/注册 Cloudflare 账号
2. 选择你的 Account
3. 点击 **Deploy**，等待约 1 分钟完成

部署完成后，你会获得一个 Worker 地址，格式如：
```
https://你的-worker-name.你的子域名.workers.dev
```

### 步骤 2：配置环境变量（重要）

1. 进入 Cloudflare Dashboard → **Workers & Pages**
2. 点击你刚部署的 Worker 项目
3. 切换到 **Settings** → **Variables**
4. 点击 **Add variable**，至少添加下面这个：

| 变量名 | 值 | 说明 |
|--------|----|------|
| `METING_TOKEN` | 自定义一段随机字符串，如 `aurora-2026-xxxxx` | **必改**，防止接口被滥用，前端也要用同样的值 |

> 💡 推荐设置的值：用你容易记住但他人猜不到的字符串，至少 8 位

**可选变量**（解锁 VIP 歌曲，需要对应平台账号）：

| 变量名 | 说明 |
|--------|------|
| `METING_COOKIE_NETEASE` | 网易云音乐 Cookie（登录后从浏览器开发者工具复制） |
| `METING_COOKIE_ALLOW_HOSTS` | 只允许某些域名调用 VIP 资源，如 `你的域名.com,*.pages.dev` |

5. 保存后点击 **Deploy** 重新部署

### 步骤 3：配置前端

打开项目根目录下的 `index.html`，找到第 12-37 行左右的配置块，取消 **方式一** 的注释并修改为你的值：

```html
<script>
  window.AURORA_API_CONFIG = {
    bases: [
      // ✅ 改成你步骤 1 中获得的 Worker 地址
      'https://你的-worker-name.你的子域名.workers.dev',
    ],
    // ✅ 改成你步骤 2 中设置的 METING_TOKEN
    tokens: ['aurora-2026-xxxxx'],
    authMode: 'hmac',
  };
</script>
```

**或者** 直接修改 `js/ncmApi.js` 中的常量（约 37-52 行）：
```javascript
const DEFAULT_API_BASES = [
    'https://你的-worker-name.你的子域名.workers.dev',  // 放第一个
];

const DEFAULT_METING_TOKENS = [
    'aurora-2026-xxxxx',  // 对应上面的 token
];
```

### 步骤 4：验证

部署到 Cloudflare Pages 后，打开播放器 → 点击搜索按钮 → 如果能正常搜索歌曲，说明配置成功！

---

## ⚡ 方案 B：Pages Functions 代理（最简单）

如果你已经把 Aurora Player 项目推送到了 Cloudflare Pages，那么**无需额外部署 Worker**，只需确保项目中有 `functions/api.js` 文件（本项目已提供）。

### 步骤 1：确认文件存在

确保你的项目根目录下有这个文件：
```
Aurora-Player/
├── functions/
│   └── api.js     ✅  这个文件必须存在
├── index.html
├── js/
└── ...
```

> 本项目已预置 `functions/api.js`，如果你是通过 Git 推送的，应该已经有了。

### 步骤 2：推送到 GitHub

确认文件后，提交并推送到 GitHub：
```bash
git add functions/api.js
git commit -m "add: Cloudflare Pages API proxy"
git push
```

Cloudflare Pages 会自动检测到 `functions/` 目录并部署 Functions。

### 步骤 3：（可选）环境变量

如果你有自己的上游 API（如方案 A 中部署的 Worker），可以在 Pages 项目中设置环境变量：

1. Pages 项目 → **Settings** → **Environment variables**
2. 选择 **Production** 和 **Preview**，分别添加：

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `NCM_API_UPSTREAM` | `https://your-worker.xxx.workers.dev` | （可选）指定上游 Worker 地址 |
| `NCM_AUTH_MODE` | `hmac` | 如果上游是 Meting Worker，填 hmac |
| `NCM_METING_TOKEN` | `你的 token` | 如果上游设置了 METING_TOKEN |
| `NCM_ALLOW_ORIGINS` | `你的域名.com,*.pages.dev` | （可选）限制来源域名 |

> 💡 **什么都不配置也可以用**：`functions/api.js` 默认自带公共 Vercel 兜底实例，直接就能用（只是可能不稳定）。

### 步骤 4：前端配置

Pages Functions 代理会自动被检测，**不需要额外配置前端**！因为 `js/ncmApi.js` 会自动优先尝试同域名下的 `/api` 路径。

但如果你想确保优先级最高，可以在 `index.html` 中显式配置：

```html
<script>
  window.AURORA_API_CONFIG = {
    bases: [window.location.origin],  // 优先使用同域名 Functions 代理
    tokens: [''],
    authMode: 'none',
  };
</script>
```

### 验证

部署完成后，直接访问：
```
https://你的-pages-域名.pages.dev/api?server=netease&type=song&keywords=test
```

如果看到 JSON 数据（或使用中的 API 返回的搜索结果），说明 Functions 代理生效了。

---

## 🆓 方案 C：仅用公共 API（零配置，但不稳定）

如果你完全不想部署任何后端，可以依赖代码中内置的公共 Vercel 实例。但请注意：
- ❌ 公共实例随时可能失效或限流
- ❌ 不保证搜索质量和速度
- ❌ 无法播放 VIP 歌曲

### 配置方式（任选其一）

**方式 1**：在 `index.html` 中注入配置（取消 **方式二** 的注释）：

```html
<script>
  window.AURORA_API_CONFIG = {
    bases: [],        // 留空，直接走公共兜底
    tokens: [],
    authMode: 'none',
  };
</script>
```

**方式 2**：什么都不做，代码中已经内置了 2 个公共 Vercel 实例作为最后兜底。

---

## 🎛️ 前端配置

本项目提供了三种配置 API 源的方式（按优先级从高到低）：

### 优先级 1：`index.html` 内联脚本（推荐）

最灵活，不用改源代码。在 `<head>` 中添加：

```html
<script>
  window.AURORA_API_CONFIG = {
    bases: [
      // 可以配置多个，按顺序尝试，失败自动切换
      'https://worker1.xxx.workers.dev',
      'https://worker2.xxx.workers.dev',
    ],
    tokens: [
      'token-for-worker1',
      'token-for-worker2',
    ],
    authMode: 'hmac',  // 'hmac' 或 'none'
  };
</script>
```

### 优先级 2：修改 `js/ncmApi.js` 常量

适合不想改 HTML 的情况。约 37-57 行：

```javascript
const DEFAULT_API_BASES = [
    'https://你的-worker.你的子域名.workers.dev',
    // ...可以加多个
];

const DEFAULT_METING_TOKENS = [
    '你的 METING_TOKEN',
];

const DEFAULT_AUTH_MODE = 'hmac';
```

### 优先级 3：自动探测（无需配置）

如果前两种都没配置，代码会按以下顺序自动尝试：
1. `window.location.origin + '/api'` → 即同域名 Pages Functions 代理（如果有）
2. `DEFAULT_API_BASES` 中配置的地址（如公共 Meting 实例）
3. 内置 2 个公共 Vercel NeteaseCloudMusicApi 实例（兜底）

---

## 🔧 故障排查

### 问题 1：点击搜索显示「网易云音乐 API 暂不可用」

**解决步骤：**
1. 打开浏览器开发者工具（F12）→ **Console** 面板
2. 看是否有 `[ncmApi] 源失败:` 的调试日志
3. 打开 **Network** 面板，重新搜索，看请求是否发出去了
4. 检查请求 URL 和响应状态码

常见原因：
- `401 Unauthorized` / `403 Forbidden` → METING_TOKEN 不匹配
- `404 Not Found` → Worker 路径不对
- `CORS error` → 检查 Worker 或 Functions 的 CORS 配置
- `5xx` 错误 → 上游 API 本身故障

### 问题 2：搜索有结果，但点击播放后没声音

**解决步骤：**
1. Network 面板看 `/song/url` 或 `type=url` 的请求
2. 检查返回的 URL 字段是否为空
3. 如果 URL 是空的，说明是 VIP/付费歌曲，需要配置 `METING_COOKIE_NETEASE`

### 问题 3：歌词不显示

检查 `type=lrc` 的请求返回的数据，有些歌曲本身没有歌词。

### 问题 4：Pages Functions 没有生效

1. 确认文件路径是 `functions/api.js`（注意是复数 functions，不是单数）
2. 确认文件内容里 `export async function onRequest(context)` 存在
3. 在 Cloudflare Pages → **Deployments** → **Functions** 选项卡中看是否有部署记录
4. 访问 `https://你的域名/api`（不带参数），如果返回 JSON 格式的错误说明（包含 `缺少 type 参数`），说明正常

---

## 📚 GitHub 参考项目

### 1. harewise/meting-api-serverless ⭐ 推荐
- **地址**：https://github.com/harewise/meting-api-serverless
- **特点**：
  - 基于 Hono，专门适配 Cloudflare Workers
  - 支持一键 Deploy 按钮
  - 维护活跃（最后更新 2026-05）
  - 支持 QQ 音乐 Cookie 自动保活（配合 KV）
  - 支持 HMAC-SHA1 鉴权
- **接口格式**：`/api?server=netease&type=song&id=xxx&auth=xxx`

### 2. Warma10032/Meting-API-Serverless
- **地址**：https://github.com/Warma10032/Meting-API-Serverless
- **特点**：fork 自 metowolf，同样支持 CF Workers 和 Vercel，配置方式类似

### 3. wjy2018/Meting
- **地址**：https://github.com/wjy2018/Meting
- **特点**：
  - 支持多种运行时：Node / Deno / Vercel / CF Workers / Docker
  - 文档详细，部署方式多

### 4. NeteaseCloudMusicApiEnhanced/api-enhanced
- **地址**：https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced
- **特点**：
  - 基于最经典的 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)
  - 原生 API 接口更丰富，适合需要更多功能的场景
  - 但原生适配 CF Workers 较复杂（推荐配成 Vercel 上游）
- **接口格式**：`/search?keywords=xxx`、`/song/url?id=xxx`、`/lyric?id=xxx`

---

## 📝 API 对照表

### Meting-API-Serverless 格式（方案 A + 方案 B 默认）

| 功能 | 参数 | 示例 |
|------|------|------|
| 搜索 | `server=netease&type=song&keywords=xxx` | `/api?server=netease&type=song&keywords=海阔天空` |
| 获取播放地址 | `server=netease&type=url&id=歌曲ID` | `/api?server=netease&type=url&id=186016` |
| 获取歌词 | `server=netease&type=lrc&id=歌曲ID` | `/api?server=netease&type=lrc&id=186016` |

鉴权：在 URL 末尾附加 `&auth=HMAC_SHA1(TOKEN, server+type+id)`

### NeteaseCloudMusicApi 原生格式（方案 C + 方案 B 兜底）

| 功能 | 路径 | 示例 |
|------|------|------|
| 搜索 | `/search?keywords=xxx` | `/search?keywords=海阔天空` |
| 获取播放地址 | `/song/url?id=歌曲ID` | `/song/url?id=186016` |
| 获取歌词 | `/lyric?id=歌曲ID` | `/lyric?id=186016` |

> 💡 `js/ncmApi.js` 会自动识别两种格式并转换为统一的输出，前端不用关心底层差异。

---

## ✅ 完成清单

部署完成后，请确认以下项目：

- [ ] 前端页面可以正常访问（Cloudflare Pages / Workers）
- [ ] 点击搜索按钮，输入关键词能返回歌曲列表
- [ ] 点击歌曲「播放」按钮，音乐能正常播放（有声音）
- [ ] 有歌词的歌曲能显示歌词
- [ ] 刷新页面后功能仍然正常

如果以上都没问题，恭喜你！🎉 网易云 API 集成已完成。

---

## 💡 最佳实践建议

1. **生产环境强烈推荐用方案 A**：独立 Worker 稳定性最高，且可以配自己的 Cookie 解锁更多歌曲
2. **METING_TOKEN 一定要改**：默认 `token` 太容易被扫到滥用，改成自定义字符串
3. **设置 `METING_COOKIE_ALLOW_HOSTS`**：只允许你自己的域名调用，防止别人蹭你的 API 和 Cookie
4. **定期检查**：Cloudflare Workers 有免费额度（每天 10 万次请求），超出会暂停

祝使用愉快！🎵
