# Aurora Player — 免费部署方案指南
（替代 Cloudflare 的两种方案）

> **重要**：本项目代码已做到「一套代码适配所有平台」——默认无需修改任何配置，`js/ncmApi.js` 会**自动探测**部署环境，选择最优 API 请求路径。
> 你只需要按以下步骤把代码推送到对应的平台即可。

---

## 📊 方案总览（根据你的需求二选一）

| 特性 | 方案一：**Vercel 部署** ⭐ 首推 | 方案二：**GitHub Pages**（纯静态） |
|------|-------------------------------|----------------------------------|
| **免费额度** | 充足（个人足够）：100GB 流量/月，10万次 Function 调用/天 | 无限流量，永久免费（GitHub 仓库免费即可） |
| **API 代理** | ✅ 自带 Serverless Functions（`/api` 同域名，零跨域） | ❌ 无后端 → 走公共 Vercel 兜底实例 |
| **稳定性** | ✅ 极高（自己的 Vercel Function + 双上游 fallback） | ⚠️ 依赖公共 API 实例，偶尔可能不稳定 |
| **配置复杂度** | ⭐⭐ 中等（一键 Import，约 3 分钟） | ⭐ 超简单（开启 Pages 开关即可，1 分钟） |
| **国内访问速度** | 一般（Vercel 境外节点为主） | 较慢（GitHub Pages 境外） |
| **自定义域名** | ✅ 支持 | ✅ 支持 |
| **适合人群** | 希望稳定、自己掌控 API 的用户 | 只想快速上线、追求零配置的用户 |

---

## 🚀 方案一：Vercel 完整部署（推荐）

