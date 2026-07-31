/**
 * ncmApi.js — 网易云音乐 API 客户端
 *
 * 支持多种部署方式，按优先级自动 fallback：
 *   1. 用户自定义配置（window.AURORA_API_CONFIG）
 *   2. 同域名 Cloudflare Pages Functions 代理（/api）
 *   3. 用户自己部署的 Cloudflare Workers（API_BASES 列表）
 *   4. 公共 Meting-API-Serverless 实例
 *
 * 支持两种鉴权模式：
 *   - HMAC-SHA1 鉴权（Meting-API-Serverless）：auth = HMAC_SHA1(TOKEN, server+type+id)
 *   - 无鉴权模式（公共 NeteaseCloudMusicApi Vercel 实例）
 */

// ═══════════════════════════════════════════════════════════════
//  API 源配置（按优先级排列，失败后自动切换下一个）
//  ═══════════════════════════════════════════════════════════════
//
//  【推荐部署方式】：
//  1. 部署 harewise/meting-api-serverless 到自己的 Cloudflare Workers
//     GitHub: https://github.com/harewise/meting-api-serverless
//     一键部署按钮在 README 中
//
//  2. 然后把下面 API_BASES 第一个改成你自己的 Worker 地址，
//     并把 METING_TOKENS[0] 改成你设置的 METING_TOKEN
//
//  【或者】：
//  部署完成后，在 index.html 的 <head> 中添加：
//    <script>
//      window.AURORA_API_CONFIG = {
//        bases: ['https://your-worker.your-subdomain.workers.dev'],
//        tokens: ['your-secret-token'],
//        authMode: 'hmac' // 或 'none'
//      };
//    </script>
//
const DEFAULT_API_BASES = [
    // —— 在这里填入你自己部署的 Cloudflare Workers 地址（优先级最高）
    // 'https://your-worker.your-subdomain.workers.dev',

    // —— 同域名 Pages Functions 代理（如已部署 functions/api.js）
    // (留空会自动探测 window.location.origin + '/api')

    // —— 公共备用实例（不保证稳定可用，仅供测试）
    'https://meting-api-serverless.3122944737.workers.dev',
];

const DEFAULT_METING_TOKENS = [
    // 对应上面每个 API_BASE 的 token
    // 如果你修改了 Worker 的 METING_TOKEN，这里也要同步
    'token',
];

// HMAC 鉴权模式：'hmac' | 'none'
// 'hmac'  -> 使用 Meting-API-Serverless 鉴权
// 'none'  -> 直接调用无鉴权的 API（如公共 Vercel NeteaseCloudMusicApi）
const DEFAULT_AUTH_MODE = 'hmac';

// 公共无鉴权备用源（NeteaseCloudMusicApi 原生格式）
// 用于鉴权模式下所有源都失败时的兜底
// 2026-07 实测可用：api.7boe.top（~600ms 搜索响应）
const FALLBACK_PUBLIC_APIS = [
    {
        base: 'https://api.7boe.top',
        authMode: 'none',
        adapter: 'ncmapi'
    },
    {
        base: 'https://netease-cloud-music-api-five-roan.vercel.app',
        authMode: 'none',
        adapter: 'ncmapi'
    },
    {
        base: 'https://netease-cloud-music-api-demo.vercel.app',
        authMode: 'none',
        adapter: 'ncmapi'
    },
];

// ═══════════════════════════════════════════════════════════════
//  运行时配置（允许 index.html 注入覆盖）
//  ═══════════════════════════════════════════════════════════════

