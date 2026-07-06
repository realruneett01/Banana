/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { CustomElement, WithContext, css } from "../base/web-components";

const common_styles = css`
    :host {
        box-sizing: border-box;
    }

    :host *,
    :host *::before,
    :host *::after {
        box-sizing: inherit;
    }

    [hidden] {
        display: none !important;
    }

    :host {
        scrollbar-width: thin;
        scrollbar-color: #ae81ff #282634;
    }

    ::-webkit-scrollbar {
        position: absolute;
        width: 6px;
        height: 6px;
        margin-left: -6px;
        background: var(--scrollbar-bg);
    }

    ::-webkit-scrollbar-thumb {
        position: absolute;
        background: var(--scrollbar-fg);
    }

    ::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-hover-fg);
    }

    ::-webkit-scrollbar-thumb:active {
        background: var(--scrollbar-active-fg);
    }

    .invert-scrollbar::-webkit-scrollbar {
        position: absolute;
        width: 6px;
        height: 6px;
        margin-left: -6px;
        background: var(--scrollbar-fg);
    }

    .invert-scrollbar::-webkit-scrollbar-thumb {
        position: absolute;
        background: var(--scrollbar-bg);
    }

    .invert-scrollbar::-webkit-scrollbar-thumb:hover {
        background: var(--scrollbar-hover-bg);
    }

    .invert-scrollbar::-webkit-scrollbar-thumb:active {
        background: var(--scrollbar-active-bg);
    }

    .github-login-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        color: #fff;
        text-decoration: none;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 500;
        transition:
            background 0.2s,
            border-color 0.2s;
        cursor: pointer;
        font-family: inherit;
    }
    .github-login-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.3);
    }
    .github-login-btn img {
        width: 16px;
        height: 16px;
    }

    .user-profile-menu {
        position: relative;
        display: inline-block;
    }
    .user-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.2);
        cursor: pointer;
        transition: border-color 0.2s;
        display: block;
    }
    .user-avatar:hover,
    .user-profile-menu.active .user-avatar {
        border-color: #81eeff;
    }

    .user-dropdown-content {
        display: none;
        position: absolute;
        right: 0;
        top: 38px;
        background: #1e1b29;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        min-width: 180px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        z-index: 1000;
        padding: 12px;
        flex-direction: column;
        gap: 10px;
    }
    .user-profile-menu.active .user-dropdown-content {
        display: flex;
    }
    .user-info {
        font-size: 12px;
        color: #aaa;
        white-space: nowrap;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 8px;
        text-align: left;
    }
    .user-info strong {
        color: #fff;
        display: block;
        font-size: 13px;
    }
    .logout-btn {
        background: #ef4444;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        width: 100%;
        text-align: center;
    }
    .logout-btn:hover {
        background: #dc2626;
    }
`;

/**
 * Base element for all kc-ui-* elements
 */
export class KCUIElement extends WithContext(CustomElement) {
    static override styles = [common_styles];
}
