// ==UserScript==
// @name:zh-CN   动漫花园种子屏蔽助手
// @name         DMHY Torrent Block
// @namespace    https://github.com/kaseidis/dmhy-torrent-block-kk
// @version      2.0.1
// @author       kaseidis
// @description  Local-only DMHY filtering with a modern, readable interface
// @description:zh-CN  仅本地运行的动漫花园资源屏蔽与页面美化工具。
// @homepage     https://github.com/kaseidis/dmhy-torrent-block-kk
// @supportURL   https://github.com/kaseidis/dmhy-torrent-block-kk/issues
// @match        *://share.dmhy.org/*
// @license      MIT
// @run-at       document-start
// @webRequest   {"selector":"*://atanx.alicdn.com/t/tanxssp.js*","action":"cancel"}
// @grant        GM_setValue
// @grant        GM_getValue
// @noframes
// @copyright    2026, kaseidis
// @originalAuthor xkbkx5904
// @originalURL  https://github.com/xkbkx5904/dmhy-torrent-block
// @icon         https://share.dmhy.org/favicon.ico
// @require      https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js
// ==/UserScript==

/*
 * 增强版脚本的本地维护 fork
 * - 增强版原作者：xkbkx5904
 * - 本地版作者：kaseidis
 * - 列表页和详情页使用独立的样式作用域
 * - 保留本地黑名单、标题转换、右键屏蔽与广告隐藏
 */

/**
 * 配置对象
 */
