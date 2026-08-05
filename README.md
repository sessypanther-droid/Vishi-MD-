# Ultra Advanced Bot Base V2.0

## Ultra Speed Advanced WhatsApp Bot — Status Timer + Video + Custom About + Settings

---

## Features

### Status Timer System
- Automatic text status posting at scheduled intervals
- Custom status messages with rotate/random/fixed modes
- Real-time statistics tracking
- Owner controls for interval, messages, and toggle

### Status Video System
- Automatic video status posting
- Add multiple video URLs
- Configurable video posting interval
- Video stats and toggle control

### Custom About/Bio System
- Fully customizable WhatsApp About text
- **Bot name auto-included** in about text using `{BOTNAME}` placeholder
- Multiple display styles (simple, advanced, dynamic)
- Configurable update intervals
- Auto-update with uptime and time display

### Bot Rename
- Change bot display name anytime
- New name auto-applied in about text
- Custom logo URL support

### Settings Menu
- Complete settings panel with all features
- Quick access to all configuration options
- Visual menu with categories

### Advanced Features
- Ultra-speed message processing
- Anti-vanish status protection
- Auto status save
- Newsletter auto-follow & react
- Delete message detection
- Anti-bot, anti-bad word, anti-link protection
- Auto read, auto react, auto typing

---

## Commands

### Settings Menu
| Command | Description |
|---------|-------------|
| `.settings` | Complete settings menu with all options |

### Bot Rename
| Command | Description |
|---------|-------------|
| `.rename <name>` | Change bot display name |
| `.setlogo <url>` | Change bot logo image |

### Status Timer (Text)
| Command | Description |
|---------|-------------|
| `.setstatusmsg <m1> \| <m2>` | Set status messages |
| `.setinterval <min>` | Set text posting interval |
| `.statustoggle` | Enable/disable timer |
| `.statusnow` | Post status immediately |
| `.statusstats` | View timer statistics |

### Status Video
| Command | Description |
|---------|-------------|
| `.addvideo <url>` | Add video status URL |
| `.setvideointerval <min>` | Set video posting interval |
| `.videotoggle` | Enable/disable video status |
| `.postvideonow` | Post video immediately |
| `.videostats` | View video stats |
| `.removevideos` | Clear all video URLs |

### Custom About (with Bot Name)
| Command | Description |
|---------|-------------|
| `.setabout <text>` | Set about text (use `{BOTNAME}` for auto name) |
| `.aboutstyle <style>` | Change style (simple/advanced/dynamic) |
| `.aboutprefix <icon>` | Set prefix icon |
| `.setabout --reset` | Reset to default |
| `.abouttoggle` | Enable/disable auto-update |
| `.aboutinterval <min>` | Set update interval |
| `.aboutinfo` | View current settings |

### General Settings
| Command | Description |
|---------|-------------|
| `.worktype <type>` | public/private/inbox/groups |
| `.autoread <on\|off>` | Toggle auto read |
| `.autoreact <on\|off>` | Toggle auto react |
| `.autotyping <on\|off>` | Toggle auto typing |
| `.alwaysonline <on\|off>` | Toggle always online |
| `.antibot <on\|off>` | Toggle anti-bot |
| `.antilink <on\|off>` | Toggle anti-link |
| `.antibad <on\|off>` | Toggle anti-bad word |
| `.prefix <symbol>` | Change command prefix |

### System Commands
| Command | Description |
|---------|-------------|
| `.ping` | Ultra-speed ping test |
| `.system` | Complete system info |
| `.uptime` | Bot uptime display |
| `.savestatus` | Save viewed status |
| `.menu` | Main menu |

---

## About Text Examples

### Using {BOTNAME} placeholder (auto-replaced with actual bot name):
```
.setabout ⚡ {BOTNAME} | Running 24/7 | Ultra Speed Mode
```
If bot name is "Raviya Bot", about becomes:
```
⚡ Raviya Bot | Running 24/7 | Ultra Speed Mode
```

### Styles:
- **simple**: `⚡ Raviya Bot | Running 24/7`
- **advanced**: Multi-line with time, uptime, and bot name
- **dynamic**: Single line with all info

---

## Setup

1. Install dependencies: `npm install`
2. Set MongoDB URI: `export MONGODB_URI=your_mongodb_uri`
3. Set owner number: Edit `config.js` → `OWNER_NUMBER`
4. Start bot: `npm start`
5. Visit `http://localhost:3000` to pair your number
6. Enter the pairing code in WhatsApp

---

## Configuration

All settings in `config.js`:

- `PREFIX` - Command prefix (default: `.`)
- `OWNER_NUMBER` - Your WhatsApp number
- `WORK_TYPE` - public/private/inbox/groups
- `BOT_NAME` - Default bot name
- `STATUS_TIMER_ENABLED` - Enable status timer
- `STATUS_TIMER_INTERVAL` - Minutes between posts
- `STATUS_VIDEO_ENABLED` - Enable video status
- `STATUS_VIDEO_INTERVAL` - Minutes between video posts
- `CUSTOM_ABOUT_ENABLED` - Enable custom about
- `CUSTOM_ABOUT_UPDATE_INTERVAL` - Minutes between updates
- `CUSTOM_ABOUT_INCLUDE_BOTNAME` - Auto include bot name in about

---

## Tech Stack

- **Engine:** Baileys (WhatsApp Web API)
- **Database:** MongoDB
- **Runtime:** Node.js 20+
- **Web Server:** Express.js
- **Authentication:** Multi-device pairing

---

**Powered by Ultra Advanced Bot Base V2.0**
