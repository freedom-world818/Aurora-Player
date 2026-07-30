/**
 * ncmApi.js — 网易云音乐 API 客户端
 * 使用 Cloudflare Workers 部署的 Meting-API-Serverless（统一 /api 端点 + HMAC-SHA1 鉴权）
 *
 * 端点统一为：${API_BASE}/api
 *   search → ?server=netease&type=song&keywords=xxx&auth=xxx
 *   url    → ?server=netease&type=url&id=xxx&auth=xxx
 *   lrc    → ?server=netease&type=lrc&id=xxx&auth=xxx
 *
 * auth = HMAC_SHA1(METING_TOKEN, server + type + id)
 */

const API_BASE = 'https://meting-api-serverless.3122944737.workers.dev';

// METING_TOKEN：与 Cloudflare Worker 后台配置的 METING_TOKEN 一致
// 默认值 'token' 是开源版本的自带默认值；如已修改请同步改这里
const METING_TOKEN = 'token';

/**
 * 计算 HMAC-SHA1 鉴权签名（Web Crypto API）
 * @param {string} server - 平台（netease / tencent / kugou / baidu / kuwo）
 * @param {string} type   - 接口类型（song / url / lrc / playlist / pic）
 * @param {string} id     - 资源 id（搜索时可为空字符串）
 * @returns {Promise<string>} 16 进制签名字符串
 */
async function makeAuth(server, type, id) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(METING_TOKEN),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(server + type + id));
    return Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * 把任意响应解析成数组（兼容 Meting 直接数组 / {data:[...]} / {result:{songs:[...]}}）
 */
function toArray(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && data.result && Array.isArray(data.result.songs)) return data.result.songs;
    return [];
}

/**
 * 搜索歌曲
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 返回数量，默认 20
 * @returns {Promise<Array>} 歌曲列表 [{id, name, artists, album, duration, coverUrl, ...}]
 */
export async function searchSongs(keyword, limit = 20) {
    const server = 'netease';
    const type = 'song';
    const auth = await makeAuth(server, type, '');
    const params = new URLSearchParams({ server, type, keywords: keyword, auth });
    const res = await fetch(`${API_BASE}/api?${params}`);
    if (!res.ok) throw new Error(`搜索失败 (HTTP ${res.status})`);
    const data = await res.json();
    const list = toArray(data);

    return list.slice(0, limit).map(song => {
        // 兼容 Meting 单字符串 artist 与标准格式 artists:[{name}]
        const artists = song.artist
            || (Array.isArray(song.artists) ? song.artists.map(a => a.name).join(' / ') : '')
            || (Array.isArray(song.ar) ? song.ar.map(a => a.name).join(' / ') : '');
        const albumName = song.album
            || (song.album && song.album.name)
            || (song.al && song.al.name)
            || '';
        const coverUrl = song.pic_url
            || (song.album && song.album.picUrl)
            || (song.al && song.al.picUrl)
            || '';

        return {
            id: song.id,
            name: song.name,
            artists: artists,
            album: albumName,
            albumId: (song.album && song.album.id) || (song.al && song.al.id) || 0,
            duration: song.duration || 0,
            coverUrl: coverUrl,
        };
    });
}

/**
 * 获取歌曲可播放 URL
 * @param {number|string} id - 歌曲 ID
 * @returns {Promise<string|null>} 可播放 URL，或 null
 */
export async function getSongUrl(id) {
    const server = 'netease';
    const type = 'url';
    const idStr = String(id);
    const auth = await makeAuth(server, type, idStr);
    const params = new URLSearchParams({ server, type, id: idStr, auth });
    const res = await fetch(`${API_BASE}/api?${params}`);
    if (!res.ok) throw new Error(`获取歌曲 URL 失败 (HTTP ${res.status})`);

    const raw = await res.text();
    // Meting 可能返回纯文本 URL，也可能是 JSON
    const trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    try {
        const data = JSON.parse(trimmed);
        const list = toArray(data);
        const song = list.find(u => String(u.id) === idStr);
        if (song && song.url) return song.url;
        if (data && data.data && data.data[0] && data.data[0].url) return data.data[0].url;
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * 获取歌曲详情（已不再需要，保留为占位以兼容旧引用；返回 null）
 */
export async function getSongDetail(id) {
    // Meting-API-Serverless 不提供独立 song detail 接口；
    // 封面、专辑等信息已包含在 searchSongs 返回值中
    return null;
}

/**
 * 获取歌词
 * @param {number|string} id - 歌曲 ID
 * @returns {Promise<string|null>} LRC 格式歌词文本
 */
export async function getLyric(id) {
    const server = 'netease';
    const type = 'lrc';
    const idStr = String(id);
    const auth = await makeAuth(server, type, idStr);
    const params = new URLSearchParams({ server, type, id: idStr, auth });
    const res = await fetch(`${API_BASE}/api?${params}`);
    if (!res.ok) throw new Error(`获取歌词失败 (HTTP ${res.status})`);

    const raw = await res.text();
    const trimmed = raw.trim();
    // 纯文本 LRC（包含 [00:xx.xx] 时间标签）
    if (trimmed.startsWith('[') && /\[\d{1,2}:\d{2}/.test(trimmed)) {
        return trimmed;
    }
    // JSON 格式兜底
    try {
        const data = JSON.parse(trimmed);
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
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (_) {
        return null;
    }
}

/**
 * 获取封面图片 URL（http → https 升级）
 * @param {string} coverUrl - 原始封面 URL
 * @returns {string} 可直接使用的 URL
 */
export function getCoverUrl(coverUrl) {
    if (!coverUrl) return '';
    return coverUrl.replace(/^http:/, 'https:');
}

/**
 * 健康检查：测试 API 服务是否可达
 * @returns {Promise<boolean>}
 */
export async function checkApiAvailable() {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        const auth = await makeAuth('netease', 'song', '');
        const params = new URLSearchParams({ server: 'netease', type: 'song', keywords: 'test', auth });
        const res = await fetch(`${API_BASE}/api?${params}`, { signal: ctrl.signal });
        clearTimeout(timer);
        return res.ok;
    } catch (_) {
        return false;
    }
}