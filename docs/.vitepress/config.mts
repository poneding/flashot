import { defineConfig } from "vitepress";

export default defineConfig({
  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ["superpowers/**"],

  // Top-level site identity for nav bar branding
  title: "Flashot",

  head: [
    ["link", { rel: "icon", href: "/app-logo.svg" }],
    ["meta", { name: "theme-color", content: "#ffce4c" }],
  ],

  // IMPORTANT: Use "root" as the English locale key (not "/").
  // Non-root locale keys must NOT have leading/trailing slashes.
  // VitePress's getLocaleForPath uses `/${key}/` regex to match
  // the current path; slashes in keys produce invalid patterns.
  locales: {
    root: {
      lang: "en-US",
      label: "English",
      title: "Flashot",
      description:
        "Fast, lightweight screenshot tool built with Tauri + React",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/guide/installation" },
          { text: "Features", link: "/features/capture" },
          { text: "Development", link: "/development/setup" },
        ],
        sidebar: {
          "/guide/": [
            {
              text: "Guide",
              items: [
                { text: "Installation", link: "/guide/installation" },
                { text: "Getting Started", link: "/guide/getting-started" },
                { text: "Settings", link: "/guide/settings" },
              ],
            },
          ],
          "/features/": [
            {
              text: "Features",
              items: [
                { text: "Screen Capture", link: "/features/capture" },
                { text: "Annotation", link: "/features/annotation" },
                { text: "Image Adjustments", link: "/features/adjustments" },
                { text: "Color Picker", link: "/features/color-picker" },
                { text: "Pin", link: "/features/pin" },
                { text: "Scroll Capture", link: "/features/scroll-capture" },
              ],
            },
          ],
          "/development/": [
            {
              text: "Development",
              items: [
                { text: "Setup", link: "/development/setup" },
                { text: "Architecture", link: "/development/architecture" },
                { text: "Contributing", link: "/development/contributing" },
              ],
            },
          ],
        },
      },
    },
    "zh-CN": {
      lang: "zh-CN",
      label: "简体中文",
      title: "Flashot",
      description: "快速、轻量的截图工具，基于 Tauri + React",
      themeConfig: {
        nav: [
          { text: "指南", link: "/zh-CN/guide/installation" },
          { text: "功能", link: "/zh-CN/features/capture" },
          { text: "开发", link: "/zh-CN/development/setup" },
        ],
        sidebar: {
          "/zh-CN/guide/": [
            {
              text: "指南",
              items: [
                { text: "安装", link: "/zh-CN/guide/installation" },
                { text: "快速上手", link: "/zh-CN/guide/getting-started" },
                { text: "设置", link: "/zh-CN/guide/settings" },
              ],
            },
          ],
          "/zh-CN/features/": [
            {
              text: "功能",
              items: [
                { text: "屏幕截取", link: "/zh-CN/features/capture" },
                { text: "标注工具", link: "/zh-CN/features/annotation" },
                { text: "图像调整", link: "/zh-CN/features/adjustments" },
                { text: "取色器", link: "/zh-CN/features/color-picker" },
                { text: "图钉", link: "/zh-CN/features/pin" },
                { text: "滚动截屏", link: "/zh-CN/features/scroll-capture" },
              ],
            },
          ],
          "/zh-CN/development/": [
            {
              text: "开发",
              items: [
                { text: "环境搭建", link: "/zh-CN/development/setup" },
                { text: "架构概览", link: "/zh-CN/development/architecture" },
                { text: "贡献指南", link: "/zh-CN/development/contributing" },
              ],
            },
          ],
        },
      },
    },
    "zh-TW": {
      lang: "zh-TW",
      label: "繁體中文",
      title: "Flashot",
      description: "快速、輕量的截圖工具，基於 Tauri + React",
      themeConfig: {
        nav: [
          { text: "指南", link: "/zh-TW/guide/installation" },
          { text: "功能", link: "/zh-TW/features/capture" },
          { text: "開發", link: "/zh-TW/development/setup" },
        ],
        sidebar: {
          "/zh-TW/guide/": [
            {
              text: "指南",
              items: [
                { text: "安裝", link: "/zh-TW/guide/installation" },
                { text: "快速上手", link: "/zh-TW/guide/getting-started" },
                { text: "設定", link: "/zh-TW/guide/settings" },
              ],
            },
          ],
          "/zh-TW/features/": [
            {
              text: "功能",
              items: [
                { text: "螢幕擷取", link: "/zh-TW/features/capture" },
                { text: "標註工具", link: "/zh-TW/features/annotation" },
                { text: "影像調整", link: "/zh-TW/features/adjustments" },
                { text: "取色器", link: "/zh-TW/features/color-picker" },
                { text: "圖釘", link: "/zh-TW/features/pin" },
                { text: "滾動截圖", link: "/zh-TW/features/scroll-capture" },
              ],
            },
          ],
          "/zh-TW/development/": [
            {
              text: "開發",
              items: [
                { text: "環境建置", link: "/zh-TW/development/setup" },
                { text: "架構概覽", link: "/zh-TW/development/architecture" },
                { text: "貢獻指南", link: "/zh-TW/development/contributing" },
              ],
            },
          ],
        },
      },
    },
  },

  // Shared theme config (merged with per-locale themeConfig)
  themeConfig: {
    logo: "/app-logo.svg",

    socialLinks: [
      { icon: "github", link: "https://github.com/poneding/flashot" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024-present poneding",
    },

    editLink: {
      pattern: "https://github.com/poneding/flashot/edit/master/docs/:path",
    },
  },
});