const CONFIG = {
    // 存储相关配置
    storage: {
        blockListKey: 'dmhy_blocklist',
        usernameMapKey: 'dmhy_username_map'
    },

    // DOM选择器配置
    selectors: {
        torrentList: "table#topic_list tbody tr",
        userLink: "td:last-child a[href*='/user_id/']",
        titleCell: "td.title",
        adSelectors: [
            '[id="1280_adv"]',
            '[id="1280_ad"]',
            '[id="ai"]',
            '[id="pkpk"]',
            '.ad',
            '.kiwi-ad-wrapper-1280x120',
            '.kiwi-ad-wrapper-950x80',
            'a[onclick*="_trackEvent"][onclick*="ad"]',
            'a[href*="mypikpak.com/drive/url-checker"]',
            'div[align="center"] > a[href*="sng.link"] > img',
            'div[align="center"] > a[href*="weidian.com"] > img[src*="/1280pik.png"]',
            'img[src*="/VA"][src*=".gif"]',
            '.download-pp'
        ]
    },

    // 缓存配置
    cache: {
        textConverterSize: 200
    },

    // 已知推广脚本。仅匹配明确的主机和路径，避免误伤站点功能脚本。
    blockedScripts: [
        /^https?:\/\/atanx\.alicdn\.com\/t\/tanxssp\.js(?:[?#]|$)/i
    ]
};

/**
 * 样式配置
 */
const STYLES = {
    blocklistUI: `
        position: fixed;
        left: 10px;
        top: 10px;
        z-index: 9999;
    `,
    manager: `
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%,-50%);
        background: white;
        padding: 20px;
        border: 1px solid #ccc;
        border-radius: 5px;
        z-index: 10000;
        width: 500px;
        max-height: 80vh;
        overflow-y: auto;
    `
};

/**
 * 缓存管理类
 */
class CacheManager {
    constructor() {
        this.caches = new Map();
        this.maxSize = CONFIG.cache.textConverterSize;
    }

    get(cacheName, key) {
        const cache = this.caches.get(cacheName);
        return cache?.get(key);
    }

    set(cacheName, key, value) {
        if (!this.caches.has(cacheName)) {
            this.caches.set(cacheName, new Map());
        }
        const cache = this.caches.get(cacheName);
        
        if (cache.size >= this.maxSize) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        cache.set(key, value);
    }
}

/**
 * 工具类
 */
class Utils {
    static cacheManager = new CacheManager();
    static opencc = {
        s2t: null,
        s2hk: null,
        t2s: null
    };

    static async init() {
        try {
            this.opencc = {
                s2t: await OpenCC.Converter({ from: 'cn', to: 'tw' }),
                s2hk: await OpenCC.Converter({ from: 'cn', to: 'hk' }),
                t2s: await OpenCC.Converter({ from: 'tw', to: 'cn' })
            };
        } catch (error) {
            this.handleError(error, 'Utils.init');
        }
    }

    static handleError(error, context) {
        console.warn(`[DMHY Block] Error in ${context}:`, error);
    }

    static log(message, type = 'info') {
        const prefix = '[DMHY Block]';
        switch (type) {
            case 'info':
                console.log(`${prefix} ${message}`);
                break;
            case 'warn':
                console.warn(`${prefix} ${message}`);
                break;
            case 'error':
                console.error(`${prefix} ${message}`);
                break;
            case 'debug':
                console.debug(`${prefix} ${message}`);
                break;
        }
    }

    static convertText(text) {
        if (!text) return {
            original: '',
            simplified: '',
            traditionalTW: '',
            traditionalHK: ''
        };

        const cached = this.cacheManager.get('textConverter', text);
        if (cached) return cached;

        try {
            const result = {
                original: text,
                simplified: this.opencc.t2s?.(text) || text,
                traditionalTW: this.opencc.s2t?.(text) || text,
                traditionalHK: this.opencc.s2hk?.(text) || text
            };

            this.cacheManager.set('textConverter', text, result);
            return result;
        } catch (error) {
            this.handleError(error, 'Utils.convertText');
            return {
                original: text,
                simplified: text,
                traditionalTW: text,
                traditionalHK: text
            };
        }
    }

    static parseKeyword(keyword) {
        if (typeof keyword === 'string' && keyword.startsWith('/') && keyword.endsWith('/')) {
            try {
                return new RegExp(keyword.slice(1, -1));
            } catch (e) {
                return keyword;
            }
        }
        return keyword;
    }

}

/**
 * 黑名单管理类
 */
class BlockListManager {
    constructor() {
        Utils.log('初始化黑名单管理器');
        this.blockList = [];
        this.userNameMap = new Map();
    }

    async init() {
        Utils.log('加载黑名单数据');
        await this.loadBlockList();
        const savedUserNames = GM_getValue(CONFIG.storage.usernameMapKey, {});
        this.userNameMap = new Map(Object.entries(savedUserNames));
        Utils.log(`已加载 ${this.userNameMap.size} 个用户名映射`);
    }

    async loadBlockList() {
        try {
            const saved = GM_getValue(CONFIG.storage.blockListKey, []);
            this.blockList = Array.isArray(saved) ? saved.map(item => {
                if (item.type === 'keywords') {
                    return {
                        type: 'keywords',
                        values: item.values.map(Utils.parseKeyword)
                    };
                }
                return item;
            }) : [];
            Utils.log(`已加载 ${this.blockList.length} 条黑名单规则`);
        } catch (error) {
            Utils.handleError(error, 'BlockListManager.loadBlockList');
            this.blockList = [];
        }
    }

    saveBlockList() {
        try {
            const listToSave = this.blockList.map(item => ({
                ...item,
                values: item.type === 'keywords'
                    ? item.values.map(k => k instanceof RegExp ? `/${k.source}/` : k)
                    : item.values
            }));
            GM_setValue(CONFIG.storage.blockListKey, listToSave);
            Utils.log('黑名单数据已保存');
        } catch (error) {
            Utils.handleError(error, 'BlockListManager.saveBlockList');
        }
    }

    addUser(userId, userName) {
        if (!userId || isNaN(userId)) {
            Utils.log(`无效的用户ID: ${userId}`, 'warn');
            return false;
        }

        const userIdList = this.getUserIds();
        if (!userIdList.includes(userId)) {
            this.updateBlockList('userId', [...userIdList, userId]);
            if (userName) {
                this.userNameMap.set(userId.toString(), userName);
                this.saveUserNameMap();
                Utils.log(`已添加用户: ${userName}(${userId})`);
            }
            return true;
        }
        Utils.log(`用户 ${userId} 已在黑名单中`, 'debug');
        return false;
    }

    getUserIds() {
        return this.blockList.find(item => item.type === 'userId')?.values || [];
    }

    getKeywords() {
        return this.blockList.find(item => item.type === 'keywords')?.values || [];
    }

    updateBlockList(type, values) {
        const index = this.blockList.findIndex(item => item.type === type);
        if (index >= 0) {
            this.blockList[index].values = values;
        } else {
            this.blockList.push({ type, values });
        }
        this.saveBlockList();
    }

    saveUserNameMap() {
        GM_setValue(CONFIG.storage.usernameMapKey, Object.fromEntries(this.userNameMap));
    }

    async getUserName(userId, forceUpdate = false) {
        if (!userId) return null;

        const userIdStr = userId.toString();
        const cachedName = this.userNameMap.get(userIdStr);
        
        if (cachedName && !forceUpdate) return cachedName;

        const userLink = document.querySelector(`a[href="/topics/list/user_id/${userId}"]`);
        if (userLink) {
            const userName = userLink.textContent;
            if (userName) {
                this.userNameMap.set(userIdStr, userName);
                this.saveUserNameMap();
                return userName;
            }
        }

        return new Promise(resolve => {
            const callback = async () => {
                try {
                    const response = await fetch(`https://share.dmhy.org/topics/list/user_id/${userId}`);
                    const text = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'text/html');
                    const userName = doc.querySelector(`a[href="/topics/list/user_id/${userId}"]`)?.textContent;

                    if (userName) {
                        this.userNameMap.set(userIdStr, userName);
                        this.saveUserNameMap();
                        resolve(userName);
                    } else {
                        resolve(userIdStr);
                    }
                } catch (error) {
                    Utils.handleError(error, 'BlockListManager.getUserName');
                    resolve(userIdStr);
                }
            };

            if (window.requestIdleCallback) {
                requestIdleCallback(() => callback(), { timeout: 5000 });
            } else {
                setTimeout(callback, 0);
            }
        });
    }
}

/**
 * 标题管理类
 */
class TitleManager {
    constructor() {
        this.displayMode = GM_getValue('dmhy_title_display_mode', 'original');
    }

    init() {
        this.saveOriginalHTML();
        this.updateAllTitles();
    }

    saveOriginalHTML() {
        document.querySelectorAll(CONFIG.selectors.titleCell).forEach(cell => {
            if (!cell.hasAttribute('data-original-html')) {
                cell.setAttribute('data-original-html', cell.innerHTML);
            }
        });
    }

    getDisplayModeText() {
        switch (this.displayMode) {
            case 'simplified':
                return '简体';
            case 'traditional':
                return '繁体';
            default:
                return '原文';
        }
    }

    toggleTitleDisplay() {
        const modes = ['original', 'simplified', 'traditional'];
        const currentIndex = modes.indexOf(this.displayMode);
        this.displayMode = modes[(currentIndex + 1) % modes.length];
        GM_setValue('dmhy_title_display_mode', this.displayMode);
        this.updateAllTitles();
    }

    // 判断文本是否需要转换
    shouldConvertText(text) {
        // 如果文本只包含英文、数字、特殊字符，不需要转换
        if (!/[\u4e00-\u9fa5]/.test(text)) {
            return false;
        }
        return true;
    }

    // 智能分割文本，保留英文和特殊字符
    splitText(text) {
        const parts = [];
        let currentPart = '';
        let isChinese = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const isCharChinese = /[\u4e00-\u9fa5]/.test(char);
            
            if (isCharChinese !== isChinese) {
                if (currentPart) {
                    parts.push({
                        text: currentPart,
                        needConvert: isChinese
                    });
                }
                currentPart = char;
                isChinese = isCharChinese;
            } else {
                currentPart += char;
            }
        }

        if (currentPart) {
            parts.push({
                text: currentPart,
                needConvert: isChinese
            });
        }

        return parts;
    }

    updateAllTitles() {
        document.querySelectorAll(CONFIG.selectors.titleCell).forEach(cell => {
            if (this.displayMode === 'original') {
                const originalHTML = cell.getAttribute('data-original-html');
                if (originalHTML) {
                    cell.innerHTML = originalHTML;
                }
                return;
            }

            if (!cell.hasAttribute('data-original-html')) {
                cell.setAttribute('data-original-html', cell.innerHTML);
            }

            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }

            textNodes.forEach(textNode => {
                const originalText = textNode.textContent;
                
                // 如果文本不需要转换，直接跳过
                if (!this.shouldConvertText(originalText)) {
                    return;
                }

                // 智能分割文本
                const parts = this.splitText(originalText);
                let newText = '';

                parts.forEach(part => {
                    if (part.needConvert) {
                        const { simplified, traditionalTW } = Utils.convertText(part.text);
                        newText += this.displayMode === 'simplified' ? simplified : traditionalTW;
                    } else {
                        newText += part.text;
                    }
                });

                textNode.textContent = newText;
            });
        });
    }

    shouldHideByTitle(title, blockedKeywords) {
        const { original, simplified, traditionalTW, traditionalHK } = Utils.convertText(title);

        return blockedKeywords.some(keyword => {
            if (typeof keyword === 'string') {
                const keywordVariants = Utils.convertText(keyword);
                const lowerKeyword = keyword.toLowerCase();

                return [original, simplified, traditionalTW, traditionalHK].some(variant =>
                    variant.toLowerCase().includes(lowerKeyword) ||
                    variant.toLowerCase().includes(keywordVariants.simplified.toLowerCase()) ||
                    variant.toLowerCase().includes(keywordVariants.traditionalTW.toLowerCase()) ||
                    variant.toLowerCase().includes(keywordVariants.traditionalHK.toLowerCase())
                );
            }
            return keyword instanceof RegExp && (
                original.match(keyword) ||
                simplified.match(keyword) ||
                traditionalTW.match(keyword) ||
                traditionalHK.match(keyword)
            );
        });
    }
}

/**
 * 过滤管理类
 */
class FilterManager {
    constructor(blockListManager, titleManager) {
        Utils.log('初始化过滤管理器');
        this.blockListManager = blockListManager;
        this.titleManager = titleManager;
    }

    init() {
        Utils.log('应用过滤规则');
        this.applyFilters();
    }

    applyFilters() {
        try {
            document.querySelectorAll(`${CONFIG.selectors.torrentList}[style*='display: none']`)
                .forEach(elem => elem.style.display = '');

            if (!this.blockListManager.blockList.length) {
                Utils.log('没有黑名单规则，跳过过滤');
                return;
            }

            const blockedUserIds = this.blockListManager.getUserIds();
            const blockedKeywords = this.blockListManager.getKeywords();

            if (!blockedUserIds.length && !blockedKeywords.length) {
                Utils.log('黑名单为空，跳过过滤');
                return;
            }

            Utils.log(`开始过滤: ${blockedUserIds.length} 个用户ID, ${blockedKeywords.length} 个关键词`);
            this.filterTorrentList(blockedUserIds, blockedKeywords);
        } catch (error) {
            Utils.handleError(error, 'FilterManager.applyFilters');
        }
    }

