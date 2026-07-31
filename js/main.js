/**
 * main.js
 * 粒子音乐播放器 — 主入口
 * 
 * 整合粒子系统、音频引擎、PillNav UI 与 OptionWheel 歌词滚动
 */

import { ParticleSystem } from './particleSystem.js';
import { AudioEngine } from './audioEngine.js';
import { searchSongs, getSongUrl, getLyric, fetchCoverAsDataUrl, checkApiAvailable, getApiSourceInfo, getCoverUrl, getSongDetail } from './ncmApi.js';

const STORAGE_KEY = 'aurora_player';

const STORAGE_DEFAULTS = {
    volume: 70,
    wave: 100,
    muted: false,
    currentIndex: -1,
};

const RECENT_PLAYLIST_KEY = 'aurora_recent';
const RECENT_MAX = 20;

const SEARCH_HISTORY_KEY = 'aurora_search_history';
const SEARCH_HISTORY_MAX = 15;

class AuroraPlayer {
    constructor() {
        this.particleSystem = null;
        this.audioEngine = null;
        this.elements = {};
        this.defaultCoverImage = null;
        this.lyricsWheel = null;
        this._savedState = { ...STORAGE_DEFAULTS };
        this.defaultCoverImage = null;
        this.lyricsWheel = null;
        this._pulseTimer = null;     // 粒子方形点击 → 面板脉冲计时器
        this._recentList = [];        // 最近播放列表
        this._progressDragging = false;
        this._lyricsHasTime = false;  // 当前歌曲是否有同步歌词（带时间戳）
        this._searchDebounce = null;  // 搜索防抖计时器
        this._apiAvailable = false;   // 网易云 API 是否可用
        this._searchHistory = [];     // 搜索历史记录

        this._init();
    }

    /* ============================================================
       初始化
       ============================================================ */
    async _init() {
        this._cacheElements();
        this._loadState();            // 从 localStorage 恢复滑块位置
        this._loadRecent();           // 加载最近播放记录
        this._loadSearchHistory();    // 加载搜索历史
        this._createDefaultCover();
        this._initSystems();
        this._applySavedState();      // 将保存的状态应用到引擎
        this._initLyricsWheel();
        this._bindEvents();
        await this._loadPlaylist();   // 从 IndexedDB 恢复播放列表
        this._renderPlaylist();       // 渲染播放列表
        const count = this.audioEngine.playlist.length;
        this._showToast(count > 0
            ? `已恢复 ${count} 首歌曲，鼠标悬停左侧控制面板`
            : '鼠标悬停左侧控制面板，导入音乐开始体验');
    }

    _cacheElements() {
        const ids = [
            'particle-canvas', 'btnPlay', 'btnPrev', 'btnNext', 'btnImport', 'btnCover',
            'btnMute', 'volumeSlider', 'waveSlider', 'btnWaveTrigger', 'btnPlaylist',
            'discVolumePopup', 'discWavePopup',
            'discPanel',
            'fileMusic', 'fileCover', 'fileLyrics',
            'progressBar', 'progressFill', 'progressHandle',
            'timeCurrent', 'timeTotal',
            'trackTitle', 'trackArtist', 'nowPlaying',
            'toast', 'lyricsWheel',
            'lyricsCover', 'lyricsCoverImg',
            'playlistDrawer', 'playlistNowPlaying', 'playlistItems', 'playlistRecent',
            'btnClosePlaylist', 'btnDrawerImport', 'btnDrawerLyrics', 'playlistCount',
            'btnOnlineSearch', 'searchOverlay', 'btnSearchClose', 'searchInput', 'searchResults',
            'searchHistory', 'searchHistoryList', 'btnClearHistory',
        ];
        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    }

