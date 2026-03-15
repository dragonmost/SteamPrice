// ==UserScript==
// @name         Steam Lowest Seen Price from IsThereAnyDeal
// @namespace    https://github.com/Dragonmost/SteamPrice
// @version      1.1
// @description  Shows IsThereAnyDeal historical low next to the current Steam store price for your region.
// @downloadURL  https://raw.githubusercontent.com/Dragonmost/SteamPrice/master/steam-lowest-price.user.js
// @updateURL    https://raw.githubusercontent.com/Dragonmost/SteamPrice/master/steam-lowest-price.user.js
// @match        https://store.steampowered.com/app/*
// @match        https://store.steampowered.com/agecheck/app/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.isthereanydeal.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const LABEL_CLASS = 'itad-lowest-price-label';
    const STYLE_ID = 'itad-lowest-price-style';
    const MAX_ATTEMPTS = 12;
    const RETRY_MS = 800;
    const REQUEST_TIMEOUT_MS = 12000;
    const ITAD_API_BASE = 'https://api.isthereanydeal.com';
    const ITAD_STEAM_SHOP_ID = 61;

    const PRICE_SELECTORS = [
        '.discount_block .discount_final_price',
        '.game_purchase_discount .discount_final_price',
        '.discount_final_price',
        '.game_purchase_price.price',
        '.game_purchase_price',
    ];

    const PURCHASE_BLOCK_SELECTORS = [
        '.game_area_purchase_game',
        '.game_area_purchase_game_wrapper',
        '.game_purchase_action',
    ];

    const LANGUAGE_FALLBACK_REGION = {
        en: 'US', de: 'DE', fr: 'FR', es: 'ES', it: 'IT',
        pt: 'BR', ru: 'RU', ja: 'JP', ko: 'KR', zh: 'CN',
        tr: 'TR', pl: 'PL', nl: 'NL', sv: 'SE', nb: 'NO',
        da: 'DK', fi: 'FI', cs: 'CZ', hu: 'HU', ro: 'RO',
        uk: 'UA', ar: 'SA', th: 'TH', id: 'ID', ms: 'MY',
        vi: 'VN', el: 'GR', bg: 'BG', hr: 'HR', sk: 'SK',
    };

    // Maps ISO 4217 currency codes to a representative country code.
    // EUR is intentionally omitted — it is shared by many countries; let locale resolve it.
    const CURRENCY_TO_COUNTRY = {
        USD: 'US', CAD: 'CA', GBP: 'GB', AUD: 'AU', NZD: 'NZ',
        HKD: 'HK', SGD: 'SG', MXN: 'MX', BRL: 'BR', TWD: 'TW',
        JPY: 'JP', KRW: 'KR', CNY: 'CN', RUB: 'RU', TRY: 'TR',
        PLN: 'PL', UAH: 'UA', INR: 'IN', CHF: 'CH', SEK: 'SE',
        NOK: 'NO', DKK: 'DK', ISK: 'IS', CZK: 'CZ', HUF: 'HU',
        RON: 'RO', IDR: 'ID', MYR: 'MY', PHP: 'PH', THB: 'TH',
        ARS: 'AR', CLP: 'CL', COP: 'CO', PEN: 'PE', UYU: 'UY',
        KZT: 'KZ', QAR: 'QA', SAR: 'SA', AED: 'AE',
    };

    // Ordered list of [regex, countryCode] for unambiguous currency markers in price text.
    // Symbols that multiple currencies share (¥, kr, $) are handled via locale fallback instead.
    const PRICE_TEXT_HINTS = [
        [/cdn\$|\bcad\b/i, 'CA'],
        [/\ba\$|\baud\b/i, 'AU'],
        [/nz\$|\bnzd\b/i, 'NZ'],
        [/hk\$|\bhkd\b/i, 'HK'],
        [/\bs\$|\bsgd\b/i, 'SG'],
        [/mx\$|\bmxn\b/i, 'MX'],
        [/\br\$|\bbrl\b/i, 'BR'],
        [/nt\$|\btwd\b/i, 'TW'],
        [/£|\bgbp\b/i, 'GB'],
        [/₩|\bkrw\b/i, 'KR'],
        [/₺|\btry\b/i, 'TR'],
        [/₴|\buah\b/i, 'UA'],
        [/₹|\binr\b/i, 'IN'],
        [/zł|\bpln\b/i, 'PL'],
        [/kč|\bczk\b/i, 'CZ'],
        [/\bchf\b/i, 'CH'],
        [/₽|\brub\b/i, 'RU'],
        [/฿|\bthb\b/i, 'TH'],
        [/₱|\bphp\b/i, 'PH'],
        [/\bidr\b/i, 'ID'],
        [/\bmyr\b/i, 'MY'],
        [/\bars\b/i, 'AR'],
        [/\bclp\b/i, 'CL'],
        [/\bcop\b/i, 'CO'],
        [/\bpen\b/i, 'PE'],
        [/\buyu\b/i, 'UY'],
        [/\bkzt\b/i, 'KZ'],
        [/\bqar\b/i, 'QA'],
        [/\bsar\b/i, 'SA'],
        [/\baed\b/i, 'AE'],
    ];

    GM_registerMenuCommand('Set ITAD API Key', promptForApiKey);

    const appId = extractAppId();
    if (!appId || window.location.hostname !== 'store.steampowered.com') {
        return;
    }

    if (typeof GM_xmlhttpRequest !== 'function') {
        return;
    }

    ensureStyles();
    run();

    async function run() {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const priceElement = findPriceElement();
            if (!priceElement) {
                await sleep(RETRY_MS);
                continue;
            }

            if (hasLabel(priceElement)) {
                return;
            }

            if (isFreeToPlayArea(priceElement)) {
                return;
            }

            const countryCode = resolveCountryCode(priceElement.textContent);
            if (!countryCode) {
                return;
            }

            const lowestPrice = await fetchLowestSteamPriceFromItad(appId, countryCode);
            if (!lowestPrice) {
                return;
            }

            const latestPriceElement = findPriceElement();
            if (!latestPriceElement || hasLabel(latestPriceElement)) {
                return;
            }

            addLabel(latestPriceElement, `Lowest: ${lowestPrice}`);
            return;
        }
    }

    function extractAppId() {
        const match = window.location.pathname.match(/\/(?:agecheck\/)?app\/(\d+)/i);
        return match ? match[1] : null;
    }

    function findPriceElement() {
        const blocks = PURCHASE_BLOCK_SELECTORS
            .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
            .filter(isVisible);

        for (const block of blocks) {
            for (const selector of PRICE_SELECTORS) {
                const candidates = Array.from(block.querySelectorAll(selector));
                const match = candidates.find((element) => isVisible(element) && looksLikePrice(element.textContent));
                if (match) {
                    return match;
                }
            }
        }

        return null;
    }

    function hasLabel(priceElement) {
        const actionRow = priceElement.closest('.game_purchase_action, .game_purchase_action_bg');
        if (actionRow && actionRow.querySelector(`.${LABEL_CLASS}`)) {
            return true;
        }

        return Boolean(priceElement.parentElement && priceElement.parentElement.querySelector(`.${LABEL_CLASS}`));
    }

    function isFreeToPlayArea(priceElement) {
        const block = priceElement.closest('.game_area_purchase_game, .game_area_purchase_game_wrapper, .game_purchase_action') || priceElement.parentElement;
        const text = normalizeText(block ? block.textContent : '');
        return /free to play|play game/i.test(text);
    }

    function resolveCountryCode(priceText) {
        const fromSteam = steamCountryCode();
        if (fromSteam) {
            return fromSteam;
        }

        const fromGlobals = steamPageCountryCode();
        if (fromGlobals) {
            return fromGlobals;
        }

        const fromPrice = countryCodeFromPriceText(priceText);
        if (fromPrice) {
            return fromPrice;
        }

        const locales = Array.isArray(navigator.languages) && navigator.languages.length
            ? navigator.languages
            : [navigator.language].filter(Boolean);

        for (const locale of locales) {
            const region = regionFromLocale(locale);
            if (region) {
                return region;
            }
        }

        return null;
    }

    function steamPageCountryCode() {
        try {
            // Steam injects window.g_rgCurrencyData with the store's active currency code
            const cd = window.g_rgCurrencyData;
            if (cd && typeof cd.strCode === 'string') {
                const cc = CURRENCY_TO_COUNTRY[cd.strCode.toUpperCase()];
                if (cc) {
                    return cc;
                }
            }
        } catch (_error) {
        }

        return null;
    }

    function countryCodeFromPriceText(text) {
        const value = normalizeText(text);
        if (!value) {
            return null;
        }

        for (const [pattern, country] of PRICE_TEXT_HINTS) {
            if (pattern.test(value)) {
                return country;
            }
        }

        return null;
    }

    function steamCountryCode() {
        const queryCountry = new URLSearchParams(window.location.search).get('cc');
        if (/^[a-z]{2}$/i.test(queryCountry || '')) {
            return queryCountry.toUpperCase();
        }

        const cookieMatch = document.cookie.match(/(?:^|;\s*)steamCountry=([^;]+)/i);
        if (!cookieMatch || !cookieMatch[1]) {
            return null;
        }

        const decoded = decodeURIComponent(cookieMatch[1]);
        const cookieCountry = decoded.split('%7C')[0] || decoded.split('|')[0] || '';
        if (/^[a-z]{2}$/i.test(cookieCountry)) {
            return cookieCountry.toUpperCase();
        }

        return null;
    }

    function regionFromLocale(locale) {
        if (!locale) {
            return null;
        }

        try {
            if (typeof Intl.Locale === 'function') {
                const parsed = new Intl.Locale(locale);
                if (parsed.region) {
                    return parsed.region.toUpperCase();
                }
            }
        } catch (_error) {
        }

        const parts = String(locale).split(/[-_]/).filter(Boolean);
        if (parts.length >= 2 && /^[a-z]{2}$/i.test(parts[1])) {
            return parts[1].toUpperCase();
        }

        const language = parts[0] ? parts[0].toLowerCase() : '';
        return LANGUAGE_FALLBACK_REGION[language] || null;
    }

    function promptForApiKey() {
        const current = GM_getValue('itadApiKey', '');
        const entered = window.prompt(
            'Enter your IsThereAnyDeal API key:\n(get one free at https://isthereanydeal.com/apps/my/)',
            current,
        );
        if (entered === null) {
            return;
        }

        const trimmed = entered.trim();
        GM_setValue('itadApiKey', trimmed);
        window.alert(trimmed ? 'API key saved.' : 'API key cleared.');
    }

    async function fetchLowestSteamPriceFromItad(appIdValue, countryCode) {
        const ITAD_API_KEY = GM_getValue('itadApiKey', '');
        if (!ITAD_API_KEY) {
            return null;
        }

        const gameId = await lookupItadGameIdByAppId(appIdValue);
        if (!gameId) {
            return null;
        }

        const lows = await fetchSteamStoreLows(gameId, countryCode);
        const best = pickBestLow(lows);
        if (!best) {
            return null;
        }

        return formatMoney(best.amount, best.currency, countryCode);
    }

    async function lookupItadGameIdByAppId(appIdValue) {
        const ITAD_API_KEY = GM_getValue('itadApiKey', '');
        const url = `${ITAD_API_BASE}/games/lookup/v1?key=${encodeURIComponent(ITAD_API_KEY)}&appid=${encodeURIComponent(appIdValue)}`;
        const data = await requestJson('GET', url);
        if (!data || !data.found || !data.game || !data.game.id) {
            return null;
        }

        return data.game.id;
    }

    async function fetchSteamStoreLows(gameId, countryCode) {
        const ITAD_API_KEY = GM_getValue('itadApiKey', '');
        const url = `${ITAD_API_BASE}/games/storelow/v2?key=${encodeURIComponent(ITAD_API_KEY)}&country=${encodeURIComponent(countryCode)}&shops=${ITAD_STEAM_SHOP_ID}`;
        const data = await requestJson('POST', url, [gameId]);
        if (!Array.isArray(data) || data.length === 0) {
            return [];
        }

        const row = data.find((item) => item && item.id === gameId) || data[0];
        if (!row || !Array.isArray(row.lows)) {
            return [];
        }

        return row.lows;
    }

    function pickBestLow(lows) {
        let best = null;

        for (const low of lows) {
            if (!isSteamLow(low)) {
                continue;
            }

            const priceObj = low && typeof low === 'object'
                ? (low.price || low.deal || low.low || low)
                : null;
            if (!priceObj || typeof priceObj !== 'object') {
                continue;
            }

            const amount = toNumber(priceObj.amount ?? priceObj.price ?? priceObj.value);
            const currency = typeof priceObj.currency === 'string' ? priceObj.currency.toUpperCase() : null;
            if (amount === null || !currency) {
                continue;
            }

            if (!best || amount < best.amount) {
                best = { amount, currency };
            }
        }

        return best;
    }

    function isSteamLow(low) {
        if (!low || typeof low !== 'object') {
            return false;
        }

        const shopId = toNumber(low.shop?.id ?? low.shopId ?? low.shop);
        if (shopId !== null) {
            return shopId === ITAD_STEAM_SHOP_ID;
        }

        const shopTitle = normalizeText(low.shop?.title || low.shopTitle || '').toLowerCase();
        if (shopTitle) {
            return shopTitle === 'steam' || shopTitle.includes('steam store');
        }

        // If the API does not include shop metadata, trust the upstream shops=61 filter.
        return true;
    }

    function formatMoney(amount, currency, countryCode) {
        try {
            const symbolStr = new Intl.NumberFormat(localeForCountry(countryCode), {
                style: 'currency',
                currency,
                currencyDisplay: 'narrowSymbol',
            }).format(amount);
            return `${currency} ${symbolStr}`;
        } catch (_error) {
            return `${currency} ${amount.toFixed(2)}`;
        }
    }

    function localeForCountry(countryCode) {
        const target = String(countryCode || '').toUpperCase();
        const locales = Array.isArray(navigator.languages) && navigator.languages.length
            ? navigator.languages
            : [navigator.language].filter(Boolean);

        for (const locale of locales) {
            const region = regionFromLocale(locale);
            if (region === target) {
                return locale;
            }
        }

        return target ? `en-${target}` : 'en-US';
    }

    function toNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function requestJson(method, url, body) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method,
                url,
                timeout: REQUEST_TIMEOUT_MS,
                headers: {
                    Accept: 'application/json',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                data: body ? JSON.stringify(body) : undefined,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            resolve(JSON.parse(response.responseText || 'null'));
                        } catch (_error) {
                            resolve(null);
                        }
                        return;
                    }

                    resolve(null);
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null),
            });
        });
    }

    function addLabel(priceElement, text) {
        const label = document.createElement('span');
        label.className = LABEL_CLASS;
        label.textContent = text;

        // Discounted rows use nested price spans; place label on the action row for stable layout.
        const actionRow = priceElement.closest('.game_purchase_action, .game_purchase_action_bg');
        if (actionRow) {
            const priceContainer = actionRow.querySelector('.discount_block, .discount_prices, .game_purchase_price');
            if (priceContainer) {
                priceContainer.insertAdjacentElement('afterend', label);
                return;
            }

            actionRow.appendChild(label);
            return;
        }

        priceElement.insertAdjacentElement('afterend', label);
    }

    function looksLikePrice(text) {
        return /\d/.test(normalizeText(text));
    }

    function normalizeText(text) {
        return String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVisible(element) {
        if (!(element instanceof HTMLElement)) {
            return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${LABEL_CLASS} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-left: 0;
                padding: 0 10px;
                min-height: 30px;
                height: 100%;
                background: rgba(35, 60, 81, 0.85);
                color: #c7d5e0;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
                box-sizing: border-box;
            }
        `;

        document.head.appendChild(style);
    }

    function sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
})();