    filterTorrentList(blockedUserIds, blockedKeywords) {
        let n = 0; // 用于设置行的奇偶样式

        document.querySelectorAll(CONFIG.selectors.torrentList).forEach(elem => {
            try {
                const { title, userId } = this.extractItemInfo(elem);
                if (!title || !userId) return;

                if (this.shouldHideItem(userId, title, blockedUserIds, blockedKeywords)) {
                    elem.style.display = 'none'; // 隐藏元素而不是删除
                } else {
                    elem.style.display = ''; // 确保元素可见
                    // 设置奇偶行样式
                    elem.className = n % 2 === 0 ? 'even' : 'odd';
                    n++;
                }
            } catch (error) {
                Utils.handleError(error, 'FilterManager.filterTorrentList.item');
            }
        });

        this.titleManager.updateAllTitles();
    }

    extractItemInfo(elem) {
        const titleCell = elem.querySelector(CONFIG.selectors.titleCell);
        const title = titleCell ? Array.from(titleCell.childNodes)
            .map(node => node.textContent?.trim())
            .filter(text => text)
            .join(' ') : '';

        const idMatch = elem.querySelector(CONFIG.selectors.userLink)?.href?.match(/user_id\/(\d+)/);
        const userId = idMatch ? parseInt(idMatch[1]) : null;

        return { title, userId };
    }

    shouldHideItem(userId, title, blockedUserIds, blockedKeywords) {
        if (blockedUserIds.includes(userId)) return true;
        return this.titleManager.shouldHideByTitle(title, blockedKeywords);
    }
}

/**
 * UI管理类
 */
class UIManager {
    constructor(blockListManager, filterManager, titleManager) {
        this.blockListManager = blockListManager;
        this.filterManager = filterManager;
        this.titleManager = titleManager;
        this.uiTexts = {
            manageButton: '管理种子黑名单',
            toggleButton: '切换标题显示：',
            simplified: '简体',
            traditional: '繁体',
            original: '原文',
            blockedUsers: '已屏蔽用户：',
            titleKeywords: '标题关键词（用分号分隔）：',
            keywordTips: [
                '提示：支持普通关键词和正则表达式',
                '- 普通关键词直接输入，用分号分隔',
                '- 正则表达式用 / 包裹，例如：/\\d+话/',
                '- 示例：关键词1；/\\d+话/；关键词2'
            ],
            userIdTips: [
                '提示：用户ID输入规则：',
                '- 支持纯数字ID，如：123456',
                '- 支持用户名(ID)格式，如：用户名(123456)',
                '- 多个ID之间用分号分隔'
            ],
            save: '保存',
            close: '关闭'
        };
    }

    init() {
        this.addBlocklistUI();
        this.addContextMenu();
    }

    getDisplayModeText() {
        return this.titleManager.getDisplayModeText();
    }

    convertText(text) {
        if (this.titleManager.displayMode === 'original') {
            return text;
        }
        const { simplified, traditionalTW } = Utils.convertText(text);
        return this.titleManager.displayMode === 'simplified' ? simplified : traditionalTW;
    }

    convertTextArray(texts) {
        return texts.map(text => this.convertText(text));
    }

    updateUITexts() {
        const showBlocklistBtn = document.getElementById('show-blocklist');
        const toggleTitleBtn = document.getElementById('toggle-title-display');
        
        if (showBlocklistBtn) {
            showBlocklistBtn.textContent = this.convertText(this.uiTexts.manageButton);
        }
        if (toggleTitleBtn) {
            toggleTitleBtn.textContent = this.convertText(this.uiTexts.toggleButton) + this.getDisplayModeText();
        }
    }

    toggleTitleDisplay() {
        this.titleManager.toggleTitleDisplay();
        this.updateUITexts();
    }