    /* ============================================================
       localStorage 状态持久化
       ============================================================ */
    _loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this._savedState = { ...STORAGE_DEFAULTS, ...parsed };
            }
        } catch (_) {
            this._savedState = { ...STORAGE_DEFAULTS };
        }

        // 立即更新滑块 DOM 值（UI 先到位）
        const volSlider = this.elements['volumeSlider'];
        const waveSlider = this.elements['waveSlider'];
        if (volSlider) volSlider.value = this._savedState.volume;
        if (waveSlider) waveSlider.value = this._savedState.wave;
    }

    _applySavedState() {
        const s = this._savedState;
        if (!this.audioEngine || !this.particleSystem) return;

        // 音量
        this.audioEngine.setVolume(s.volume / 100);
        if (s.muted) this.audioEngine.isMuted = true;
        this._updateMuteIcon();

        // 波浪强度
        this.particleSystem.setWaveIntensity((s.wave / 100) * 1.5);
    }

    _saveState() {
        const state = {
            volume: parseInt(this.elements['volumeSlider']?.value) || STORAGE_DEFAULTS.volume,
            wave: parseInt(this.elements['waveSlider']?.value) || STORAGE_DEFAULTS.wave,
            muted: this.audioEngine ? this.audioEngine.isMuted : STORAGE_DEFAULTS.muted,
            currentIndex: this.audioEngine ? this.audioEngine.currentIndex : STORAGE_DEFAULTS.currentIndex,
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_) {
            // localStorage 满了或不可用，静默降级
        }
    }

    /* ============================================================
       控制面板脉冲（粒子方形点击 → 短暂激活毛玻璃状态）
       ============================================================ */
    _pulseDisc() {
        const panel = this.elements['discPanel'];
        if (!panel) return;
        panel.classList.add('ctrl-list--pulse');
        if (this._pulseTimer) clearTimeout(this._pulseTimer);
        this._pulseTimer = setTimeout(() => {
            panel.classList.remove('ctrl-list--pulse');
        }, 1500);
    }

    /* ============================================================
       最近播放管理（localStorage）
       ============================================================ */
    _loadRecent() {
        try {
            this._recentList = JSON.parse(localStorage.getItem(RECENT_PLAYLIST_KEY)) || [];
        } catch (_) {
            this._recentList = [];
        }
    }

    _saveRecent() {
        try {
            localStorage.setItem(RECENT_PLAYLIST_KEY, JSON.stringify(this._recentList.slice(0, RECENT_MAX)));
        } catch (_) { /* 静默降级 */ }
    }

    /* ============================================================
       搜索历史管理（localStorage）
       ============================================================ */
    _loadSearchHistory() {
        try {
            this._searchHistory = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
        } catch (_) {
            this._searchHistory = [];
        }
    }

    _saveSearchHistory() {
        try {
            localStorage.setItem(SEARCH_HISTORY_KEY,
                JSON.stringify(this._searchHistory.slice(0, SEARCH_HISTORY_MAX)));
        } catch (_) { /* 静默降级 */ }
    }

    /**
     * 添加搜索关键词到历史（去重 → 置顶 → 截断）
     */
    _addToSearchHistory(keyword) {
        const kw = keyword.trim();
        if (!kw) return;
        // 去重：先移除已有相同关键词
        this._searchHistory = this._searchHistory.filter(h => h.toLowerCase() !== kw.toLowerCase());
        // 置顶
        this._searchHistory.unshift(kw);
        // 截断
        if (this._searchHistory.length > SEARCH_HISTORY_MAX) {
            this._searchHistory = this._searchHistory.slice(0, SEARCH_HISTORY_MAX);
        }
        this._saveSearchHistory();
    }

    /**
     * 渲染搜索历史列表到 DOM
     */
    _renderSearchHistory() {
        const container = this.elements['searchHistory'];
        const listEl = this.elements['searchHistoryList'];
        if (!container || !listEl) return;

        if (this._searchHistory.length === 0) {
            container.classList.remove('search-history--visible');
            return;
        }

        container.classList.add('search-history--visible');
        listEl.innerHTML = this._searchHistory.map(kw =>
            `<button class="search-history__item" data-keyword="${this._escapeHtml(kw)}">${this._escapeHtml(kw)}</button>`
        ).join('');

        // 绑定点击事件
        listEl.querySelectorAll('.search-history__item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const keyword = btn.dataset.keyword;
                if (keyword) {
                    this.elements['searchInput'].value = keyword;
                    this._doSearch();
                }
            });
        });
    }

    /**
     * 清空搜索历史
     */
    _clearSearchHistory() {
        this._searchHistory = [];
        this._saveSearchHistory();
        this._renderSearchHistory();
    }

    /**
     * 清理最近播放中已不存在的歌曲记录
     */
    _cleanupRecent() {
        const playlist = this.audioEngine ? this.audioEngine.playlist : [];
        const validNames = new Set(playlist.map(t => t.name));
        this._recentList = this._recentList.filter(r => {
            // 索引必须在有效范围内，且名称能匹配
            if (r.index < 0 || r.index >= playlist.length) return false;
            return playlist[r.index].name === r.name;
        });
        this._saveRecent();
    }

    /**
     * 记录播放到最近列表
     */
    _recordRecent(index) {
        if (index < 0 || index >= this.audioEngine.playlist.length) return;
        const track = this.audioEngine.playlist[index];
        const entry = {
            name: track.name,
            index: index,
            coverArt: track.coverArt || null,
            time: Date.now(),
        };
        // 移除旧记录（同名+同索引）
        this._recentList = this._recentList.filter(
            r => !(r.name === entry.name && r.index === entry.index)
        );
        // 插入到最前
        this._recentList.unshift(entry);
        // 截断
        if (this._recentList.length > RECENT_MAX) this._recentList = this._recentList.slice(0, RECENT_MAX);
        this._saveRecent();
        this._renderPlaylist();
    }

    /* ============================================================
       播放列表渲染
       ============================================================ */
    _renderPlaylist() {
        const playlist = this.audioEngine ? this.audioEngine.playlist : [];
        const currentIdx = this.audioEngine ? this.audioEngine.currentIndex : -1;

        // --- 正在播放 ---
        const npEl = this.elements['playlistNowPlaying'];
        if (npEl) {
            if (currentIdx >= 0 && playlist[currentIdx]) {
                const t = playlist[currentIdx];
                npEl.innerHTML = this._buildPlaylistItemHTML(0, t, true, true);
            } else {
                npEl.innerHTML = '<div class="playlist-empty">暂无歌曲</div>';
            }
        }

        // --- 全部歌曲 ---
        const itemsEl = this.elements['playlistItems'];
        if (itemsEl) {
            if (playlist.length === 0) {
                itemsEl.innerHTML = '<div class="playlist-empty">导入音乐文件后显示在此处</div>';
            } else {
                itemsEl.innerHTML = playlist.map((t, i) =>
                    this._buildPlaylistItemHTML(i, t, false, i === currentIdx)
                ).join('');
            }
        }

        // --- 计数 ---
        const countEl = this.elements['playlistCount'];
        if (countEl) countEl.textContent = playlist.length > 0 ? `(${playlist.length})` : '';

        // --- 最近播放 ---
        const recentEl = this.elements['playlistRecent'];
        if (recentEl) {
            if (this._recentList.length === 0) {
                recentEl.innerHTML = '<div class="playlist-empty">暂无播放记录</div>';
            } else {
                recentEl.innerHTML = this._recentList.map((r, i) => {
                    const isCurrent = (r.index === currentIdx);
                    const timeStr = this._formatRelativeTime(r.time);
                    return `
                        <div class="playlist-item${isCurrent ? ' playlist-item-playing' : ''}" data-recent="${i}">
                            ${r.coverArt
                                ? `<img class="playlist-item-cover" src="${r.coverArt}" alt="">`
                                : `<div class="playlist-item-cover"></div>`
                            }
                            <div class="playlist-item-info">
                                <div class="playlist-item-name">${this._escapeHTML(r.name)}</div>
                                <div class="playlist-item-duration">第 ${r.index + 1} 首</div>
                            </div>
                            <span class="playlist-item-time">${timeStr}</span>
                            <button class="playlist-item-delete" data-recent="${i}" title="移出最近播放" aria-label="移出最近播放">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>`;
                }).join('');
            }
        }
    }

    _buildPlaylistItemHTML(index, track, isNowPlaying, isActive) {
        const cls = isNowPlaying ? ' playlist-item-playing' : (isActive ? ' active' : '');
        return `
            <div class="playlist-item${cls}" data-idx="${index}">
                ${track.coverArt
                    ? `<img class="playlist-item-cover" src="${track.coverArt}" alt="">`
                    : `<div class="playlist-item-cover"></div>`
                }
                <span class="playlist-item-index">${index + 1}</span>
                <div class="playlist-item-info">
                    <div class="playlist-item-name">${this._escapeHTML(track.name)}</div>
                </div>
                <button class="playlist-item-delete" data-idx="${index}" title="删除此歌曲" aria-label="删除歌曲">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>`;
    }

    _formatRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return '刚刚';
        if (mins < 60) return `${mins}分钟前`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}小时前`;
        const days = Math.floor(hours / 24);
        return `${days}天前`;
    }

    _escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _togglePlaylistDrawer() {
        const drawer = this.elements['playlistDrawer'];
        if (!drawer) return;
        const open = drawer.classList.contains('open');
        if (open) {
            drawer.classList.remove('open');
        } else {
            this._renderPlaylist();
            drawer.classList.add('open');
        }
    }

    /**
     * 从 IndexedDB 恢复播放列表（页面刷新后调用）
     */
    async _loadPlaylist() {
        try {
            const playlist = await this.audioEngine.loadFromStorage();
            if (playlist.length === 0) return;

            // 恢复上次播放的歌曲索引
            const savedIndex = this._savedState.currentIndex;
            const index = (savedIndex >= 0 && savedIndex < playlist.length) ? savedIndex : 0;

            // 初始化音频引擎（AudioContext 会处于 suspended 状态，用户交互后恢复）
            this.audioEngine.init();
            this.audioEngine.currentIndex = index;

            // 预加载音频源（不自动播放，等用户点击）
            const track = playlist[index];
            if (this.audioEngine.audioElement && track) {
                this.audioEngine.audioElement.src = track.url;
                this.audioEngine.audioElement.load();
            }

            // 触发 UI 更新（封面、歌词等）
            if (this.audioEngine.onTrackChange) {
                this.audioEngine.onTrackChange(playlist, index);
            }
        } catch (_) {
            // IndexedDB 不可用，静默降级
        }
    }

    _createDefaultCover() {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.arc(100, 100, 60, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(100, 100, 25, 0, Math.PI*2); ctx.fill();
        const img = new Image();
        img.src = canvas.toDataURL();
        this.defaultCoverImage = img;
    }

    _ensureDefaultCover() {
        return new Promise((resolve) => {
            if (this.defaultCoverImage.complete) resolve(this.defaultCoverImage);
            else this.defaultCoverImage.onload = () => resolve(this.defaultCoverImage);
        });
    }

    _initSystems() {
        this.particleSystem = new ParticleSystem(this.elements['particle-canvas']);
        this.particleSystem.setDensity(0.2);
        this.audioEngine = new AudioEngine();

        // 粒子方形点击 → 脉冲激活控制面板（短暂毛玻璃高亮）
        this.particleSystem.onSquareClick = () => this._pulseDisc();

        this.audioEngine.onTimeUpdate = (current, duration) => {
            this._updateProgress(current, duration);
        };
        this.audioEngine.onDurationChange = (duration) => {
            this.elements['timeTotal'].textContent = AudioEngine.formatTime(duration);
        };
        this.audioEngine.onPlay = () => this._setPlayState(true);
        this.audioEngine.onPause = () => this._setPlayState(false);
        this.audioEngine.onEnded = () => this.audioEngine.next();
        this.audioEngine.onTrackChange = (playlist, index) => {
            this._updateTrackInfo(playlist, index);
            this._updateLyrics(playlist, index);
            this._renderPlaylist();
            this._saveState();
            if (index >= 0) this._recordRecent(index);
        };
        this.audioEngine.onLyricsUpdate = (playlist, index) => {
            this._updateLyrics(playlist, index);
        };

        this._audioLoop();
    }

    _audioLoop() {
        const update = () => {
            requestAnimationFrame(update);
            const level = this.audioEngine.getAudioLevel();
            this.particleSystem.updateAudio(level);
            // 歌词逐句同步 + 逐字放大（每帧更新，60fps 平滑）
            if (this.lyricsWheel && this._lyricsHasTime && this.audioEngine.currentIndex >= 0) {
                this.lyricsWheel.syncToTime(this.audioEngine.getCurrentTime());
            }
        };
        update();
    }

    /* ============================================================
       OptionWheel 歌词滚动
       ============================================================ */
    _initLyricsWheel() {
        const el = this.elements['lyricsWheel'];
        if (!el) return;

        const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const cfg = {
            items: [
                { time: null, text: 'AURORA' },
                { time: null, text: '粒子音乐播放器' },
                { time: null, text: '导入音频文件' },
                { time: null, text: '开始体验' },
                { time: null, text: '沉浸式视觉' },
                { time: null, text: '波浪粒子特效' },
                { time: null, text: '三维轨道旋转' },
            ],
            fontSize: 1.5,
            spacing: 1.8,
            curve: 1,
            tilt: 7,
            blur: 1.5,
            fade: 0.22,
            minOpacity: 0.05,
            side: 'right',
            loop: false,
            smoothing: 180,
            rowH: Math.max(1.5 * 1.8 * remPx, 1),
        };

        let pos = 0;
        let target = 0;
        let selectedIdx = 0;
        let rafId = null;
        let lastTime = 0;

        const itemEls = [];
        const mirror = cfg.side === 'right' ? -1 : 1;
        const tiltRad = (cfg.tilt * Math.PI) / 180;
        const R = tiltRad > 0.0005 ? cfg.rowH / tiltRad : 0;

        // 拆字渲染：每个字独立 span，支持逐字放大
        const buildItemContent = (div, text) => {
            div.innerHTML = '';
            const chars = [...(text || '')];
            if (chars.length === 0) {
                const span = document.createElement('span');
                span.className = 'lyric-char';
                span.innerHTML = '&nbsp;';
                div.appendChild(span);
            } else {
                for (const ch of chars) {
                    const span = document.createElement('span');
                    span.className = 'lyric-char';
                    span.textContent = ch;
                    if (ch === ' ') span.style.whiteSpace = 'pre';
                    div.appendChild(span);
                }
            }
        };

        // 重置指定行所有字的放大状态
        const resetCharScale = (idx) => {
            const itemEl = itemEls[idx];
            if (!itemEl) return;
            const chars = itemEl.querySelectorAll('.lyric-char');
            chars.forEach(c => c.style.setProperty('--char-scale', '0'));
        };

        // 只清除歌词项，保留封面元素
        const existingItems = el.querySelectorAll('.lyrics-wheel__item');
        existingItems.forEach(d => d.remove());
        itemEls.length = 0;

        cfg.items.forEach((item, i) => {
            const div = document.createElement('div');
            div.className = 'lyrics-wheel__item' + (i === selectedIdx ? ' lyrics-wheel__item--selected' : '');
            div.setAttribute('role', 'option');
            div.setAttribute('aria-selected', String(i === selectedIdx));
            div.dataset.idx = i;
            buildItemContent(div, item.text);
            div.addEventListener('click', () => {
                if (_suppressClick) return;
                this._lyricsClick(i);
            });
            el.appendChild(div);
            itemEls.push(div);
        });

        const onChange = (idx, oldIdx) => {
            // 上一行的字回到原状
            if (oldIdx >= 0 && oldIdx !== idx) resetCharScale(oldIdx);
            itemEls.forEach((d, i) => {
                d.classList.toggle('lyrics-wheel__item--selected', i === idx);
                d.setAttribute('aria-selected', String(i === idx));
            });
        };

        // rAF loop
        const runFrame = (now) => {
            const dt = Math.min((now - lastTime) / 1000, 0.05);
            lastTime = now;
            const tau = Math.max(cfg.smoothing, 1) / 1000;
            const k = 1 - Math.exp(-dt / tau);

            let next = pos + (target - pos) * k;
            const settled = Math.abs(target - next) < 0.001;
            if (settled) next = target;
            pos = next;

            const n = cfg.items.length;
            for (let i = 0; i < n; i++) {
                const d = i - pos;
                const dist = Math.abs(d);
                let x = 0;
                let y = d * cfg.rowH;
                let rot = 0;
                if (R > 0) {
                    const ang = Math.max(-Math.PI/2, Math.min(Math.PI/2, d * tiltRad));
                    y = R * Math.sin(ang);
                    x = -mirror * R * (1 - Math.cos(ang)) * cfg.curve;
                    // 旋转补偿：枢轴大幅右移后，补偿系数可降低
                    x += Math.abs(rot) * 0.35;
                    rot = (mirror * ang * 180) / Math.PI;
                }
                const itemEl = itemEls[i];
                if (!itemEl) continue;
                itemEl.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`;
                itemEl.style.opacity = String(Math.max(cfg.minOpacity, 1 - dist * cfg.fade));
                itemEl.style.filter = cfg.blur > 0 ? `blur(${(dist * cfg.blur).toFixed(2)}px)` : 'none';
                itemEl.style.setProperty('--ow-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4));
            }

            rafId = settled ? null : requestAnimationFrame(runFrame);
        };

        const startLoop = () => {
            if (rafId != null) return;
            lastTime = performance.now();
            rafId = requestAnimationFrame(runFrame);
        };

        const applyTarget = (value, snap) => {
            let v = value;
            const maxIdx = Math.max(cfg.items.length - 1, 0);
            if (!cfg.loop) v = Math.min(Math.max(v, 0), maxIdx);
            if (snap) v = Math.round(v);
            target = v;
            const idx = cfg.items.length > 0 ? ((Math.round(v) % cfg.items.length) + cfg.items.length) % cfg.items.length : 0;
            if (idx !== selectedIdx) {
                const oldIdx = selectedIdx;
                selectedIdx = idx;
                onChange(idx, oldIdx);
            }
            startLoop();
        };

        // ── 用户浏览状态：手动滚动后 3 秒内暂停自动同步，方便查看歌词 ──
        let _userBrowsing = false;
        let _browseTimer = null;
        const markUserBrowse = () => {
            _userBrowsing = true;
            if (_browseTimer) clearTimeout(_browseTimer);
            _browseTimer = setTimeout(() => { _userBrowsing = false; }, 3000);
        };
        const clearUserBrowse = () => {
            _userBrowsing = false;
            if (_browseTimer) { clearTimeout(_browseTimer); _browseTimer = null; }
        };
        // 拖拽后阻止 click 误触 seek
        let _suppressClick = false;

        // Wheel scroll
        const onWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
            const step = Math.max(-1, Math.min(1, delta / cfg.rowH));
            applyTarget(target + step, false);
            markUserBrowse();
            if (this._lyricsWheelTimer) clearTimeout(this._lyricsWheelTimer);
            this._lyricsWheelTimer = setTimeout(() => applyTarget(target, true), 140);
        };
        el.addEventListener('wheel', onWheel, { passive: false });

        // Drag
        let drag = null;
        let dragMoved = false;
        const onPointerDown = (e) => {
            drag = { y: e.clientY, start: target, id: e.pointerId };
            dragMoved = false;
            _suppressClick = false;
            el.classList.add('lyrics-wheel--dragging');
        };
        const onPointerMove = (e) => {
            if (!drag) return;
            const dy = e.clientY - drag.y;
            if (!dragMoved && Math.abs(dy) > 4) {
                dragMoved = true;
                _suppressClick = true;
                el.setPointerCapture(drag.id);
            }
            if (dragMoved) {
                applyTarget(drag.start - dy / cfg.rowH, false);
                markUserBrowse();
            }
        };
        const onPointerEnd = () => {
            if (!drag) return;
            drag = null;
            el.classList.remove('lyrics-wheel--dragging');
            if (dragMoved) {
                applyTarget(target, true);
                // 延迟清除抑制标志，确保 pointerup 后的 click 被忽略
                setTimeout(() => { _suppressClick = false; }, 50);
            }
        };
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', onPointerEnd);
        el.addEventListener('pointercancel', onPointerEnd);

        // Keyboard
        el.addEventListener('keydown', (e) => {
            let delta = null;
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
            else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
            if (delta == null) return;
            e.preventDefault();
            applyTarget(Math.round(target) + delta, true);
        });

        // ── 逐字放大：根据行内播放进度更新每个字的 scale ──
        const updateCharProgress = (idx, time) => {
            const item = cfg.items[idx];
            if (!item || item.time === null || item.time === undefined) return;

            const lineStart = item.time;
            // 找下一行的时间戳作为本行结束
            let lineEnd = null;
            for (let j = idx + 1; j < cfg.items.length; j++) {
                if (cfg.items[j].time !== null && cfg.items[j].time !== undefined) {
                    lineEnd = cfg.items[j].time;
                    break;
                }
            }
            if (lineEnd === null) lineEnd = lineStart + 5;

            const lineDuration = Math.max(0.5, lineEnd - lineStart);
            const lineProgress = Math.max(0, Math.min(1, (time - lineStart) / lineDuration));

            const itemEl = itemEls[idx];
            if (!itemEl) return;
            const charEls = itemEl.querySelectorAll('.lyric-char');
            const cn = charEls.length;
            if (cn === 0) return;

            for (let i = 0; i < cn; i++) {
                // 第 i 个字在进度 i/cn 时开始放大，过渡宽度 1.0 让整行在行末刚好放大完成（与歌唱同步）
                const charProgress = Math.max(0, Math.min(1, (lineProgress * cn - i) / 1.0));
                charEls[i].style.setProperty('--char-scale', charProgress.toFixed(3));
            }
        };

        // Store for external access
        this.lyricsWheel = {
            setItems: (newItems) => {
                cfg.items = newItems || [];
                // 只清除歌词项，保留封面元素
                const existingItems = el.querySelectorAll('.lyrics-wheel__item');
                existingItems.forEach(d => d.remove());
                itemEls.length = 0;
                cfg.items.forEach((item, i) => {
                    const div = document.createElement('div');
                    div.className = 'lyrics-wheel__item' + (i === 0 ? ' lyrics-wheel__item--selected' : '');
                    div.setAttribute('role', 'option');
                    div.setAttribute('aria-selected', String(i === 0));
                    div.dataset.idx = i;
                    buildItemContent(div, item.text);
                    div.addEventListener('click', () => {
                        if (_suppressClick) return;
                        this._lyricsClick(i);
                    });
                    el.appendChild(div);
                    itemEls.push(div);
                });
                pos = 0;
                target = 0;
                selectedIdx = 0;
                applyTarget(0, true);
                // 动态调整可触控区域左边缘，与歌词最左侧对齐
                requestAnimationFrame(() => this._updateLyricsWheelBounds());
            },
            selectIndex: (idx) => applyTarget(idx, true),
            getSelectedIndex: () => selectedIdx,
            getItems: () => cfg.items,
            isUserBrowsing: () => _userBrowsing,
            markUserBrowse: () => markUserBrowse(),
            clearUserBrowse: () => clearUserBrowse(),
            syncToTime: (time) => {
                if (!cfg.items || cfg.items.length === 0) return;
                // 找到当前时间对应的行（最后一个 time <= currentTime）
                let newIdx = -1;
                for (let i = 0; i < cfg.items.length; i++) {
                    const t = cfg.items[i].time;
                    if (t !== null && t !== undefined && t <= time) {
                        newIdx = i;
                    } else if (t !== null && t !== undefined && t > time) {
                        break;
                    }
                }
                if (newIdx === -1) return;  // 还没到第一句歌词
                if (_userBrowsing) {
                    // 用户浏览中：不强制滚动，但仍更新当前播放行的逐字放大
                    updateCharProgress(newIdx, time);
                    return;
                }
                if (newIdx !== selectedIdx) {
                    applyTarget(newIdx, true);
                }
                updateCharProgress(newIdx, time);
            },
            setCoverArt: (dataUrl) => {
                const coverEl = this.elements['lyricsCover'];
                const imgEl = this.elements['lyricsCoverImg'];
                if (!coverEl || !imgEl) return;

                if (dataUrl) {
                    imgEl.src = dataUrl;
                    imgEl.classList.add('lyrics-cover-img--visible');
                    coverEl.classList.remove('lyrics-cover--hidden');
                } else {
                    imgEl.classList.remove('lyrics-cover-img--visible');
                    coverEl.classList.add('lyrics-cover--hidden');
                }
            },
        };

        applyTarget(0, false);

        // 初始状态：无封面
        const coverEl = this.elements['lyricsCover'];
        if (coverEl) coverEl.classList.add('lyrics-cover--hidden');

        // 初始可触控区域对齐
        requestAnimationFrame(() => this._updateLyricsWheelBounds());
    }

    _lyricsClick(index) {
        if (!this.lyricsWheel) return;
        const currentIdx = this.lyricsWheel.getSelectedIndex();
        const items = this.lyricsWheel.getItems();
        const item = items[index];

        if (index === currentIdx) {
            // 已居中 → 再次点击 → seek 到该歌词时段
            if (item && item.time !== null && item.time !== undefined && this.audioEngine) {
                this.audioEngine.seek(item.time);
                // seek 后恢复自动同步
                this.lyricsWheel.clearUserBrowse();
            }
        } else {
            // 未居中 → 第一次点击 → 仅滚动到中间，不 seek
            this.lyricsWheel.selectIndex(index);
            this.lyricsWheel.markUserBrowse();
        }
    }

    /**
     * 动态调整歌词区域：测量最宽歌词 → 计算 --ow-inset + wheel left
     * 确保歌词 + 旋转余量全部在毛玻璃面板内，不穿模
     */
    _updateLyricsWheelBounds() {
        const el = this.elements['lyricsWheel'];
        if (!el) return;

        const items = el.querySelectorAll('.lyrics-wheel__item');
        if (items.length === 0) return;

        // 测量最长歌词宽度
        let maxWidth = 0;
        items.forEach(item => {
            const w = item.offsetWidth;
            if (w > maxWidth) maxWidth = w;
        });
        if (maxWidth === 0) return;

        const vw = window.innerWidth;
        const maxWidthVw = maxWidth / vw * 100;       // 最长歌词占视口宽度百分比
        const tiltMarginVw = 1.5;                     // 旋转余量
        const rightMarginVw = 1;                      // wheel right: 1vw
        const minInsetVw = 3;                         // 右边缘最小留白

        // 计算所需 inset = 歌词宽度 + 旋转余量
        const requiredInset = maxWidthVw + tiltMarginVw;

        let wheelLeftPx = parseFloat(getComputedStyle(el).left) || vw * 0.6;
        let wheelWidthVw = (vw - wheelLeftPx - rightMarginVw * vw / 100) / vw * 100;

        // 如果空间不够，向左扩张 wheel 左边界
        if (requiredInset > wheelWidthVw - minInsetVw) {
            const newLeftVw = 100 - rightMarginVw - requiredInset - minInsetVw;
            el.style.left = Math.max(0, newLeftVw) + 'vw';
            wheelLeftPx = Math.max(0, newLeftVw) * vw / 100;
            wheelWidthVw = (vw - wheelLeftPx - rightMarginVw * vw / 100) / vw * 100;
        }

        // 设置 --ow-inset，保证歌词右侧锚点 → 左边缘完全可见
        const insetVw = Math.max(minInsetVw, wheelWidthVw - requiredInset);
        el.style.setProperty('--ow-inset', insetVw.toFixed(1) + 'vw');
    }

    _updateLyrics(playlist, index) {
        if (!this.lyricsWheel) return;
        if (index === -1 || !playlist[index]) {
            this.lyricsWheel.setCoverArt(null);
            this.lyricsWheel.setItems([]);
            this._lyricsHasTime = false;
            return;
        }
        const track = playlist[index];
        let lyricLines = [];

        if (track.lyrics && track.lyrics.trim()) {
            // 用 parseLRCWithTime 解析，保留时间戳用于逐句同步
            const parsed = AudioEngine.parseLRCWithTime(track.lyrics);
            lyricLines = parsed.lines;
            this._lyricsHasTime = parsed.hasTime;
        } else {
            this._lyricsHasTime = false;
            lyricLines = [
                { time: null, text: track.name },
                { time: null, text: `第 ${index + 1} / ${playlist.length} 首` },
                { time: null, text: '' },
                { time: null, text: 'AURORA' },
                { time: null, text: '粒子音乐播放器' },
            ];
        }

        this.lyricsWheel.setItems(lyricLines);
        this.lyricsWheel.setCoverArt(track.coverArt || null);

        // 如果有封面，也更新粒子方形
        if (track.coverArt) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => this.particleSystem.setCoverImage(img);
            img.src = track.coverArt;
        }
    }

    /* ============================================================
       事件绑定
       ============================================================ */
    _bindEvents() {
        // 播放/暂停
        this.elements['btnPlay'].addEventListener('click', async () => {
            if (this.audioEngine.currentIndex === -1) {
                this._showToast('请先导入音乐文件');
                return;
            }
            try { await this.audioEngine.togglePlay(); }
            catch (e) { this._showToast('播放失败，请重试'); }
        });

        this.elements['btnPrev'].addEventListener('click', () => this.audioEngine.prev());
        this.elements['btnNext'].addEventListener('click', () => this.audioEngine.next());

        // 导入音乐
        this.elements['btnImport'].addEventListener('click', () => this.elements['fileMusic'].click());
        this.elements['fileMusic'].addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            try {
                if (!this.particleSystem.coverColors) {
                    const coverReady = await this._ensureDefaultCover();
                    this.particleSystem.setCoverImage(coverReady);
                }
                await this.audioEngine.loadFiles(files);
                this._showToast(`已导入 ${files.length} 首音乐，开始播放`);
            } catch (e) { this._showToast('导入失败，请重试'); }
            e.target.value = '';
        });

        // 封面 — 用户手动上传，同步到当前曲目 + IndexedDB
        this.elements['btnCover'].addEventListener('click', () => this.elements['fileCover'].click());
        this.elements['fileCover'].addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const img = new Image();
                img.onload = async () => {
                    this.particleSystem.setCoverImage(img);
                    if (this.lyricsWheel) this.lyricsWheel.setCoverArt(dataUrl);
                    await this.audioEngine.updateTrackCoverArt(
                        this.audioEngine.currentIndex, dataUrl
                    );
                    this._showToast('专辑封面已更新并持久化');
                };
                img.onerror = () => this._showToast('封面加载失败');
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });

        // 歌词 — 导入外部 .lrc 文件
        this.elements['fileLyrics'].addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file || this.audioEngine.currentIndex === -1) {
                if (this.audioEngine.currentIndex === -1) this._showToast('请先选择一首歌曲');
                e.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = async () => {
                const lyrics = AudioEngine.parseLRC(reader.result);
                if (lyrics) {
                    await this.audioEngine.updateTrackLyrics(this.audioEngine.currentIndex, lyrics);
                    this._updateLyrics(this.audioEngine.playlist, this.audioEngine.currentIndex);
                    this._showToast(`已导入歌词（${lyrics.split(/\r?\n/).length} 行）`);
                } else {
                    this._showToast('歌词文件为空');
                }
            };
            reader.onerror = () => this._showToast('歌词文件读取失败');
            reader.readAsText(file);
            e.target.value = '';
        });

        // 音量 — 滑块事件
        this.elements['volumeSlider'].addEventListener('input', (e) => {
            const value = e.target.value / 100;
            this.audioEngine.setVolume(value);
            if (this.audioEngine.isMuted && value > 0) this.audioEngine.isMuted = false;
            this._updateMuteIcon();
            this._saveState();
        });
        this.elements['volumeSlider'].addEventListener('click', (e) => e.stopPropagation());

        // 静音按钮 — 切换静音 + 弹出/关闭音量面板
        this.elements['btnMute'].addEventListener('click', (e) => {
            e.stopPropagation();
            this.audioEngine.init();
            this.audioEngine.toggleMute();
            this._updateMuteIcon();
            this._saveState();
            this._togglePopup('discVolumePopup');
        });

        // 波浪触发按钮 — 弹出/关闭波浪面板
        this.elements['btnWaveTrigger'].addEventListener('click', (e) => {
            e.stopPropagation();
            this._togglePopup('discWavePopup');
        });

        // ── 在线搜索 ──
        // 打开搜索弹窗
        this.elements['btnOnlineSearch'].addEventListener('click', () => this._openSearch());
        this.elements['btnSearchClose'].addEventListener('click', () => this._closeSearch());
        // 点击遮罩关闭
        this.elements['searchOverlay'].addEventListener('click', (e) => {
            if (e.target === this.elements['searchOverlay']) this._closeSearch();
        });
        // ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.elements['searchOverlay'].classList.contains('search-overlay--open')) {
                this._closeSearch();
            }
        });
        // 搜索输入防抖
        this.elements['searchInput'].addEventListener('input', () => {
            clearTimeout(this._searchDebounce);
            this._searchDebounce = setTimeout(() => this._doSearch(), 400);
        });
        // 回车搜索
        this.elements['searchInput'].addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(this._searchDebounce);
                this._doSearch();
            }
        });
        // 清空搜索历史
        this.elements['btnClearHistory'].addEventListener('click', () => this._clearSearchHistory());

        // 波浪 — 滑块事件
        this.elements['waveSlider'].addEventListener('input', (e) => {
            this.particleSystem.setWaveIntensity((e.target.value / 100) * 1.5);
            this._saveState();
        });
        this.elements['waveSlider'].addEventListener('click', (e) => e.stopPropagation());

        // 进度条 — 支持拖拽实时跟随
        const progressBar = this.elements['progressBar'];
        progressBar.addEventListener('mousedown', (e) => {
            if (!this.audioEngine.audioElement || !this.audioEngine.audioElement.duration) return;
            this._progressDragging = true;
            progressBar.classList.add('progress-bar--dragging');
            const rect = progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.elements['progressFill'].style.width = (percent * 100) + '%';
            this.elements['progressHandle'].style.left = (percent * 100) + '%';
            this.elements['progressHandle'].style.transform = 'translate(-50%,-50%) scale(1)';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!this._progressDragging) return;
            if (!this.audioEngine.audioElement || !this.audioEngine.audioElement.duration) return;
            const rect = progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const dur = this.audioEngine.audioElement.duration;
            this.elements['progressFill'].style.width = (percent * 100) + '%';
            this.elements['progressHandle'].style.left = (percent * 100) + '%';
            this.elements['timeCurrent'].textContent = AudioEngine.formatTime(percent * dur);
        });
        document.addEventListener('mouseup', () => {
            if (!this._progressDragging) return;
            this._progressDragging = false;
            progressBar.classList.remove('progress-bar--dragging');
            // 执行最终的 seek
            if (this.audioEngine.audioElement && this.audioEngine.audioElement.duration) {
                const percent = parseFloat(this.elements['progressFill'].style.width) / 100;
                if (!isNaN(percent)) {
                    this.audioEngine.seek(percent * this.audioEngine.audioElement.duration);
                }
            }
            this.elements['progressHandle'].style.transform = '';
        });

        // 点击控制面板外部 → 关闭弹出滑块面板
        document.addEventListener('click', (e) => {
            const panel = this.elements['discPanel'];
            if (!panel) return;

            // 粒子方形点击已由 particleSystem.onSquareClick 处理脉冲，跳过
            if (e.target === this.elements['particle-canvas'] &&
                this.particleSystem.consumeSquareClick()) {
                this._closeAllPopups();
                return;
            }

            // 点击控制面板外部 → 关闭所有弹出面板
            const clickedInside = panel.contains(e.target);
            if (!clickedInside) {
                this._closeAllPopups();
            }
        });

        // --- 播放列表 ---
        this.elements['btnPlaylist'].addEventListener('click', (e) => {
            e.stopPropagation();
            this._togglePlaylistDrawer();
        });

        this.elements['btnClosePlaylist'].addEventListener('click', () => {
            this.elements['playlistDrawer'].classList.remove('open');
        });

        // 抽屉内导入按钮
        this.elements['btnDrawerImport'].addEventListener('click', () => {
            this.elements['fileMusic'].click();
        });

        // 抽屉内歌词导入按钮
        this.elements['btnDrawerLyrics'].addEventListener('click', () => {
            if (this.audioEngine.currentIndex === -1) {
                this._showToast('请先选择一首歌曲');
                return;
            }
            this.elements['fileLyrics'].click();
        });

        // 播放列表项点击（事件委托）
        this.elements['playlistItems'].addEventListener('click', async (e) => {
            // 删除按钮
            const delBtn = e.target.closest('.playlist-item-delete');
            if (delBtn) {
                e.stopPropagation();
                const idx = parseInt(delBtn.dataset.idx);
                if (!isNaN(idx)) {
                    const name = this.audioEngine.playlist[idx]?.name || '歌曲';
                    await this.audioEngine.removeTrack(idx);
                    this._cleanupRecent();
                    this._renderPlaylist();
                    this._saveState();
                    this._showToast(`已删除「${name}」`);
                }
                return;
            }
            // 播放
            const item = e.target.closest('.playlist-item');
            if (!item) return;
            const idx = parseInt(item.dataset.idx);
            if (!isNaN(idx)) this.audioEngine.playIndex(idx);
        });

        // 正在播放项点击
        this.elements['playlistNowPlaying'].addEventListener('click', (e) => {
            const item = e.target.closest('.playlist-item');
            if (!item) return;
            const idx = parseInt(item.dataset.idx);
            if (!isNaN(idx)) this.audioEngine.playIndex(idx);
        });

        // 最近播放项点击（切歌 / 删除）
        this.elements['playlistRecent'].addEventListener('click', (e) => {
            // 删除按钮
            const delBtn = e.target.closest('.playlist-item-delete');
            if (delBtn) {
                e.stopPropagation();
                const recentIdx = parseInt(delBtn.dataset.recent);
                if (!isNaN(recentIdx) && this._recentList[recentIdx]) {
                    const name = this._recentList[recentIdx].name;
                    this._recentList.splice(recentIdx, 1);
                    this._saveRecent();
                    this._renderPlaylist();
                    this._showToast(`已从最近播放移除「${name}」`);
                }
                return;
            }
            // 播放
            const item = e.target.closest('.playlist-item');
            if (!item) return;
            const recentIdx = parseInt(item.dataset.recent);
            if (!isNaN(recentIdx) && this._recentList[recentIdx]) {
                const trackIdx = this._recentList[recentIdx].index;
                // 验证索引仍有效
                if (trackIdx >= 0 && trackIdx < this.audioEngine.playlist.length) {
                    this.audioEngine.playIndex(trackIdx);
                } else {
                    this._showToast('该歌曲已不在播放列表中');
                }
            }
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    this.elements['btnPlay'].click();
                    break;
                case 'ArrowLeft':
                    if (e.shiftKey) this.elements['btnPrev'].click();
                    else if (this.audioEngine.audioElement) this.audioEngine.seek(this.audioEngine.getCurrentTime() - 5);
                    break;
                case 'ArrowRight':
                    if (e.shiftKey) this.elements['btnNext'].click();
                    else if (this.audioEngine.audioElement) this.audioEngine.seek(this.audioEngine.getCurrentTime() + 5);
                    break;
                case 'KeyM':
                    this.elements['btnMute'].click();
                    break;
            }
        });

        // 窗口尺寸变化 → 重新计算歌词可触控区域
        window.addEventListener('resize', () => this._updateLyricsWheelBounds());
    }

    /* ============================================================
       UI 更新
       ============================================================ */
    _setPlayState(isPlaying) {
        const btn = this.elements['btnPlay'];
        const playIcons = btn.querySelectorAll('.icon-play');
        const pauseIcons = btn.querySelectorAll('.icon-pause');

        if (isPlaying) {
            playIcons.forEach(icon => icon.style.display = 'none');
            pauseIcons.forEach(icon => icon.style.display = 'block');
            btn.setAttribute('aria-label', '暂停');
            this.particleSystem.play();
            this.elements['nowPlaying'].classList.add('active');
        } else {
            playIcons.forEach(icon => icon.style.display = 'block');
            pauseIcons.forEach(icon => icon.style.display = 'none');
            btn.setAttribute('aria-label', '播放');
            this.particleSystem.pause();
            this.elements['nowPlaying'].classList.remove('active');
        }
    }

    _updateProgress(current, duration) {
        if (!duration) return;
        if (this._progressDragging) return;  // 拖拽时不覆盖
        const percent = (current / duration) * 100;
        this.elements['progressFill'].style.width = percent + '%';
        this.elements['progressHandle'].style.left = percent + '%';
        this.elements['timeCurrent'].textContent = AudioEngine.formatTime(current);
    }

    _updateTrackInfo(playlist, index) {
        if (index === -1 || !playlist[index]) {
            this.elements['trackTitle'].textContent = '等待音乐接入';
            this.elements['trackArtist'].textContent = '导入音频文件开始体验';
            this.elements['nowPlaying'].querySelector('.np-label').textContent = '未播放';
            return;
        }
        const track = playlist[index];
        this.elements['trackTitle'].textContent = track.name;
        this.elements['trackArtist'].textContent = `第 ${index + 1} / ${playlist.length} 首`;
        this.elements['nowPlaying'].querySelector('.np-label').textContent = track.name;
    }

    _updateMuteIcon() {
        const btn = this.elements['btnMute'];
        const volumeIcon = btn.querySelector('.icon-volume');
        const muteIcon = btn.querySelector('.icon-mute');
        if (this.audioEngine.isMuted || this.audioEngine.volume === 0) {
            volumeIcon.style.display = 'none';
            muteIcon.style.display = 'block';
        } else {
            volumeIcon.style.display = 'block';
            muteIcon.style.display = 'none';
        }
    }

    /* ============================================================
       弹出面板控制
       ============================================================ */
    _togglePopup(popupId) {
        const popup = this.elements[popupId];
        if (!popup) return;

        const isOpen = popup.classList.contains('ctrl-popup--open');

        // 先关闭所有弹出面板
        this._closeAllPopups();

        // 如果之前是关闭的，则打开；如果已打开则保持关闭（toggle 效果）
        if (!isOpen) {
            popup.classList.add('ctrl-popup--open');
        }
    }

    _closeAllPopups() {
        ['discVolumePopup', 'discWavePopup'].forEach(id => {
            const el = this.elements[id];
            if (el) el.classList.remove('ctrl-popup--open');
        });
    }

    _showToast(message) {
        const toast = this.elements['toast'];
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    /* ============================================================
       在线搜索（网易云音乐）
       ============================================================ */
    async _openSearch() {
        const overlay = this.elements['searchOverlay'];
        overlay.classList.add('search-overlay--open');
        this.elements['searchInput'].value = '';
        this.elements['searchResults'].innerHTML = '<div class="search-placeholder">输入关键词开始搜索</div>';
        this._renderSearchHistory();  // 渲染搜索历史
        // 检查 API 可用性
        if (!this._apiAvailable) {
            this._apiAvailable = await checkApiAvailable();
            if (!this._apiAvailable) {
                this._renderApiUnavailable();
            }
        }
        setTimeout(() => this.elements['searchInput'].focus(), 100);
    }

    _closeSearch() {
        this.elements['searchOverlay'].classList.remove('search-overlay--open');
        this.elements['searchInput'].value = '';
        clearTimeout(this._searchDebounce);
    }

    async _doSearch() {
        const keyword = this.elements['searchInput'].value.trim();
        if (!keyword) return;

        if (!this._apiAvailable) {
            this._apiAvailable = await checkApiAvailable();
            if (!this._apiAvailable) {
                this._renderApiUnavailable();
                return;
            }
        }

        this.elements['searchResults'].innerHTML = '<div class="search-loading">搜索中…</div>';

        try {
            const songs = await searchSongs(keyword, 15);
            if (songs.length === 0) {
                this.elements['searchResults'].innerHTML =
                    '<div class="search-empty">未找到相关歌曲</div>';
                return;
            }
            this._renderSearchResults(songs);
            this._addToSearchHistory(keyword);  // 记录搜索历史
            this._renderSearchHistory();        // 刷新历史列表
        } catch (e) {
            console.error('[搜索] 失败:', e);
            this.elements['searchResults'].innerHTML =
                '<div class="search-error">搜索失败，请检查 API 服务</div>';
        }
    }

    _renderSearchResults(songs) {
        const container = this.elements['searchResults'];
        let html = '';
        songs.forEach((song, i) => {
            const duration = song.duration
                ? `${Math.floor(song.duration / 60000)}:${String(Math.floor((song.duration % 60000) / 1000)).padStart(2, '0')}`
                : '--:--';
            const coverUrl = song.coverUrl
                ? `src="${song.coverUrl}"`
                : '';
            html += `<div class="search-result-item" data-song-id="${song.id}" data-idx="${i}">
                <img class="search-result-cover" ${coverUrl} alt="" loading="lazy"
                     onerror="this.style.display='none'">
                <div class="search-result-info">
                    <div class="search-result-name">${this._escapeHtml(song.name)}</div>
                    <div class="search-result-meta">${this._escapeHtml(song.artists)} · ${this._escapeHtml(song.album)} · ${duration}</div>
                </div>
                <div class="search-result-actions">
                    <button class="search-result-btn search-result-btn--play" data-action="play" data-id="${song.id}" data-idx="${i}">播放</button>
                    <button class="search-result-btn" data-action="add" data-id="${song.id}" data-idx="${i}">添加</button>
                </div>
            </div>`;
        });
        container.innerHTML = html;

        // 异步补全缺失的封面（逐首查询，互不影响）
        songs.forEach((song, i) => {
            if (!song.coverUrl) {
                getSongDetail(song.id).then(details => {
                    if (details && details[0]) {
                        const d = details[0];
                        const rawUrl = (d.al && d.al.picUrl) || (d.album && d.album.picUrl) || (d.al && d.al.pic_str) || '';
                        if (rawUrl) {
                            song.coverUrl = getCoverUrl(rawUrl);
                            const img = container.querySelector(`[data-idx="${i}"] .search-result-cover`);
                            if (img) {
                                img.src = song.coverUrl;
                                img.style.display = '';
                            }
                        }
                    }
                }).catch(() => {});
            }
        });

        // 事件委托
        container.querySelectorAll('.search-result-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const songId = btn.dataset.id;
                const idx = parseInt(btn.dataset.idx);
                const song = songs[idx];
                if (!song) return;
                if (action === 'play') this._playOnlineSong(song);
                else if (action === 'add') this._addOnlineToPlaylist(song);
            });
        });
    }

    /**
     * 直接播放在线歌曲（加入播放列表首位并立即播放）
     */
    async _playOnlineSong(song) {
        this._closeSearch();
        this._showToast(`正在加载: ${song.name}`);

        try {
            // 获取可播放 URL
            const url = await getSongUrl(song.id);
            if (!url) {
                this._showToast('无法获取播放地址，可能是付费歌曲');
                return;
            }

            // 封面：优先用直链 URL（浏览器 <img> 直接加载最稳）
            // 如果后续要 setCoverImage（粒子需要）再 crossOrigin 加载，失败就算了
            let coverArt = getCoverUrl(song.coverUrl) || null;
            console.log('[播放] song.coverUrl:', song.coverUrl ? song.coverUrl.slice(0, 70) : 'NULL', '→ coverArt:', coverArt ? coverArt.slice(0, 70) : 'NULL');

            // 兜底：如果搜索结果没有 coverUrl，实时查 song/detail 获取
            if (!coverArt) {
                try {
                    const details = await getSongDetail(song.id);
                    if (details && details[0]) {
                        const d = details[0];
                        const rawUrl = (d.al && d.al.picUrl) || (d.album && d.album.picUrl) || (d.al && d.al.pic_str) || '';
                        if (rawUrl) {
                            coverArt = getCoverUrl(rawUrl);
                            console.log('[播放] 兜底 detail 查询成功, coverArt:', coverArt ? coverArt.slice(0, 70) : 'NULL');
                        }
                    }
                } catch (e) {
                    console.warn('[播放] 兜底 detail 查询失败:', e.message);
                }
            }

            // 构建 track 对象
            const trackEntry = {
                name: `${song.name} - ${song.artists}`,
                url: url,
                file: null,
                duration: song.duration / 1000,
                coverArt: coverArt,
                lyrics: null,
                _idbId: null,
                _online: true,
            };

            // 加入播放列表
            this.audioEngine.playlist.push(trackEntry);
            const index = this.audioEngine.playlist.length - 1;

            // 初始化音频上下文
            this.audioEngine.init();

            // 播放
            await this.audioEngine.playIndex(index);

            // 更新 UI
            if (this.lyricsWheel) this.lyricsWheel.setCoverArt(coverArt);
            if (coverArt && this.particleSystem) {
                const img = new Image();
                // 网易云 CDN (p*.music.126.net) 返回 ACAO=*，支持 CORS
                // 设 crossOrigin 后 canvas 可读取像素（粒子封面颜色）
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    console.log('[粒子] 封面加载成功:', img.width + 'x' + img.height, coverArt.slice(0, 60));
                    this.particleSystem.setCoverImage(img);
                };
                img.onerror = () => console.warn('[粒子] 封面加载失败:', coverArt.slice(0, 100));
                img.src = coverArt;
            }
            this._renderPlaylist();
            this._saveState();
            this._showToast(`正在播放: ${song.name}`);

            // 异步获取歌词
            try {
                const lyricText = await getLyric(song.id);
                if (lyricText) {
                    trackEntry.lyrics = lyricText;
                    this._updateLyrics(this.audioEngine.playlist, index);
                }
            } catch (_) { /* 歌词获取失败不影响播放 */ }
        } catch (e) {
            console.error('[在线播放] 失败:', e);
            const msg = (e && e.message) ? e.message.slice(0, 80) : '未知错误';
            this._showToast(`播放失败: ${msg}`);
        }
    }

    /**
     * 添加到播放列表（不立即播放）
     */
    async _addOnlineToPlaylist(song) {
        this._closeSearch();
        this._showToast(`已添加: ${song.name}`);

        try {
            const url = await getSongUrl(song.id);
            if (!url) {
                this._showToast('无法获取播放地址，可能是付费歌曲');
                return;
            }
            const coverArt = getCoverUrl(song.coverUrl) || null;

            const trackEntry = {
                name: `${song.name} - ${song.artists}`,
                url: url,
                file: null,
                duration: song.duration / 1000,
                coverArt: coverArt,
                lyrics: null,
                _idbId: null,
                _online: true,
            };

            this.audioEngine.playlist.push(trackEntry);
            this._renderPlaylist();

            // 异步获取歌词
            getLyric(song.id).then(lyricText => {
                if (lyricText) {
                    trackEntry.lyrics = lyricText;
                    // 如果当前是这首歌，刷新歌词
                    const idx = this.audioEngine.playlist.indexOf(trackEntry);
                    if (idx === this.audioEngine.currentIndex) {
                        this._updateLyrics(this.audioEngine.playlist, idx);
                    }
                }
            }).catch(() => {});
        } catch (e) {
            console.error('[在线添加] 失败:', e);
            this._showToast('添加失败，请重试');
        }
    }

    /**
     * 渲染 API 服务不可用提示，带重试按钮
     */
    _renderApiUnavailable() {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname || '';
        const isLocal = (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '');
        const isFileProtocol = protocol === 'file:';
        const isCloudflarePages = !isLocal && !isFileProtocol &&
            (hostname.includes('pages.dev') || hostname.includes('workers.dev'));

        // 获取当前配置的 API 源信息
        const apiInfo = getApiSourceInfo ? getApiSourceInfo() : null;
        let sourceList = '';
        if (apiInfo) {
            const allSources = [apiInfo.primary, ...apiInfo.fallbacks];
            sourceList = allSources.map((s, i) =>
                `<div class="api-source-item ${i === 0 ? 'api-source-item--primary' : ''}">${i === 0 ? '●' : '○'} ${this._escapeHtml(s)}</div>`
            ).join('');
        }

        let hint;
        if (isFileProtocol) {
            hint = `
                <div>本地使用请双击项目目录下的 <br><code>start.bat</code> 一键启动播放器</div>`;
        } else if (isCloudflarePages) {
            hint = `
                <div>已检测到部署在 Cloudflare Pages，请按以下方式配置：</div>
                <ol style="text-align:left; margin:8px 0 8px 24px; padding:0; line-height:1.8;">
                    <li><b>推荐</b>：部署 <code>functions/api.js</code> 代理（已在项目中），无需其他配置</li>
                    <li>或部署 <a href="https://github.com/harewise/meting-api-serverless" target="_blank" rel="noopener">Meting-API-Serverless</a> Worker，并配置环境变量</li>
                    <li>查看 <code>README-CLOUDFLARE.md</code> 了解完整步骤</li>
                </ol>
                ${sourceList ? `<div style="margin-top:8px; text-align:left; font-size:12px; opacity:0.7;">当前 API 源列表：<br>${sourceList}</div>` : ''}`;
        } else if (isLocal) {
            hint = `
                <div>本地开发模式，等待 API 服务启动…</div>
                <div>如果长时间未恢复，请运行 <code>node server.js</code> 或 <code>start.bat</code></div>`;
        } else {
            hint = `
                <div>所有备用 API 源均连接失败</div>
                <div style="margin-top:4px; font-size:12px; opacity:0.8;">
                  可能原因：网络问题 / 公共 API 限流或失效
                </div>
                ${sourceList ? `<div style="margin-top:8px; text-align:left; font-size:12px; opacity:0.7;">当前尝试的 API 源：<br>${sourceList}</div>` : ''}`;
        }

        this.elements['searchResults'].innerHTML = `
            <div class="search-error">
                <div class="search-error__icon">⚠</div>
                <div class="search-error__title">网易云音乐 API 暂不可用</div>
                <div class="search-error__hint">${hint}</div>
                <button class="search-error__retry" id="btnRetryApi">重新检测</button>
            </div>`;
        // 绑定重试按钮
        const retryBtn = this.elements['searchResults'].querySelector('#btnRetryApi');
        if (retryBtn) {
            retryBtn.addEventListener('click', async () => {
                retryBtn.disabled = true;
                retryBtn.textContent = '检测中…';
                this._apiAvailable = await checkApiAvailable();
                if (this._apiAvailable) {
                    this.elements['searchResults'].innerHTML = '<div class="search-placeholder">输入关键词开始搜索</div>';
                } else {
                    this._renderApiUnavailable();
                }
            });
        }
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
}

// 启动
window.addEventListener('DOMContentLoaded', () => {
    new AuroraPlayer();
});