function getRuntimeConfig() {
    const injected = (typeof window !== 'undefined' && window.AURORA_API_CONFIG) || {};

    // 注意：用户显式注入 bases/tokens 时，即使是空数组 [] 也保留用户选择
    //      只有未注入（undefined）才回退到默认值（区分「用户想禁用」与「用户没写」）
    let bases = Array.isArray(injected.bases)
        ? injected.bases.slice()
        : DEFAULT_API_BASES.slice();

    let tokens = Array.isArray(injected.tokens)
        ? injected.tokens.slice()
        : DEFAULT_METING_TOKENS.slice();

    // authMode 统一规范为「与 bases 等长的数组」，每一项对应一个源的鉴权模式
    // 允许注入：全局字符串（所有源共用），或按源区分的数组
    let authModeList;
    if (Array.isArray(injected.authMode)) {
        authModeList = injected.authMode.slice();
    } else if (typeof injected.authMode === 'string') {
        authModeList = Array(bases.length).fill(injected.authMode);
    } else {
        authModeList = Array(bases.length).fill(DEFAULT_AUTH_MODE);
    }

    // 补齐 tokens 和 authModeList 的长度，避免越界
    while (tokens.length < bases.length) tokens.push(tokens[tokens.length - 1] || 'token');
    while (authModeList.length < bases.length) authModeList.push(DEFAULT_AUTH_MODE);

    // 如果同域名有 Functions 代理（Vercel / Cloudflare Pages 等），优先使用
    // 注意：
    //   1) 仅当用户未显式写 bases 配置时才自动插入（用户显式写了 = [],[xxx] 都尊重）
    //   2) 同域名 Functions 代理不需要客户端 HMAC 鉴权（服务端处理）
    //   3) 纯静态托管域名（如 *.github.io）没有 /api 能力，跳过插入避免首次请求浪费
    const userExplicitlySetBases = Array.isArray(injected.bases);
    if (!userExplicitlySetBases
        && typeof window !== 'undefined'
        && window.location
        && window.location.origin) {

        const origin = window.location.origin;
        const hasOriginProxy = bases.some(b => b.startsWith(origin));

        // 明确的纯静态托管域名后缀（无 Serverless Functions /api 能力），跳过插入
        const PURE_STATIC_HOST_SUFFIXES = [
            '.github.io',    // GitHub Pages（纯静态，无 Functions）
            '.gitlab.io',    // GitLab Pages
            '.gitee.io',     // Gitee Pages
            '.coding.me',    // Coding Pages
            '.coding.net',   // Coding Pages
            '.surge.sh',     // Surge.sh（纯静态
            '.firebaseapp.com', // Firebase Hosting（纯静态，Functions 另配路径）
        ];
        let host = '';
        try { host = new URL(origin).hostname; } catch (e) { /* ignore */ }
        const isPureStatic = PURE_STATIC_HOST_SUFFIXES.some(s => host.endsWith(s));

        if (!hasOriginProxy && !origin.startsWith('file:') && !isPureStatic) {
            // 找到第一个公共实例的位置，在它之前插入
            const publicIdx = bases.findIndex(b =>
                b.includes('workers.dev') && !b.includes('your-worker')
            );
            const insertIdx = publicIdx >= 0 ? publicIdx : bases.length;
            bases.splice(insertIdx, 0, origin);
            tokens.splice(insertIdx, 0, '');                  // 同域名代理不需要 token
            authModeList.splice(insertIdx, 0, 'none');         // 同域名代理强制无鉴权
        }
    }

    // 保证返回时长度一致
    while (tokens.length < bases.length) tokens.push('token');
    while (authModeList.length < bases.length) authModeList.push(DEFAULT_AUTH_MODE);

    return { bases, tokens, authMode: authModeList };
}

// ═══════════════════════════════════════════════════════════════
//  HMAC-SHA1 鉴权
//  ═══════════════════════════════════════════════════════════════

async function makeHmacAuth(token, server, type, id) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(token),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(server + type + id));
    return Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// ═══════════════════════════════════════════════════════════════
//  数据格式兼容
//  ═══════════════════════════════════════════════════════════════

function toArray(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && data.result && Array.isArray(data.result.songs)) return data.result.songs;
    return [];
}

// ═══════════════════════════════════════════════════════════════
//  多源请求：自动尝试多个 API 源直到成功
//  ═══════════════════════════════════════════════════════════════

/**
 * 多源 fetch：按配置的 API 源顺序逐个尝试，直至成功
 * @param {Object} opts - 请求选项
 * @param {string} opts.server - 平台 netease/tencent/...
 * @param {string} opts.type   - song/url/lrc/...
 * @param {string} [opts.id]   - 资源 ID
 * @param {string} [opts.keywords] - 搜索关键词（type=song 时用）
 * @param {number} [opts.limit] - 返回数量
 * @returns {Promise<{response: Response, base: string, authMode: string, adapter: string}>}
 */