    addBlocklistUI() {
        // 如果已经存在UI，先移除
        const existingUI = document.getElementById('dmhy-blocklist-ui');
        if (existingUI) {
            existingUI.remove();
        }

        const uiHtml = `
            <div id="dmhy-blocklist-ui" style="${STYLES.blocklistUI}">
                <button id="show-blocklist">${this.convertText(this.uiTexts.manageButton)}</button>
                <button id="toggle-title-display" style="margin-left:10px;">${this.convertText(this.uiTexts.toggleButton)}${this.getDisplayModeText()}</button>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', uiHtml);

        // 确保在DOM加载完成后再绑定事件
        setTimeout(() => {
            const showBlocklistBtn = document.getElementById('show-blocklist');
            const toggleTitleBtn = document.getElementById('toggle-title-display');
            
            showBlocklistBtn?.addEventListener('click', () => this.showBlocklistManager());
            toggleTitleBtn?.addEventListener('click', () => this.toggleTitleDisplay());
        }, 0);
    }

    async showBlocklistManager() {
        // 如果已经存在管理界面，先移除
        const existingManager = document.getElementById('blocklist-manager');
        const existingOverlay = document.getElementById('blocklist-overlay');
        if (existingManager) existingManager.remove();
        if (existingOverlay) existingOverlay.remove();

        const managerHtml = `
            <div id="blocklist-manager" style="${STYLES.manager}">
                <h3 style="margin-top:0;">${this.convertText(this.uiTexts.manageButton)}</h3>
                <div style="margin-bottom:10px;">
                    <label>${this.convertText(this.uiTexts.blockedUsers)}</label><br>
                    <textarea id="user-ids" style="width:100%;height:100px;margin-top:5px;resize:none;border:1px solid #ccc;"></textarea>
                    <div id="user-ids-error" style="color:red;font-size:12px;margin-top:3px;display:none;"></div>
                </div>
                <div style="margin-bottom:10px;">
                    <label>${this.convertText(this.uiTexts.titleKeywords)}</label><br>
                    <textarea id="keywords" style="width:100%;height:100px;margin-top:5px;resize:none;border:1px solid #ccc;"></textarea>
                    <div id="keywords-error" style="color:red;font-size:12px;margin-top:3px;display:none;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;color:#666;font-size:12px;margin-top:5px;">
                    <div style="flex:1;margin-right:10px;">
                        ${this.convertTextArray(this.uiTexts.keywordTips).join('<br>')}
                    </div>
                    <div style="flex:1;margin-left:10px;">
                        ${this.convertTextArray(this.uiTexts.userIdTips).join('<br>')}
                    </div>
                </div>
                <div style="margin-top:10px;text-align:right;">
                    <button id="save-blocklist" style="padding:5px 15px;">${this.convertText(this.uiTexts.save)}</button>
                    <button id="close-manager" style="padding:5px 15px;margin-left:10px;">${this.convertText(this.uiTexts.close)}</button>
                </div>
            </div>
            <div id="blocklist-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;"></div>
        `;
        document.body.insertAdjacentHTML('beforeend', managerHtml);

        this.initManagerEvents();
        this.fillManagerData();
    }

    initManagerEvents() {
        const closeManager = () => {
            if (this.hasUnsavedChanges()) {
                if (confirm('有未保存的更改，确定要关闭吗？')) {
                    document.getElementById('blocklist-manager')?.remove();
                    document.getElementById('blocklist-overlay')?.remove();
                }
            } else {
                document.getElementById('blocklist-manager')?.remove();
                document.getElementById('blocklist-overlay')?.remove();
            }
        };

        document.getElementById('close-manager')?.addEventListener('click', closeManager);

        document.getElementById('blocklist-overlay')?.addEventListener('click', e => {
            if (e.target === e.currentTarget) {
                closeManager();
            }
        });

        document.getElementById('save-blocklist')?.addEventListener('click', async () => {
            const saveResult = await this.saveManagerData();
            if (saveResult) {
                closeManager();
                this.filterManager.applyFilters();
            }
        });

        document.getElementById('user-ids')?.addEventListener('input', () => {
            this.validateManagerData();
        });

        document.getElementById('keywords')?.addEventListener('input', () => {
            this.validateManagerData();
        });
    }

    fillManagerData() {
        const keywords = this.blockListManager.getKeywords();
        const keywordsText = keywords.map(k => {
            if (k instanceof RegExp) {
                return `/${k.source}/`;
            }
            return k;
        }).join('；');

        // 如果有关键词，在末尾添加分号
        document.getElementById('keywords').value = keywordsText ? keywordsText + '；' : '';

        // 获取用户ID列表并在末尾添加分号
        const userIds = this.blockListManager.getUserIds()
            .map(id => {
                const name = this.blockListManager.userNameMap.get(id.toString());
                return name ? `${name}(${id})` : id;
            })
            .join('；');

        document.getElementById('user-ids').value = userIds ? userIds + '；' : '';

        // 异步更新缺失的用户名
        this.updateMissingUserNames();
    }

    async updateMissingUserNames() {
        const userIds = this.blockListManager.getUserIds();
        const missingIds = userIds.filter(id => !this.blockListManager.userNameMap.has(id.toString()));

        if (missingIds.length > 0) {
            for (const id of missingIds) {
            try {
                const userName = await this.blockListManager.getUserName(id, true);
                if (userName) {
                        // 更新输入框中的用户名显示
                        const currentValue = document.getElementById('user-ids').value;
                        const newValue = currentValue.replace(
                            new RegExp(`\\b${id}\\b`),
                            `${userName}(${id})`
                        );
                        document.getElementById('user-ids').value = newValue;
                }
            } catch (error) {
                    this.handleError(error, 'UIManager.updateMissingUserNames');
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        }
    }

    hasUnsavedChanges() {
        const currentUserIds = document.getElementById('user-ids')?.value.trim() || '';
        const currentKeywords = document.getElementById('keywords')?.value.trim() || '';

        const originalUserIds = this.blockListManager.getUserIds()
            .map(id => {
                const name = this.blockListManager.userNameMap.get(id.toString());
                return name ? `${name}(${id})` : id;
            })
            .join('；');

        const originalKeywords = this.blockListManager.getKeywords()
            .map(k => k instanceof RegExp ? `/${k.source}/` : k)
            .join('；');

        const normalizeString = (str) => str.split(/[;；]/)
            .map(s => s.trim())
            .filter(s => s)
            .sort()
            .join('；');

        return normalizeString(currentUserIds) !== normalizeString(originalUserIds) ||
               normalizeString(currentKeywords) !== normalizeString(originalKeywords);
    }

    validateManagerData() {
        const userIdsInput = document.getElementById('user-ids');
        const keywordsInput = document.getElementById('keywords');
        const userIdsError = document.getElementById('user-ids-error');
        const keywordsError = document.getElementById('keywords-error');
        const saveButton = document.getElementById('save-blocklist');

        let isValid = true;

        userIdsError.style.display = 'none';
        keywordsError.style.display = 'none';
        userIdsInput.style.borderColor = '#ccc';
        keywordsInput.style.borderColor = '#ccc';
        saveButton.style.borderColor = '';

        if (userIdsInput.value.trim()) {
            const items = userIdsInput.value.trim().split(/[;；]/).map(item => item.trim()).filter(item => item);
            const invalidItems = items.filter(item => {
                return !(/^\d+$/.test(item) || /^.+\(\d+\)$/.test(item));
            });

            if (invalidItems.length > 0) {
                userIdsError.textContent = `以下用户ID格式无效：${invalidItems.join('、')}`;
                userIdsError.style.display = 'block';
                userIdsInput.style.borderColor = 'red';
                isValid = false;
            }
        }

        if (keywordsInput.value.trim()) {
            const keywords = keywordsInput.value.trim().split(/[;；]/).map(k => k.trim()).filter(k => k);
            const invalidKeywords = keywords.filter(k => {
                if (k === '/') return false;

                if (k.startsWith('/') && k.endsWith('/')) {
                    try {
                        new RegExp(k.slice(1, -1));
                        return false;
                    } catch (e) {
                        return true;
                    }
                }
                return false;
            });

            if (invalidKeywords.length > 0) {
                keywordsError.textContent = `以下正则表达式格式无效：${invalidKeywords.join('、')}`;
                keywordsError.style.display = 'block';
                keywordsInput.style.borderColor = 'red';
                isValid = false;
            }
        }

        if (!isValid) {
            saveButton.style.borderColor = 'red';
        }

        return { isValid };
    }

    async saveManagerData() {
        const { isValid } = this.validateManagerData();

        if (!isValid) {
            alert('请修正输入错误后再保存');
            return false;
        }

        const oldUserIds = this.blockListManager.getUserIds();

        const userIdsInput = document.getElementById('user-ids').value
            .split(/[;；]/)
            .map(item => item.trim())
            .filter(item => item);

        const validIds = [];
        const invalidItems = [];
        const retainedIds = [];

        userIdsInput.forEach(item => {
            if (/^\d+$/.test(item)) {
                validIds.push(parseInt(item));
                return;
            }

            const idMatch = item.match(/^.+\((\d+)\)$/);
            if (idMatch && /^\d+$/.test(idMatch[1])) {
                validIds.push(parseInt(idMatch[1]));
                return;
            }

            const partialMatch = item.match(/\((\d+)/);
            if (partialMatch) {
                const partialId = parseInt(partialMatch[1]);
                if (oldUserIds.includes(partialId)) {
                    retainedIds.push(partialId);
                    invalidItems.push(`${item} (已保留原数据)`);
                    return;
                }
            }

            invalidItems.push(item);
        });

        const finalIds = [...new Set([...validIds, ...retainedIds])];

        if (invalidItems.length > 0) {
            alert(`以下内容格式无效：${invalidItems.join('、')}`);
        }

        const newKeywords = document.getElementById('keywords').value
            .split(/[;；]/)
            .map(k => k.trim())
            .filter(k => k)
            .map(k => {
                if (k.startsWith('/') && k.endsWith('/')) {
                    try {
                        return new RegExp(k.slice(1, -1));
                    } catch (e) {
                        return k;
                    }
                }
                return k;
            });

        this.blockListManager.updateBlockList('userId', finalIds);
        this.blockListManager.updateBlockList('keywords', newKeywords);

        const addedUserIds = finalIds.filter(id => !oldUserIds.includes(id));

        if (addedUserIds.length > 0) {
            this.processNewUserIds(addedUserIds);
        }

        return true;
    }

    processNewUserIds(userIds) {
        if (window.requestIdleCallback) {
            requestIdleCallback(() => {
                this.processUserNameQueue(userIds);
            }, { timeout: 1000 });
        } else {
            setTimeout(() => {
                this.processUserNameQueue(userIds);
            }, 0);
        }
    }

    async processUserNameQueue(userIds) {
        for (const userId of userIds) {
            try {
                const userName = await this.blockListManager.getUserName(userId, true);
                if (userName) {
                    console.log(`[DMHY Block] 成功获取用户名: ${userName}(${userId})`);
                }
            } catch (error) {
                this.handleError(error, 'UIManager.processUserNameQueue');
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    addContextMenu() {
        const menuHtml = `
            <div id="dmhy-context-menu" style="display:none;position:fixed;background:white;
                border:1px solid #ccc;border-radius:3px;padding:5px;box-shadow:2px 2px 5px rgba(0,0,0,0.2);z-index:10000;">
                <div id="block-user" style="padding:5px 10px;cursor:pointer;hover:background-color:#f0f0f0;">
                    添加用户到黑名单
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', menuHtml);
        this.initContextMenuEvents();
    }

