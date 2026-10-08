# ScenarijPro 🎬

**ScenarijPro** is a focused writing workspace that helps screenwriters turn ideas into organized film and TV scripts. Scenes, dialogue, characters, and saved versions stay together in a clean interface designed for writing on both desktop and mobile.

**Live demo:** [Open ScenarijPro](https://scenarij-app.onrender.com)

## Features

- registration and session-based authentication;
- private scenario workspaces and read-only public demos;
- screenplay editor with scene, action, character, and dialogue formatting;
- character renaming, text analysis, and saved versions;
- responsive desktop and mobile interface.

## Tech Stack

- Node.js and Express
- PostgreSQL with Sequelize
- HTML, CSS, and vanilla JavaScript
- Neon for the hosted database and Render for deployment

## Local Setup

```bash
git clone https://github.com/hhadzicc/scenarij-app.git
cd scenarij-app
npm install
```

Create a private `.env` file based on `.env.example`, then start the application:

```bash
npm start
```

The application runs at `http://localhost:3000`. Database migrations and demo data are applied automatically on startup.
