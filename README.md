<div align="center">

<img src="public/LOGO-2.svg" width="140" alt="山海同行 Logo" />

# 山海同行 · Travel Together

**专为好友与团队打造的「轻量沉浸式旅行协作 × 文创手账」WebApp (PWA)**

*A lightweight, immersive travel-collaboration & cultural-journal WebApp (PWA) for friends & teams*

与君同行，山海皆可平 · *Every mountain and sea grows small when we walk together*

[![License: MIT](https://img.shields.io/badge/License-MIT-8A6D3B?style=flat-square)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&style=flat-square)](https://react.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?logo=postgresql&style=flat-square)](https://supabase.com)
[![OpenStreetMap](https://img.shields.io/badge/Map-OpenStreetMap-7EBC6F?logo=openstreetmap&style=flat-square)](https://www.openstreetmap.org)
[![Vite](https://img.shields.io/badge/Vite-build-646CFF?logo=vite&style=flat-square)](https://vitejs.dev)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?style=flat-square)](public/manifest.json)

**[中文说明](#-中文文档)** | **[English Documentation](#-english-documentation)**

</div>

---

<a name="-中文文档"></a>

## 📖 项目简介

一次旅行，从建团那一刻起，就有聊不完的话、订不完的酒店、记不完的账。**《山海同行》** 把这一切收进一枚可以装进口袋的「数字手账」：

它不是又一个冷冰冰的行程管理工具，而是一个**有温度的协作空间**——地图上跳动的队友实时位置、打卡即得的齿轮邮票、深夜群里弹出的一条推送，都是为了让「一起出发」这件事更轻盈、更像一场共同创作。

> 💡 **核心定位**：**轻量沉浸式旅行协作与文创手账 WebApp (PWA)** —— 无需前往应用商店，手机浏览器“添加到主屏幕”即可获得原生 App 级流畅体验。

---

## ✨ 全维度核心功能

### 🗺️ 智能地图导览 · Smart Map Companion
- **极简矢量底图**：基于 **OpenStreetMap (OSM)** 开源地图数据与 MapLibre 引擎，**彻底免除商业 API Key、永久无限量**
- **层级自适应地标**：街区尺度显示圆形封面照片与地标徽章，广域缩小自动折叠为金色星星 ⭐，地图层次分明不凌乱
- **全生态地图导航跳转**：打卡点、餐厅、酒店均支持一键唤起 **Google Maps / Apple Maps / 高德地图 / 百度地图** 规划路线

### 📅 全要素规划 · Full-Spectrum Planning
- **物品清单**：全团行李打包进度实时协同跟踪，谁带了转换插头一目了然；支持清单一键纯文本导出、一键重置打勾与批量清空
- **每日行程**：多天时间轴路线精细化管理
- **美食规划**：**特色菜**（前菜/主菜/甜点/小吃结构化呈现）与 **精选餐厅**（早/午/晚/下午茶全餐段、地址自动精准定位、必点菜单）双板块协同
- **酒店住宿**：可视化日历选择入住/退房日期，地图小房子专属地标与定位飞行联动

### 📮 艺术足迹集邮 · Artistic Stamp Collection
- **实体齿轮邮票质感**：沉浸式多列照片瀑布流，深色模式纯白衬底、浅色模式满幅照片自适应
- **一键导出 6:4 实体画框明信片**：
  - 自动瀑布流拼版、内置**上元明朝体**典雅排版
  - 呈现**金色实木相框 + 博物馆级白色卡纸内衬装裱**质感
  - 支持画板随机打乱重排、手机端系统原生分享（微信/相册保存等）

### 🧾 智能票据记账 · Smart Receipt Ledger
- **多币种灵活独立记录**：支持 EUR / USD / CNY / JPY 等自由记账，不搞复杂的强制折算
- **多图发票凭证归档**：支持一张票据关联多张收据小票，自适应拼图查看与全屏双指缩放
- **团队共享 × 个人私账**分类，成员真实头像与专属首字母色彩联动，每一笔支出清晰透明

### 💬 实时群聊与推送 · Realtime Chat & Push
- 基于 WebSocket (Realtime) 的行程群聊，支持**消息长按撤回**与**一键「重新编辑」自动回填输入框**
- 类似微信的高度自适应伸缩输入框
- **Web Push 系统原生通知**：队友发消息，手机锁屏也能接收推送

### 🏛️ 博物馆文创百科 · Museum Culture Encyclopedia
- **高清导览图多图展示**，支持双指自由放大查看房间号与文字细节
- **Word / 纯文本一键双向图文导入与导出**：攻略在电脑上写好，拖入即自动结构化解析；已有百科亦可一键导出图文 Word 归档

---

## 🧱 技术栈与零成本架构 · Tech Stack

全栈架构精心打磨，实现 **100% 运行在免费托管层（Zero Running Cost）**，且完全开放，不强制绑定特定厂商：

| 层级 Layer | 技术选型 Technologies | 架构与开源说明 |
| --- | --- | --- |
| 前端 Frontend | **React 19** · TanStack Start / Router · **Vite** · **Tailwind CSS v4** · Lucide Icons | 标准 PWA 应用，可部署于 Vercel / Cloudflare / Docker / Nginx |
| 视觉与渲染 Visuals | **Canvas API**（明信片生成）· **MapLibre GL** · **OpenStreetMap (OSM)** | 永久免费开源底图，零 API Key 限制 |
| 后端与数据库 Backend | **PostgreSQL**（基于 Supabase SDK / REST / Realtime） | 支持 Supabase 免费云服务，亦支持 Docker 自建私有化部署 |
| 消息推送 Push | **Serverless Function** (`api/send-push.ts` · Web Push 协议) | Vercel 免运维函数，或任何 Node.js 服务端环境 |
| 字体资产 Fonts | 上元明朝体（LanternMing）· 余繁新语（YuFanXinYu）· Iceland | [详见开源字体授权声明](public/fonts/MIT%20License.txt) |

---

## 🚀 5 分钟极速上手 · Quick Start

### 1. 克隆仓库与依赖安装

```bash
git clone https://github.com/YOUR_USERNAME/travel-together.git
cd travel-together
npm install
```

### 2. 数据库一键初始化（约 1 分钟）

本项目使用标准的 PostgreSQL 数据库（开箱支持 Supabase）：

1. 前往 supabase.com 免费注册并新建项目（或使用自建 Docker 版 Supabase）；
2. 在左侧菜单打开 SQL Editor ➔ 点击 + New query；
3. 将项目根目录下的 supabase/schema.sql 文件中的全部内容复制粘贴进去，点击 Run；

瞬间完成：18 张业务数据表、完整 RLS 安全策略、存储桶与 Realtime 广播全自动就绪！

### 3. 配置环境变量（约 1 分钟）

```bash
cp .env.example .env
```

打开 .env 文件，填入你的数据库连接密钥（可在 Supabase 控制台的 Project Settings → API 中找到）：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-anon-key
```

(可选系统级消息推送)：运行 npx web-push generate-vapid-keys 生成密钥对，将公钥填入 VITE_VAPID_PUBLIC_KEY。

### 4. 本地启动开发环境

```bash
npm run dev
```

打开浏览器访问 http://localhost:5173 ，即可体验完整的《山海同行》！

### 💡 内置开箱即用模板（快速填充测试数据）

项目在 docs/templates/ 目录下为你准备了中英双语的纯文本示范导入文件，点击界面中的【导入】按钮即可一秒生成真实丰富的旅行内容：

| 模块分类 | 中文示范模板 (Chinese) | 英文示范模板 (English) | 说明 |
| --- | --- | --- | --- |
| 行程规划 | 01_行程规划_导入模板.txt | 01_Itinerary_Template_EN.txt | 3 天多时段精细日程时间轴 |
| 美食特色菜 | 02_美食特色菜_导入模板.txt | 02_Local_Dishes_Template_EN.txt | 前菜、主菜、甜点与小吃 |
| 精选餐厅 | 03_精选餐厅_导入模板.txt | 03_Restaurants_Template_EN.txt | 含餐段、营业时间与精准地图坐标 |
| 博物馆百科 | 04_百科卡片_导入模板.txt | 04_Museum_Encyclopedia_Template_EN.txt | 圣母百花大教堂大穹顶与核心展品 |

---

## 🌐 自由部署上线 (Deployment)

你可以根据喜好自由选择部署平台：

**选项 A：Vercel 一键托管（推荐）**

1. 登录 Vercel 官网，导入你的 GitHub 仓库；
2. 在 Settings ➔ Environment Variables 中配置环境变量（参考 .env.example）；
3. 点击 Deploy 即可上线。

**选项 B：自建 Docker / 静态服务器部署**

运行 npm run build 生成生产产物，即可将 dist/ 静态文件通过 Nginx、Caddy 或 Cloudflare Pages 进行托管。

---

## 📄 开源协议与版权声明 · License & Copyright

本项目源代码基于 MIT License 自由开源——山与海属于每一个出发的人。

> ⚠️ **商标与品牌形象保护声明 (TRADEMARK & LOGO NOTICE)**：
> 本项目的原创名称（《山海同行》 / Travel Together）、原创 LOGO 矢量图形及应用图标版权归原作者个人所有。
> MIT 开源协议不包含对本项目 LOGO、品牌名称、定制图标等知识产权的商用授权。未经原作者事先书面许可，任何个人或组织不得将该 LOGO 和品牌用于商业用途或二次包装发布。详见 LICENSE 结尾的专门条款。

---

<a name="-english-documentation"></a>

## 🌍 English Documentation

<div align="center">

### Travel Together

*A lightweight, immersive travel-collaboration & cultural-journal WebApp (PWA) for friends & teams*

*Every mountain and sea grows small when we walk together*

**[中文文档](#-中文文档)** | **[English Documentation](#-english-documentation)**

</div>

## 📖 Overview

From the moment a trip group is formed, there are endless chats, hotel bookings, and split expenses. Travel Together folds all of it into a pocket-sized digital hand-account:

It is not another cold, utilitarian itinerary tool, but a collaboration space with soul: teammates' avatars pulsing live on the map, perforated stamps earned with each photo check-in, and lock-screen push notifications when a friend drops a midnight note.

> 💡 **Core Identity**: A Lightweight, Immersive Travel-Collaboration & Cultural-Journal PWA — installable right from your mobile browser with zero app store hassle for a native-app feel.

---

## ✨ Full-Spectrum Features

### 🗺️ Smart Map Companion
- **Keyless Vector Basemaps**: Powered by OpenStreetMap (OSM) and MapLibre GL — 100% key-free, unmetered, and permanently accessible.
- **Zoom-Adaptive Landmarks**: Expands to circular photo badges at street level; collapses smoothly into golden stars ⭐ at macro scale for clean readability.
- **Universal Multi-Map Navigation**: Tap any check-in, restaurant, or hotel to hand off navigation directly to Google Maps, Apple Maps, AMap (高德), or Baidu Maps.

### 📅 Full-Spectrum Planning
- **Packing Checklist**: Real-time collaborative packing progress; see who has packed what at a glance. Supports one-tap plain-text export, checkmark reset, and batch clear.
- **Daily Timeline Itinerary**: Multi-day schedule and activity management.
- **Gastronomy Planner**: Dual views for Local Specialties (structured courses: Starters, Mains, Desserts, Snacks) and Curated Restaurants (meal categories, auto-geocoded coordinates, must-order menus).
- **Hotel Accommodations**: Visual calendar picker for check-in/out dates, synced to dedicated map house landmarks with camera fly-to animation.

### 📮 Artistic Stamp Collection
- **Authentic Perforated Postage Stamps**: Multi-column responsive photo waterfall with adaptive borders (solid white in Dark Mode, borderless full-bleed in Light Mode).
- **One-Tap 6:4 Framed-Postcard Export**:
  - Auto-waterfall collage layout on an ultra-crisp canvas.
  - Elegant typography powered by LanternMing (上元明朝体).
  - Rendered with solid golden-wood frame + museum-grade white matting.
  - Shuffle button to re-randomize stamp layouts; native OS sharing (WeChat, AirDrop, Save to Photos).

### 🧾 Smart Receipt Ledger
- **Flexible Multi-Currency Records**: Freely log in EUR, USD, CNY, JPY, etc., without forced artificial conversions.
- **Multi-Image Receipts**: Attach invoices, itemized bills, and card slips with auto-collage preview and pinch-to-zoom full-screen lightbox.
- **Shared vs. Personal Split**: Filter between Team Shared and Personal entries, synced with authentic member avatars and custom initials.

### 💬 Realtime Chat & Push
- Realtime group chat powered by WebSockets, featuring message recall and one-tap "re-edit" auto-refill.
- WeChat-style auto-expanding and scrollable textarea.
- Native Web Push Notifications: Receive lock-screen notifications when teammates send messages, dispatched via lightweight serverless functions.

### 🏛️ Museum Culture Encyclopedia
- **High-Definition Multi-Image Floor Maps**: Zoom in with double-finger pinch gestures to inspect gallery room numbers and labels.
- **Two-Way Word / Plain-Text Import & Export**: Write guides in Word or plain text and import them with one click; export existing museum cards into illustrated Word documents anytime.

---

## 🧱 Tech Stack & Zero-Cost Architecture

Engineered to run 100% within free-tier limits (Zero Running Cost) without vendor lock-in:

| Layer | Technologies | Architecture Notes |
| --- | --- | --- |
| Frontend | **React 19** · TanStack Start / Router · **Vite** · **Tailwind CSS v4** · Lucide Icons | Installable PWA; deployable on Vercel, Cloudflare, Netlify, or Docker |
| Map & Visuals | **Canvas API** · **MapLibre GL** · **OpenStreetMap (OSM)** | Key-free open-source vector tiles; zero API billings |
| Backend & DB | **PostgreSQL** (via Supabase SDK / REST / Realtime) | 500MB free cloud tier with full RLS security; Docker self-hosting ready |
| Push Engine | **Serverless Function** (`api/send-push.ts` · Web Push protocol) | Zero-maintenance lightweight push dispatcher |
| Open Fonts | LanternMing (上元明朝体) · YuFanXinYu (余繁新语) · Iceland | [See Open Font Licenses](public/fonts/MIT%20License.txt) |

---

## 🚀 Quick Start (5 Minutes)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/YOUR_USERNAME/travel-together.git
cd travel-together
npm install
```

### 2. One-Click Database Initialization (1 min)

This project runs on standard PostgreSQL (with native Supabase support):

1. Create a free project on supabase.com (or launch your own Dockerized Supabase instance);
2. Open the SQL Editor from the left navigation ➔ click + New query;
3. Copy the entire contents of supabase/schema.sql, paste it into the editor, and click Run;

Done: All 18 database tables, RLS security policies, storage buckets, and Realtime publications are created automatically!

### 3. Configure Environment Variables (1 min)

```bash
cp .env.example .env
```

Open .env and fill in your Supabase connection parameters (found in Project Settings → API):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-anon-key
```

(Optional for Web Push): Run npx web-push generate-vapid-keys and paste the generated public key into VITE_VAPID_PUBLIC_KEY.

### 4. Run Locally

```bash
npm run dev
```

Open http://localhost:5173 in your browser to start exploring!

### 💡 Built-In Quick-Start Templates (Bilingual)

Sample plain-text templates are provided in docs/templates/ for instant testing without manual typing — click the Import button in each module to generate rich, realistic travel content in one second:

| Module | English Template | Chinese Template | Description |
| --- | --- | --- | --- |
| Itinerary | 01_Itinerary_Template_EN.txt | 01_行程规划_导入模板.txt | 3-day timeline schedule |
| Local Dishes | 02_Local_Dishes_Template_EN.txt | 02_美食特色菜_导入模板.txt | Starters, mains, desserts, snacks |
| Restaurants | 03_Restaurants_Template_EN.txt | 03_精选餐厅_导入模板.txt | Meal types, hours & GPS coordinates |
| Museum Encyclopedia | 04_Museum_Encyclopedia_Template_EN.txt | 04_百科卡片_导入模板.txt | Florence Cathedral history & exhibits |

---

## 🌐 Deployment Options

Deploy anywhere you prefer:

**Option A: Vercel (Recommended 1-Click)**

1. Import your GitHub repository into Vercel;
2. Configure your Environment Variables in Settings ➔ Environment Variables (refer to .env.example);
3. Click Deploy.

**Option B: Docker / Self-Hosted Static Server**

Run npm run build to generate the production build. Host the static dist/ directory via Nginx, Caddy, or Cloudflare Pages.

---

## 📄 License & Copyright Notice

The source code of this project is licensed under the MIT License.

> ⚠️ **Trademark & Brand Design Notice (TRADEMARK & LOGO NOTICE)**:
> The original project name ("山海同行" / "Travel Together"), original SVG logo artwork, and application icon designs are the exclusive intellectual property of the original author (All Rights Reserved).
> The MIT License does NOT grant any permission to use, copy, modify, or redistribute the project's distinctive logo, brand assets, or trademarks for commercial purposes or derived products without explicit prior written authorization. See the dedicated clause in LICENSE.