    initContextMenuEvents() {
        const menu = document.getElementById('dmhy-context-menu');

        document.addEventListener('contextmenu', e => {
            const userLink = e.target.closest(CONFIG.selectors.userLink);
            if (userLink) {
                e.preventDefault();
                const userId = userLink.href.match(/user_id\/(\d+)/)?.[1];
                const userName = userLink.textContent;
                if (userId) {
                    menu.style.display = 'block';
                    menu.style.left = e.clientX + 'px';
                    menu.style.top = e.clientY + 'px';

                    document.getElementById('block-user').onclick = e => {
                        e.stopPropagation();
                        if (this.blockListManager.addUser(parseInt(userId), userName)) {
                            this.filterManager.applyFilters();
                        }
                        menu.style.display = 'none';
                    };
                }
            }
        });

        document.addEventListener('click', e => {
            if (!menu.contains(e.target)) {
                menu.style.display = 'none';
            }
        });

        window.addEventListener('scroll', () => {
            menu.style.display = 'none';
        });
    }

}

/**
 * 广告拦截类
 */
class AdBlocker {
    static init() {
        this.hideAds();

        document.addEventListener('DOMContentLoaded', () => {
            this.hideAds();
        });

        this.initDOMObserver();

        window.addEventListener('load', () => {
            this.hideAds();
        });
    }

    static initDOMObserver() {
        const config = {
            childList: true,
            subtree: true
        };

        const observer = new MutationObserver(() => {
            window.requestAnimationFrame(() => {
                this.hideAds();
            });
        });

        observer.observe(document.documentElement, config);
    }

    static hideAds() {
        if (!document.getElementById('dmhy-ad-styles')) {
            const style = document.createElement('style');
            style.id = 'dmhy-ad-styles';
            style.textContent = CONFIG.selectors.adSelectors
                .map(selector => `${selector} { display: none !important; }`)
                .join('\n');
            document.head.appendChild(style);
        }

        CONFIG.selectors.adSelectors.forEach(selector => {
            try {
                document.querySelectorAll(selector).forEach(element => {
                    if (element) {
                        element.style.setProperty('display', 'none', 'important');
                    }
                });
            } catch (error) {
                Utils.handleError(error, 'AdBlocker.hideAds');
            }
        });
    }
}

/**
 * 现代化页面外观，仅修改本地 DOM/CSS。
 */
class PageBeautifier {
    static init() {
        const isListPage = Boolean(document.querySelector('#topic_list'));
        const isDetailPage = Boolean(document.querySelector('.topics_bk .topic-main'));

        document.body.classList.add('dmhy-modern');
        if (isListPage) document.body.classList.add('dmhy-list-page');
        if (isDetailPage) document.body.classList.add('dmhy-detail-page');

        this.injectStyles();
        this.normalizeSearchForm();
        if (isListPage) this.wrapTopicTable();
    }