async function multiFetch(opts) {
    const cfg = getRuntimeConfig();

    // 构建候选源列表
    const candidates = [];

    // 说明：getRuntimeConfig() 已保证 cfg.authMode 为与 bases 等长的数组
    const authModes = cfg.authMode;

    // 1. 主源（配置中的 bases）—— 长度与 cfg.authMode / cfg.tokens 保持一致
    cfg.bases.forEach((base, idx) => {
        const token = cfg.tokens[idx] ?? '';
        const thisAuth = authModes[idx] ?? DEFAULT_AUTH_MODE;
        // 双保险：token 为空时强制无鉴权（同域名 Pages Functions 代理场景）
        const finalAuth = (!token) ? 'none' : thisAuth;

        candidates.push({
            base: base.replace(/\/$/, ''),
            authMode: finalAuth,
            adapter: 'meting',
            token
        });
    });

    // 2. 公共兜底源（NeteaseCloudMusicApi）
    FALLBACK_PUBLIC_APIS.forEach(fb => {
        candidates.push({
            base: fb.base.replace(/\/$/, ''),
            authMode: fb.authMode,
            adapter: fb.adapter,
            token: ''
        });
    });

    let lastErr = null;

    for (const src of candidates) {
        try {
            let url;
            let fetchOpts = {};

            if (src.adapter === 'meting') {
                // —— Meting 统一接口（/api 端点）——
                const params = new URLSearchParams();
                params.set('server', opts.server);
                params.set('type', opts.type);
                if (opts.id) params.set('id', String(opts.id));
                if (opts.keywords) params.set('keywords', opts.keywords);
                if (opts.limit) params.set('limit', String(opts.limit));

                if (src.authMode === 'hmac') {
                    // 搜索时 id 留空
                    const idForAuth = opts.type === 'song' && opts.keywords ? '' : (opts.id || '');
                    const auth = await makeHmacAuth(src.token, opts.server, opts.type, idForAuth);
                    params.set('auth', auth);
                }

                // Meting 统一接口（同域名 Functions 代理 与 独立 Worker 路径一致）
                url = `${src.base}/api?${params}`;

            } else {
                // —— NeteaseCloudMusicApi 原生接口 ——
                const params = new URLSearchParams();
                if (opts.keywords) params.set('keywords', opts.keywords);
                if (opts.limit) params.set('limit', String(opts.limit));

                switch (opts.type) {
                    case 'song': // 搜索
                        url = `${src.base}/search?${params}`;
                        break;
                    case 'url':  // 播放地址
                        url = `${src.base}/song/url?id=${encodeURIComponent(opts.id || '')}`;
                        break;
                    case 'lrc':  // 歌词
                        url = `${src.base}/lyric?id=${encodeURIComponent(opts.id || '')}`;
                        break;
                    case 'detail': // 歌曲详情（用于获取封面 picUrl）
                        // ids 优先级 > id（支持批量查多首歌）
                        const ids = opts.ids || opts.id || '';
                        url = `${src.base}/song/detail?ids=${encodeURIComponent(ids)}`;
                        break;
                    default:
                        continue; // 不支持的类型直接跳过
                }
            }

            const ctrl = new AbortController();
            // 超时 15s（Vercel Functions 冷启动约 3-8s + 公共源网络延迟 2-5s，留足余量）
            const timer = setTimeout(() => ctrl.abort(), 15000);
            const res = await fetch(url, { ...fetchOpts, signal: ctrl.signal });
            clearTimeout(timer);

            if (!res.ok) {
                lastErr = new Error(`HTTP ${res.status} @ ${src.base}`);
                continue;
            }

            return { response: res, base: src.base, authMode: src.authMode, adapter: src.adapter };

        } catch (err) {
            lastErr = err;
            // 继续下一个源
            if (typeof console !== 'undefined' && console.debug) {
                console.debug('[ncmApi] 源失败:', src?.base, '->', err.message);
            }
        }
    }

    throw lastErr || new Error('所有 API 源均不可用');
}

// ═══════════════════════════════════════════════════════════════
//  对外 API
//  ═══════════════════════════════════════════════════════════════

/**
 * 搜索歌曲
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 返回数量，默认 20
 * @returns {Promise<Array>} 歌曲列表 [{id, name, artists, album, duration, coverUrl, ...}]
 */