### 前置条件
- 有 GitHub 账号，代码已推送到 GitHub 仓库
- 有 [Vercel](https://vercel.com/) 账号（GitHub 一键登录，免费）

### 步骤 1：推送最新代码到 GitHub（如果还没）

```bash
# 在项目根目录执行
git add -A
git status   # 确认以下文件已在更改列表中：
#   api/index.js   vercel.json   .nojekyll   404.html
#   js/ncmApi.js   index.html    README-FREE-DEPLOY.md
git commit -m "feat: 添加 Vercel / GitHub Pages 免费部署支持"
git push origin main   # 或你的主分支
```

### 步骤 2：在 Vercel 导入项目

1. 打开 https://vercel.com/new
2. **"Import Git Repository"** → 选择你的 Aurora Player 仓库 → 点击 **Import**
3. **Configure Project** 页面：
   - **Framework Preset**：选择 `Other`（不是 Next.js/Vite 等，我们是纯静态）
   - **Root Directory**：保持 `./`（不要改）
   - **Build Command**：**留空**（纯静态无需构建）
   - **Output Directory**：**留空**或填 `.`（根目录）
   - **Install Command**：**留空**
4. 点击 **Deploy** 开始部署

等待约 1-2 分钟，Vercel 会自动：
- 识别 `vercel.json` 的配置（rewrites + headers + functions）
- 把 `api/index.js` 部署为 Serverless Function（路由 `/api`）
- 把所有静态文件托管到 CDN

### 步骤 3：部署完成验证

完成后 Vercel 会给你一个域名（如 `https://aurora-player-xxx.vercel.app`），打开它，按顺序测试：

| 测试项 | 操作 | 预期 |
|--------|------|------|
| 搜索歌曲 | Tab → 输入"晴天 周杰伦"回车 | 3 秒内出歌曲列表 |
| 播放 | 点击任意歌曲 | 有声音，进度条走动 |
| 歌词 | 按 `L` 键 | 歌词加载并滚动 |
| API 是否走自己的代理 | F12 → Network → 搜索 `/api` 请求 | URL 应该是 `https://你的域名.vercel.app/api?...`（**同域名**） |

### 步骤 4（可选）：配置环境变量增强稳定性

在 **Vercel Dashboard → 项目 → Settings → Environment Variables → Production** 中添加：

| 变量名 | 推荐值 | 是否加密 | 作用 |
|--------|--------|---------|------|
| `NCM_API_UPSTREAM` | `https://meting-api-serverless.3122944737.workers.dev` | 否 | 自定义优先级最高的 Meting 上游（比公共兜底稳定） |
| `NCM_AUTH_MODE` | `hmac` | 否 | 与上游 Worker 的鉴权方式一致 |
| `NCM_METING_TOKEN` | `token` | 🔒 加密 | 与上游 Worker 的 METING_TOKEN 一致 |
| `NCM_ALLOW_ORIGINS` | `*` 或 `你的自定义域名` | 否 | CORS 白名单，逗号分隔 |

添加完后点击 **Save → 回到 Deployments → 最新一次部署 → 三个点 → Redeploy** 让变量生效。

---

## 🚀 方案二：GitHub Pages 零后端部署（最简洁）

> 如果你不想折腾 Functions、追求一分钟上线、能接受偶尔公共 API 不稳定 → 选这个。

### 前置条件
- 代码已推送到 GitHub 仓库（公开仓库或 Pro 私有仓库均可）

### 步骤 1：推送最新代码（同方案一步骤 1）

```bash
git add -A
git commit -m "feat: GitHub Pages 免费部署支持"
git push origin main
```

### 步骤 2：开启 GitHub Pages

1. 打开你的 **GitHub 仓库页面** → **Settings** → **Pages**（左侧菜单）
2. **Build and deployment / Source**：选择 `Deploy from a branch`
3. **Branch**：选择 `main` / 分支 → `/ (root)` 目录 → 点击 **Save**
4. 页面顶部会出现绿色提示：`Your site is ready to be published at https://你的用户名.github.io/仓库名/`
5. **等待 1-2 分钟**，刷新页面直到提示变成 `Your site is live at ...`

### 步骤 3：测试访问

打开上面的地址，按方案一的测试表验证。

> **注意**：GitHub Pages 是纯静态，没有 `/api` 代理，所以：
> - 代码会**自动跳过**插入同域名 origin（识别到 `.github.io` 后缀）
> - 请求会走**公共 Vercel 兜底实例**（`netease-cloud-music-api-five-roan.vercel.app` 等）
> - 如果公共 API 不可用，搜索和播放会暂时失败 → 此时建议切换到方案一（Vercel 自带 Function）

### 步骤 4（可选）：自定义域名

在 Settings → Pages → Custom domain 填入你的域名，按提示去 DNS 添加 CNAME 记录即可。

---

## 🔍 两方案下自动探测的行为对比

（无需配置，代码自动处理）

| 部署环境 | 是否插入 `origin` 作为第一个 API 源 | 真实请求路径 | 说明 |
|----------|-------------------------------------|-------------|------|
| Vercel `.vercel.app`（含 Functions） | ✅ 是 | `https://xxx.vercel.app/api?...` → 自己的 Serverless Function → 双上游 fallback | 稳定，无跨域 |
| Cloudflare Pages `.pages.dev` | ✅ 是 | `https://xxx.pages.dev/api?...` → 自己的 Pages Function | 稳定，无跨域 |
| GitHub Pages `.github.io` | ❌ 否（识别为纯静态） | 公共 Vercel NCM API（多源 fallback） | 省配置，依赖公共实例稳定性 |
| 自定义域名（部署了 Functions） | ✅ 是 | 同域名 `/api` | 需确保平台有 Functions 能力，否则会 fallback |
| 本地 `file://` 打开 | ❌ 否 | 公共兜底 | 仅测试用，播放可能跨域受限 |

---

## 🐛 常见问题排查

### Q1：Vercel 部署后打开页面是 404？
- **原因**：`outputDirectory` 配置错误，Vercel 找不到 `index.html`
- **解决**：项目 → Settings → General → Build & Development Settings → 全部留空 → Save → Redeploy

### Q2：Vercel 搜索返回 502（API 代理失败）？
1. 打开部署日志：Project → Deployments → 失败的那个 → Functions → Logs
2. 常见原因：
   - `NCM_METING_TOKEN` 与上游 Worker 不一致 → 改环境变量 + redeploy
   - 自定义上游 Worker 挂了 → 临时把 `NCM_API_UPSTREAM` 清空，让它走公共兜底
   - 国内网络访问 Vercel 节点波动 → 换个时间段或绑定自定义域名

### Q3：GitHub Pages 打开页面空白（不是 404）？
- **原因**：浏览器缓存了旧资源
- **解决**：强制刷新 `Ctrl+Shift+R`；或打开 DevTools → Network → Disable cache → 刷新

### Q4：GitHub Pages 搜索正常但点击播放没声音？
- **原因**：公共 Vercel 实例返回的播放 URL 跨域/失效（版权歌曲）
- **解决**：换一首歌试试；如果完全没法用 → 迁移到方案一 Vercel 自己的 Function

### Q5：如何从 Cloudflare 切换到 Vercel/GitHub Pages？
1. 推送新代码到 GitHub
2. 按上面方案一或二部署新站点
3. **绑定的自定义域名切换**：
   - Cloudflare → 去 DNS 把 CNAME 从 `xxx.pages.dev` 改成 Vercel 给的 `cname.vercel-dns.com`
   - 或直接把 DNS NameServer 切回域名注册商
   - 等待 DNS 生效（最长 24 小时）

---

## 🛠 平台特有文件作用一览

| 文件 | 对应平台 | 作用 |
|------|---------|------|
| `vercel.json` | Vercel | 路由重写（SPA 兜底） + Headers 缓存控制 + Function runtime |
| `api/index.js` | Vercel | Serverless Function（网易云 API 代理，路由 `/api`） |
| `.nojekyll` | GitHub Pages | **必须存在**！防止 GitHub 把 `_headers` / `_redirects` 等以下划线开头的文件当成 Jekyll 源而忽略输出 |
| `404.html` | GitHub Pages | SPA 路由 hack：404 时跳回 `/index.html`，保证刷新不真的丢失 |
| `functions/api.js` | Cloudflare Pages | 保留以备后用：如果以后要切回 Cloudflare 可以直接用 |
| `_headers` / `_redirects` | Cloudflare Pages | 保留以备后用 |

---

## ✅ 完成检查清单

- [ ] 代码已 push 到 GitHub
- [ ] 按方案一或二部署成功
- [ ] 打开新域名能看到粒子特效和播放器 UI
- [ ] 按 Tab 搜索歌曲**能出列表**
- [ ] 点击歌曲**能播放出声音**
- [ ] 按 L 键**能出歌词**
- [ ] F12 Network 中**没有 4xx/5xx 错误**

完成后你就拥有一个完全免费托管、自动适配部署平台的粒子音乐播放器啦 🎉