    static normalizeSearchForm() {
        const form = document.querySelector('.quick_search form');
        if (!form) return;

        Array.from(form.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
                node.remove();
            }
        });
    }

    static wrapTopicTable() {
        const table = document.querySelector('#topic_list');
        if (!table || table.parentElement?.classList.contains('dmhy-topic-card')) return;

        const card = document.createElement('div');
        card.className = 'dmhy-topic-card';
        table.parentNode.insertBefore(card, table);
        card.appendChild(table);
    }

    static injectStyles() {
        if (document.getElementById('dmhy-modern-style')) return;

        const style = document.createElement('style');
        style.id = 'dmhy-modern-style';
        style.textContent = this.buildStyleText();
        document.head.appendChild(style);
    }

    static buildStyleText() {
        return [
            this.getBaseStyles(),
            this.getListPageStyles(),
            this.getDetailPageStyles(),
            this.getResponsiveStyles()
        ].join('\n');
    }

    static getBaseStyles() {
        return `

            :root {
                --dmhy-navy: #1c2a44;
                --dmhy-blue: #356fd6;
                --dmhy-teal: #248b8b;
                --dmhy-bg: #eef2f7;
                --dmhy-card: #fff;
                --dmhy-line: #dbe3ed;
                --dmhy-text: #26364b;
                --dmhy-muted: #6c7d91;
            }

            html { background: var(--dmhy-bg); }
            body.dmhy-modern {
                margin: 0 !important;
                overflow-x: hidden;
                color: var(--dmhy-text) !important;
                background: var(--dmhy-bg) !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
                line-height: 1.55;
            }

            body.dmhy-modern .container,
            body.dmhy-modern .bg {
                width: 100% !important;
                min-width: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                background: transparent !important;
            }

            /* 顶部仅做安全的视觉覆盖，不改变原站浮动结构 */
            body.dmhy-modern .header {
                height: 100px !important;
                color: #fff;
                background: linear-gradient(110deg, #294f88 0%, #315f91 58%, #2f8b93 100%) !important;
                box-shadow: 0 4px 18px rgba(23, 40, 65, .18);
            }
            body.dmhy-modern .headerleft { height: 100px !important; }
            body.dmhy-modern .headerleft img { width: auto !important; height: 100px !important; }
            body.dmhy-modern .headerright { padding: 12px 18px 0 0 !important; }
            body.dmhy-modern .headerright .links {
                height: auto !important;
                padding: 7px 10px;
                color: rgba(255,255,255,.45) !important;
                background: rgba(16,35,62,.20) !important;
                border: 1px solid rgba(255,255,255,.12);
                border-radius: 8px;
            }
            body.dmhy-modern .headerright .links a { color: rgba(255,255,255,.86) !important; }
            body.dmhy-modern .headerright .links a:hover { color: #fff !important; }

            body.dmhy-modern .top_sort {
                min-height: 44px !important;
                background: rgba(255,255,255,.97) !important;
                border-bottom: 1px solid var(--dmhy-line);
                box-shadow: 0 2px 10px rgba(30,48,73,.08);
            }
            body.dmhy-modern .top_sort .menu { background: transparent !important; }
            body.dmhy-modern .top_sort .menu > ul.nav { margin: 0 !important; padding: 6px 14px !important; }
            body.dmhy-modern .top_sort .menu > ul.nav > li { width: auto !important; margin-right: 4px; }
            body.dmhy-modern .top_sort .menu > ul.nav > li > a {
                min-width: 62px;
                padding: 4px 12px;
                color: #465a73 !important;
                border-radius: 999px;
                line-height: 28px;
            }
            body.dmhy-modern .top_sort .menu > ul.nav > li > a font { color: inherit !important; }
            body.dmhy-modern .top_sort .menu > ul.nav > li > a:hover {
                color: var(--dmhy-blue) !important;
                background: #eaf1fd !important;
            }

            body.dmhy-modern .main {
                box-sizing: border-box;
                width: min(1440px, calc(100vw - 32px)) !important;
                margin: 20px auto 44px !important;
                padding: 0 !important;
                background: transparent !important;
            }

            /* 搜索栏固定为三列，不再依赖旧站 input 宽度 */
            body.dmhy-modern .quick_search {
                box-sizing: border-box;
                width: min(980px, 100%) !important;
                margin: 16px auto !important;
                padding: 12px !important;
                color: var(--dmhy-text) !important;
                background: #fff !important;
                border: 1px solid var(--dmhy-line) !important;
                border-radius: 11px;
                box-shadow: 0 4px 16px rgba(34,55,85,.07);
            }
            body.dmhy-modern .quick_search form {
                display: grid !important;
                grid-template-columns: minmax(0, 1fr) auto auto;
                align-items: center;
                gap: 9px;
                width: 100%;
            }
            body.dmhy-modern .quick_search .quick_input {
                box-sizing: border-box;
                width: 100% !important;
                height: 40px;
                padding: 0 13px !important;
                color: var(--dmhy-text) !important;
                background: #f8fafc !important;
                border: 1px solid #cbd7e6 !important;
                border-radius: 7px;
                outline: none;
            }
            body.dmhy-modern .quick_search .quick_input:focus {
                border-color: var(--dmhy-blue) !important;
                box-shadow: 0 0 0 3px rgba(53,111,214,.12);
            }
            body.dmhy-modern .quick_search .formButton {
                height: 40px;
                margin: 0 !important;
                padding: 0 18px !important;
                color: #fff !important;
                background: var(--dmhy-blue) !important;
                border: 0 !important;
                border-radius: 7px;
                font-weight: 600;
                cursor: pointer;
            }
            body.dmhy-modern .quick_search form > a {
                color: #526985 !important;
                white-space: nowrap;
                text-decoration: none !important;
            }
            body.dmhy-modern .quick_search #AdvSearch { grid-column: 1 / -1; }

            body.dmhy-modern #dmhy-blocklist-ui {
                top: auto !important;
                bottom: 16px !important;
                left: 16px !important;
                display: flex;
                gap: 7px;
                padding: 7px;
                background: rgba(28,42,68,.94) !important;
                border: 1px solid rgba(255,255,255,.15);
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(14,24,42,.25);
                backdrop-filter: blur(8px);
            }
            body.dmhy-modern #dmhy-blocklist-ui button {
                margin: 0 !important;
                padding: 7px 10px !important;
                color: #f2f6ff !important;
                background: rgba(255,255,255,.10) !important;
                border: 1px solid rgba(255,255,255,.17) !important;
                border-radius: 6px !important;
            }
        `;
    }

    static getListPageStyles() {
        return `
            /* 列表页：所有选择器限定在 dmhy-list-page */
            body.dmhy-list-page .dmhy-topic-card {
                width: 100%;
                overflow-x: auto;
                background: #fff;
                border: 1px solid var(--dmhy-line);
                border-radius: 12px;
                box-shadow: 0 7px 24px rgba(29,48,77,.09);
            }
            body.dmhy-list-page table#topic_list {
                width: 100% !important;
                min-width: 1060px;
                table-layout: fixed;
                border: 0 !important;
                border-collapse: separate !important;
                border-spacing: 0 !important;
                background: #fff;
                font-size: 14px;
            }
            body.dmhy-list-page table#topic_list thead th {
                position: sticky;
                top: 0;
                z-index: 10;
                box-sizing: border-box;
                height: 43px;
                padding: 0 9px !important;
                color: #edf3fb !important;
                background: var(--dmhy-navy) !important;
                border: 0 !important;
                text-align: left !important;
                white-space: nowrap;
                line-height: 43px;
            }
            body.dmhy-list-page table#topic_list tbody tr { background: #fff !important; }
            body.dmhy-list-page table#topic_list tbody tr:nth-child(even) { background: #f6f8fb !important; }
            body.dmhy-list-page table#topic_list tbody tr:hover {
                background: #eaf2ff !important;
                box-shadow: inset 4px 0 0 var(--dmhy-blue);
            }
            body.dmhy-list-page table#topic_list tbody td {
                box-sizing: border-box;
                padding: 10px 9px !important;
                color: #536278;
                background: transparent !important;
                border: 0 !important;
                border-bottom: 1px solid #e4eaf1 !important;
                vertical-align: middle !important;
            }
            body.dmhy-list-page table#topic_list th:nth-child(1),
            body.dmhy-list-page table#topic_list td:nth-child(1) { width: 106px !important; }
            body.dmhy-list-page table#topic_list th:nth-child(2),
            body.dmhy-list-page table#topic_list td:nth-child(2) { width: 68px !important; text-align: center !important; }
            body.dmhy-list-page table#topic_list th:nth-child(4),
            body.dmhy-list-page table#topic_list td:nth-child(4) { width: 112px !important; text-align: center !important; }
            body.dmhy-list-page table#topic_list th:nth-child(5),
            body.dmhy-list-page table#topic_list td:nth-child(5) { width: 84px !important; text-align: center !important; }
            body.dmhy-list-page table#topic_list th:nth-child(6),
            body.dmhy-list-page table#topic_list td:nth-child(6),
            body.dmhy-list-page table#topic_list th:nth-child(7),
            body.dmhy-list-page table#topic_list td:nth-child(7),
            body.dmhy-list-page table#topic_list th:nth-child(8),
            body.dmhy-list-page table#topic_list td:nth-child(8) { width: 58px !important; text-align: center !important; }
            body.dmhy-list-page table#topic_list th:nth-child(9),
            body.dmhy-list-page table#topic_list td:nth-child(9) { width: 112px !important; text-align: center !important; }
            body.dmhy-list-page table#topic_list td.title {
                color: var(--dmhy-text);
                line-height: 1.55;
                overflow-wrap: anywhere;
            }
            body.dmhy-list-page table#topic_list td.title > a {
                color: #235ca8 !important;
                font-weight: 600;
                text-decoration: none !important;
            }
            body.dmhy-list-page table#topic_list td.title span.tag {
                display: inline;
                margin: 0 5px 0 0 !important;
                padding: 0 !important;
                color: inherit !important;
                background: transparent !important;
                border: 0 !important;
            }
            body.dmhy-list-page table#topic_list td.title .tag a {
                display: inline-block;
                margin: 0;
                padding: 2px 7px;
                color: #227c7c !important;
                background: #e7f6f5;
                border: 1px solid #bee7e4;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                line-height: 1.45;
                text-decoration: none !important;
            }
        `;
    }

    static getDetailPageStyles() {
        return `
            /* 详情页：独立双栏布局，不复用列表页的 table/box 规则 */
            body.dmhy-detail-page .topics_bk {
                display: grid !important;
                grid-template-columns: 230px minmax(0, 1fr);
                gap: 16px;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                background: transparent !important;
                border: 0 !important;
            }
            body.dmhy-detail-page .user-sidebar,
            body.dmhy-detail-page .topic-main {
                float: none !important;
                width: auto !important;
                min-width: 0;
                margin: 0 !important;
                padding: 0 !important;
            }
            body.dmhy-detail-page .user-sidebar {
                grid-column: 1;
                align-self: start;
            }
            body.dmhy-detail-page .topic-main { grid-column: 2; }
            body.dmhy-detail-page .user-sidebar > .box,
            body.dmhy-detail-page .topic-main > .box {
                box-sizing: border-box;
                margin: 0 0 14px !important;
                padding: 16px !important;
                color: var(--dmhy-text) !important;
                background: #fff !important;
                border: 1px solid var(--dmhy-line) !important;
                border-radius: 11px !important;
                box-shadow: 0 5px 18px rgba(31,52,80,.07);
            }
            body.dmhy-detail-page .user-sidebar > .box {
                padding: 14px !important;
                overflow: hidden;
            }
            body.dmhy-detail-page .user-sidebar img {
                max-width: 100% !important;
                height: auto !important;
            }
            body.dmhy-detail-page .topics_cult {
                color: var(--dmhy-text) !important;
                font-weight: 500 !important;
                max-height: 620px;
                overflow-y: auto !important;
            }
            body.dmhy-detail-page .topics_cult li {
                padding: 8px 0 !important;
                text-align: left !important;
                border-bottom: 1px solid #e8edf3;
            }
            body.dmhy-detail-page .topics_cult li:last-child { border-bottom: 0; }

            body.dmhy-detail-page .topic-title h3 {
                margin: 0 0 15px !important;
                padding: 0 0 13px !important;
                color: #203653 !important;
                border-bottom: 1px solid var(--dmhy-line) !important;
                font-size: 20px !important;
                line-height: 1.45;
            }
            body.dmhy-detail-page .topic-title .resource-info {
                float: none !important;
                width: auto !important;
                margin: 0 !important;
                padding: 13px 15px;
                color: #40546d;
                background: #f6f8fb;
                border: 1px solid #e1e7ef;
                border-radius: 8px;
                column-count: 2;
                column-gap: 28px;
                line-height: 2;
            }
            body.dmhy-detail-page .topic-title .relative-goods:empty { display: none !important; }

            body.dmhy-detail-page .topic-nfo {
                font-size: 14px;
                line-height: 1.75;
                overflow-wrap: anywhere;
            }
            body.dmhy-detail-page .topic-nfo p { margin: 7px 0; }
            body.dmhy-detail-page .topic-nfo img {
                box-sizing: border-box;
                max-width: 70% !important;
                height: auto !important;
                object-fit: contain;
            }
            body.dmhy-detail-page .topic-nfo hr {
                height: 0;
                border: 0 !important;
                border-top: 1px solid var(--dmhy-line) !important;
            }

            body.dmhy-detail-page .resource-detail {
                overflow: hidden;
                background-image: none !important;
            }
            body.dmhy-detail-page .resource-detail .ui-tabs-nav,
            body.dmhy-detail-page .resource-detail .tb_ {
                margin: -16px -16px 15px !important;
                padding: 10px 14px !important;
                color: #fff !important;
                background: var(--dmhy-navy) !important;
                border: 0 !important;
                list-style: none;
            }
            body.dmhy-detail-page .resource-detail .ui-tabs-panel,
            body.dmhy-detail-page .resource-detail .dis {
                padding: 0 !important;
                color: var(--dmhy-text) !important;
                background: transparent !important;
                border: 0 !important;
            }
            body.dmhy-detail-page .file_list {
                box-sizing: border-box;
                width: 100% !important;
                margin: 12px 0 0 !important;
                padding: 8px !important;
                background: #f7f9fc !important;
                border: 1px solid var(--dmhy-line) !important;
                border-radius: 7px;
            }
            body.dmhy-detail-page .comment { min-height: 52px; }
            body.dmhy-detail-page .comment a { color: #315f9e !important; }

            body.dmhy-modern .footer {
                color: var(--dmhy-muted) !important;
                background: transparent !important;
                border: 0 !important;
            }
            body.dmhy-modern .footer a { color: #526b89 !important; }

            #blocklist-manager {
                box-sizing: border-box;
                width: min(620px, calc(100vw - 28px)) !important;
                border: 0 !important;
                border-radius: 14px !important;
                box-shadow: 0 18px 60px rgba(12,23,42,.30);
            }
            #blocklist-manager textarea {
                box-sizing: border-box;
                padding: 9px;
                border-color: #ccd8e6 !important;
                border-radius: 8px;
                font: inherit;
            }
        `;
    }

    static getResponsiveStyles() {
        return `
            @media (max-width: 820px) {
                body.dmhy-modern .header { height: 76px !important; }
                body.dmhy-modern .headerleft,
                body.dmhy-modern .headerleft img { height: 76px !important; }
                body.dmhy-modern .headerright { display: none; }
                body.dmhy-modern .main {
                    width: calc(100vw - 18px) !important;
                    margin-top: 10px !important;
                }
                body.dmhy-modern #mini_jmd { display: none; }
                body.dmhy-modern .quick_search form {
                    grid-template-columns: minmax(0,1fr) auto;
                }
                body.dmhy-modern .quick_search form > a { grid-column: 1 / -1; }
                body.dmhy-detail-page .topics_bk {
                    grid-template-columns: minmax(0,1fr);
                }
                body.dmhy-detail-page .topic-main {
                    grid-column: 1;
                    grid-row: 1;
                }
                body.dmhy-detail-page .user-sidebar {
                    grid-column: 1;
                    grid-row: 2;
                }
                body.dmhy-detail-page .topic-title .resource-info {
                    column-count: 1;
                }
                .dmhy-topic-card { border-radius: 8px; }
            }
        `;
    }

}
/**
 * 尽早阻止已知推广脚本被创建或插入，作为请求层拦截的兼容回退。
 */