export async function searchSongs(keyword, limit = 20) {
    const { response, adapter } = await multiFetch({
        server: 'netease',
        type: 'song',
        keywords: keyword,
        limit: limit,
    });

    const data = await response.json();
    const list = toArray(data).slice(0, limit);

    // 第一轮：快速 map 提取基础信息 + 初步尝试取封面
    const results = list.map(song => {
        let artists = '';
        let albumName = '';
        let coverUrl = '';
        let albumId = 0;
        let duration = 0;

        // NeteaseCloudMusicApi 原生格式
        if (adapter === 'ncmapi') {
            artists = Array.isArray(song.ar)
                ? song.ar.map(a => a.name).join(' / ')
                : (song.artists || '');
            albumName = (song.al && song.al.name) || (song.album && song.album.name) || (song.album || '');
            coverUrl = _normalizeCoverUrl(_extractRawCoverUrl(song), '300y300');
            albumId = (song.al && song.al.id) || (song.album && song.album.id) || 0;
            duration = song.dt || song.duration || 0;
        } else {
            // Meting 格式
            artists = song.artist
                || (Array.isArray(song.artists) ? song.artists.map(a => a.name).join(' / ') : '')
                || (Array.isArray(song.ar) ? song.ar.map(a => a.name).join(' / ') : '');
            albumName = (typeof song.album === 'string') ? song.album
                : ((song.album && song.album.name) || (song.al && song.al.name) || '');
            coverUrl = song.pic_url
                || (song.album && song.album.picUrl)
                || (song.al && song.al.picUrl)
                || '';
            coverUrl = _normalizeCoverUrl(coverUrl, '300y300');
            albumId = (song.album && song.album.id) || (song.al && song.al.id) || 0;
            duration = song.duration || song.dt || 0;
        }

        return {
            id: song.id,
            name: song.name,
            artists: artists,
            album: albumName,
            albumId: albumId,
            duration: duration,
            coverUrl: coverUrl,
            // 保留原 song 对象用于 debug（非标准）
            _raw: song,
        };
    });

    // 第二轮（可选）：如果是 ncmapi 且存在 coverUrl 为空的条目，批量调 song/detail 补全
    if (adapter === 'ncmapi') {
        const missingIdx = [];
        results.forEach((r, i) => { if (!r.coverUrl) missingIdx.push(i); });
        if (missingIdx.length > 0) {
            try {
                const ids = missingIdx.map(i => String(results[i].id)).join(',');
                const detailSongs = await getSongDetail(ids);
                if (detailSongs.length > 0) {
                    const detailMap = new Map();
                    detailSongs.forEach(s => detailMap.set(String(s.id), s));
                    for (const idx of missingIdx) {
                        const orig = results[idx];
                        const detail = detailMap.get(String(orig.id));
                        if (!detail) continue;
                        const rawCover = _extractRawCoverUrl(detail);
                        if (rawCover) {
                            orig.coverUrl = _normalizeCoverUrl(rawCover, '300y300');
                            // 顺带补全其他缺失字段
                            if (!orig.album && detail.al && detail.al.name) orig.album = detail.al.name;
                        } else {
                            // detail 里也没有，再尝试拿歌手头像当 fallback
                            const ar = Array.isArray(detail.ar) ? detail.ar[0] : null;
                            if (ar && ar.picUrl) orig.coverUrl = _normalizeCoverUrl(ar.picUrl, '300y300');
                        }
                    }
                }
            } catch (_) {
                // 补全失败不影响主流程
            }
        }
    }

    // 去掉临时 _raw 字段再返回
    return results.map(r => {
        const { _raw, ...rest } = r;
        void _raw;
        return rest;
    });
}

/**
 * 获取歌曲可播放 URL
 * @param {number|string} id - 歌曲 ID
 * @returns {Promise<string|null>} 可播放 URL，或 null
 */
