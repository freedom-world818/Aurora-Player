/**
 * ncmApi.js — 网易云音乐 API 客户端
 * 自动检测运行环境：通过 local server 则用相对路径，file:// 直开则连 localhost:3000
 */

const API_BASE = (typeof location !== 'undefined' && location.protocol === 'file:')
    ? 'http://localhost:3000'
    : '';

/**
 * 搜索歌曲
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 返回数量，默认 20
 * @returns {Promise<Array>} 歌曲列表 [{id, name, artists, album, duration, ...}]
 */
export async function searchSongs(keyword, limit = 20) {
    const params = new URLSearchParams({ keywords: keyword, limit: String(limit), type: '1' });
    const res = await fetch(`${API_BASE}/search?${params}`);
    if (!res.ok) throw new Error(`搜索失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (data.code !== 200) throw new Error(data.message || '搜索接口返回异常');

    const songs = (data.result?.songs || []).map(song => {
        const artists = (song.artists || song.ar || []).map(a => a.name).join(' / ');
        const album = song.album || song.al || {};
        const albumName = album.name || '';

        return {
            id: song.id,
            name: song.name,
            artists: artists,
            album: albumName,
            albumId: album.id || 0,
            duration: song.duration || 0,
            coverUrl: '',  // 下面批量回填
        };
    });

    // 批量获取封面：一次请求 /song/detail 拿到所有歌曲的真实 picUrl
    if (songs.length > 0) {
        const ids = songs.map(s => s.id).join(',');
        try {
            const detailRes = await fetch(`${API_BASE}/song/detail?ids=${ids}`);
            if (detailRes.ok) {
                const detailData = await detailRes.json();
                if (detailData.code === 200 && detailData.songs) {
                    const picMap = {};
                    detailData.songs.forEach(s => {
                        const url = (s.al?.picUrl || '').replace(/\?param=\d+y\d+/, '?param=200y200');
                        if (url) picMap[s.id] = url;
                    });
                    songs.forEach(s => {
                        s.coverUrl = picMap[s.id] || '';
                    });
                }
            }
        } catch (_) {
            // 封面获取失败不阻塞，保持 coverUrl 为空
        }
    }

    return songs;
}

/**
 * 获取歌曲可播放 URL（优先 320k mp3）
 * @param {number|string} id - 歌曲 ID
 * @returns {Promise<string|null>} 可播放 URL，或 null
 */
export async function getSongUrl(id) {
    const params = new URLSearchParams({ id: String(id), level: 'standard' });
    const res = await fetch(`${API_BASE}/song/url/v1?${params}`);
    if (!res.ok) throw new Error(`获取歌曲 URL 失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (data.code !== 200) return null;

    const urls = data.data || [];
    const song = urls.find(u => u.id === Number(id));
    return song?.url || null;
}

/**
 * 获取歌曲详情
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
export async function getSongDetail(id) {
    const params = new URLSearchParams({ ids: String(id) });
    const res = await fetch(`${API_BASE}/song/detail?${params}`);
    if (!res.ok) throw new Error(`获取歌曲详情失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (data.code !== 200) return null;

    const songs = data.songs || [];
    return songs[0] || null;
}

/**
 * 获取歌词
 * @param {number|string} id - 歌曲 ID
 * @returns {Promise<string|null>} LRC 格式歌词文本
 */
export async function getLyric(id) {
    const params = new URLSearchParams({ id: String(id) });
    const res = await fetch(`${API_BASE}/lyric?${params}`);
    if (!res.ok) throw new Error(`获取歌词失败 (HTTP ${res.status})`);
    const data = await res.json();
    if (data.code !== 200) return null;

    return data.lrc?.lyric || null;
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
 * 获取封面图片的代理 URL（通过网易云 API 的图片代理）
 * @param {string} coverUrl - 原始封面 URL
 * @returns {string} 可直接使用的 URL
 */
export function getCoverUrl(coverUrl) {
    // 网易云的封面 URL 通常是 http://p3.music.126.net/... 或 http://p4.music.126.net/...
    // NeteaseCloudMusicApi 会处理跨域，通常直接可用
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
        const res = await fetch(`${API_BASE}/search?keywords=test&limit=1`, { signal: ctrl.signal });
        clearTimeout(timer);
        return res.ok;
    } catch (_) {
        return false;
    }
}