class ScriptBlocker {
    static installed = false;

    static init() {
        if (this.installed) return;
        this.installed = true;

        const shouldBlock = node => {
            if (!(node instanceof HTMLScriptElement) || !node.src) return false;
            return CONFIG.blockedScripts.some(pattern => pattern.test(node.src));
        };

        const removeBlockedScripts = root => {
            if (shouldBlock(root)) root.remove();
            if (root instanceof Element || root instanceof Document) {
                root.querySelectorAll('script[src]').forEach(script => {
                    if (shouldBlock(script)) script.remove();
                });
            }
        };

        const wrapInsertion = methodName => {
            const original = Node.prototype[methodName];
            Node.prototype[methodName] = function(node, ...args) {
                if (shouldBlock(node)) return node;
                return original.call(this, node, ...args);
            };
        };
        wrapInsertion('appendChild');
        wrapInsertion('insertBefore');
        wrapInsertion('replaceChild');

        const originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            if (this instanceof HTMLScriptElement && name.toLowerCase() === 'src') {
                const resolvedUrl = new URL(String(value), location.href).href;
                if (CONFIG.blockedScripts.some(pattern => pattern.test(resolvedUrl))) return;
            }
            return originalSetAttribute.call(this, name, value);
        };

        const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        if (srcDescriptor?.configurable && srcDescriptor.get && srcDescriptor.set) {
            Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                configurable: true,
                enumerable: srcDescriptor.enumerable,
                get: srcDescriptor.get,
                set(value) {
                    const resolvedUrl = new URL(String(value), location.href).href;
                    if (CONFIG.blockedScripts.some(pattern => pattern.test(resolvedUrl))) return;
                    srcDescriptor.set.call(this, value);
                }
            });
        }

        removeBlockedScripts(document);
        const observer = new MutationObserver(records => {
            records.forEach(record => {
                record.addedNodes.forEach(removeBlockedScripts);
            });
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
}

/**
 * 在浏览器首次绘制页面前注入样式，避免先显示原站布局、随后再切换布局造成闪烁。
 */
class EarlyPageBootstrap {
    static init() {
        const style = document.createElement('style');
        style.id = 'dmhy-modern-style';
        style.textContent = [
            PageBeautifier.buildStyleText(),
            CONFIG.selectors.adSelectors
                .map(selector => `${selector} { display: none !important; }`)
                .join('\n')
        ].join('\n');
        document.documentElement.appendChild(style);

        const applyBodyClasses = () => {
            if (!document.body) return false;

            document.body.classList.add('dmhy-modern');
            if (/\/topics\/view\//.test(location.pathname)) {
                document.body.classList.add('dmhy-detail-page');
            } else {
                document.body.classList.add('dmhy-list-page');
            }
            return true;
        };

        if (!applyBodyClasses()) {
            const observer = new MutationObserver(() => {
                if (applyBodyClasses()) observer.disconnect();
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    }
}

/**
 * 根据用户意图预取站内页面，让后续导航尽量直接命中浏览器缓存。
 */
class LinkPreloader {
    static prefetchedUrls = new Set();
    static scannedTopicUrls = new Set();
    static knownImageUrls = new Set();
    static imagePreloads = [];
    static hoverTimers = new WeakMap();
    static maxPrefetches = 16;
    static maxImagesPerTopic = 8;
    static imageCacheStorageKey = 'dmhy_preloaded_image_urls';

    static init() {
        if (navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) {
            return;
        }

        try {
            const storedUrls = JSON.parse(sessionStorage.getItem(this.imageCacheStorageKey) || '[]');
            storedUrls.forEach(src => this.knownImageUrls.add(src));
        } catch {
            sessionStorage.removeItem(this.imageCacheStorageKey);
        }

        document.addEventListener('pointerover', event => {
            const link = this.getEligibleLink(event.target);
            if (!link || this.hoverTimers.has(link)) return;

            const timer = setTimeout(() => {
                this.hoverTimers.delete(link);
                this.prefetch(link.href, 'low', true);
            }, 80);
            this.hoverTimers.set(link, timer);
        }, { passive: true });

        document.addEventListener('pointerout', event => {
            const link = this.getEligibleLink(event.target);
            if (!link || link.contains(event.relatedTarget)) return;

            clearTimeout(this.hoverTimers.get(link));
            this.hoverTimers.delete(link);
        }, { passive: true });

        const preloadImmediately = event => {
            const link = this.getEligibleLink(event.target);
            if (link) this.prefetch(link.href, 'high', true);
        };
        document.addEventListener('pointerdown', preloadImmediately, { passive: true });
        document.addEventListener('touchstart', preloadImmediately, { passive: true });

        const preloadVisibleTopics = () => {
            document.querySelectorAll('#topic_list td.title > a[href]').forEach(link => {
                if (this.prefetchedUrls.size < 4 && this.isEligible(link)) {
                    this.prefetch(link.href, 'low', false);
                }
            });
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(preloadVisibleTopics, { timeout: 2500 });
        } else {
            setTimeout(preloadVisibleTopics, 1200);
        }
    }

    static getEligibleLink(target) {
        const link = target instanceof Element ? target.closest('a[href]') : null;
        return link && this.isEligible(link) ? link : null;
    }

    static isEligible(link) {
        if (link.hasAttribute('download')) return false;

        let url;
        try {
            url = new URL(link.href, location.href);
        } catch {
            return false;
        }

        if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return false;
        if (url.pathname === location.pathname && url.search === location.search) return false;
        if (/\/(?:logout|login|register)(?:\/|$)/i.test(url.pathname)) return false;
        return true;
    }

    static prefetch(href, priority, includeTopicImages) {
        if (document.hidden) return;

        const url = new URL(href, location.href);
        if (includeTopicImages && /\/topics\/view\//.test(url.pathname)) {
            this.prefetchTopicImages(url.href, priority);
        }

        if (this.prefetchedUrls.size >= this.maxPrefetches) return;
        if (this.prefetchedUrls.has(url.href)) return;
        this.prefetchedUrls.add(url.href);

        const hint = document.createElement('link');
        hint.rel = 'prefetch';
        hint.as = 'document';
        hint.href = url.href;
        hint.fetchPriority = priority;
        document.head.appendChild(hint);
    }

    static async prefetchTopicImages(topicUrl, priority) {
        if (this.scannedTopicUrls.has(topicUrl)) return;
        this.scannedTopicUrls.add(topicUrl);

        try {
            const response = await fetch(topicUrl, {
                credentials: 'same-origin',
                cache: 'force-cache',
                priority
            });
            if (!response.ok) return;

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const imageUrls = Array.from(doc.querySelectorAll('.topic-nfo img'))
                .map(image => image.dataset.src || image.dataset.original || image.getAttribute('src'))
                .filter(Boolean)
                .map(src => new URL(src, topicUrl).href)
                .filter((src, index, urls) => {
                    return /^https?:/i.test(src) &&
                        urls.indexOf(src) === index &&
                        !this.isImageKnown(src);
                })
                .slice(0, this.maxImagesPerTopic);

            imageUrls.forEach(src => {
                this.rememberImage(src);
                const image = new Image();
                image.decoding = 'async';
                image.fetchPriority = priority;
                image.src = src;
                this.imagePreloads.push(image);
            });
        } catch (error) {
            Utils.handleError(error, 'LinkPreloader.prefetchTopicImages');
        }
    }

    static isImageKnown(src) {
        if (this.knownImageUrls.has(src)) return true;

        const loadedInThisDocument = Array.from(document.images).some(image => {
            return image.currentSrc === src || image.src === src;
        });
        if (loadedInThisDocument) {
            this.rememberImage(src);
            return true;
        }

        const hasResourceTimingEntry = performance.getEntriesByName(src, 'resource')
            .some(entry => entry.responseEnd > 0);
        if (hasResourceTimingEntry) {
            this.rememberImage(src);
            return true;
        }

        return false;
    }

    static rememberImage(src) {
        this.knownImageUrls.add(src);
        try {
            const recentUrls = Array.from(this.knownImageUrls).slice(-100);
            sessionStorage.setItem(this.imageCacheStorageKey, JSON.stringify(recentUrls));
        } catch {
            // 存储不可用时仅保留当前页面内的去重。
        }
    }
}

/**
 * 事件管理类
 */
class EventManager {
    constructor(filterManager) {
        this.filterManager = filterManager;
    }

    init() {
        this.initSortingEvents();
    }

    initSortingEvents() {
        document.querySelectorAll("th.header").forEach(header => {
            header.addEventListener('click', () => {
                setTimeout(() => this.filterManager.applyFilters(), 100);
            });
        });
    }
}

/**
 * 应用主类
 */
class App {
    static async init() {
        try {
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve, { once: true });
                });
            }

            Utils.log('初始化应用');
            AdBlocker.init();
            Utils.log('广告拦截器初始化完成');

            PageBeautifier.init();
            Utils.log('页面美化完成');

            LinkPreloader.init();
            Utils.log('链接预加载完成');

            await Utils.init();
            Utils.log('文字转换器初始化完成');

            const blockListManager = new BlockListManager();
            await blockListManager.init();
            Utils.log('黑名单管理器初始化完成');

            const titleManager = new TitleManager();
            titleManager.init();
            Utils.log('标题管理器初始化完成');

            const filterManager = new FilterManager(blockListManager, titleManager);
            const uiManager = new UIManager(blockListManager, filterManager, titleManager);
            const eventManager = new EventManager(filterManager);

            uiManager.init();
            filterManager.init();
            eventManager.init();
            Utils.log('应用初始化完成');
        } catch (error) {
            Utils.log('应用初始化失败', 'error');
            Utils.handleError(error, 'App.init');
        }
    }
}

// 启动应用
(function() {
    'use strict';
    ScriptBlocker.init();
    EarlyPageBootstrap.init();
    App.init();
})();