export async function getSongUrl(id) {
    const idStr = String(id);

    let response, adapter;
    try {
        ({ response, adapter } = await multiFetch({
            server: 'netease',
            type: 'url',
            id: idStr,
        }));
    } catch (e) {
        console.warn('[getSongUrl] multiFetch 失败:', e.message);
        return null;
    }

    let raw;
    try {
        raw = await response.text();
    } catch (e) {
        console.warn('[getSongUrl] response.text() 失败:', e.message);
        return null;
    }
    const trimmed = raw.trim();

    // Meting 可能返回纯文本 URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed.replace(/^http:/, 'https:');
    }

    try {
        const data = JSON.parse(trimmed);

        // NeteaseCloudMusicApi 格式: {data:[{id,url,...}]}
        if (adapter === 'ncmapi') {
            const arr = Array.isArray(data.data) ? data.data : [];
            const s = arr.find(u => String(u.id) === idStr);
            if (s && s.url) return s.url.replace(/^http:/, 'https:');
            if (arr[0] && arr[0].url) return arr[0].url.replace(/^http:/, 'https:');
            return null;
        }

        // Meting JSON 格式
        const list = toArray(data);
        const song = list.find(u => String(u.id) === idStr);
        if (song && song.url) return song.url.replace(/^http:/, 'https:');
        if (data && data.data && data.data[0] && data.data[0].url) {
            return data.data[0].url.replace(/^http:/, 'https:');
        }
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * 从搜索/detail 返回的歌曲对象中提取封面 URL（多级 fallback）
 * @param {object} song - 原格式歌曲对象
 * @returns {string} 原始封面 URL（未 normalize）
 */
function _extractRawCoverUrl(song) {
    if (!song || typeof song !== 'object') return '';
    // 优先级：al.picUrl → al.pic_str 构造 → al.pic(+从 picUrl 推断) → album.picUrl → artists[0].picUrl
    if (song.al && typeof song.al === 'object') {
        if (song.al.picUrl) return song.al.picUrl;
        if (song.al.pic_str) return `https://p1.music.126.net/placeholder/${song.al.pic_str}.jpg`;
    }
    if (song.album && typeof song.album === 'object' && song.album.picUrl) return song.album.picUrl;
    if (Array.isArray(song.ar) && song.ar[0] && song.ar[0].picUrl) return song.ar[0].picUrl;
    if (Array.isArray(song.artists) && song.artists[0] && song.artists[0].picUrl) return song.artists[0].picUrl;
    if (song.picUrl) return song.picUrl;
    return '';
}

/**
 * 将网易云 CDN URL 转成同源图片代理（避开浏览器 Referer 防盗链 + CORS 像素读取限制）
 * 只有在有 origin 的情况下才走代理；file:// 协议或无 origin 环境下原样返回
 * @param {string} httpsUrl - 已 normalize 成 https 的封面 URL
 */
export function proxyCoverUrl(httpsUrl) {
    if (!httpsUrl) return '';
    let u = String(httpsUrl).trim();
    if (!u) return '';
    // 已是代理 URL 或相对路径：跳过
    if (u.startsWith('/') || /\/api\?.*type=image\b/i.test(u)) return u;
    // 非网易云域名（如占位图）：不代理，原样返回
    if (!/^https?:\/\/([a-z0-9-]+\.)*music\.126\.net\//i.test(u)) return u;

    const hasWindow = (typeof self !== 'undefined' && self.location && self.location.origin);
    const origin = hasWindow ? self.location.origin : '';
    if (!origin || origin.startsWith('file:')) {
        // 本地 file:// 或未知环境，无法使用同源代理 → 直连（可能失败，但只能这样）
        return u;
    }
    // 去掉网易云自己的 ?param=xxx 参数（交给同源代理原样转发，不做裁剪）
    // —— 但保留它也行，代理会把 URL 透传的，所以这里直接 encode 就行
    return `${origin}/api?server=netease&type=image&url=${encodeURIComponent(u)}`;
}

/**
 * 封面 URL 归一化：http→https，附加尺寸参数（网易云 CDN 原生支持 ?param=WxH）
 * 最后统一走 proxyCoverUrl 转成同源代理，解决防盗链 + CORS
 * @param {string} rawUrl
 * @param {string} size - 如 '200y200' '300y300'
 */
function _normalizeCoverUrl(rawUrl, size = '300y300') {
    if (!rawUrl) return '';
    let u = String(rawUrl).trim();
    if (!u) return '';
    u = u.replace(/^http:/, 'https:');
    if (/music\.126\.net\//.test(u) && !/\?param=/.test(u) && !/\/$/.test(u)) {
        u += `?param=${size}`;
    }
    return proxyCoverUrl(u);
}

/**
 * 获取歌曲详情（用于补全封面 picUrl 等字段）
 * @param {string|number|Array<string|number>} ids - 单首歌曲 ID 或多首歌曲 ID 数组
 * @returns {Promise<Array<object>>} songs 数组（NeteaseCloudMusicApi 原生格式）
 */
export async function getSongDetail(ids) {
    if (!ids) return [];
    const idsStr = Array.isArray(ids) ? ids.filter(Boolean).map(String).join(',') : String(ids);
    if (!idsStr) return [];
    try {
        const { response } = await multiFetch({
            server: 'netease',
            type: 'detail',
            ids: idsStr,
        });
        const data = await response.json();
        return Array.isArray(data && data.songs) ? data.songs : [];
    } catch (_) {
        return [];
    }
}

/**
 * 获取歌词
 * @param {number|string} id - 歌曲 ID
 * @returns {Promise<string|null>} LRC 格式歌词文本
 */
export async function getLyric(id) {
    const idStr = String(id);
    const { response, adapter } = await multiFetch({
        server: 'netease',
        type: 'lrc',
        id: idStr,
    });

    const raw = await response.text();
    const trimmed = raw.trim();

    // 纯文本 LRC
    if (trimmed.startsWith('[') && /\[\d{1,2}:\d{2}/.test(trimmed)) {
        return trimmed;
    }

    try {
        const data = JSON.parse(trimmed);

        // NeteaseCloudMusicApi 格式: {lrc:{lyric}}
        if (adapter === 'ncmapi') {
            if (data && data.lrc && data.lrc.lyric) return data.lrc.lyric;
            if (data && data.klyric && data.klyric.lyric) return data.klyric.lyric;
            return null;
        }

        // Meting JSON
        const list = toArray(data);
        if (list[0] && list[0].lyric) return list[0].lyric;
        if (data && data.lrc && data.lrc.lyric) return data.lrc.lyric;
    } catch (_) { /* fall through */ }

    return null;
}

/**
 * 获取封面图片为 data URL（避免外链跨域问题）
 * @param {string} url - 封面图片 URL
 * @returns {Promise<string|null>} data URL
 */
export async function fetchCoverAsDataUrl(url) {
    if (!url) return null;
    const proxiedUrl = proxyCoverUrl(url.replace(/^http:/, 'https:'));

    // 尝试顺序：
    // 1) 同源代理（首选：100% 无防盗链 + CORS 正确）
    // 2) 原始直连（万一代理不可用）
    // 3) allorigins 代理兜底
    const attempts = [
        { url: proxiedUrl, mode: 'cors' },
    ];
    // 如果 proxiedUrl 不等于直链，再加直链尝试
    const direct = url.replace(/^http:/, 'https:');
    if (direct !== proxiedUrl) attempts.push({ url: direct, mode: 'cors' });
    attempts.push({
        url: `https://api.allorigins.win/raw?url=${encodeURIComponent(direct)}`,
        mode: 'cors',
    });

    for (const a of attempts) {
        try {
            const res = await fetch(a.url, { mode: a.mode || 'cors' });
            if (!res.ok) continue;
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
            if (dataUrl && String(dataUrl).startsWith('data:')) return dataUrl;
        } catch (_) {
            // 继续下一种
        }
    }
    return null;
}

/**
 * 获取封面图片 URL（http → https 升级 + 走同源图片代理，避开防盗链/CORS）
 * @param {string} coverUrl - 原始封面 URL
 * @returns {string} 可直接使用的 URL
 */
export function getCoverUrl(coverUrl) {
    if (!coverUrl) return '';
    return proxyCoverUrl(coverUrl.replace(/^http:/, 'https:'));
}

/**
 * 健康检查：测试 API 服务是否可达
 * @returns {Promise<boolean>}
 */
export async function checkApiAvailable() {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);

        // 用一个轻量搜索请求来测试（带 multiFetch fallback）
        await multiFetch({
            server: 'netease',
            type: 'song',
            keywords: 'test',
            limit: 1,
        });

        clearTimeout(timer);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * 获取当前可用的 API 源信息（用于调试 / UI 展示）
 * @returns {{primary: string, fallbacks: string[], list: Array<{base:string, authMode:string, tokenLen:number}>}}
 */
export function getApiSourceInfo() {
    const cfg = getRuntimeConfig();
    const list = cfg.bases.map((b, i) => ({
        base: b,
        authMode: cfg.authMode[i] || DEFAULT_AUTH_MODE,
        tokenLen: (cfg.tokens[i] || '').length
    }));
    FALLBACK_PUBLIC_APIS.forEach(f => {
        list.push({ base: f.base + ' (公共兜底)', authMode: f.authMode, tokenLen: 0 });
    });
    return {
        primary: cfg.bases[0] || '(未配置)',
        fallbacks: [
            ...cfg.bases.slice(1).map((b, i) => {
                const idx = i + 1;
                const auth = cfg.authMode[idx];
                return `${b} [auth=${auth}]`;
            }),
            ...FALLBACK_PUBLIC_APIS.map(f => `${f.base} (公共兜底) [adapter=${f.adapter}]`)
        ],
        list,
    };
}
