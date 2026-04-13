# ⚡ Service Hub — GPT Subscription Activation

A premium web interface for activating ChatGPT Plus, Pro, and Team subscriptions using CDK codes.

## Features

- 🔐 **CDK Code Verification** — Validate activation codes instantly
- 🔑 **Dual Auth Support** — Session token or email-based activation
- ⚡ **Real-time Status Polling** — Live progress tracking during activation
- 🎨 **Premium Dark UI** — Glassmorphism design with smooth animations
- 📱 **Fully Responsive** — Works on desktop and mobile
- 🌐 **Smart API Layer** — Auto-fallback through multiple connection methods

## Quick Start

### Local Development
```bash
npx -y serve@latest . -l 3000
```
Open [http://localhost:3000](http://localhost:3000)

### Deploy to Vercel
1. Push to GitHub
2. Import on [vercel.com](https://vercel.com)
3. Done! The `vercel.json` handles API proxying automatically

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **API**: [ai-redeem.cc](https://ai-redeem.cc) CDK Activation API
- **Hosting**: Vercel (recommended) / Any static host

## API Flow

```
1. POST /cdk-activation/check     → Verify CDK code
2. POST /cdk-activation/outstock  → Start activation
3. GET  /cdk-activation/tasks/:id → Poll status
```

## License

© 2026 Service Hub. All rights reserved.
